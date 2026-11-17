package app.notes.ai

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File

/** قالب المحادثة الذي يفهمه النموذج. */
enum class Template { GEMMA, CHATML }

data class ModelInfo(
    val id: String,
    val label: String,
    val note: String,
    val sizeMB: Int,
    val url: String,
    val fileName: String,
    val template: Template,
    /** يحتاج قبول الترخيص في HuggingFace ورمز دخول. */
    val gated: Boolean = false,
)

/** نماذج تعمل على الهاتف عبر MediaPipe LLM Inference (ملفات ‎.task). */
val MODEL_CATALOG = listOf(
    ModelInfo(
        "gemma3-1b", "Gemma 3 (1B)", "خفيف ومتوازن وعربيته جيدة. يحتاج رمز HuggingFace بعد قبول ترخيص Gemma.",
        560, "https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4.task",
        "gemma3-1b-it-int4.task", Template.GEMMA, gated = true,
    ),
    ModelInfo(
        "qwen25-05b", "Qwen 2.5 (0.5B)", "الأصغر والأسرع، ردوده أبسط.",
        550, "https://huggingface.co/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        "Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task", Template.CHATML,
    ),
    ModelInfo(
        "qwen25-15b", "Qwen 2.5 (1.5B)", "الأذكى بينها، للهواتف القوية (ذاكرة ٦ جيجا فأكثر).",
        1600, "https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        "Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task", Template.CHATML,
    ),
)

/** ملف نموذج موجود على الهاتف (منزَّل من القائمة أو مستورد). */
data class InstalledModel(val file: File, val label: String, val template: Template)

data class DownloadState(val percent: Int, val running: Boolean, val failed: Boolean)

class ModelManager(val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("models", Context.MODE_PRIVATE)
    private val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    val dir: File get() = File(ctx.getExternalFilesDir(null), "models").apply { mkdirs() }

    var hfToken: String
        get() = prefs.getString("hf_token", "") ?: ""
        set(v) = prefs.edit().putString("hf_token", v.trim()).apply()

    /** مسار النموذج المختار، أو فارغ للمحرك الأساسي. */
    var activePath: String
        get() = prefs.getString("active", "") ?: ""
        set(v) = prefs.edit().putString("active", v).apply()

    fun installed(): List<InstalledModel> =
        (dir.listFiles() ?: emptyArray())
            .filter { it.isFile && (it.name.endsWith(".task") || it.name.endsWith(".bin")) && it.length() > 1_000_000 }
            .sortedBy { it.name }
            .map { f ->
                val known = MODEL_CATALOG.firstOrNull { it.fileName == f.name }
                InstalledModel(f, known?.label ?: f.nameWithoutExtension, known?.template ?: guessTemplate(f.name))
            }

    fun fileOf(m: ModelInfo) = File(dir, m.fileName)

    /** تنزيل عبر مدير التنزيلات في أندرويد: يستمر بالخلفية ويظهر في الإشعارات. */
    fun startDownload(m: ModelInfo): Long {
        fileOf(m).delete()
        val req = DownloadManager.Request(Uri.parse(m.url))
            .setTitle("تنزيل ${m.label}")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(ctx, "models", m.fileName)
            .setAllowedOverMetered(true)
        // الرمز يُرسل إلى HuggingFace فقط، ولنماذجها المقيّدة فقط
        if (m.gated && hfToken.isNotEmpty()) req.addRequestHeader("Authorization", "Bearer $hfToken")
        val id = dm.enqueue(req)
        prefs.edit().putLong("dl_${m.id}", id).apply()
        return id
    }

    fun downloadState(m: ModelInfo): DownloadState? {
        val id = prefs.getLong("dl_${m.id}", -1)
        if (id < 0) return null
        dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
            if (!c.moveToFirst()) return null
            val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
            val pct = if (total > 0) (done * 100 / total).toInt() else 0
            return when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> { forget(m); null }
                DownloadManager.STATUS_FAILED -> DownloadState(pct, running = false, failed = true)
                else -> DownloadState(pct, running = true, failed = false)
            }
        }
    }

    fun cancelDownload(m: ModelInfo) {
        val id = prefs.getLong("dl_${m.id}", -1)
        if (id >= 0) dm.remove(id)
        forget(m)
        fileOf(m).delete()
    }

    private fun forget(m: ModelInfo) = prefs.edit().remove("dl_${m.id}").apply()

    /** استيراد ملف نموذج من الهاتف (مثلاً نزّلته من المتصفح). */
    fun import(uri: Uri): File {
        var name = "model.task"
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (i >= 0 && c.moveToFirst()) name = c.getString(i)
        }
        if (!name.endsWith(".task") && !name.endsWith(".bin")) name += ".task"
        val out = File(dir, name.replace(Regex("[/\\\\]"), "_"))
        ctx.contentResolver.openInputStream(uri)!!.use { input -> out.outputStream().use { input.copyTo(it, 1 shl 20) } }
        return out
    }

    fun delete(file: File) {
        if (file.absolutePath == activePath) activePath = ""
        file.delete()
    }

    companion object {
        fun guessTemplate(name: String) = if (name.lowercase().contains("gemma")) Template.GEMMA else Template.CHATML
    }
}
