package app.notes.ai

import app.notes.data.Note
import org.json.JSONObject

/** علاقة أكدها الذكاء بين ملاحظتين، مع سببها. */
data class Relation(val a: Long, val b: Long, val why: String)

/** سؤال الذكاء: أي الملاحظات المرشحة مرتبطة فعلاً بالملاحظة الجديدة، ولماذا؟ */
object RelatePrompt {
    const val SYSTEM =
        "أنت تربط ملاحظات شخصية في دفتر ذكي. اختر من الملاحظات المرشحة فقط ما يرتبط فعلاً بالملاحظة الجديدة " +
            "بعلاقة واضحة: نفس الموضوع أو المشروع أو الشخص أو المكان، أو سبب ونتيجة، أو مهمة تخص فكرة، أو تكرار المشكلة نفسها، أو قرار يخص أمراً سابقاً. " +
            "لا تربط لمجرد تشابه كلمة عابرة، ولا تخمّن. إن لم يوجد ارتباط حقيقي فأعد قائمة فارغة.\n" +
            "أعد JSON فقط بهذا الشكل: {\"links\":[{\"n\":رقم المرشحة,\"why\":\"سبب قصير بالعربية من ٢ إلى ٦ كلمات\"}]}"

    fun user(note: Note, candidates: List<Note>): String = buildString {
        append("الملاحظة الجديدة: «").append(note.text.take(400)).append("»\n\nالمرشحة:\n")
        candidates.forEachIndexed { i, c -> append(i + 1).append(". «").append(c.text.take(220).replace('\n', ' ')).append("»\n") }
    }

    fun parse(raw: String, note: Note, candidates: List<Note>): List<Relation> {
        val s = raw.indexOf('{'); val e = raw.lastIndexOf('}')
        if (s < 0 || e <= s) return emptyList()
        return runCatching {
            val arr = JSONObject(raw.substring(s, e + 1)).optJSONArray("links") ?: return emptyList()
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val c = candidates.getOrNull(o.optInt("n", 0) - 1) ?: return@mapNotNull null
                val why = o.optString("why").trim().take(60).ifEmpty { "مرتبطة" }
                if (c.id == note.id) null else Relation(note.id, c.id, why)
            }.distinctBy { it.b }
        }.getOrDefault(emptyList())
    }
}
