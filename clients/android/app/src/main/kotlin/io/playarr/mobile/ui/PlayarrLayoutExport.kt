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
                val bmp = bitmap.takeIf { result == PixelCopy.SUCCESS }
                val mainLoc = IntArray(2).also { mainView.getLocationOnScreen(it) }
                synchronized(parityBoxes) {
                    for (box in parityBoxes.toList()) {
                        box.refresh()
                        if (!box.view.isShown || box.bounds.width < 1f || box.bounds.height < 1f) continue
                        val loc = IntArray(2).also { box.view.getLocationOnScreen(it) }
                        val fitted = box.fit?.invoke(box.bounds) ?: box.bounds
                        val x = fitted.left + loc[0] - mainLoc[0]; val y = fitted.top + loc[1] - mainLoc[1]
                        val w = fitted.width; val h = fitted.height
                        val e = JSONObject().put("text", box.label).put("role", box.role)
                            .put("rect", JSONObject().put("x", r2(x)).put("y", r2(y)).put("w", r2(w)).put("h", r2(h)))
                            .put("color", box.style?.let { hex(it.third.toArgb(), true) } ?: JSONObject.NULL)
                            .put("background", if (box.background != androidx.compose.ui.graphics.Color.Unspecified) hex(box.background.toArgb()) else insideColour(bmp, x.toInt(), y.toInt(), w.toInt(), h.toInt()) ?: JSONObject.NULL)
                            .put("fontSize", box.style?.first?.toDouble() ?: JSONObject.NULL).put("fontWeight", box.style?.second ?: JSONObject.NULL)
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
        val inner = synchronized(parityBoxes) { parityBoxes.toList() }.onEach { it.refresh() }.filter { it.background != androidx.compose.ui.graphics.Color.Unspecified && it.role != "image" && it.role != "img" }
            .filter { b -> val loc = IntArray(2).also { b.view.getLocationOnScreen(it) }; val bx = b.bounds.left + loc[0] - mainOrigin[0]; val by = b.bounds.top + loc[1] - mainOrigin[1]; cx in bx..(bx + b.bounds.width) && cy in by..(by + b.bounds.height) }
            .let { c -> val top = c.filter { it.view.rootView !== mainRoot }; (if (top.isNotEmpty()) top else c).reversed().minByOrNull { it.bounds.width * it.bounds.height } }
        return hex((inner?.background ?: PlayarrWebTheme.palette.surface).toArgb())
    }

    private var mainRoot: View? = null
    private var mainOrigin = IntArray(2)

    /**
     * One element per laid-out text line, read from the app's own [TextLayoutResult]: the line's text, its glyph-run left and right, and
     * the font's ascent and descent as the app's own font resolves them (a probe measurement, not a constant). The transform to the window
     * is the node's real [androidx.compose.ui.layout.LayoutCoordinates] (graphicsLayer scale and offsets included).
     * shortcut: one element per line, not per style run (a line mixing sizes or weights exports at its first style), upgrade when such a Text appears.
     */
    private fun walk(node: SemanticsNode, dx: Int, dy: Int, bitmap: Bitmap?, out: JSONArray) {
        val config = node.config
        val text = config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
        if (text.isNotEmpty() && node.layoutInfo.isPlaced) {
            val results = mutableListOf<TextLayoutResult>()
            config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
            val layout = results.firstOrNull()
            val coords = node.layoutInfo.coordinates
            if (layout != null && coords.isAttached) {
                val input = layout.layoutInput
                val density = input.density
                val style = input.style
                val size = style.fontSize.value * density.fontScale * density.density
                val colour = style.color.takeIf { it.alpha > 0f && it != androidx.compose.ui.graphics.Color.Unspecified }
                val heading = config.contains(SemanticsProperties.Heading)
                val probe = androidx.compose.ui.text.TextMeasurer(input.fontFamilyResolver, density, input.layoutDirection)
                    .measure("Hg", style.copy(lineHeight = androidx.compose.ui.unit.TextUnit.Unspecified, letterSpacing = androidx.compose.ui.unit.TextUnit.Unspecified, textAlign = androidx.compose.ui.text.style.TextAlign.Unspecified), maxLines = 1)
                val ascent = probe.getLineBaseline(0) - probe.getLineTop(0)
                val descent = probe.getLineBottom(0) - probe.getLineBaseline(0)
                // The browser's run box includes the letter spacing after the last glyph; Compose's line right edge does not.
                val trailing = (style.letterSpacing.takeIf { it.isSp }?.value ?: 0f) * density.fontScale * density.density
                val lineBox = config.contains(io.playarr.shared.designsystem.page.ParityLineBoxKey)
                val declared = style.lineHeight.takeIf { it.isSp }?.value?.times(density.fontScale * density.density)
                val half = if (lineBox && declared != null) (declared - (ascent + descent)) / 2f else 0f
                val rawText = input.text.text
                val override = config.getOrNull(io.playarr.shared.designsystem.page.ParityTextKey)
                val bgOverride = config.getOrNull(io.playarr.shared.designsystem.page.ParityBgKey)?.let { androidx.compose.ui.graphics.Color(it.toULong()) }
                for (i in 0 until layout.lineCount) {
                    val lineText = rawText.substring(layout.getLineStart(i), layout.getLineEnd(i, true)).trim()
                    if (lineText.isEmpty()) continue
                    val l = layout.getLineLeft(i); val r = layout.getLineRight(i) + trailing
                    val baseline = layout.getLineBaseline(i)
                    val top = baseline - ascent - half
                    val bottom = if (lineBox && declared != null) top + declared else baseline + descent
                    val a = coords.localToRoot(androidx.compose.ui.geometry.Offset(l, top)); val b = coords.localToRoot(androidx.compose.ui.geometry.Offset(r, bottom))
                    val rx = minOf(a.x, b.x) + dx; val ry = minOf(a.y, b.y) + dy; val rw = Math.abs(b.x - a.x); val rh = Math.abs(b.y - a.y)
                    out.put(
                        JSONObject().apply { config.getOrNull(io.playarr.shared.designsystem.page.ParityRadiusKey)?.let { put("radius", it.toDouble()) } }
                            .put("text", if (override != null && layout.lineCount == 1) override else lineText)
                            .put("role", config.getOrNull(io.playarr.shared.designsystem.page.ParityRoleKey) ?: if (heading) "heading" else "text")
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
