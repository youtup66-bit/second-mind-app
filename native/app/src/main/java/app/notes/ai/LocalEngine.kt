package app.notes.ai

import android.content.Context
import app.notes.data.Msg
import app.notes.data.Note
import app.notes.data.Section
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** نموذج لغوي يعمل على الهاتف نفسه؛ لا يغادر كلامك الجهاز. */
class LocalEngine(
    private val ctx: Context,
    private val file: File,
    override val name: String,
    private val template: Template,
) : AiEngine {
    private var llm: LlmInference? = null

    /** تحميل النموذج في الذاكرة (أول رد فقط يأخذ وقتاً). */
    private fun model(): LlmInference = llm ?: LlmInference.createFromOptions(
        ctx,
        LlmInference.LlmInferenceOptions.builder()
            .setModelPath(file.absolutePath)
            .setMaxTokens(MAX_TOKENS)
            .build(),
    ).also { llm = it }

    override suspend fun reply(history: List<Msg>, memory: List<Note>, input: String, section: Section): String =
        withContext(Dispatchers.Default) {
            val raw = model().generateResponse(buildPrompt(history, memory, input, section))
            clean(raw).ifBlank { "…" }
        }

    fun close() { llm?.close(); llm = null }

    private fun systemText(memory: List<Note>, section: Section): String = buildString {
        append("أنت «عقلي»، مساعد ملاحظات شخصي على هاتف المستخدم. ")
        append("ترد بالعربية بإيجاز ولطف، وتساعده على ترتيب أفكاره، وتقترح خطوة عملية عند الحاجة. ")
        append("حُفظ كلامه الأخير في قسم «${section.name}».")
        if (memory.isNotEmpty()) {
            append("\nملاحظات سابقة له قد تفيدك (استعن بها إن كانت ذات صلة):")
            memory.forEach { append("\n- ").append(it.text.take(160)) }
        }
    }

    override suspend fun classify(text: String, sections: List<Section>): Section? {
        val list = sections.mapIndexed { i, s -> "${i + 1}. ${s.name}" }.joinToString("\n")
        val out = generate(
            "أنت مصنِّف ملاحظات. اقرأ الملاحظة واختر القسم الأنسب لها من القائمة. أجب برقم القسم فقط دون أي كلمة أخرى.\n$list",
            "الملاحظة: ${text.take(400)}\nرقم القسم:",
        )
        val n = Regex("\\d+").find(toLatinDigits(out))?.value?.toIntOrNull() ?: return null
        return sections.getOrNull(n - 1)
    }

    override suspend fun summarize(section: Section, notes: List<Note>): String? {
        // الأحدث أولاً حتى يتسع النص لحجم النموذج
        val sb = StringBuilder()
        for (n in notes.asReversed()) {
            val line = "- ${n.text.take(200)}\n"
            if (sb.length + line.length > 1400) break
            sb.append(line)
        }
        return generate(
            "أنت تلخّص كتاب «${section.name}» من ملاحظات المستخدم الشخصية. اكتب بالعربية ملخصاً قصيراً (٣ إلى ٥ نقاط) يبرز أهم ما فيه وما يتكرر، ثم سطراً واحداً بخطوة مقترحة.",
            "الملاحظات:\n$sb",
        ).ifBlank { null }
    }

    /** طلب واحد بلا سجل محادثة. */
    private suspend fun generate(system: String, user: String): String = withContext(Dispatchers.Default) {
        clean(model().generateResponse(format(system, listOf("user" to user))))
    }

    private fun toLatinDigits(s: String) = s.map { c -> if (c in '٠'..'٩') '0' + (c - '٠') else c }.joinToString("")

    private fun buildPrompt(history: List<Msg>, memory: List<Note>, input: String, section: Section): String {
        // آخر الرسائل قبل الحالية، باختصار لتبقى ضمن حجم النموذج
        val past = history.dropLast(1).takeLast(6).map { it.role to it.text.take(300) }
        return format(systemText(memory, section), past + ("user" to input))
    }

    private fun format(sys: String, turns: List<Pair<String, String>>): String {
        return when (template) {
            Template.GEMMA -> buildString {
                turns.forEachIndexed { i, (role, text) ->
                    val r = if (role == "user") "user" else "model"
                    append("<start_of_turn>").append(r).append('\n')
                    if (i == 0) append(sys).append("\n\n")
                    append(text).append("<end_of_turn>\n")
                }
                append("<start_of_turn>model\n")
            }
            Template.CHATML -> buildString {
                append("<|im_start|>system\n").append(sys).append("<|im_end|>\n")
                turns.forEach { (role, text) ->
                    append("<|im_start|>").append(if (role == "user") "user" else "assistant").append('\n')
                    append(text).append("<|im_end|>\n")
                }
                append("<|im_start|>assistant\n")
            }
        }
    }

    private fun clean(s: String) = s
        .replace(Regex("<think>[\\s\\S]*?</think>"), "")
        .replace(Regex("<end_of_turn>|<start_of_turn>|<\\|im_end\\|>|<\\|im_start\\|>|<eos>"), "")
        .trim()

    companion object { const val MAX_TOKENS = 1280 }
}
