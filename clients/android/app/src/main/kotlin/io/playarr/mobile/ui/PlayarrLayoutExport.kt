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
    "home" to Triple("Home", "Home media tracks", 729.59),
    "movies" to Triple("Movies library", "Movies titles", 729.61),
    "filters" to Triple("Movies library", "Movies titles", 729.61),
    "actions" to Triple("Movies library", "Movies titles", 729.61),
    "series" to Triple("Series library", "Series titles", 729.61),
    "music" to Triple("Music library", "Music artists", 729.61),
    "search" to Triple("Search Playarr", "Search results", 729.61),
    "calendar-agenda" to Triple("Calendar", "Calendar", 729.61),
    "calendar-month" to Triple("Calendar", null, 0.0),
    "calendar-week" to Triple("Calendar", null, 0.0),
    "film-detail" to Triple("Silent Meridian 1", "Silent Meridian 1 chapters and people", 729.61),
    "series-detail" to Triple("Golden Cathedral 1", "Golden Cathedral 1 seasons and episodes", 729.61),
    "settings" to Triple("Settings sections", "Appearance", 672.0),
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
                elements.put(fill(PlayarrWebTheme.palette.background))
                val names = PAGE_LANDMARKS[screen]
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
                        val e = JSONObject().put("text", box.label).put("role", box.role)
                            .put("rect", JSONObject().put("x", r2(x)).put("y", r2(y)).put("w", r2(w)).put("h", r2(h)))
                            .put("color", JSONObject.NULL)
                            .put("background", if (box.background != androidx.compose.ui.graphics.Color.Unspecified) hex(box.background.toArgb()) else insideColour(bmp, x.toInt(), y.toInt(), w.toInt(), h.toInt()) ?: JSONObject.NULL)
                            .put("fontSize", JSONObject.NULL).put("fontWeight", JSONObject.NULL)
                        if (box.radius > 0f) e.put("radius", box.radius.toDouble())
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
            .minByOrNull { it.bounds.width * it.bounds.height }
        return hex((inner?.background ?: PlayarrWebTheme.palette.surface).toArgb())
    }

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
                val ascent = Math.round(1.011f * size); val descent = Math.round(0.353f * size)
                var l = Float.MAX_VALUE; var r = 0f; var top = Float.MAX_VALUE; var bottom = 0f
                for (i in 0 until layout.lineCount) {
                    if (layout.getLineEnd(i, true) == layout.getLineStart(i)) continue
                    l = minOf(l, layout.getLineLeft(i)); r = maxOf(r, layout.getLineRight(i))
                    top = minOf(top, layout.getLineBaseline(i) - ascent); bottom = maxOf(bottom, layout.getLineBaseline(i) + descent)
                }
                if (r > l) {
                    val rx = x + l; val ry = y + top; val rw = r - l; val rh = bottom - top
                    out.put(
                        JSONObject().apply { config.getOrNull(io.playarr.shared.designsystem.page.ParityRadiusKey)?.let { put("radius", it.toDouble()) } }
                            .put("text", text).put("role", config.getOrNull(io.playarr.shared.designsystem.page.ParityRoleKey) ?: if (heading) "heading" else "text")
                            .put("rect", JSONObject().put("x", r2(rx)).put("y", r2(ry)).put("w", r2(rw)).put("h", r2(rh)))
                            .put("color", colour?.let { hex(it.toArgb(), true) } ?: JSONObject.NULL)
                            .put("background", textBackground(rx, ry, rw, rh) ?: JSONObject.NULL)
                            .put("fontSize", Math.round(size * 100) / 100.0).put("fontWeight", style.fontWeight?.weight ?: 400),
                    )
                }
            }
        }
        node.children.forEach { walk(it, dx, dy, bitmap, out) }
    }
}
