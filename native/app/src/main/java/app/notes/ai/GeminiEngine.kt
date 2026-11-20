package app.notes.ai

import app.notes.data.Msg
import app.notes.data.Note
import app.notes.data.Section
import app.notes.data.path
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * ذكاء على الإنترنت عبر Gemini API.
 * يُرسل إلى Google: آخر رسائل المحادثة، والملاحظات القليلة ذات الصلة، وما تطلب تصنيفه أو تلخيصه فقط.
 * المفتاح يُحفظ على الهاتف ويُرسل إلى Google وحدها.
 */
class GeminiEngine(private val key: String, private val model: String) : AiEngine {
    override val name = "Gemini 🌐"

    override suspend fun reply(history: List<Msg>, memory: List<Note>, input: String, section: Section): String {
        val sys = buildString {
            append("أنت «عقلي»، مساعد ملاحظات شخصي ذكي في تطبيق على هاتف المستخدم. ")
            append("افهم ما يريده (فضفضة، رأي، حل، معلومة)، وردّ بالعربية البسيطة الدافئة بإيجاز (٢ إلى ٥ جمل). ")
            append("عند طلب حل قدّم خطوات عملية قصيرة تبدأ كل منها بـ \"- \"، بلا عناوين ولا رموز تنسيق أخرى. ")
            append("كن صريحاً بلطف، واختم غالباً بسؤال واحد أو خطوة تالية صغيرة. ")
            append("حُفظ كلامه الأخير في قسم «${section.name}».")
            if (memory.isNotEmpty()) {
                append("\n\nملاحظات سابقة من عقله قد تكون ذات صلة (استعن بها صراحة إن أفادت، مثل: ذكرتَ سابقاً أن…، ولا تخترع شيئاً لم يرد فيها):")
                memory.forEach { append("\n- ").append(it.text.take(400).replace(Regex("\\s+"), " ")) }
            }
        }
        val turns = history.dropLast(1).takeLast(12).map { it.role to it.text } + ("user" to input)
        return generate(sys, turns, temperature = 0.8, maxTokens = 2048)
    }

    override suspend fun classify(text: String, sections: List<Section>): Section? {
        val list = sections.mapIndexed { i, s -> "${i + 1}. ${s.path(sections)}" }.joinToString("\n")
        val out = generate(
            "أنت مصنِّف ملاحظات. اختر القسم الأنسب للملاحظة من القائمة، وأجب برقم القسم فقط.\n$list",
            listOf("user" to "الملاحظة: ${text.take(1000)}"),
            temperature = 0.0, maxTokens = 256,
        )
        val n = Regex("\\d+").find(out.map { c -> if (c in '٠'..'٩') '0' + (c - '٠') else c }.joinToString(""))
            ?.value?.toIntOrNull() ?: return null
        return sections.getOrNull(n - 1)
    }

    override suspend fun plan(text: String, sections: List<Section>): List<AppAction> =
        ActionPlanner.parse(
            generate(ActionPlanner.prompt(sections), listOf("user" to text.take(1000)), temperature = 0.0, maxTokens = 1024, json = true),
        )

    override suspend fun summarize(section: Section, notes: List<Note>): String? {
        val sb = StringBuilder()
        for (n in notes.asReversed()) {
            val line = "- ${n.text.take(400)}\n"
            if (sb.length + line.length > 12_000) break
            sb.append(line)
        }
        return generate(
            "أنت تلخّص كتاب «${section.name}» من ملاحظات المستخدم الشخصية. اكتب بالعربية ملخصاً قصيراً (٣ إلى ٥ نقاط تبدأ بـ \"- \") يبرز أهم ما فيه وما يتكرر، ثم سطراً واحداً بخطوة مقترحة. لا تخترع شيئاً ليس في الملاحظات.",
            listOf("user" to "الملاحظات:\n$sb"),
            temperature = 0.4, maxTokens = 1500,
        ).ifBlank { null }
    }

    private suspend fun generate(
        system: String, turns: List<Pair<String, String>>, temperature: Double, maxTokens: Int, json: Boolean = false,
    ): String =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
                .put("contents", JSONArray().apply {
                    turns.forEach { (role, text) ->
                        put(JSONObject()
                            .put("role", if (role == "user") "user" else "model")
                            .put("parts", JSONArray().put(JSONObject().put("text", text))))
                    }
                })
                .put("generationConfig", JSONObject().put("temperature", temperature).put("maxOutputTokens", maxTokens).apply {
                    if (json) put("responseMimeType", "application/json")
                })

            val conn = (URL("$API/models/$model:generateContent").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 60_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("x-goog-api-key", key)
            }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw GeminiException(explain(code, text))

            val parts = JSONObject(text).optJSONArray("candidates")?.optJSONObject(0)
                ?.optJSONObject("content")?.optJSONArray("parts") ?: return@withContext ""
            buildString {
                for (i in 0 until parts.length()) {
                    val p = parts.optJSONObject(i) ?: continue
                    if (p.optBoolean("thought")) continue
                    append(p.optString("text"))
                }
            }.trim()
        }

    private fun explain(code: Int, body: String): String {
        val msg = runCatching { JSONObject(body).getJSONObject("error").optString("message") }.getOrDefault("")
        return when {
            code == 400 && msg.contains("API key", ignoreCase = true) -> "مفتاح Gemini غير صحيح. راجعه في صفحة النماذج."
            code == 401 || code == 403 -> "مفتاح Gemini مرفوض. تأكد منه في صفحة النماذج."
            code == 404 -> "النموذج $model غير متاح لمفتاحك. اختر نموذجاً آخر في صفحة النماذج."
            code == 429 -> "انتهت حصة Gemini المجانية مؤقتاً. جرّب بعد قليل أو اختر Flash-Lite."
            code >= 500 -> "خوادم Gemini مشغولة الآن. جرّب بعد قليل."
            else -> "خطأ من Gemini ($code) ${msg.take(120)}"
        }
    }

    companion object {
        const val API = "https://generativelanguage.googleapis.com/v1beta"
        const val MODEL_FLASH = "gemini-3.6-flash"
        const val MODEL_LITE = "gemini-3.5-flash-lite"
    }
}

class GeminiException(message: String) : Exception(message)
