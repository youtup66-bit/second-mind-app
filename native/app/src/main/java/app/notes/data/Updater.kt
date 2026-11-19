package app.notes.data

import android.app.DownloadManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
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

data class UpdateDownload(val percent: Int, val done: Boolean, val failed: Boolean)

/** يستقبل خبر انتهاء تنزيل التحديث من أندرويد ولو كان التطبيق مغلقاً. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
        val up = Updater(ctx.applicationContext)
        if (id < 0 || id != up.downloadId()) return
        if (up.state()?.done == true) up.notifyReady()
    }
}

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
    fun install(apk: File = apkFile) {
        ctx.getSystemService(NotificationManager::class.java).cancel(READY_NOTIF)
        ctx.startActivity(installIntent(apk))
    }

    private fun installIntent(apk: File): Intent {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", apk)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    // ---- التنزيل عبر مدير التنزيلات: يستمر بعد الخروج من الصفحة أو إغلاق التطبيق ----
    private val prefs = ctx.getSharedPreferences("update", Context.MODE_PRIVATE)
    private val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    val apkFile: File get() = File(File(ctx.getExternalFilesDir(null), "updates"), "aqli-notes.apk")

    fun downloadId(): Long = prefs.getLong("dl", -1)

    fun startDownload() {
        apkFile.delete()
        val id = dm.enqueue(
            DownloadManager.Request(Uri.parse("$BASE/aqli-notes.apk"))
                .setTitle("تحديث Note AI")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(ctx, "updates", "aqli-notes.apk")
                .setAllowedOverMetered(true),
        )
        prefs.edit().putLong("dl", id).apply()
    }

    /** حالة التنزيل الجاري: النسبة، وهل انتهى أو فشل. null إن لم يكن هناك تنزيل. */
    fun state(): UpdateDownload? {
        val id = downloadId()
        if (id < 0) return null
        dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
            if (!c.moveToFirst()) { clear(); return null }
            val done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
            val pct = if (total > 0) (done * 100 / total).toInt() else 0
            return when (c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                DownloadManager.STATUS_SUCCESSFUL -> UpdateDownload(100, done = true, failed = false)
                DownloadManager.STATUS_FAILED -> UpdateDownload(pct, done = false, failed = true)
                else -> UpdateDownload(pct, done = false, failed = false)
            }
        }
    }

    fun clear() = prefs.edit().remove("dl").apply()

    /** إشعار «التحديث جاهز» حين ينتهي التنزيل والتطبيق مغلق؛ الضغط عليه يفتح شاشة التثبيت. */
    fun notifyReady() {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("update", "تحديثات التطبيق", NotificationManager.IMPORTANCE_DEFAULT))
        val pi = PendingIntent.getActivity(ctx, 3, installIntent(apkFile), PendingIntent.FLAG_IMMUTABLE)
        nm.notify(
            READY_NOTIF,
            Notification.Builder(ctx, "update")
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("التحديث جاهز")
                .setContentText("اضغط للتثبيت. ملاحظاتك تبقى كما هي.")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build(),
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
        private const val READY_NOTIF = 9
        const val BASE = "https://github.com/youtup66-bit/second-mind-app/releases/download/notes-latest"
    }
}
