package app.notes.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class AppVersion(val code: Long, val name: String)

/**
 * تحديث التطبيق نفسه من إصدار "notes-latest" في GitHub.
 * لا يُرسل شيء من بياناتك؛ يقرأ رقم الإصدار وينزّل ملف التطبيق فقط.
 */
class Updater(private val ctx: Context) {

    fun current(): AppVersion {
        val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        return AppVersion(code, info.versionName ?: "")
    }

    /** آخر نسخة منشورة. */
    suspend fun latest(): AppVersion = withContext(Dispatchers.IO) {
        val json = JSONObject(open("$BASE/version.json").inputStream.bufferedReader().use { it.readText() })
        AppVersion(json.getLong("versionCode"), json.getString("versionName"))
    }

    /** تنزيل ملف التطبيق مع نسبة التقدم. */
    suspend fun download(onProgress: (Int) -> Unit): File = withContext(Dispatchers.IO) {
        val dir = File(ctx.getExternalFilesDir(null), "updates").apply { mkdirs() }
        val out = File(dir, "aqli-notes.apk")
        val conn = open("$BASE/aqli-notes.apk")
        val total = conn.contentLengthLong
        conn.inputStream.use { input ->
            out.outputStream().use { o ->
                val buf = ByteArray(64 * 1024)
                var done = 0L
                var last = -1
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    o.write(buf, 0, n)
                    done += n
                    if (total > 0) {
                        val pct = (done * 100 / total).toInt()
                        if (pct != last) { last = pct; withContext(Dispatchers.Main) { onProgress(pct) } }
                    }
                }
            }
        }
        out
    }

    /** هل سمح المستخدم للتطبيق بتثبيت التحديثات؟ */
    fun canInstall(): Boolean = ctx.packageManager.canRequestPackageInstalls()

    fun openInstallPermission() {
        ctx.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    /** يفتح شاشة التثبيت في أندرويد؛ المستخدم يؤكد. */
    fun install(apk: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", apk)
        ctx.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            useCaches = false
            if (responseCode !in 200..299) throw IllegalStateException("HTTP $responseCode")
        }

    companion object {
        const val BASE = "https://github.com/youtup66-bit/second-mind-app/releases/download/notes-latest"
    }
}
