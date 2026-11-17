package app.notes.ai

import app.notes.data.Note

/** البحث والربط بالمعنى باستخدام بصمات المعنى المحفوظة. */
object Semantic {
    /** أقرب الملاحظات في المعنى لبصمة السؤال. */
    fun recall(vectors: Map<Long, FloatArray>, notes: List<Note>, q: FloatArray, limit: Int = 3, min: Float = 0.4f): List<Note> =
        notes.mapNotNull { n -> vectors[n.id]?.let { n to Embedder.cosine(it, q) } }
            .filter { it.second >= min }
            .sortedByDescending { it.second }
            .take(limit)
            .map { it.first }

    /** روابط بين الملاحظات المتقاربة في المعنى (اقتراح آلي، مع نسبة التشابه). */
    fun links(vectors: Map<Long, FloatArray>, notes: List<Note>, min: Float = 0.55f, limit: Int = 300): List<SuggestedLink> {
        val list = notes.takeLast(limit).mapNotNull { n -> vectors[n.id]?.let { n.id to it } }
        val out = mutableListOf<SuggestedLink>()
        for (i in list.indices) for (j in i + 1 until list.size) {
            val s = Embedder.cosine(list[i].second, list[j].second)
            if (s >= min) out += SuggestedLink(list[i].first, list[j].first, listOf("تشابه بالمعنى ${(s * 100).toInt()}٪"))
        }
        return out
    }

    /** دمج روابط الكلمات وروابط المعنى دون تكرار الزوج نفسه. */
    fun merge(words: List<SuggestedLink>, meaning: List<SuggestedLink>): List<SuggestedLink> {
        val byPair = LinkedHashMap<Pair<Long, Long>, SuggestedLink>()
        (meaning + words).forEach { l ->
            val k = minOf(l.a, l.b) to maxOf(l.a, l.b)
            val old = byPair[k]
            byPair[k] = if (old == null) l else old.copy(shared = (old.shared + l.shared).distinct())
        }
        return byPair.values.toList()
    }
}
