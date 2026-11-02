package pw.pawchive.desktop

import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var splashOverlay: View? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.setBackgroundColor(Color.TRANSPARENT)
    showSplashOverlay()
    webView.addJavascriptInterface(
      object {
        @JavascriptInterface
        fun hide() {
          runOnUiThread { hideSplashOverlay() }
        }
      },
      "AndroidSplash",
    )
  }

  private fun showSplashOverlay() {
    if (splashOverlay != null) return
    val content = findViewById<ViewGroup>(android.R.id.content) ?: return
    val logoSize = (160 * resources.displayMetrics.density).toInt()

    val logo = ImageView(this).apply {
      setImageResource(R.drawable.splash_logo)
      scaleType = ImageView.ScaleType.FIT_CENTER
      layoutParams = FrameLayout.LayoutParams(logoSize, logoSize, Gravity.CENTER)
    }
    val overlay = FrameLayout(this).apply {
      setBackgroundColor(Color.rgb(0x17, 0x19, 0x1A))
      addView(logo)
    }
    content.addView(
      overlay,
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
    splashOverlay = overlay

    // Fallback: never leave the splash covering the app if the webview fails.
    Handler(Looper.getMainLooper()).postDelayed({ hideSplashOverlay() }, 5000)
  }

  private fun hideSplashOverlay() {
    splashOverlay?.visibility = View.GONE
    splashOverlay = null
  }
}
