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

// جسر الذكاء الأصلي: يُعرض للصفحة باسم "AqliNative".
// - التنزيل يجري في خدمة في المقدمة (DownloadService) فيستمر حتى لو خرج المستخدم من الشاشة أو التطبيق.
// - المحادثة تعمل بمحرك llama.cpp المدمج (مكتبة com.arm.aichat) دون أي خادم.
// كل النتائج تعود إلى الصفحة عبر window.__aqliNative({ type, id, ... }).
// الأنواع: progress و token و done و error.
class NativeAI(private val context: Context, private val web: WebView) {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    // المحادثة تخدم طلباً واحداً في كل مرة: محرك llama.cpp لا يتحمل طلبين معاً
    private val lock = Mutex()
    private val dir = File(context.filesDir, "models").apply { mkdirs() }
    // المسار الذي حُمّل فيه النموذج الآن (لإعادة الضبط بدل إعادة التحميل)
    private var loadedPath: String? = null

    init {
        // أحداث التنزيل تأتي من الخدمة؛ نرسلها إلى الصفحة إن كانت حيّة
        DownloadService.sink = { ev -> emit(ev) }
    }

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

    // ينزّل النموذج في خدمة المقدمة. إن انقطع يُكمَل من حيث توقف (ملف .part)
    @JavascriptInterface
    fun download(url: String, name: String, id: String) {
        val target = fileOf(name) ?: return fail(id, "اسم ملف النموذج غير صالح")
        if (target.isFile && target.length() > 0) {
            emit(JSONObject().put("type", "done").put("id", id))
            return
        }
        DownloadService.start(context, url, target.absolutePath, id)
    }

    // يحمّل النموذج ويجيب على الرسالة. يبدأ كل طلب بسياق نظيف (A25) دون إعادة تحميل إن كان محمّلاً
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
                        // النموذج محمّل: نمسح السياق داخل المحرك فقط دون إعادة تحميل
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
