package io.playarr.mobile.ui

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.graphics.toArgb
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
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED) else activity.registerReceiver(receiver, filter)
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
                        walk(owner.rootSemanticsNode, view, loc[0] - main[0], loc[1] - main[1], bitmap.takeIf { result == PixelCopy.SUCCESS }, elements)
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

    private fun hex(argb: Int, withAlpha: Boolean = false): String =
        "#%02x%02x%02x".format((argb shr 16) and 255, (argb shr 8) and 255, argb and 255) + if (withAlpha && (argb ushr 24) < 255) "%02x".format(argb ushr 24) else ""

    private fun backgroundAround(bitmap: Bitmap?, x: Int, y: Int, w: Int, h: Int): String? {
        bitmap ?: return null
        fun px(px: Int, py: Int) = bitmap.getPixel(px.coerceIn(0, bitmap.width - 1), py.coerceIn(0, bitmap.height - 1))
        val samples = listOf(px(x - 2, y - 2), px(x - 2, y + h + 2), px(x + w + 2, y - 2), px(x + w + 2, y + h + 2), px(x - 2, y + h / 2), px(x + w + 2, y + h / 2))
        return hex(samples.groupingBy { it }.eachCount().maxByOrNull { it.value }!!.key)
    }

    private fun walk(node: SemanticsNode, view: View, dx: Int, dy: Int, bitmap: Bitmap?, out: JSONArray) {
        val config = node.config
        val bounds = node.boundsInRoot
        val x = bounds.left.toInt() + dx; val y = bounds.top.toInt() + dy
        val text = config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
        val layout: TextLayoutResult? = if (text.isNotEmpty()) {
            val results = mutableListOf<TextLayoutResult>()
            config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
            results.firstOrNull()
        } else null
        val label = config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ").orEmpty()
        val clickable = config.contains(SemanticsActions.OnClick)
        val focusable = config.contains(SemanticsProperties.Focused)
        val role = config.getOrNull(SemanticsProperties.Role)
        val density = layout?.layoutInput?.density
        if (layout != null && density != null) {
            // Glyph-run bounds: the union of the laid-out lines (not the widget box).
            var l = Float.MAX_VALUE; var t = Float.MAX_VALUE; var r = 0f; var b = 0f
            for (i in 0 until layout.lineCount) {
                if (layout.getLineEnd(i) == layout.getLineStart(i)) continue
                l = minOf(l, layout.getLineLeft(i)); r = maxOf(r, layout.getLineRight(i))
                t = minOf(t, layout.getLineTop(i)); b = maxOf(b, layout.getLineBottom(i))
            }
            if (r > l) {
                val style = layout.layoutInput.style
                val sp = style.fontSize.value * density.fontScale * density.density
                val colour = style.color.takeIf { it.alpha > 0f && it != androidx.compose.ui.graphics.Color.Unspecified }
                val rx = x + l.toInt(); val ry = y + t.toInt(); val rw = (r - l).toInt(); val rh = (b - t).toInt()
                out.put(
                    JSONObject().put("text", text).put("role", if (clickable || focusable) "button" else "text")
                        .put("rect", JSONObject().put("x", rx).put("y", ry).put("w", rw).put("h", rh))
                        .put("color", colour?.let { hex(it.toArgb(), true) } ?: JSONObject.NULL)
                        .put("background", backgroundAround(bitmap, rx, ry, rw, rh) ?: JSONObject.NULL)
                        .put("fontSize", Math.round(sp * 100) / 100.0).put("fontWeight", style.fontWeight?.weight ?: 400),
                )
            }
        } else if (label.isNotEmpty() || clickable || role == Role.Image) {
            val w = (bounds.right - bounds.left).toInt(); val h = (bounds.bottom - bounds.top).toInt()
            if (w > 0 && h > 0 && node.layoutInfo.isPlaced) {
                out.put(
                    JSONObject().put("text", label).put("role", if (role == Role.Image) "image" else if (clickable) "button" else "container")
                        .put("rect", JSONObject().put("x", x).put("y", y).put("w", w).put("h", h))
                        .put("color", JSONObject.NULL).put("background", backgroundAround(bitmap, x, y, w, h) ?: JSONObject.NULL)
                        .put("fontSize", JSONObject.NULL).put("fontWeight", JSONObject.NULL),
                )
            }
        }
        node.children.forEach { walk(it, view, dx, dy, bitmap, out) }
    }
}
