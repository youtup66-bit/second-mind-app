package app.aqli

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import java.io.File

// حفظ الملفات ومشاركتها من الصفحة (يُعرض باسم "AqliFiles").
// WebView لا يحفظ التنزيلات ولا يدعم navigator.share، فنستعمل أندرويد مباشرة.
class FileBridge(private val activity: MainActivity) {

    // يحفظ الملف في مجلد التنزيلات، ويعيد true عند النجاح
    @JavascriptInterface
    fun save(name: String, mime: String, base64: String): Boolean {
        return try {
            val resolver = activity.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safeName(name))
                put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
            resolver.openOutputStream(uri)?.use { it.write(Base64.decode(base64, Base64.DEFAULT)) } ?: return false
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        } catch (e: Exception) {
            false
        }
    }

    // يفتح قائمة المشاركة في أندرويد (Drive، البريد، واتساب...)
    @JavascriptInterface
    fun share(name: String, mime: String, base64: String): Boolean {
        return try {
            val dir = File(activity.cacheDir, "shared").apply { mkdirs() }
            val file = File(dir, safeName(name))
            file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
            val uri: Uri = FileProvider.getUriForFile(activity, "app.aqli.files", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mime.ifBlank { "application/octet-stream" }
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, "مشاركة الملف")) }
            true
        } catch (e: Exception) {
            false
        }
    }

    // اسم آمن لا يحوي مسارات
    private fun safeName(name: String): String =
        name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120).ifBlank { "ملف" }
}
