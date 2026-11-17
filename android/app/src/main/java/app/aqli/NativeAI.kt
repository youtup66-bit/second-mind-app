package app.aqli

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.arm.aichat.AiChat
import com.arm.aichat.AqliReset
import com.arm.aichat.InferenceEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

// جسر الذكاء الأصلي: يُعرض للصفحة باسم "AqliNative".
// - التنزيل يتم هنا (مع استئناف إن انقطع)، والنموذج يُحفظ في مجلد التطبيق الخاص.
// - المحادثة تعمل بمحرك llama.cpp المدمج (مكتبة com.arm.aichat) دون أي خادم.
// كل النتائج تعود إلى الصفحة عبر window.__aqliNative({ type, id, ... }).
// الأنواع: progress و token و done و error.
class NativeAI(private val context: Context, private val web: WebView) {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    // عملية ثقيلة واحدة في كل مرة (تنزيل أو محادثة): محرك llama.cpp يخدم طلباً واحداً
    private val lock = Mutex()
    private val dir = File(context.filesDir, "models").apply { mkdirs() }
    // المسار الذي حُمّل فيه النموذج الآن (لإعادة الضبط بدل إعادة التحميل)
    private var loadedPath: String? = null

    // اسم الملف فقط داخل مجلد النماذج، بلا مسارات
    private fun fileOf(name: String): File? {
        if (name.isBlank() || name.contains('/') || name.contains('\\') || name.startsWith('.')) return null
        return File(dir, name)
    }

    private fun emit(obj: JSONObject) {
        // JSON الناتج صالح كتعبير JavaScript مباشرة
        val js = "window.__aqliNative && window.__aqliNative($obj)"
        web.post { web.evaluateJavascript(js, null) }
    }

    private fun fail(id: String, message: String) =
        emit(JSONObject().put("type", "error").put("id", id).put("message", message))

    @JavascriptInterface
    fun hasModel(name: String): Boolean {
        val f = fileOf(name) ?: return false
        return f.isFile && f.length() > 0
    }

    @JavascriptInterface
    fun removeModel(name: String): Boolean = fileOf(name)?.delete() == true

    // ينزّل النموذج إلى مجلد التطبيق. إن انقطع يُكمَل من حيث توقف (ملف .part)
    @JavascriptInterface
    fun download(url: String, name: String, id: String) {
        val target = fileOf(name) ?: return fail(id, "اسم ملف النموذج غير صالح")
        scope.launch {
            try {
                lock.withLock { fetchTo(url, target, id) }
                emit(JSONObject().put("type", "done").put("id", id))
            } catch (e: Throwable) {
                fail(id, if (e is IOException) "تعذّر التنزيل؛ تأكد من الاتصال بالإنترنت ثم أعد المحاولة." else (e.message ?: "فشل التنزيل"))
            }
        }
    }

    private fun fetchTo(url: String, target: File, id: String) {
        if (target.isFile && target.length() > 0) return
        val part = File(target.path + ".part")
        val have = if (part.exists()) part.length() else 0L

        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 30_000
            readTimeout = 60_000
            instanceFollowRedirects = true
            if (have > 0) setRequestProperty("Range", "bytes=$have-")
        }
        try {
            conn.connect()
            val code = conn.responseCode
            if (code !in 200..299) throw IllegalStateException("خطأ من خادم التنزيل: $code")
            val resumed = code == HttpURLConnection.HTTP_PARTIAL
            val start = if (resumed) have else 0L
            val remaining = conn.contentLengthLong
            val total = if (remaining >= 0) start + remaining else -1L

            var done = start
            var lastReport = 0L
            conn.inputStream.use { input ->
                FileOutputStream(part, resumed).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val now = System.currentTimeMillis()
                        if (now - lastReport > 400) {
                            lastReport = now
                            emit(JSONObject().put("type", "progress").put("id", id)
                                .put("loaded", done).put("total", total))
                        }
                    }
                }
            }
            if (total > 0 && part.length() != total) throw IOException("انقطع التنزيل؛ أعد المحاولة ليكمل من حيث توقف.")
            // ملفات GGUF تبدأ بالنص GGUF؛ غير ذلك يعني رداً خاطئاً من الخادم
            val magic = ByteArray(4)
            part.inputStream().use { it.read(magic) }
            if (String(magic, Charsets.US_ASCII) != "GGUF") {
                part.delete()
                throw IllegalStateException("الملف المنزّل ليس نموذجاً صالحاً.")
            }
            if (!part.renameTo(target)) throw IllegalStateException("تعذّر حفظ النموذج على الجهاز.")
        } finally {
            conn.disconnect()
        }
    }

    // يحمّل النموذج ويجيب على الرسالة. يبدأ كل طلب بسياق نظيف: المحرك يحتفظ بالمحادثة
    // بين الطلبات، ولا يسمح بضبط تعليمات النظام إلا مباشرة بعد التحميل، فنعيد التحميل لكل طلب.
    @JavascriptInterface
    fun chat(id: String, name: String, system: String, user: String, maxTokens: Int) {
        val file = fileOf(name)
        if (file == null || !file.isFile) return fail(id, "النموذج غير منزّل بعد.")
        scope.launch {
            try {
                lock.withLock {
                    val engine = AiChat.getInferenceEngine(context)
                    val path = file.absolutePath
                    if (loadedPath == path && engine.state.value is InferenceEngine.State.ModelReady) {
                        // النموذج محمّل: نمسح السياق داخل المحرك فقط (A25) دون إعادة تحميل
                        AqliReset.reset()
                    } else {
                        // cleanUp يقبل النموذج المحمّل أو حالة الخطأ فقط
                        val state = engine.state.value
                        if (state is InferenceEngine.State.ModelReady || state is InferenceEngine.State.Error) {
                            withContext(Dispatchers.IO) { engine.cleanUp() }
                        }
                        loadedPath = null
                        engine.loadModel(path)
                        loadedPath = path
                    }
                    // المحرك لا يضبط تعليمات النظام إلا بعد التحميل مباشرة، فنضعها مع الرسالة نفسها
                    val prompt = if (system.isBlank()) user else "$system\n\n$user"
                    engine.sendUserPrompt(prompt, maxTokens).collect { piece ->
                        emit(JSONObject().put("type", "token").put("id", id).put("text", piece))
                    }
                }
                emit(JSONObject().put("type", "done").put("id", id))
            } catch (e: Throwable) {
                fail(id, when (e) {
                    is OutOfMemoryError -> "ذاكرة الجوال لا تكفي لهذا النموذج. أغلق التطبيقات الأخرى ثم أعد المحاولة."
                    else -> "تعذّر تشغيل النموذج على الجهاز: ${e.message ?: "خطأ غير معروف"}. أغلق التطبيق وافتحه من جديد."
                })
            }
        }
    }
}
