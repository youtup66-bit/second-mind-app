package app.notes.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * النسخ الاحتياطي: نسخة من قاعدة البيانات في مجلد يختاره المستخدم،
 * يُحدَّث الملف نفسه يدوياً أو تلقائياً كل ٢٤ ساعة. لا يغادر شيء الهاتف.
 */
class Backup(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("backup", Context.MODE_PRIVATE)

    val folder: Uri?
        get() = prefs.getString("folder", null)?.let(Uri::parse)

    val auto: Boolean get() = prefs.getBoolean("auto", false)
    val lastTime: Long get() = prefs.getLong("last", 0L)
    val lastError: String get() = prefs.getString("error", "") ?: ""

    fun folderName(): String? = folder?.let { DocumentFile.fromTreeUri(ctx, it)?.name }

    /** حفظ صلاحية المجلد الذي اختاره المستخدم حتى بعد إعادة التشغيل. */
    fun setFolder(uri: Uri) {
        folder?.let { old ->
            runCatching { ctx.contentResolver.releasePersistableUriPermission(old, RW) }
        }
        ctx.contentResolver.takePersistableUriPermission(uri, RW)
        prefs.edit().putString("folder", uri.toString()).apply()
    }

    fun setAuto(on: Boolean) {
        prefs.edit().putBoolean("auto", on).apply()
        val wm = WorkManager.getInstance(ctx)
        if (on) wm.enqueueUniquePeriodicWork(
            WORK, ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<BackupWorker>(24, TimeUnit.HOURS).build(),
        ) else wm.cancelUniqueWork(WORK)
    }

    /** يكتب النسخة فوق الملف نفسه في المجلد المختار. */
    fun runNow() {
        try {
            val tree = DocumentFile.fromTreeUri(ctx, folder ?: error("لم يُختر مجلد"))
                ?: error("المجلد غير متاح")
            if (!tree.canWrite()) error("لا صلاحية للكتابة في المجلد؛ اختره من جديد")
            val target = tree.findFile(FILE_NAME) ?: tree.createFile("application/octet-stream", FILE_NAME)
                ?: error("تعذّر إنشاء الملف")
            val db = Db.get(ctx)
            synchronized(db) {
                // دمج أي تغييرات معلّقة في الملف الرئيسي قبل نسخه
                db.writableDatabase.rawQuery("PRAGMA wal_checkpoint(FULL)", null).use { it.moveToFirst() }
                val src = ctx.getDatabasePath(DB_NAME)
                ctx.contentResolver.openOutputStream(target.uri, "wt")!!.use { out ->
                    src.inputStream().use { it.copyTo(out) }
                }
            }
            prefs.edit().putLong("last", System.currentTimeMillis()).putString("error", "").apply()
        } catch (e: Throwable) {
            prefs.edit().putString("error", e.message ?: e.javaClass.simpleName).apply()
            throw e
        }
    }

    /**
     * استعادة من ملف نسخة: يتحقق منه، ويحفظ القاعدة الحالية احتياطاً في التطبيق،
     * ثم يستبدلها ويعيد تشغيل التطبيق.
     */
    fun restore(uri: Uri) {
        val tmp = File(ctx.cacheDir, "restore.db")
        ctx.contentResolver.openInputStream(uri)!!.use { input -> tmp.outputStream().use { input.copyTo(it) } }
        val head = tmp.inputStream().use { s -> ByteArray(16).also { s.read(it) } }
        if (String(head, Charsets.US_ASCII) != "SQLite format 3\u0000") { tmp.delete(); error("هذا ليس ملف نسخة احتياطية صالحاً") }

        val db = Db.get(ctx)
        synchronized(db) {
            val cur = ctx.getDatabasePath(DB_NAME)
            db.close()
            if (cur.exists()) cur.copyTo(File(ctx.filesDir, "before-restore.db"), overwrite = true)
            File(cur.path + "-wal").delete()
            File(cur.path + "-shm").delete()
            tmp.copyTo(cur, overwrite = true)
            tmp.delete()
        }
        // إعادة تشغيل التطبيق ليقرأ القاعدة المستعادة
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
            ctx.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        }
        Runtime.getRuntime().exit(0)
    }

    companion object {
        const val FILE_NAME = "aqli-notes-backup.db"
        const val DB_NAME = "notes.db"
        private const val WORK = "daily-backup"
        private const val RW = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    }
}

/** يعمل في الخلفية كل ٢٤ ساعة حتى لو كان التطبيق مغلقاً. */
class BackupWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = try {
        Backup(applicationContext).runNow(); Result.success()
    } catch (e: Throwable) {
        if (runAttemptCount < 3) Result.retry() else Result.failure()
    }
}
