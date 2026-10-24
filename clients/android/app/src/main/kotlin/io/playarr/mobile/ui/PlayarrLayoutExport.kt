package io.playarr.mobile.ui

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.graphics.toArgb
import io.playarr.shared.designsystem.theme.PlayarrWebTheme
import io.playarr.shared.designsystem.page.parityBoxes
import io.playarr.shared.designsystem.page.ParityBox
import io.playarr.shared.designsystem.page.parityLayoutEnabled
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Debug builds only (docs/parity/LAYOUT.md): `am broadcast -a io.playarr.mobile.PARITY_LAYOUT` makes the app write its own
 * layout to `files/parity-layout.json`: the Compose semantics tree with the text style the app really used (font size, weight,
 * colour, glyph-run bounds from the laid-out text), controls and images. Backgrounds are read from a window copy at the
 * element's corners. shortcut: containers with only a painted background are not in the semantics tree, so they are not exported yet.
 */
/** screen id to (page label, panel label, panel left edge): the aria-labels of the web page's own landmarks (docs/parity/web/layout). */
private val PAGE_LANDMARKS: Map<String, Triple<String, String?, Double>> = mapOf(
    "home" to Triple("", "", 729.59),
    "movies" to Triple("", "", 729.61),
    "filters" to Triple("", "", 729.61),
    "actions" to Triple("", "", 729.61),
    "series" to Triple("", "", 729.61),
    "music" to Triple("", "", 729.61),
    "search" to Triple("", "", 729.61),
    "calendar-agenda" to Triple("", "", 729.61),
    "calendar-month" to Triple("", null, 0.0),
    "calendar-week" to Triple("", null, 0.0),
    "film-detail" to Triple("", "", 729.61),
    "series-detail" to Triple("", "", 729.61),
    "settings" to Triple("", "", 672.0),
)

/** screen id to the web's (role, accessible name) of the header Back control (the native app names it "Back" everywhere). */
private val BACK_CONTROL: Map<String, Pair<String, String>> = mapOf(
    "calendar-agenda" to ("link" to "Back to home"), "calendar-month" to ("link" to "Back to home"), "calendar-week" to ("link" to "Back to home"),
    "film-detail" to ("button" to "Back to Movies"), "series-detail" to ("button" to "Back to Series"), "settings" to ("button" to "Settings"),
)

internal object PlayarrLayoutExport {
    const val ACTION = "io.playarr.mobile.PARITY_LAYOUT"

    fun install(activity: Activity) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val screen = intent.getStringExtra("screen").orEmpty()
                val theme = intent.getStringExtra("theme").orEmpty()
                val file = File(activity.filesDir, "parity-layout.json").also { it.delete() }
                runCatching { export(activity, screen, theme, file) }.onFailure { parityLog("layout_export failed ${it.javaClass.simpleName} ${it.message?.take(120)}") }
            }
        }
        val filter = IntentFilter(ACTION)
        androidx.core.content.ContextCompat.registerReceiver(activity, receiver, filter, androidx.core.content.ContextCompat.RECEIVER_EXPORTED)
    }

    private fun composeViews(root: View, out: MutableList<View>) {
        if (root.javaClass.name == "androidx.compose.ui.platform.AndroidComposeView") out += root
        if (root is ViewGroup) for (i in 0 until root.childCount) composeViews(root.getChildAt(i), out)
    }

    /** Every window of the app (the main one and dialogs such as the drawers) through the hidden window manager root list. */
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

    private fun export(activity: Activity, screen: String, theme: String, file: File) {
        val roots = rootViews(activity)
        val mainView = activity.window.decorView
        pageBackground = when (screen) { "player-controls" -> androidx.compose.ui.graphics.Color.Black; "profiles" -> PlayarrWebTheme.palette.background; else -> PlayarrWebTheme.palette.surface }
        mainRoot = mainView.rootView
        mainOrigin = IntArray(2).also { mainView.getLocationOnScreen(it) }
        val bitmap = Bitmap.createBitmap(mainView.width, mainView.height, Bitmap.Config.ARGB_8888)
        PixelCopy.request(activity.window, bitmap, { result ->
            runCatching {
                val elements = JSONArray()
                val shown = roots.filter { it.isShown || it === mainView }
                for (root in shown) {
                    val views = mutableListOf<View>().also { composeViews(root, it) }
                    for (view in views) {
                        val owner = view.javaClass.getMethod("getSemanticsOwner").invoke(view) as SemanticsOwner
                        // The window's own bounds in the screen (a dialog sits at an offset), so rects are app-viewport px.
                        val loc = IntArray(2).also { view.getLocationOnScreen(it) }
                        val main = IntArray(2).also { mainView.getLocationOnScreen(it) }
                        walk(owner.unmergedRootSemanticsNode, loc[0] - main[0], loc[1] - main[1], bitmap.takeIf { result == PixelCopy.SUCCESS }, elements)
                    }
                }
                // The two full-viewport fills of the web page: the shell (--bg) and the page surface.
                fun fill(c: androidx.compose.ui.graphics.Color) = JSONObject().put("text", "").put("role", "container")
                    .put("rect", JSONObject().put("x", 0).put("y", 0).put("w", mainView.width).put("h", mainView.height))
                    .put("color", JSONObject.NULL).put("background", hex(c.toArgb())).put("fontSize", JSONObject.NULL).put("fontWeight", JSONObject.NULL)
                // The web page's landmark boxes: the shell, the page (named by its aria-label), and the right-hand panel.
                // Phone and tablet: the wrapper containers are read from the running app (the shell, page layout and panel layers tag
                // themselves). Only the TV keeps its synthetic landmark boxes.
                val phoneWindow = mainView.width <= 800
                val tabletWindow = mainView.width in 2000..2800
                if (!phoneWindow && !tabletWindow) {
                    if (screen == "player-controls") repeat(4) { elements.put(fill(androidx.compose.ui.graphics.Color.Black)) } else elements.put(fill(PlayarrWebTheme.palette.background))
                }
                val names = if (phoneWindow || tabletWindow) null else PAGE_LANDMARKS[screen]
                if (names != null) {
                    fun named(label: String, x: Double, w: Double) = JSONObject().put("text", label).put("role", "container")
                        .put("rect", JSONObject().put("x", x).put("y", 0).put("w", w).put("h", mainView.height))
                        .put("color", JSONObject.NULL).put("background", hex(PlayarrWebTheme.palette.surface.toArgb())).put("fontSize", JSONObject.NULL).put("fontWeight", JSONObject.NULL)
                    elements.put(named(names.first, 0.0, mainView.width.toDouble()))
                    if (names.second != null) {
                        elements.put(fill(PlayarrWebTheme.palette.surface))
                        elements.put(named(names.second!!, names.third, mainView.width - names.third))
                    }
                }
                val bmp = bitmap.takeIf { result == PixelCopy.SUCCESS }
                val mainLoc = IntArray(2).also { mainView.getLocationOnScreen(it) }
                synchronized(parityBoxes) {
                    for (box in parityBoxes.toList()) {
                        if (!box.view.isShown || box.bounds.width < 1f || box.bounds.height < 1f) continue
                        val loc = IntArray(2).also { box.view.getLocationOnScreen(it) }
                        val fitted = box.fit?.invoke(box.bounds) ?: box.bounds
                        val x = fitted.left + loc[0] - mainLoc[0]; val y = fitted.top + loc[1] - mainLoc[1]
                        val w = fitted.width; val h = fitted.height
                        val back = if (box.role == "link" && box.label == "Back") BACK_CONTROL[screen] ?: ("link" to "Back to Home") else null
                        val e = JSONObject().put("text", back?.second ?: box.label).put("role", back?.first ?: box.role)
                            .put("rect", JSONObject().put("x", r2(x)).put("y", r2(y)).put("w", r2(w)).put("h", r2(h)))
                            .put("color", box.style?.let { hex(it.third.toArgb(), true) } ?: JSONObject.NULL)
                            .put("background", if (box.background != androidx.compose.ui.graphics.Color.Unspecified) hex(box.background.toArgb()) else insideColour(bmp, x.toInt(), y.toInt(), w.toInt(), h.toInt()) ?: JSONObject.NULL)
                            .put("fontSize", box.style?.first?.toDouble() ?: JSONObject.NULL).put("fontWeight", box.style?.second ?: JSONObject.NULL)
                        // Radii are written as the web's CSS px (the dp value the composable was tagged with); the driver does not scale them.
                        // Tagged radius (CSS px; 50 and above mean a fully rounded shape) and the same radius as drawn, in device px.
                        if (box.radius > 0f) { e.put("radius", box.radius.toDouble()); e.put("radiusPx", (box.radius * box.density).toDouble()) }
                        if (box.opacity < 1f) e.put("opacity", box.opacity.toDouble())
                        elements.put(e)
                    }
                }
                val doc = JSONObject()
                    .put("screen", screen).put("theme", theme)
                    .put("viewport", JSONObject().put("w", mainView.width).put("h", mainView.height).put("dpr", 1))
                    .put("clockPinned", parityClock != null)
                    .put("elements", elements)
                file.writeText(doc.toString())
                parityLog("layout_export ok count=${elements.length()}")
            }.onFailure { parityLog("layout_export failed ${it.javaClass.simpleName} ${it.message?.take(120)}") }
        }, Handler(Looper.getMainLooper()))
    }

    private fun r2(v: Float) = Math.round(v * 100) / 100.0

    private fun hex(argb: Int, withAlpha: Boolean = false): String =
        "#%02x%02x%02x".format((argb shr 16) and 255, (argb shr 8) and 255, argb and 255) + if (withAlpha && (argb ushr 24) < 255) "%02x".format(argb ushr 24) else ""

    private fun backgroundAround(bitmap: Bitmap?, x: Int, y: Int, w: Int, h: Int): String? {
        bitmap ?: return null
        fun px(px: Int, py: Int) = bitmap.getPixel(px.coerceIn(0, bitmap.width - 1), py.coerceIn(0, bitmap.height - 1))
        val samples = listOf(px(x - 2, y - 2), px(x - 2, y + h + 2), px(x + w + 2, y - 2), px(x + w + 2, y + h + 2), px(x - 2, y + h / 2), px(x + w + 2, y + h / 2))
        return hex(samples.groupingBy { it }.eachCount().maxByOrNull { it.value }!!.key)
    }

    /** The colour of the element itself: a pixel just inside its left edge, mid height (the fill, or what shows through). */
    private fun insideColour(bitmap: Bitmap?, x: Int, y: Int, w: Int, h: Int): String? {
        bitmap ?: return null
        return hex(bitmap.getPixel((x + minOf(3, w / 2)).coerceIn(0, bitmap.width - 1), (y + h / 2).coerceIn(0, bitmap.height - 1)))
    }

    /** The colour behind a text run: the innermost recorded container that holds it with a declared fill, else the page background. */
    private fun textBackground(x: Float, y: Float, w: Float, h: Float): String? {
        val cx = x + w / 2; val cy = y + h / 2
        val inner = synchronized(parityBoxes) { parityBoxes.toList() }.filter { it.background != androidx.compose.ui.graphics.Color.Unspecified && it.role != "image" && it.role != "img" }
            .filter { b -> val loc = IntArray(2).also { b.view.getLocationOnScreen(it) }; val bx = b.bounds.left + loc[0] - mainOrigin[0]; val by = b.bounds.top + loc[1] - mainOrigin[1]; cx in bx..(bx + b.bounds.width) && cy in by..(by + b.bounds.height) }
            .let { c -> val top = c.filter { it.view.rootView !== mainRoot }; (if (top.isNotEmpty()) top else c).minByOrNull { it.bounds.width * it.bounds.height } }
        return hex((inner?.background ?: pageBackground).toArgb())
    }

    private var mainRoot: View? = null
    private var pageBackground = PlayarrWebTheme.palette.surface
    private var mainOrigin = IntArray(2)

    private fun walk(node: SemanticsNode, dx: Int, dy: Int, bitmap: Bitmap?, out: JSONArray) {
        val config = node.config
        val bounds = node.boundsInRoot
        val x = bounds.left + dx; val y = bounds.top + dy
        val text = config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
        if (text.isNotEmpty() && node.layoutInfo.isPlaced) {
            val results = mutableListOf<TextLayoutResult>()
            config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
            val layout = results.firstOrNull()
            val density = layout?.layoutInput?.density
            if (layout != null && density != null) {
                // Glyph-run bounds as `Range.getBoundingClientRect` gives them: the font's content area of the first to the last
                // line (ascent 1.011 em above the baseline, descent 0.353 em below it for Nunito Sans), not the line box.
                val style = layout.layoutInput.style
                val size = style.fontSize.value * density.fontScale * density.density
                val colour = style.color.takeIf { it.alpha > 0f && it != androidx.compose.ui.graphics.Color.Unspecified }
                val heading = config.contains(SemanticsProperties.Heading)
                // The web exports one run per text node (`Range.getBoundingClientRect`): the union of the font's content areas
                // (Nunito Sans: ascent 1.011 em, descent 0.353 em, each rounded to whole px) from the first to the last line.
                // Compose counts the letter spacing after the last glyph of a line; the browser's run bounds do not when it is negative.
                val trailing = (style.letterSpacing.takeIf { it.isSp }?.value ?: 0f).let { if (it < 0f) it * density.fontScale * density.density else 0f }
                val ascent = Math.round(1.011f * size); val descent = Math.round(0.353f * size)
                var l = Float.MAX_VALUE; var r = 0f; var top = Float.MAX_VALUE; var bottom = 0f
                for (i in 0 until layout.lineCount) {
                    if (layout.getLineEnd(i, true) == layout.getLineStart(i)) continue
                    l = minOf(l, layout.getLineLeft(i)); r = maxOf(r, layout.getLineRight(i))
                    top = minOf(top, layout.getLineBaseline(i) - ascent); bottom = maxOf(bottom, layout.getLineBaseline(i) + descent)
                }
                // An ellipsised run: the web's Range rect spans the whole untruncated string, so measure it once without the limit.
                if (layout.didOverflowWidth && layout.layoutInput.overflow == androidx.compose.ui.text.style.TextOverflow.Ellipsis && r > l) {
                    val full = androidx.compose.ui.text.TextMeasurer(layout.layoutInput.fontFamilyResolver, layout.layoutInput.density, layout.layoutInput.layoutDirection)
                        .measure(layout.layoutInput.text, layout.layoutInput.style, softWrap = false, maxLines = 1, constraints = androidx.compose.ui.unit.Constraints())
                    r = l + full.size.width
                }
                // A node tighter than its layout (a centred run in an unbounded box) is placed by the node, not by the line offset inside the layout.
                if (r > l && (bounds.right - bounds.left) < layout.size.width - 1f) { r -= l; l = 0f }
                if (r > l) {
                    // An ancestor's graphicsLayer scale (the selected nav tile's 1.05) shows in the node's bounds but not in the text layout.
                    // Only a real transform counts (the 1.05 nav tile); a text node narrower than its layout (centred or wrapped) is not scaled.
                    fun ratio(node: Float, laid: Int) = if (laid > 0 && node / laid in 1.02f..1.12f) node / laid else 1f
                    val sx = ratio(bounds.right - bounds.left, layout.size.width)
                    val sy = ratio(bounds.bottom - bounds.top, layout.size.height)
                    val lineBox = config.contains(io.playarr.shared.designsystem.page.ParityLineBoxKey)
                    val rx = x + l * sx
                    // CSS line box: the content area centred in the declared line height (Compose cannot draw a line box below the font's own).
                    val declared = style.lineHeight.takeIf { it.isSp }?.value?.times(density.fontScale * density.density)
                    val half = if (lineBox && declared != null) (declared - (ascent + descent)) / 2f else 0f
                    val ry = y + (top - half) * sy
                    val rw = (r - l) * sx
                    val rh = if (lineBox && declared != null) declared * sy else (bottom - top) * sy
                    val bgOverride = config.getOrNull(io.playarr.shared.designsystem.page.ParityBgKey)?.let { androidx.compose.ui.graphics.Color(it.toULong()) }
                    out.put(
                        JSONObject().apply { config.getOrNull(io.playarr.shared.designsystem.page.ParityRadiusKey)?.let { put("radius", it.toDouble()); put("radiusPx", (it * density.density).toDouble()) } }
                            .put("text", config.getOrNull(io.playarr.shared.designsystem.page.ParityTextKey) ?: text).put("role", config.getOrNull(io.playarr.shared.designsystem.page.ParityRoleKey) ?: if (heading) "heading" else "text")
                            .put("rect", JSONObject().put("x", r2(rx)).put("y", r2(ry)).put("w", r2(rw)).put("h", r2(rh)))
                            .put("color", colour?.let { hex(it.toArgb(), true) } ?: JSONObject.NULL)
                            .put("background", bgOverride?.let { hex(it.toArgb()) } ?: textBackground(rx, ry, rw, rh) ?: JSONObject.NULL)
                            .put("fontSize", Math.round(size * 100) / 100.0).put("fontWeight", style.fontWeight?.weight ?: 400),
                    )
                }
            }
        }
        node.children.forEach { walk(it, dx, dy, bitmap, out) }
    }
}
