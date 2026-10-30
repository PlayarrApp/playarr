package io.playarr.mobile.ui

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.compositeOver
import io.playarr.shared.designsystem.theme.PlayarrWebTheme
import io.playarr.shared.designsystem.page.parityBoxes
import io.playarr.shared.designsystem.page.parityLayoutEnabled
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Debug builds only (docs/parity/LAYOUT.md): `am broadcast -a io.playarr.mobile.PARITY_LAYOUT` makes the app write what it laid out to
 * `files/parity-layout.json`. It reads nothing but the running app:
 *  - one `text` (or `heading`, when the node is a Compose heading) element per laid-out line, from the app's own TextLayoutResult
 *    (line left and right, line top and bottom) through the node's real window transform, with the resolved text style;
 *  - one control element per merged semantics node that is clickable, has a Role, is a slider or is an editable field, named by its
 *    real contentDescription or text, with the role Android reports (a clickable without a Role is a `button`) and the corner radius
 *    the control's shape declares, resolved against its measured size;
 *  - the `parityBox` records: painted containers, images and dots, by measured bounds.
 * Elements wholly outside the viewport, clipped away, hidden from accessibility or covered by a higher opaque window are not exported.
 * Colours are the ones the app passed to its paint calls (parityBackground and friends), composited over their tree ancestors. Units are converted by the display density only.
 */
internal object PlayarrLayoutExport {
    const val ACTION = "io.playarr.mobile.PARITY_LAYOUT"
    /** `am broadcast -a io.playarr.mobile.PARITY_COVER --ez on true|false --es ids 1,2`: hides (or shows again) every window below the topmost one and skips the paint of the listed parity boxes, so the capture script can screenshot the screen without them. */
    const val COVER_ACTION = "io.playarr.mobile.PARITY_COVER"

    fun install(activity: Activity) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val screen = intent.getStringExtra("screen").orEmpty()
                val theme = intent.getStringExtra("theme").orEmpty()
                val captureId = intent.getStringExtra("id").orEmpty()
                val file = File(activity.filesDir, "parity-layout.json").also { it.delete() }
                val candidates = intent.getBooleanExtra("rendered", false)
                runCatching { export(activity, screen, theme, captureId, file, candidates) }.onFailure { parityLog("layout_export failed ${it.javaClass.simpleName} ${it.message?.take(120)}") }
            }
        }
        androidx.core.content.ContextCompat.registerReceiver(activity, receiver, IntentFilter(ACTION), androidx.core.content.ContextCompat.RECEIVER_EXPORTED)
        val cover = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val hide = intent.getBooleanExtra("on", false)
                val shown = rootViews(activity).filter { it.isShown || it === activity.window.decorView || it.alpha == 0f }
                shown.dropLast(1).forEach { it.alpha = if (hide) 0f else 1f }
                // Boxes whose paint is skipped (the covers of same-window candidates).
                io.playarr.shared.designsystem.page.parityHiddenBoxes.value = intent.getStringExtra("ids").orEmpty().split(',').mapNotNull { it.toIntOrNull() }.toSet()
            }
        }
        androidx.core.content.ContextCompat.registerReceiver(activity, cover, IntentFilter(COVER_ACTION), androidx.core.content.ContextCompat.RECEIVER_EXPORTED)
    }

    private fun composeViews(root: View, out: MutableList<View>) {
        if (root.javaClass.name == "androidx.compose.ui.platform.AndroidComposeView") out += root
        if (root is ViewGroup) for (i in 0 until root.childCount) composeViews(root.getChildAt(i), out)
    }

    /** Every window of the app, bottom to top, through the hidden window manager root list (the main one and dialogs such as the drawers). */
    private fun rootViews(activity: Activity): List<View> {
        val roots = mutableListOf<View>()
        runCatching {
            val global = Class.forName("android.view.WindowManagerGlobal").getMethod("getInstance").invoke(null)
            @Suppress("UNCHECKED_CAST")
            val views = global.javaClass.getDeclaredField("mViews").apply { isAccessible = true }.get(global) as List<View>
            roots += views
        }
        // No silent fallback to the activity window: dialogs would be missing from the document. The capture fails instead.
        check(roots.isNotEmpty()) { "window manager roots unreadable" }
        return roots
    }

    private class Item(val window: Int, val json: JSONObject, val x: Float, val y: Float, val w: Float, val h: Float, var occludes: Boolean, val hook: Boolean = false, val boxId: Int = -1, val controlBoxes: Set<Int>? = null, val order: Int = -1, val end: Int = -1, val chain: List<Int> = emptyList())

    private fun export(activity: Activity, screen: String, theme: String, captureId: String, file: File, candidates: Boolean) {
        val mainView = activity.window.decorView
        val width = mainView.width.toFloat(); val height = mainView.height.toFloat()
        val unit = 1f / activity.resources.displayMetrics.density
        val main = IntArray(2).also { mainView.getLocationOnScreen(it) }
        val items = mutableListOf<Item>()
        // A dialog window is hosted in the activity (web: inside the shell), so its fills composite over the first window's outermost painted box, not over white.
        var base: androidx.compose.ui.graphics.Color? = null
        val pending = mutableListOf<Triple<JSONObject, Int, Boolean>>()
        val shown = rootViews(activity).filter { it.isShown || it === mainView }
        shown.forEachIndexed { windowIndex, root ->
            for (view in mutableListOf<View>().also { composeViews(root, it) }) {
                val owner = view.javaClass.getMethod("getSemanticsOwner").invoke(view) as SemanticsOwner
                val loc = IntArray(2).also { view.getLocationOnScreen(it) }
                val tree = Tree()
                chains(owner.unmergedRootSemanticsNode, emptyList(), false, tree)
                val ctx = Ctx(windowIndex, (loc[0] - main[0]).toFloat(), (loc[1] - main[1]).toFloat(), unit, width, height, items, tree, base = base)
                synchronized(parityBoxes) {
                    for (box in parityBoxes.toList()) {
                        if (box.view.rootView !== root) continue
                        val b = box.bounds() ?: continue
                        box.visible() ?: continue
                        // A box inside a subtree the app hides from accessibility (a drawer covers the page) is not shown.
                        if (box.id in tree.hiddenBoxes) continue
                        ctx.boxes[box.id] = box
                        // A layer alpha is not an element: its alpha is multiplied into everything below it.
                        if (box.kind == "alpha") continue
                        val x = b.left + ctx.dx; val y = b.top + ctx.dy
                        val e = JSONObject().put("text", if (box.kind == "video") ownerLabel(tree, box.id) else "").put("role", if (box.kind == "image") "image" else if (box.kind == "fill") "container" else if (box.kind == "img") (if (ownerIsImage(tree, box.id)) "img" else "container") else box.kind)
                            .put("rect", rect(x, y, b.width, b.height, unit)).put("color", JSONObject.NULL).put("fontSize", JSONObject.NULL).put("fontWeight", JSONObject.NULL)
                        val drawn = box.drawnRadiusPx ?: tree.own.values.firstOrNull { box.id in it }?.firstNotNullOfOrNull { ctx.boxes[it]?.drawnRadiusPx }
                        // A plain-rectangle paint inside a clipping parent keeps the clip's declared radius.
                        if (drawn != null && drawn > 0f) e.put("radius", radius(drawn * box.scale(), b.width, b.height, unit))
                        else if (box.radius > 0f) e.put("radius", radius(box.radius * box.density * box.scale(), b.width, b.height, unit))
                        val effective = box.opacity * ctx.layerAlpha(ctx.boxChain(box.id), except = box.id)
                        if (effective <= 0f) continue
                        if (effective < 1f) e.put("opacity", effective.toDouble())
                        val painted = (box.fill != androidx.compose.ui.graphics.Color.Unspecified && box.fill.alpha > 0f) || box.brushPainted
                        if (painted && box.fill != androidx.compose.ui.graphics.Color.Unspecified) ctx.fills[box.id] = box.fill
                        // kind "textfill": the pill the text node paints for itself; the text element carries it (web: one span), so it is not a second element.
                        if (box.kind == "textfill") continue
                        // A box that paints nothing (a layout wrapper, a surface without a fill) is not an element: only painted containers are exported.
                        if ((box.kind == "fill" || box.kind == "container") && !painted) continue
                        pending += Triple(e, box.id, painted)
                        ctx.add(e, x, y, b.width, b.height, occludes = box.kind == "container" && painted && box.fill != androidx.compose.ui.graphics.Color.Unspecified && box.fill.alpha >= 0.5f, hook = true, boxId = box.id)
                    }
                }
                // Like the browser's backdrop: the fills of the box's own tree ancestors (and its own), outer to inner. A box that paints nothing
                // itself (an image, a status dot) shows what its ancestors paint. A fill that is not an ancestor (a sibling backdrop layer) does not count.
                for ((e, id, _) in pending) ctx.behind(ctx.boxChain(id))?.let { e.put("background", it) }
                pending.clear()
                walkText(owner.unmergedRootSemanticsNode, ctx, hidden = false)
                walkControls(owner.rootSemanticsNode, ctx)
                if (windowIndex == 0 && base == null) base = tree.own.entries.firstNotNullOfOrNull { e -> e.value.firstNotNullOfOrNull { ctx.fills[it] } }
            }
        }
        // A higher window's opaque container covers everything of a lower window that lies wholly inside it (docs/parity/LAYOUT.md occlusion rule).
        // A container or image box that is the very box of a control exported from the same node (same rectangle) is that control, not a second element: the control carries its paint, radius and alpha.
        val controls = items.filter { it.controlBoxes != null }
        val unique: List<Item> = items.filter { h ->
            // A hook folded into its control hands its occlusion to that control: the covering paint is not lost with the duplicate record.
            val absorbed = h.hook && h.boxId >= 0 && (h.json.getString("role") == "container" || h.json.getString("role") == "image") && controls.any { c ->
                c.window == h.window && Math.abs(c.x - h.x) < 1.5f && Math.abs(c.y - h.y) < 1.5f && Math.abs(c.w - h.w) < 1.5f && Math.abs(c.h - h.h) < 1.5f && (h.boxId in c.controlBoxes!!).also { same -> if (same && h.occludes) c.occludes = true }
            }
            !absorbed
        }
        // Geometry only nominates candidates. With `covered` requested the candidates stay in the document, flagged, and the capture script decides on the
        // rendered screen (hide the window the element lives in, screenshot, keep it only if the pixels in its rectangle change). Without it they are dropped as before.
        val nominated = unique.filter { item ->
            unique.any { top -> top.window > item.window && top.occludes && item.x >= top.x && item.y >= top.y && item.x + item.w <= top.x + top.w && item.y + item.h <= top.y + top.h }
        }.toSet()
        // Same-window candidates: painted boxes (images, video, opaque containers) drawn after the element (later in paint order, outside its subtree) whose rectangles
        // together reach 90% of its area. Geometry only nominates; the rendered diff decides, with the covers' paint skipped (docs/parity/LAYOUT.md).
        val painters = unique.filter { it.hook && it.boxId >= 0 && it.order >= 0 && (it.json.getString("role") == "image" || it.json.getString("role") == "video" || (it.json.getString("role") == "container" && it.occludes)) }
        fun overlap(a: Item, b: Item): Float = maxOf(0f, minOf(a.x + a.w, b.x + b.w) - maxOf(a.x, b.x)) * maxOf(0f, minOf(a.y + a.h, b.y + b.h) - maxOf(a.y, b.y))
        val sameWindow = if (!candidates) emptyMap() else unique.filter { it !in nominated && it.order >= 0 }.mapNotNull { c ->
            val covers = painters.filter { k -> k !== c && k.window == c.window && k.order > c.end && overlap(c, k) > 0f }
            if (covers.isNotEmpty() && covers.sumOf { overlap(c, it).toDouble() } >= 0.9 * c.w * c.h) c to covers else null
        }.toMap()
        val kept = if (candidates) unique.also {
            nominated.forEach { it.json.put("covered", true) }
            sameWindow.forEach { (c, covers) -> c.json.put("covered", true).put("coverIds", JSONArray(covers.map { it.boxId })).put("chainIds", JSONArray(c.chain)) }
        } else unique.filter { it !in nominated }
        val ordered = kept.sortedWith(compareBy({ it.y }, { it.x }, { it.json.getString("role") }, { it.json.getString("text") }, { it.w })).map { it.json }
        val doc = JSONObject()
            .put("screen", screen).put("theme", theme).put("captureId", captureId).put("paletteDark", PlayarrWebTheme.palette.dark)
            .put("viewport", JSONObject().put("w", r2(width * unit)).put("h", r2(height * unit)).put("dpr", 1))
            .put("clockPinned", parityClock != null).put("occluded", if (candidates) 0 else unique.size - kept.size)
            .put("elements", JSONArray().also { arr -> ordered.forEach { arr.put(it) } })
        file.writeText(doc.toString())
        parityLog("layout_export ok count=${ordered.size}")
    }

    /** The unmerged semantics tree of one window: per node the box ids painted by it (own) and by its ancestors (chain), and the boxes the app hides. */
    private class Tree {
        val own = mutableMapOf<Int, List<Int>>()
        val chain = mutableMapOf<Int, List<Int>>()
        val hiddenBoxes = mutableSetOf<Int>()
        /** Paint order: a node's position in the depth-first walk of the unmerged tree, and the last position inside its subtree. */
        val order = mutableMapOf<Int, Int>()
        val end = mutableMapOf<Int, Int>()
        var next = 0
        /** The content description each node declares itself (before its children's are merged into it). */
        val ownLabel = mutableMapOf<Int, List<String>>()
        /** Nodes that declare the standard image role themselves. */
        val imageRole = mutableSetOf<Int>()
    }

    /** The accessible name the semantics node that carries this box declares (its own content description), or empty: never a label handed to the debug record. */
    private fun ownerLabel(tree: Tree, boxId: Int): String =
        tree.own.entries.firstOrNull { boxId in it.value }?.let { tree.ownLabel[it.key] }?.joinToString(" ").orEmpty()

    /** Whether the semantics node that carries this box declares the platform image role: a status dot or progress track is exported as an image only when the app says so. */
    private fun ownerIsImage(tree: Tree, boxId: Int): Boolean =
        tree.own.entries.firstOrNull { boxId in it.value }?.let { it.key in tree.imageRole } ?: false

    private fun chains(node: SemanticsNode, above: List<Int>, hidden: Boolean, out: Tree) {
        val own = node.config.filter { it.key.name == io.playarr.shared.designsystem.page.PARITY_BOX_KEY_NAME }.map { it.value as Int }.sorted()
        val chain = above + own
        val hide = hidden || node.config.contains(SemanticsProperties.InvisibleToUser)
        out.own[node.id] = own; out.chain[node.id] = chain
        out.order[node.id] = out.next++
        node.config.getOrNull(SemanticsProperties.ContentDescription)?.let { out.ownLabel[node.id] = it }
        if (node.config.getOrNull(SemanticsProperties.Role) == Role.Image) out.imageRole += node.id
        if (hide) out.hiddenBoxes += own
        node.children.forEach { chains(it, chain, hide, out) }
        out.end[node.id] = out.next - 1
    }

    private class Ctx(val window: Int, val dx: Float, val dy: Float, val unit: Float, val width: Float, val height: Float, val items: MutableList<Item>, val tree: Tree, val fills: MutableMap<Int, androidx.compose.ui.graphics.Color> = mutableMapOf(), val base: androidx.compose.ui.graphics.Color? = null, val boxes: MutableMap<Int, io.playarr.shared.designsystem.page.ParityBox> = mutableMapOf()) {
        fun boxChain(boxId: Int): List<Int> = tree.own.entries.firstOrNull { boxId in it.value }?.let { tree.chain[it.key] } ?: emptyList()
        /** The product of the layer alphas ([layerAlpha] boxes) of a chain, own box [except] left out. */
        fun layerAlpha(chain: List<Int>, except: Int = -1): Float = chain.fold(1f) { acc, id -> if (id == except) acc else acc * (boxes[id]?.takeIf { it.kind == "alpha" }?.opacity ?: 1f) }
        fun chainOf(node: SemanticsNode): List<Int> = tree.chain[node.id].orEmpty()
        fun ownBoxes(node: SemanticsNode) = tree.own[node.id].orEmpty().mapNotNull { boxes[it] }
        /** The colour behind an element, as the browser's backdrop: its own and its ancestors' fills composited from the outermost in, over white. */
        fun behind(chain: List<Int>): String? {
            val under = chain.mapNotNull { fills[it] }
            if (under.isEmpty()) return null
            var c = base?.copy(alpha = 1f) ?: androidx.compose.ui.graphics.Color.White
            for (f in under) c = f.compositeOver(c)
            return hex(c.toArgb())
        }
        /** Adds an element unless it lies wholly outside the viewport. Rectangles are in window px. */
        fun add(json: JSONObject, x: Float, y: Float, w: Float, h: Float, occludes: Boolean = false, hook: Boolean = false, boxId: Int = -1, controlBoxes: Set<Int>? = null, nodeId: Int = -1) {
            if (w <= 0f || h <= 0f || x >= width || y >= height || x + w <= 0f || y + h <= 0f) return
            val owner = if (nodeId >= 0) nodeId else if (boxId >= 0) tree.own.entries.firstOrNull { boxId in it.value }?.key ?: -1 else -1
            items += Item(window, json, x, y, w, h, occludes, hook, boxId, controlBoxes, tree.order[owner] ?: -1, tree.end[owner] ?: -1, if (owner >= 0) tree.chain[owner].orEmpty() else emptyList())
        }
    }

    /** The platform layout that shaped line [line] of [result], with the line's index inside it and the paragraph's first character index. Null when the layout does not expose it. */
    private fun platformLine(result: TextLayoutResult, line: Int): Triple<android.text.Layout, Int, Int>? = runCatching {
        // The compose text classes that hold the platform layout are internal, so they are read by reflection (the debug export only).
        val multi = result.multiParagraph
        val infos = multi.javaClass.methods.first { it.name.startsWith("getParagraphInfoList") }.invoke(multi) as List<*>
        val info = infos.first { i ->
            val start = i!!.javaClass.methods.first { it.name == "getStartLineIndex" }.invoke(i) as Int
            val end = i.javaClass.methods.first { it.name == "getEndLineIndex" }.invoke(i) as Int
            line >= start && line < end
        }!!
        val paragraph = info.javaClass.methods.first { it.name == "getParagraph" }.invoke(info)!!
        val field = generateSequence<Class<*>>(paragraph.javaClass) { it.superclass }.flatMap { it.declaredFields.asSequence() }.first { it.type.name == "androidx.compose.ui.text.android.TextLayout" }
        val textLayout = field.also { it.isAccessible = true }.get(paragraph)!!
        val platform = textLayout.javaClass.methods.first { it.name == "getLayout" }.invoke(textLayout) as android.text.Layout
        Triple(platform, line - (info.javaClass.methods.first { it.name == "getStartLineIndex" }.invoke(info) as Int), info.javaClass.methods.first { it.name == "getStartIndex" }.invoke(info) as Int)
    }.onFailure { parityLog("platform layout failed ${it.javaClass.simpleName} ${it.message?.take(100)}") }.getOrNull()

    /** The paint the platform text layout draws character [index] of line [line] with: the layout's paint plus the metric-affecting spans over that character. Null when the layout does not expose it. */
    private fun shapedRunPaint(result: TextLayoutResult, line: Int, index: Int): android.text.TextPaint? = runCatching {
        val (platform, _, paragraphStart) = platformLine(result, line)!!
        val paint = android.text.TextPaint(platform.paint)
        val local = index - paragraphStart
        (platform.text as? android.text.Spanned)?.getSpans(local, local + 1, android.text.style.MetricAffectingSpan::class.java)?.forEach { it.updateMeasureState(paint) }
        paint
    }.onFailure { parityLog("shaped paint failed ${it.javaClass.simpleName} ${it.message?.take(100)}") }.getOrNull()

    /** The string the platform text engine draws for an ellipsized end (its own constant, read from the framework; the export fails when the framework hides it). */
    private fun platformEllipsis(): String = runCatching {
        android.text.TextUtils::class.java.getMethod("getEllipsisString", android.text.TextUtils.TruncateAt::class.java).invoke(null, android.text.TextUtils.TruncateAt.END) as String
    }.onFailure { parityLog("platform ellipsis unavailable ${it.javaClass.simpleName} ${it.message?.take(100)}") }.getOrNull() ?: error("the platform ellipsis string is unavailable")

    private fun r2(v: Float) = Math.round(v * 100) / 100.0
    private fun rect(x: Float, y: Float, w: Float, h: Float, unit: Float) = JSONObject().put("x", r2(x * unit)).put("y", r2(y * unit)).put("w", r2(w * unit)).put("h", r2(h * unit))
    /** A declared corner radius (px) clamped to half the short side, as the drawn shape resolves it. */
    private fun radius(px: Float, w: Float, h: Float, unit: Float) = r2(minOf(px, minOf(w, h) / 2f) * unit)

    private fun hex(argb: Int): String =
        "#%02x%02x%02x".format((argb shr 16) and 255, (argb shr 8) and 255, argb and 255) + if ((argb ushr 24) < 255) "%02x".format(argb ushr 24) else ""

    private fun walkText(node: SemanticsNode, ctx: Ctx, hidden: Boolean) {
        val config = node.config
        val hide = hidden || config.contains(SemanticsProperties.InvisibleToUser)
        val text = config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty().ifEmpty { config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty() }
        val coords = node.layoutInfo.coordinates
        if (!hide && text.isNotEmpty() && node.layoutInfo.isPlaced && coords.isAttached && !node.boundsInWindow.isEmpty) {
            val results = mutableListOf<TextLayoutResult>()
            config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
            val layout = results.firstOrNull()
            if (layout != null) {
                val input = layout.layoutInput
                val style = input.style
                val role = if (config.contains(SemanticsProperties.Heading)) "heading" else "text"
                val raw = input.text.text
                val layerAlpha = ctx.layerAlpha(ctx.chainOf(node))
                val spans = input.text.spanStyles
                for (i in 0 until layout.lineCount) {
                    val ls = layout.getLineStart(i); val le = layout.getLineEnd(i, true)
                    // One element per style run: the line is cut where a span style starts or ends.
                    val cuts = (listOf(ls, le) + spans.flatMap { listOf(it.start, it.end) }).filter { it in ls..le }.distinct().sorted()
                    for (k in 0 until cuts.size - 1) {
                        var rs = cuts[k]; var re = cuts[k + 1]
                        while (rs < re && raw[rs].isWhitespace()) rs++
                        while (re > rs && raw[re - 1].isWhitespace()) re--
                        if (rs >= re) continue
                        val runStyle = spans.filter { it.start <= rs && it.end > rs }.fold(style) { acc, sp -> acc.merge(sp.item) }
                        val colour = runStyle.color.takeIf { it.alpha > 0f && it != androidx.compose.ui.graphics.Color.Unspecified } ?: continue
                        val size = runStyle.fontSize.value * input.density.fontScale * input.density.density
                        // An ellipsized line: the platform layout reports how many characters it replaced and the line's drawn extent, ellipsis included.
                        val ellipsized = layout.isLineEllipsized(i) && k == cuts.size - 2
                        val platformLine = if (ellipsized) checkNotNull(platformLine(layout, i)) { "platform layout of the ellipsized line unavailable" } else null
                        val ellipsisCount = platformLine?.let { (pl, local, _) -> pl.getEllipsisCount(local) } ?: 0
                        check(!ellipsized || ellipsisCount > 0) { "compose reports an ellipsized line the platform layout did not ellipsize" }
                        val runText = raw.substring(rs, re) + if (ellipsized) platformEllipsis() else ""
                        // The run's content area: the drawn line's own baseline minus and plus the ascent and descent of the font the shaped layout drew the run with.
                        // The paint is the one android.text.Layout draws with: the layout's own paint with the metric-affecting spans (typeface, size, letter spacing) the shaping applied to this run.
                        val drawPaint = checkNotNull(shapedRunPaint(layout, i, rs)) { "shaped paint of '${raw.substring(rs, re).take(20)}' unavailable" }
                        val fm = drawPaint.fontMetrics
                        val ascent = -fm.ascent; val descent = fm.descent
                        val baseline = layout.getLineBaseline(i)
                        // The drawn ellipsis is part of the text and of the width: the platform layout's own line extent covers it.
                        // The ellipsis sits at the end of the line in its paragraph direction: that side grows to the platform line's extent.
                        val rtl = platformLine?.let { (pl, local, _) -> pl.getParagraphDirection(local) == android.text.Layout.DIR_RIGHT_TO_LEFT } ?: false
                        val lo = (rs until re).minOf { layout.getBoundingBox(it).left }.let { l -> if (rtl) platformLine?.let { (pl, local, _) -> minOf(l, pl.getLineLeft(local)) } ?: l else l }
                        val hiEnd = (rs until re).maxOf { layout.getBoundingBox(it).right }.let { r -> if (!rtl) platformLine?.let { (pl, local, _) -> maxOf(r, pl.getLineRight(local)) } ?: r else r }
                        // The run's four corners through the node's transform (a rotation or unequal scale still gives its bounding box).
                        val corners = listOf(lo to baseline - ascent, hiEnd to baseline - ascent, lo to baseline + descent, hiEnd to baseline + descent).map { (cx, cy) -> coords.localToRoot(androidx.compose.ui.geometry.Offset(cx, cy)) }
                        val x = corners.minOf { it.x } + ctx.dx; val y = corners.minOf { it.y } + ctx.dy; val w = corners.maxOf { it.x } - corners.minOf { it.x }; val h = corners.maxOf { it.y } - corners.minOf { it.y }
                        // A run wholly outside the node's clipped bounds (a scroll or clip ancestor) is not drawn.
                        val vis = node.boundsInRoot; if (x - ctx.dx >= vis.right || x - ctx.dx + w <= vis.left || y - ctx.dy >= vis.bottom || y - ctx.dy + h <= vis.top) continue
                        val e = JSONObject().put("text", runText).put("role", role).put("rect", rect(x, y, w, h, ctx.unit))
                            .put("color", hex(colour.toArgb()))
                            .put("fontSize", r2(size * ctx.unit)).put("fontWeight", runStyle.fontWeight?.weight ?: 400)
                        // A text that paints its own pill (kind textfill on the text node itself, as the web span does) carries that outline: the drawn corners of its own paint, never a copy from another node.
                        ctx.ownBoxes(node).lastOrNull { b -> b.kind == "textfill" }?.let { pill ->
                            val pb = pill.bounds(); val d = pill.drawnRadiusPx
                            if (pb != null && d != null && d > 0f) e.put("radius", radius(d * pill.scale(), pb.width, pb.height, ctx.unit))
                        }
                        ctx.behind(ctx.chainOf(node))?.let { e.put("background", it) }
                        if (layerAlpha <= 0f) continue
                        if (layerAlpha < 1f) e.put("opacity", layerAlpha.toDouble())
                        ctx.add(e, x, y, w, h, nodeId = node.id)
                    }
                }
            }
        }
        node.children.forEach { walkText(it, ctx, hide) }
    }

    /** Controls: merged semantics nodes the user can act on, with the name and role the platform reports. */
    private fun walkControls(node: SemanticsNode, ctx: Ctx, insideSlider: Boolean = false) {
        val config = node.config
        if (config.contains(SemanticsProperties.InvisibleToUser)) return
        val role = config.getOrNull(SemanticsProperties.Role)
        val editable = config.contains(SemanticsProperties.EditableText) || config.contains(SemanticsActions.SetText)
        val slider = config.contains(SemanticsProperties.ProgressBarRangeInfo) && config.contains(SemanticsActions.SetProgress)
        val clickable = config.contains(SemanticsActions.OnClick)
        // A painted status dot or track the app marks with the image role is exported from its paint record (rect, colour, name); the semantics node is that same element.
        val paintedImage = role == Role.Image && ctx.ownBoxes(node).any { it.kind == "img" }
        if (!paintedImage && (clickable || role != null || editable || slider || config.contains(SemanticsProperties.PaneTitle)) && !(slider && insideSlider) && node.layoutInfo.isPlaced && !node.boundsInWindow.isEmpty) {
            val kind = when {
                config.contains(SemanticsProperties.PaneTitle) -> "dialog"
                editable -> "textbox"
                slider -> "slider"
                role == Role.Checkbox -> "checkbox"
                role == Role.Switch -> "switch"
                role == Role.RadioButton -> "radio"
                role == Role.Tab -> "tab"
                role == Role.DropdownList -> "combobox"
                role == Role.Image -> "image"
                else -> "button"
            }
            // An image the app tagged for the export and also exposes through semantics on the same node is one element: the tagged record carries the alpha.
            // The label the control itself declares wins over the descriptions and text merged up from its children (those are exported as their own elements).
            val name = if (kind == "dialog") ctx.tree.ownLabel[node.id]?.joinToString(" ").orEmpty() else ctx.tree.ownLabel[node.id]?.joinToString(" ")?.takeIf { it.isNotBlank() }
                ?: config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")?.takeIf { it.isNotBlank() }
                ?: (if (editable) config.getOrNull(SemanticsProperties.EditableText)?.text else null)
                ?: config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
            // The border box as laid out (a scroll container clips what it shows, not the control's box): the node's own coordinates through every layer.
            // The border box at the node's own semantics modifier (padding placed after a clickable is inside it; layoutInfo.coordinates is the inner content box and drops it):
            // the node's unclipped root position and size, the size taken through the scale the layers put on the node.
            val sc = node.layoutInfo.coordinates.takeIf { it.isAttached && it.size.width > 0 }?.let { c ->
                val o = c.localToRoot(androidx.compose.ui.geometry.Offset.Zero); val r = c.localToRoot(androidx.compose.ui.geometry.Offset(c.size.width.toFloat(), 0f))
                // A control's box is read as an axis-aligned scale of its layout size; a rotated control would get a wrong box, so the export fails instead of guessing.
                if (Math.abs(r.y - o.y) > 0.5f) throw IllegalStateException("control is rotated; its box cannot be read from the layout size")
                Math.hypot((r.x - o.x).toDouble(), (r.y - o.y).toDouble()).toFloat() / c.size.width
            } ?: 1f
            // The vertical scale is measured on the vertical axis (unequal X and Y scales are two numbers).
            val scY = node.layoutInfo.coordinates.takeIf { it.isAttached && it.size.height > 0 }?.let { c ->
                val o = c.localToRoot(androidx.compose.ui.geometry.Offset.Zero); val r = c.localToRoot(androidx.compose.ui.geometry.Offset(0f, c.size.height.toFloat()))
                Math.hypot((r.x - o.x).toDouble(), (r.y - o.y).toDouble()).toFloat() / c.size.height
            } ?: sc
            val b = node.takeIf { it.size.width > 0 }?.let { n -> androidx.compose.ui.geometry.Rect(n.positionInRoot.x, n.positionInRoot.y, n.positionInRoot.x + n.size.width * sc, n.positionInRoot.y + n.size.height * scY) } ?: node.boundsInRoot
            val x = b.left + ctx.dx; val y = b.top + ctx.dy
            val e = JSONObject().put("text", name).put("role", kind).put("rect", rect(x, y, b.width, b.height, ctx.unit))
                .put("color", JSONObject.NULL).put("fontSize", JSONObject.NULL).put("fontWeight", JSONObject.NULL)
            val nodeCoords = node.layoutInfo.coordinates
            val nodeScale = if (nodeCoords.isAttached && nodeCoords.size.width > 0) nodeCoords.localToRoot(androidx.compose.ui.geometry.Offset(nodeCoords.size.width.toFloat(), 0f)).let { r -> val o = nodeCoords.localToRoot(androidx.compose.ui.geometry.Offset.Zero); Math.hypot((r.x - o.x).toDouble(), (r.y - o.y).toDouble()).toFloat() / nodeCoords.size.width } else 1f
            val ownDensity = node.layoutInfo.density.density
            // The radius is the outline the control's own surface resolved to at paint time; the clamp uses the unclipped size (a clipped strip keeps its corners).
            val fullW = if (nodeCoords.isAttached && nodeCoords.size.width > 0) nodeCoords.size.width * nodeScale else b.width
            val fullH = if (nodeCoords.isAttached && nodeCoords.size.height > 0) nodeCoords.size.height * nodeScale else b.height
            val declared = ctx.ownBoxes(node).filter { it.kind != "alpha" }.firstOrNull { it.opacity < 1f }?.opacity ?: config.getOrNull(io.playarr.shared.designsystem.page.ParityAlphaKey) ?: 1f
            val effective = declared * ctx.layerAlpha(ctx.chainOf(node))
            if (effective <= 0f) { node.children.forEach { walkControls(it, ctx, insideSlider || slider) }; return }
            if (effective < 1f) e.put("opacity", effective.toDouble())
            // The outline the control's own paint resolved to; failing that, an ancestor's paint drawn on the same box (a pill behind the clickable row); only then the declared shape.
            val drawn = ctx.ownBoxes(node).lastOrNull { it.drawnRadiusPx != null }?.drawnRadiusPx
                ?: ctx.chainOf(node).asReversed().firstNotNullOfOrNull { id ->
                    ctx.boxes[id]?.takeIf { pb -> pb.kind != "alpha" && pb.drawnRadiusPx != null }?.takeIf { pb ->
                        pb.bounds()?.let { r -> Math.abs(r.left + ctx.dx - x) < 1.5f && Math.abs(r.top + ctx.dy - y) < 1.5f && Math.abs(r.width - b.width) < 1.5f && Math.abs(r.height - b.height) < 1.5f } == true
                    }?.let { pb -> pb.drawnRadiusPx!! * pb.scale() / nodeScale }
                }
            if (drawn != null && drawn > 0f) e.put("radius", radius(drawn * nodeScale, fullW, fullH, ctx.unit))
            else config.getOrNull(io.playarr.shared.designsystem.page.ParityRadiusKey)?.let { e.put("radius", radius(it * ownDensity * nodeScale, fullW, fullH, ctx.unit)) }
            ctx.behind(ctx.chainOf(node))?.let { e.put("background", it) }
            ctx.add(e, x, y, b.width, b.height, controlBoxes = ctx.tree.own[node.id].orEmpty().toSet(), nodeId = node.id)
        }
        node.children.forEach { walkControls(it, ctx, insideSlider || slider) }
    }
}
