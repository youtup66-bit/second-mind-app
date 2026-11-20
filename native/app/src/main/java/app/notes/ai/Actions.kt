package app.notes.ai

import app.notes.data.Section
import app.notes.data.path
import org.json.JSONObject

/** أمر واحد فهمه الذكاء من طلب المستخدم (قبل التحقق والتأكيد). */
data class AppAction(val type: String, val args: Map<String, String>) {
    operator fun get(k: String): String = args[k].orEmpty().trim()
}

/** تحويل طلبات المستخدم بلغته إلى أوامر يفهمها التطبيق. */
object ActionPlanner {
    /** فحص سريع قبل سؤال الذكاء: هل يبدو الكلام أمراً للتطبيق؟ (يوفر وقت النموذج على الملاحظات العادية) */
    private val verbs = Regex(
        "(^|\\s)(انشي|انشئ|اصنع|اضف|زد|احذف|امسح|ازل|الغ|انقل|حول|غير|بدل|سم|اعد تسميه|لخص|افتح|اعرض|" +
            "شغل|اوقف|فعل|عطل|اجعل|كبر|صغر|خذ نسخه|انسخ|استخدم)",
    )
    private val nouns = Regex("(قسم|اقسام|كتاب|ملاحظ|كره|نسخه احتياطيه|النموذج|gemini|جيميني|الذكاء|لون|فرعي)", RegexOption.IGNORE_CASE)

    fun looksLikeCommand(text: String): Boolean {
        val t = Arabic.normalize(text)
        return text.length < 400 && verbs.containsMatchIn(t) && nouns.containsMatchIn(t)
    }

    fun prompt(sections: List<Section>): String = buildString {
        append("أنت منفّذ أوامر لتطبيق ملاحظات اسمه Note AI. حوّل طلب المستخدم إلى أوامر JSON فقط، بلا أي نص آخر.\n")
        append("إن لم يكن الكلام طلباً لتغيير التطبيق (ملاحظة أو سؤال أو فضفضة) فأعد بالضبط: {\"actions\":[]}\n")
        append("استخدم أسماء الأقسام كما هي في القائمة.\n\nالأقسام الحالية:\n")
        sections.forEach { append("- ").append(it.path(sections)).append('\n') }
        append(
            """
الأوامر المتاحة:
{"type":"create_section","name":"اسم القسم","parent":"القسم الأب أو فارغ"}
{"type":"rename_section","section":"القسم","new_name":"الاسم الجديد"}
{"type":"delete_section","section":"القسم","move_to":"قسم تنتقل إليه ملاحظاته أو فارغ"}
{"type":"move_section","section":"القسم","parent":"القسم الأب الجديد، أو فارغ ليصبح رئيسياً"}
{"type":"move_notes","query":"كلمة موجودة في نص الملاحظات","from":"قسم أو فارغ","to":"القسم الهدف"}
{"type":"delete_notes","query":"كلمة موجودة في نص الملاحظات","section":"قسم أو فارغ"}
{"type":"summarize_section","section":"القسم"}
{"type":"open_book","section":"القسم"}
{"type":"backup_now"}
{"type":"bubble","on":"true أو false أو فارغ","color":"بنفسجي|أزرق|فيروزي|أخضر|برتقالي|أحمر|وردي|أبيض|رمادي أو فارغ","size":"صغير|متوسط|كبير أو فارغ"}
{"type":"switch_ai","target":"gemini أو basic أو اسم نموذج على الهاتف"}

أمثلة:
"أنشئ قسم جيم تحت رياضة" ← {"actions":[{"type":"create_section","name":"جيم","parent":"رياضة"}]}
"احذف قسم أحلام" ← {"actions":[{"type":"delete_section","section":"أحلام","move_to":""}]}
"انقل ملاحظات القهوة إلى صحة" ← {"actions":[{"type":"move_notes","query":"القهوة","from":"","to":"صحة"}]}
"اجعل الكرة خضراء وصغيرة" ← {"actions":[{"type":"bubble","on":"","color":"أخضر","size":"صغير"}]}
"اشتريت قهوة اليوم" ← {"actions":[]}
            """.trimIndent(),
        )
    }

    /** يقرأ JSON من رد النموذج (يتسامح مع نص زائد حوله). */
    fun parse(raw: String): List<AppAction> {
        val start = raw.indexOf('{')
        val end = raw.lastIndexOf('}')
        if (start < 0 || end <= start) return emptyList()
        return runCatching {
            val arr = JSONObject(raw.substring(start, end + 1)).optJSONArray("actions") ?: return emptyList()
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val type = o.optString("type").trim()
                if (type.isEmpty()) return@mapNotNull null
                val args = HashMap<String, String>()
                o.keys().forEach { k -> if (k != "type") args[k] = o.optString(k) }
                AppAction(type, args)
            }
        }.getOrDefault(emptyList())
    }
}
