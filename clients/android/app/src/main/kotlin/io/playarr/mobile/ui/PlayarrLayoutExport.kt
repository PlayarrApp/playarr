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
 * No colours are written here: the driver reads them from the screenshot of the same frame. Units are converted by the display density only.
 */
internal object PlayarrLayoutExport {
    const val ACTION = "io.playarr.mobile.PARITY_LAYOUT"

    fun install(activity: Activity) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val screen = intent.getStringExtra("screen").orEmpty()
                val theme = intent.getStringExtra("theme").orEmpty()
                val captureId = intent.getStringExtra("id").orEmpty()
                val file = File(activity.filesDir, "parity-layout.json").also { it.delete() }
                runCatching { export(activity, screen, theme, captureId, file) }.onFailure { parityLog("layout_export failed ${it.javaClass.simpleName} ${it.message?.take(120)}") }
            }
        }
        androidx.core.content.ContextCompat.registerReceiver(activity, receiver, IntentFilter(ACTION), androidx.core.content.ContextCompat.RECEIVER_EXPORTED)
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
        if (roots.isEmpty()) roots += activity.window.decorView
        return roots
    }

    private class Item(val window: Int, val json: JSONObject, val x: Float, val y: Float, val w: Float, val h: Float, val occludes: Boolean, val hook: Boolean = false, val boxId: Int = -1, val controlBoxes: Set<Int>? = null)

    private fun export(activity: Activity, screen: String, theme: String, captureId: String, file: File) {
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
                        val x = b.left + ctx.dx; val y = b.top + ctx.dy
                        val e = JSONObject().put("text", "").put("role", if (box.kind == "image") "image" else box.kind)
                            .put("rect", rect(x, y, b.width, b.height, unit)).put("color", JSONObject.NULL).put("fontSize", JSONObject.NULL).put("fontWeight", JSONObject.NULL)
                        val drawn = box.drawnRadiusPx ?: tree.own.values.firstOrNull { box.id in it }?.firstNotNullOfOrNull { ctx.boxes[it]?.drawnRadiusPx }
                        if (drawn != null && drawn > 0f) e.put("radius", radius(drawn * box.scale(), b.width, b.height, unit))
                        else if (box.radius > 0f) e.put("radius", radius(box.radius * box.density * box.scale(), b.width, b.height, unit))
                        if (box.opacity < 1f) e.put("opacity", box.opacity.toDouble())
                        val painted = box.fill != androidx.compose.ui.graphics.Color.Unspecified && box.fill.alpha > 0f
                        if (painted) ctx.fills[box.id] = box.fill
                        // kind "fill": a surface drawn behind a text or control that web models as that element's own background (a pill): it
                        // backs its descendants but is not an element of its own.
                        if (box.kind == "fill" || box.kind == "textfill") continue
                        pending += Triple(e, box.id, painted)
                        ctx.add(e, x, y, b.width, b.height, occludes = box.kind == "container" && painted && box.fill.alpha >= 0.5f, hook = true, boxId = box.id)
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
            !(h.hook && h.boxId >= 0 && (h.json.getString("role") == "container" || h.json.getString("role") == "image") && controls.any { c ->
                c.window == h.window && c.json.getString("role") != "dialog" && Math.abs(c.x - h.x) < 1.5f && Math.abs(c.y - h.y) < 1.5f && Math.abs(c.w - h.w) < 1.5f && Math.abs(c.h - h.h) < 1.5f && h.boxId in c.controlBoxes!!
            })
        }
        val kept = unique.filter { item ->
            unique.none { top -> top.window > item.window && top.occludes && item.x >= top.x && item.y >= top.y && item.x + item.w <= top.x + top.w && item.y + item.h <= top.y + top.h }
        }
        val ordered = kept.sortedWith(compareBy({ it.y }, { it.x }, { it.json.getString("role") }, { it.json.getString("text") }, { it.w })).map { it.json }
        val doc = JSONObject()
            .put("screen", screen).put("theme", theme).put("captureId", captureId).put("paletteDark", PlayarrWebTheme.palette.dark)
            .put("viewport", JSONObject().put("w", r2(width * unit)).put("h", r2(height * unit)).put("dpr", 1))
            .put("clockPinned", parityClock != null).put("occluded", unique.size - kept.size)
            .put("elements", JSONArray().also { arr -> ordered.forEach { arr.put(it) } })
        file.writeText(doc.toString())
        parityLog("layout_export ok count=${ordered.size}")
    }

    /** The unmerged semantics tree of one window: per node the box ids painted by it (own) and by its ancestors (chain), and the boxes the app hides. */
    private class Tree {
        val own = mutableMapOf<Int, List<Int>>()
        val chain = mutableMapOf<Int, List<Int>>()
        val hiddenBoxes = mutableSetOf<Int>()
    }

    private fun chains(node: SemanticsNode, above: List<Int>, hidden: Boolean, out: Tree) {
        val own = node.config.filter { it.key.name == io.playarr.shared.designsystem.page.PARITY_BOX_KEY_NAME }.map { it.value as Int }.sorted()
        val chain = above + own
        val hide = hidden || node.config.contains(SemanticsProperties.InvisibleToUser)
        out.own[node.id] = own; out.chain[node.id] = chain
        if (hide) out.hiddenBoxes += own
        node.children.forEach { chains(it, chain, hide, out) }
    }

    private class Ctx(val window: Int, val dx: Float, val dy: Float, val unit: Float, val width: Float, val height: Float, val items: MutableList<Item>, val tree: Tree, val fills: MutableMap<Int, androidx.compose.ui.graphics.Color> = mutableMapOf(), val base: androidx.compose.ui.graphics.Color? = null, val boxes: MutableMap<Int, io.playarr.shared.designsystem.page.ParityBox> = mutableMapOf()) {
        fun boxChain(boxId: Int): List<Int> = tree.own.entries.firstOrNull { boxId in it.value }?.let { tree.chain[it.key] } ?: emptyList()
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
        fun add(json: JSONObject, x: Float, y: Float, w: Float, h: Float, occludes: Boolean = false, hook: Boolean = false, boxId: Int = -1, controlBoxes: Set<Int>? = null) {
            if (w <= 0f || h <= 0f || x >= width || y >= height || x + w <= 0f || y + h <= 0f) return
            items += Item(window, json, x, y, w, h, occludes, hook, boxId, controlBoxes)
        }
    }

    private fun r2(v: Float) = Math.round(v * 100) / 100.0
    private fun rect(x: Float, y: Float, w: Float, h: Float, unit: Float) = JSONObject().put("x", r2(x * unit)).put("y", r2(y * unit)).put("w", r2(w * unit)).put("h", r2(h * unit))
    /** A declared corner radius (px) clamped to half the short side, as the drawn shape resolves it. */
    private fun radius(px: Float, w: Float, h: Float, unit: Float) = r2(minOf(px, minOf(w, h) / 2f) * unit)

    private fun hex(argb: Int): String =
        "#%02x%02x%02x".format((argb shr 16) and 255, (argb shr 8) and 255, argb and 255) + if ((argb ushr 24) < 255) "%02x".format(argb ushr 24) else ""

    private fun walkText(node: SemanticsNode, ctx: Ctx, hidden: Boolean) {
        val config = node.config
        val hide = hidden || config.contains(SemanticsProperties.InvisibleToUser)
        val text = config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
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
                val measurer = androidx.compose.ui.text.TextMeasurer(input.fontFamilyResolver, input.density, input.layoutDirection)
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
                        val runText = raw.substring(rs, re)
                        // The run's content area, as the browser's Range rect gives it: baseline minus and plus the ascent and descent of the font
                        // that drew the run, read from the same text and style measured without a line height (the typeface's own metrics, in px).
                        val metrics = measurer.measure(runText, runStyle.copy(lineHeight = androidx.compose.ui.unit.TextUnit.Unspecified, lineHeightStyle = null, textAlign = androidx.compose.ui.text.style.TextAlign.Unspecified), softWrap = false, maxLines = 1)
                        val ascent = metrics.getLineBaseline(0) - metrics.getLineTop(0); val descent = metrics.getLineBottom(0) - metrics.getLineBaseline(0)
                        val baseline = layout.getLineBaseline(i)
                                                val lo = (rs until re).minOf { layout.getBoundingBox(it).left }; val hi = (rs until re).maxOf { layout.getBoundingBox(it).right }
                        val a0 = coords.localToRoot(androidx.compose.ui.geometry.Offset(lo, baseline - ascent))
                        val b = coords.localToRoot(androidx.compose.ui.geometry.Offset(hi, baseline + descent))
                        val x = minOf(a0.x, b.x) + ctx.dx; val y = minOf(a0.y, b.y) + ctx.dy; val w = Math.abs(b.x - a0.x); val h = Math.abs(b.y - a0.y)
                        // A run wholly outside the node's clipped bounds (a scroll or clip ancestor) is not drawn.
                        val vis = node.boundsInRoot; if (x - ctx.dx >= vis.right || x - ctx.dx + w <= vis.left || y - ctx.dy >= vis.bottom || y - ctx.dy + h <= vis.top) continue
                        val e = JSONObject().put("text", runText).put("role", role).put("rect", rect(x, y, w, h, ctx.unit))
                            .put("color", hex(colour.toArgb()))
                            .put("fontSize", r2(size * ctx.unit)).put("fontWeight", runStyle.fontWeight?.weight ?: 400)
                        // A text inside a pill the app paints for it (kind textfill) owns that fill, as the web models it: its corners are the pill's drawn outline on the pill's box.
                        ctx.chainOf(node).asReversed().firstNotNullOfOrNull { ctx.boxes[it]?.takeIf { b -> b.kind == "textfill" } }?.let { pill ->
                            val pb = pill.bounds(); val d = pill.drawnRadiusPx
                            if (pb != null && d != null && d > 0f) e.put("radius", radius(d * pill.scale(), pb.width, pb.height, ctx.unit))
                        }
                        ctx.behind(ctx.chainOf(node))?.let { e.put("background", it) }
                        ctx.add(e, x, y, w, h)
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
        if ((clickable || role != null || editable || slider || config.contains(SemanticsProperties.PaneTitle)) && !(slider && insideSlider) && node.layoutInfo.isPlaced && !node.boundsInWindow.isEmpty) {
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
            val name = config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")?.takeIf { it.isNotBlank() }
                ?: (if (editable) config.getOrNull(SemanticsProperties.EditableText)?.text else null)
                ?: config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
            // The border box as laid out (a scroll container clips what it shows, not the control's box): the node's own coordinates through every layer.
            val b = node.layoutInfo.coordinates.takeIf { it.isAttached && it.size.width > 0 }?.let { c ->
                val p = c.localToRoot(androidx.compose.ui.geometry.Offset.Zero); val q = c.localToRoot(androidx.compose.ui.geometry.Offset(c.size.width.toFloat(), c.size.height.toFloat()))
                androidx.compose.ui.geometry.Rect(minOf(p.x, q.x), minOf(p.y, q.y), maxOf(p.x, q.x), maxOf(p.y, q.y))
            } ?: node.boundsInRoot
            val x = b.left + ctx.dx; val y = b.top + ctx.dy
            val e = JSONObject().put("text", name).put("role", kind).put("rect", rect(x, y, b.width, b.height, ctx.unit))
                .put("color", JSONObject.NULL).put("fontSize", JSONObject.NULL).put("fontWeight", JSONObject.NULL)
            val nodeCoords = node.layoutInfo.coordinates
            val nodeScale = if (nodeCoords.isAttached && nodeCoords.size.width > 0) nodeCoords.localToRoot(androidx.compose.ui.geometry.Offset(nodeCoords.size.width.toFloat(), 0f)).x.minus(nodeCoords.localToRoot(androidx.compose.ui.geometry.Offset.Zero).x) / nodeCoords.size.width else 1f
            val ownDensity = node.layoutInfo.density.density
            // The radius is the outline the control's own surface resolved to at paint time; the clamp uses the unclipped size (a clipped strip keeps its corners).
            val fullW = if (nodeCoords.isAttached && nodeCoords.size.width > 0) nodeCoords.size.width * nodeScale else b.width
            val fullH = if (nodeCoords.isAttached && nodeCoords.size.height > 0) nodeCoords.size.height * nodeScale else b.height
            ctx.ownBoxes(node).firstOrNull { it.opacity < 1f }?.let { e.put("opacity", it.opacity.toDouble()) }
            val drawn = ctx.ownBoxes(node).lastOrNull { it.drawnRadiusPx != null }?.drawnRadiusPx
            if (drawn != null && drawn > 0f) e.put("radius", radius(drawn * nodeScale, fullW, fullH, ctx.unit))
            else config.getOrNull(io.playarr.shared.designsystem.page.ParityRadiusKey)?.let { e.put("radius", radius(it * ownDensity * nodeScale, fullW, fullH, ctx.unit)) }
            config.getOrNull(io.playarr.shared.designsystem.page.ParityAlphaKey)?.let { e.put("opacity", it.toDouble()) }
            ctx.behind(ctx.chainOf(node))?.let { e.put("background", it) }
            ctx.add(e, x, y, b.width, b.height, controlBoxes = ctx.tree.own[node.id].orEmpty().toSet())
        }
        node.children.forEach { walkControls(it, ctx, insideSlider || slider) }
    }
}
