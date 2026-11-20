package app.notes.ai

import app.notes.data.Msg
import app.notes.data.Note
import app.notes.data.Section

/** توحيد الكتابة العربية للمطابقة: حذف التشكيل، وتوحيد الألف والتاء المربوطة والياء. */
object Arabic {
    private val diacritics = Regex("[\\u064B-\\u0652\\u0640]")
    fun normalize(s: String): String = s.lowercase()
        .replace(diacritics, "")
        .replace(Regex("[أإآ]"), "ا")
        .replace('ة', 'ه')
        .replace('ى', 'ي')
        .replace('ؤ', 'و')
        .replace('ئ', 'ي')

    fun words(s: String): List<String> =
        normalize(s).split(Regex("[^\\p{L}\\p{N}]+")).filter { it.length >= 2 }
}

/** تصنيف مبدئي بالكلمات الدالة. سيحلّ محله النموذج المحلي في المرحلة ٣. */
object Classifier {
    fun classify(text: String, sections: List<Section>): Section {
        val words = Arabic.words(text)
        var best = sections.first()
        var bestScore = 0
        for (s in sections) {
            val kws = Arabic.words(s.keywords + " " + s.name)
            val score = words.count { w -> kws.any { k -> w == k || (k.length >= 3 && w.contains(k)) } }
            if (score > bestScore) { best = s; bestScore = score }
        }
        if (bestScore == 0) sections.firstOrNull { it.name == "تفكير" }?.let { best = it }
        return best
    }
}

/** هل الرسالة سؤال عن ملاحظاته المحفوظة؟ (فيُجاب منها ولا تُحفظ ملاحظةً جديدة) */
object MemoryAsk {
    private val about = Regex("(ملاحظ|كتبت|ذكرت|سجلت|دونت|حفظت|كتبي|كتاب|اقسام|قسم|عقلي|ذاكرت)")
    private val ask = Regex("(^|\\s)(هل|ما|ماذا|اين|كم|متي|اعرض|اذكر|عدد|اخبرني|قل لي|تري|تعرف|وش|شو|ايش|لخص|ابحث|اعطني|هات)(\\s|$)|[؟?]")
    fun isAsk(text: String): Boolean {
        val t = Arabic.normalize(text)
        return about.containsMatchIn(t) && ask.containsMatchIn(t)
    }
}

/** الذاكرة: يبحث في كل الملاحظات السابقة (من كل المحادثات) عن الأقرب لما تقوله الآن. */
object Recall {
    fun find(all: List<Note>, query: String, limit: Int = 3): List<Note> {
        val q = Arabic.words(query).filter { it.length >= 3 }.toSet()
        if (q.isEmpty()) return emptyList()
        return all.map { n -> n to Arabic.words(n.text).count { it in q } }
            .filter { it.second > 0 }
            .sortedWith(compareByDescending<Pair<Note, Int>> { it.second }.thenByDescending { it.first.time })
            .take(limit)
            .map { it.first }
    }
}

/** واجهة موحدة لأي ذكاء صناعي (محلي على الهاتف أو غيره)، ليختار المستخدم بينها. */
interface AiEngine {
    val name: String
    /**
     * [section] القسم الذي حُفظ فيه كلامه (null إن كان سؤالاً عن ملاحظاته فلم يُحفظ)،
     * و[overview] نظرة على محتويات عقله (أقسامه وملاحظاته) ليجيب منها.
     */
    suspend fun reply(history: List<Msg>, memory: List<Note>, input: String, section: Section?, overview: String = ""): String

    /** تصنيف بالذكاء الصناعي؛ null يعني استخدم التصنيف بالكلمات. */
    suspend fun classify(text: String, sections: List<Section>): Section? = null

    /** تلخيص كتاب؛ null يعني أن المحرك لا يلخّص. */
    suspend fun summarize(section: Section, notes: List<Note>): String? = null

    /** تحويل طلب بلغة المستخدم إلى أوامر للتطبيق؛ قائمة فارغة إن لم يكن أمراً. */
    suspend fun plan(text: String, sections: List<Section>): List<AppAction> = emptyList()
}

/** محرك أساسي بلا نموذج: يؤكد الحفظ ويذكّر بالملاحظات المرتبطة. يُستبدل بنموذج محلي في المرحلة ٢. */
class BasicEngine : AiEngine {
    override val name = "أساسي (بلا نموذج)"

    override suspend fun reply(history: List<Msg>, memory: List<Note>, input: String, section: Section?, overview: String): String {
        // بلا نموذج: يعرض ما في عقله كما هو عند السؤال عنه
        if (section == null) return if (overview.isNotBlank()) "هذا ما في عقلك:\n\n$overview" else "لا ملاحظات بعد."
        val sb = StringBuilder("حفظتها في كتاب ${section.icon} ${section.name}.")
        if (memory.isNotEmpty()) {
            sb.append("\n\nتذكّرت أنك كتبت سابقاً:")
            memory.forEach { sb.append("\n• ").append(it.text.take(120)) }
        }
        return sb.toString()
    }
}
