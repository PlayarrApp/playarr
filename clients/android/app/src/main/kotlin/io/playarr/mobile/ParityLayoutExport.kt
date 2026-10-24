@file:OptIn(androidx.compose.ui.InternalComposeUiApi::class)

package io.playarr.mobile

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.TextLayoutResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Debuggable builds only (parity captures): `am broadcast -a io.playarr.mobile.PARITY_LAYOUT -p io.playarr.mobile` writes
 * `files/parity-layout.json`, the Compose semantics tree as layout elements in device px (docs/parity/LAYOUT.md). Text rects are the
 * laid-out line bounds, font size, weight and colour come from the text layout's own style. Backgrounds are not in semantics;
 * the run script samples them from the screenshot.
 */
internal object ParityLayoutExport {
    const val ACTION = "io.playarr.mobile.PARITY_LAYOUT"

    fun register(activity: Activity) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val out = File(activity.filesDir, "parity-layout.json")
                out.delete()
                val json = runCatching { export(activity.window.decorView) }.getOrElse { JSONObject().put("error", it.toString()) }
                File(activity.filesDir, "parity-layout.tmp").also { it.writeText(json.toString()) }.renameTo(out)
            }
        }
        androidx.core.content.ContextCompat.registerReceiver(activity, receiver, IntentFilter(ACTION), androidx.core.content.ContextCompat.RECEIVER_EXPORTED)
    }

    private fun findRoot(view: View): RootForTest? {
        if (view is RootForTest) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) findRoot(view.getChildAt(i))?.let { return it }
        return null
    }

    private fun hex(argb: Int, withAlpha: Boolean = true): String {
        val a = argb ushr 24 and 0xFF
        val rgb = String.format("#%06x", argb and 0xFFFFFF)
        return if (withAlpha && a != 255) rgb + String.format("%02x", a) else rgb
    }

    private fun export(decor: View): JSONObject {
        val root = findRoot(decor) ?: error("no compose root")
        val elements = JSONArray()
        fun visit(node: SemanticsNode) {
            val b: Rect = node.boundsInWindow
            val cfg = node.config
            val textList = cfg.getOrNull(SemanticsProperties.Text)
            val desc = cfg.getOrNull(SemanticsProperties.ContentDescription)?.joinToString(" ")
            val role = cfg.getOrNull(SemanticsProperties.Role)
            val clickable = cfg.getOrNull(SemanticsActions.OnClick) != null
            val heading = cfg.contains(SemanticsProperties.Heading)
            val layouts = ArrayList<TextLayoutResult>()
            if (textList != null) cfg.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(layouts)
            val layout = layouts.firstOrNull()
            val visible = b.width > 0 && b.height > 0
            if (visible && layout != null && textList != null) {
                // Chromium's Range rect is the font's content area (ascent + descent), not the line box: Nunito Sans 1.011 / 0.353 em.
                val style0 = layout.layoutInput.style
                val fs = with(layout.layoutInput.density) { style0.fontSize.toPx() }
                var l = Float.MAX_VALUE; var t = Float.MAX_VALUE; var r = 0f; var bt = 0f
                for (i in 0 until layout.lineCount) {
                    l = minOf(l, layout.getLineLeft(i)); r = maxOf(r, layout.getLineRight(i))
                    t = minOf(t, layout.getLineBaseline(i) - 1.011f * fs); bt = maxOf(bt, layout.getLineBaseline(i) + 0.353f * fs)
                }
                val style = layout.layoutInput.style
                val density = layout.layoutInput.density
                val px = with(density) { style.fontSize.toPx() }
                val colour = style.color
                elements.put(JSONObject()
                    .put("text", layout.layoutInput.text.text).put("role", if (heading) "heading" else if (clickable) "button" else "text")
                    .put("x", b.left + l).put("y", b.top + t).put("w", r - l).put("h", bt - t)
                    .put("color", if (colour.alpha == 0f && colour.red == 0f) JSONObject.NULL else hex(colour.toArgb()))
                    .put("fontSizePx", px).put("fontWeight", style.fontWeight?.weight ?: 400))
            } else if (visible && (clickable || role == Role.Image || (desc != null && textList == null))) {
                elements.put(JSONObject()
                    .put("text", desc ?: "").put("role", if (role == Role.Image) "image" else if (clickable) (if (role == Role.Button) "button" else "link") else "image")
                    .put("x", b.left).put("y", b.top).put("w", b.width).put("h", b.height))
            }
            node.children.forEach(::visit)
        }
        visit(root.semanticsOwner.unmergedRootSemanticsNode)
        return JSONObject().put("widthPx", decor.width).put("heightPx", decor.height).put("elements", elements)
    }
}
