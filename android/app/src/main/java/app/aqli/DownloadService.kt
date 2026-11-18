package app.aqli

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File

// يُنزّل النموذج في خدمة في المقدمة: تبقى حية ويستمر التنزيل حتى لو خرج المستخدم من الشاشة
// أو من التطبيق، ويظهر تقدّمه في شريط الإشعارات. الأحداث تُرسل إلى الصفحة عبر sink إن كانت حيّة.
class DownloadService : Service() {

    companion object {
        private const val CHANNEL = "model-download"
        private const val NOTE_ID = 7

        // يضبطه NativeAI ليستقبل الأحداث ويرسلها إلى الصفحة
        @Volatile
        var sink: ((JSONObject) -> Unit)? = null

        fun start(ctx: Context, url: String, path: String, id: String) {
            val i = Intent(ctx, DownloadService::class.java)
                .putExtra("url", url)
                .putExtra("path", path)
                .putExtra("id", id)
            ContextCompat.startForegroundService(ctx, i)
        }
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val i = intent ?: run { stopSelf(startId); return START_NOT_STICKY }
        val url = i.getStringExtra("url") ?: run { stopSelf(startId); return START_NOT_STICKY }
        val path = i.getStringExtra("path") ?: run { stopSelf(startId); return START_NOT_STICKY }
        val id = i.getStringExtra("id") ?: "model"
        val label = File(path).name

        ensureChannel()
        startForeground(NOTE_ID, notification("جارٍ تنزيل $label…", 0))

        scope.launch {
            try {
                ModelFiles.fetch(url, File(path)) { loaded, total ->
                    if (total > 0) {
                        val pct = (loaded * 100 / total).toInt()
                        notifyProgress(notification("جارٍ تنزيل $label… $pct%", pct))
                    }
                    sink?.invoke(JSONObject().put("type", "progress").put("id", id)
                        .put("loaded", loaded).put("total", total))
                }
                sink?.invoke(JSONObject().put("type", "done").put("id", id))
            } catch (e: Throwable) {
                val msg = if (e is java.io.IOException) "تعذّر التنزيل؛ تأكد من الاتصال بالإنترنت ثم أعد المحاولة." else (e.message ?: "فشل التنزيل")
                sink?.invoke(JSONObject().put("type", "error").put("id", id).put("message", msg))
            } finally {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf(startId)
            }
        }
        return START_NOT_STICKY
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val ch = NotificationChannel(CHANNEL, "تنزيل النموذج", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    private fun notification(text: String, pct: Int): Notification =
        NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("عقلي الثاني")
            .setContentText(text)
            .setProgress(100, pct, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    private fun notifyProgress(n: Notification) {
        try {
            NotificationManagerCompat.from(this).notify(NOTE_ID, n)
        } catch (_: SecurityException) {
            // إذن الإشعارات غير ممنوح: التنزيل يكمل والإشعار مخفي
        }
    }
}
