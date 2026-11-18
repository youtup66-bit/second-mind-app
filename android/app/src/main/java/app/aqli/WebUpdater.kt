package app.aqli

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// تحديث صفحة التطبيق من داخله: ينزّل الملفات المتغيّرة من موقع النسخة التجريبية،
// ويتحقق من بصمة كل ملف، ثم يستبدل النسخة المحفوظة في الجهاز.
// لا يحتاج git ولا إعادة بناء APK لتغييرات الواجهة. تغييرات الكود الأصلي تحتاج APK جديداً.
object WebUpdate {
    // موقع الملفات التي يُحدَّث منها التطبيق
    const val BASE = "https://youtup66-bit.github.io/second-mind-app/dev/"
    const val MANIFEST = "update.json"
    const val VERSION_FILE = "version.txt"
    const val FOLDER = "web"
}

// يخدم ملفات الصفحة: المحدَّث من الجهاز أولاً، وإلا النسخة المضمّنة في التطبيق
class WebFilesHandler(private val context: Context) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        val rel = path.ifEmpty { "index.html" }.let { if (it.endsWith("/")) it + "index.html" else it }
        if (rel.contains("..")) return null
        val mime = mimeOf(rel)
        val encoding = if (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")) "UTF-8" else null
        return try {
            val local = File(File(context.filesDir, WebUpdate.FOLDER), rel)
            if (local.isFile) WebResourceResponse(mime, encoding, FileInputStream(local))
            else WebResourceResponse(mime, encoding, context.assets.open("app/$rel"))
        } catch (e: Exception) {
            null
        }
    }

    private fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "application/javascript"
        "css" -> "text/css"
        "json", "webmanifest" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        else -> "application/octet-stream"
    }
}

// نفّذ التحديث وأبلغ الصفحة بالتقدم عبر emit؛ ينتهي بـ onApplied لإعادة تحميل الصفحة
class WebUpdater(
    private val context: Context,
    private val emit: (JSONObject) -> Unit,
    private val onApplied: () -> Unit,
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val root = File(context.filesDir, WebUpdate.FOLDER)

    // الإصدار الحالي: المحدَّث إن وُجد، وإلا المضمّن في التطبيق
    fun currentVersion(): String = try {
        File(root, WebUpdate.VERSION_FILE).readText().trim()
    } catch (e: Exception) {
        try { context.assets.open("app/${WebUpdate.VERSION_FILE}").bufferedReader().readText().trim() } catch (e2: Exception) { "" }
    }

    fun run() {
        scope.launch {
            try {
                val manifest = JSONObject(fetchText(WebUpdate.BASE + WebUpdate.MANIFEST))
                val remote = manifest.getString("version")
                val current = currentVersion()
                if (remote == current) {
                    emit(JSONObject().put("type", "uptodate").put("version", current))
                    return@launch
                }
                val files = manifest.getJSONArray("files")
                val total = files.length()
                emit(JSONObject().put("type", "start").put("total", total).put("version", remote))

                val tmp = File(context.filesDir, "${WebUpdate.FOLDER}-new")
                tmp.deleteRecursively()
                tmp.mkdirs()
                for (i in 0 until total) {
                    val item = files.getJSONObject(i)
                    val rel = item.getString("path")
                    if (rel.contains("..")) throw IllegalStateException("مسار غير صالح في التحديث")
                    val target = File(tmp, rel)
                    target.parentFile?.mkdirs()
                    downloadVerified(WebUpdate.BASE + rel, target, item.getString("sha256"))
                    emit(JSONObject().put("type", "progress").put("done", i + 1).put("total", total))
                }
                File(tmp, WebUpdate.VERSION_FILE).writeText(remote)
                // استبدال النسخة القديمة بعد نجاح كل الملفات
                root.deleteRecursively()
                if (!tmp.renameTo(root)) throw IllegalStateException("تعذّر تثبيت التحديث على الجهاز")
                emit(JSONObject().put("type", "done").put("version", remote))
                onApplied()
            } catch (e: Throwable) {
                emit(JSONObject().put("type", "error").put("message", e.message ?: "تعذّر التحديث، تحقق من الإنترنت"))
            }
        }
    }

    private fun fetchText(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 30_000
            instanceFollowRedirects = true
        }
        try {
            if (conn.responseCode !in 200..299) throw IllegalStateException("خادم التحديث أعاد ${conn.responseCode}")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    // ينزّل الملف ويتحقق من بصمته قبل حفظه
    private fun downloadVerified(url: String, target: File, expectedSha: String) {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        try {
            if (conn.responseCode !in 200..299) throw IllegalStateException("تعذّر تنزيل ${target.name}")
            val digest = MessageDigest.getInstance("SHA-256")
            conn.inputStream.use { input ->
                target.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                    }
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (!actual.equals(expectedSha, ignoreCase = true)) {
                target.delete()
                throw IllegalStateException("بصمة الملف ${target.name} غير مطابقة")
            }
        } finally {
            conn.disconnect()
        }
    }
}
