package io.playarr.mobile.webshell

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.util.DisplayMetrics
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.media3.ui.PlayerView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Pilot: the Playarr web TV client (packaged under assets, base `/tv/`) inside the platform WebView, with Media3 as the
 * video plane behind it and the remote keys delivered to the page. The native Compose UI (`MainActivity`) is untouched;
 * this activity is only reachable by component name until the owner approves switching a launcher. Debug builds accept
 * `parity_seed_b64` (base64 JavaScript run before the page boots, to store the server and a signed-in session) and
 * `web_debug=1` (WebView remote debugging).
 */
class WebTvShellActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var plane: PlayerView
    private var bridge: NativePlayerBridge? = null

    override fun attachBaseContext(newBase: Context) {
        // Same 160 dpi activity context as MainActivity: the page sees the 1920x1080 CSS-pixel TV canvas at DPR 1.
        val configuration = Configuration(newBase.resources.configuration)
        configuration.densityDpi = DisplayMetrics.DENSITY_DEFAULT
        super.attachBaseContext(newBase.createConfigurationContext(configuration))
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.BLACK))
        val root = FrameLayout(this)
        plane = PlayerView(this).apply {
            useController = false
            isFocusable = false
            setShutterBackgroundColor(Color.TRANSPARENT)
            visibility = android.view.View.GONE
        }
        root.addView(plane, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        val assets = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .setHttpAllowed(true)
            .addPathHandler("/tv/", SpaAssetsPathHandler(this))
            .build()
        web = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                userAgentString = "$userAgentString $USER_AGENT_TOKEN"
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)
            }
            WebView.setWebContentsDebuggingEnabled(intent.getBooleanExtra("web_debug", false))
        }
        root.addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setContentView(root)

        bridge = NativePlayerBridge(this, web, plane).also {
            web.addJavascriptInterface(it, "PlayarrAndroidTvPlayer")
        }
        web.addJavascriptInterface(ShellMarkers(), "PlayarrAndroidTvShell")

        intent.getStringExtra("parity_seed_b64")?.let { b64 ->
            val js = String(android.util.Base64.decode(b64, android.util.Base64.DEFAULT), Charsets.UTF_8)
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(web, js, setOf("http://$ASSET_HOST"))
            }
        }
        web.requestFocus()
        web.loadUrl("http://$ASSET_HOST/tv/")
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) {
                web.evaluateJavascript(BACK_JS) { result ->
                    // A Back nothing in the page claimed, on the root route, leaves the app.
                    if (result == "\"0|root\"") finish()
                }
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onDestroy() {
        bridge?.release()
        web.destroy()
        super.onDestroy()
    }

    private inner class ShellMarkers {
        @JavascriptInterface
        fun homeReady() {
            Log.i("PlayarrPerf", "home_ready")
        }
    }

    private companion object {
        const val ASSET_HOST = "localhost"
        const val USER_AGENT_TOKEN = "PlayarrAndroidTV/1.0"
        const val BACK_JS = "(function(){var e=new KeyboardEvent('keydown',{key:'GoBack',bubbles:true,cancelable:true});" +
            "(document.activeElement||document.body).dispatchEvent(e);" +
            "var p=location.pathname.replace(/\\/+\$/,'');var root=(p===''||p==='/tv'||p==='/tv/home');" +
            "return (e.defaultPrevented?'1':'0')+'|'+(root?'root':'page');})()"
    }
}

/** Serves the packaged bundle; any path without a file extension is a client-side route and gets `index.html`. */
private class SpaAssetsPathHandler(context: Context) : WebViewAssetLoader.PathHandler {
    private val assets = WebViewAssetLoader.AssetsPathHandler(context)

    override fun handle(path: String): WebResourceResponse? {
        val last = path.substringAfterLast('/')
        return assets.handle(if (last.contains('.')) path else "index.html")
    }
}
