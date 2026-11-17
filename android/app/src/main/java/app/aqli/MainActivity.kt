package app.aqli

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts

// الغلاف: يفتح التطبيق (الموقع) داخل متصفح مدمج يملك أذوناته، ويتولى نافذة اختيار الصور والمشاركة
class MainActivity : ComponentActivity() {

    companion object {
        // رابط نسخة التجربة؛ يُغيَّر إلى الرابط الرسمي عند الحاجة
        const val START_URL = "https://youtup66-bit.github.io/second-mind-app/dev/"
        const val HOST = "youtup66-bit.github.io"
    }

    private lateinit var web: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingShare: String? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        filePathCallback?.onReceiveValue(uris.toTypedArray())
        filePathCallback = null
    }

    // إشعار تقدم تنزيل النموذج يحتاج إذناً من أندرويد 13 فما بعد؛ التنزيل نفسه يعمل دونه
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // جسر بسيط يقرأه التطبيق: هل توجد صورة مشاركة؟ ويأخذها مرة واحدة
    inner class ShareBridge {
        @JavascriptInterface
        fun hasShare(): Boolean = pendingShare != null

        @JavascriptInterface
        fun takeShare(): String? {
            val s = pendingShare
            pendingShare = null
            return s
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
        }
        web.webViewClient = object : WebViewClient() {
            // الروابط الخارجية تُفتح في المتصفح الافتراضي، ويبقى التطبيق على موقعه
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // نوافذ التأكيد (confirm) في الصفحة: نعرضها بنافذة أندرويد حتى لا يُعدّ الرد "لا" تلقائياً
            override fun onJsConfirm(view: WebView, url: String?, message: String?, result: android.webkit.JsResult): Boolean {
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setMessage(message ?: "")
                    .setPositiveButton("موافق") { _, _ -> result.confirm() }
                    .setNegativeButton("إلغاء") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                // نوع الملفات يأتي من خاصية accept في الصفحة: صور للمرفقات، وملفات النسخ الاحتياطي لها أنواعها
                val accepted = params.acceptTypes.map { it.trim() }.filter { it.isNotEmpty() }
                // نوع واحد واضح يُستعمل كما هو؛ وإلا تُعرض كل الملفات
                val mime = if (accepted.size == 1 && accepted[0].contains('/')) accepted[0] else "*/*"
                pickFiles.launch(mime)
                return true
            }
        }
        web.addJavascriptInterface(ShareBridge(), "Android")
        // الذكاء على الجهاز بالمحرك الأصلي (تنزيل النموذج والمحادثة)
        web.addJavascriptInterface(NativeAI(applicationContext, web), "AqliNative")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        handleIntent(intent)
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(if (pendingShare != null) "$START_URL#/chats?share=1" else START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
        if (pendingShare != null) web.loadUrl("$START_URL#/chats?share=1")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    // صورة مشاركة: نحوّلها إلى رابط بيانات (base64) ليقرأه التطبيق
    private fun handleIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val type = intent.type ?: return
        if (!type.startsWith("image/")) return
        @Suppress("DEPRECATION")
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: return
        val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return
        pendingShare = "data:$type;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
}
