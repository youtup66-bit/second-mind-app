package app.notes.ai

import app.notes.data.Note

/**
 * روابط مقترحة آلياً بين الملاحظات: كلمة مهمة مشتركة أو أكثر.
 * هي اقتراح لا حقيقة، وتُعرض في الواجهة بشكل مختلف عن الروابط المؤكدة.
 */
data class SuggestedLink(val a: Long, val b: Long, val shared: List<String>)

/** رابط مجمّع بين قسمين: عدد الروابط المقترحة بين ملاحظاتهما. */
data class SectionLink(val a: Long, val b: Long, val strength: Int, val shared: List<String>)

object Links {
    private val stop = setOf(
        "الذي", "التي", "الذين", "هذا", "هذه", "ذلك", "تلك", "كان", "كانت", "يكون", "على", "الي", "الى",
        "من", "في", "عن", "مع", "لكن", "ثم", "انا", "انت", "هو", "هي", "نحن", "هم", "كل", "بعد", "قبل",
        "عند", "لقد", "قد", "ما", "لا", "لم", "لن", "ان", "او", "ايضا", "جدا", "اليوم", "شي", "شيء",
        "عندي", "لازم", "يجب", "اريد", "ابي", "بس", "فقط", "حتي", "حتى", "كيف", "متي", "اين", "هل", "ماذا", "لماذا",
    ).map { Arabic.normalize(it) }.toSet()

    fun keywords(text: String): Set<String> =
        Arabic.words(text).filter { it.length >= 3 && it !in stop }.toSet()

    /** يقارن آخر [limit] ملاحظة فقط حتى يبقى سريعاً على الهاتف. */
    fun suggest(notes: List<Note>, minShared: Int = 1, limit: Int = 300): List<SuggestedLink> {
        val recent = notes.takeLast(limit)
        val kw = recent.map { it.id to keywords(it.text) }
        val out = mutableListOf<SuggestedLink>()
        for (i in kw.indices) for (j in i + 1 until kw.size) {
            val shared = kw[i].second intersect kw[j].second
            if (shared.size >= minShared) out += SuggestedLink(kw[i].first, kw[j].first, shared.sorted())
        }
        return out
    }

    fun bySection(links: List<SuggestedLink>, notes: List<Note>): List<SectionLink> {
        val sec = notes.associate { it.id to it.sectionId }
        return links.mapNotNull { l ->
            val a = sec[l.a] ?: return@mapNotNull null
            val b = sec[l.b] ?: return@mapNotNull null
            if (a == b) null else (minOf(a, b) to maxOf(a, b)) to l.shared
        }.groupBy({ it.first }, { it.second }).map { (k, v) ->
            SectionLink(k.first, k.second, v.size, v.flatten().groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.take(4).map { it.key })
        }
    }
}
