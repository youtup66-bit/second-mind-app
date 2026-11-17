package app.notes.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.JsonReader
import java.io.File
import java.nio.LongBuffer
import java.text.Normalizer
import kotlin.math.sqrt

/**
 * مقسّم النص (SentencePiece Unigram) لنماذج عائلة XLM-R، يُقرأ من tokenizer.json.
 * يقسّم النص إلى أجزاء الكلمات التي يعرفها النموذج بأفضل احتمال (خوارزمية Viterbi).
 */
class UnigramTokenizer(file: File) {
    private val ids = HashMap<String, Int>(300_000)
    private var scores = FloatArray(0)
    private var maxLen = 1
    private var unkId = 3

    init {
        val list = ArrayList<Float>(260_000)
        JsonReader(file.bufferedReader()).use { r ->
            r.beginObject()
            while (r.hasNext()) {
                if (r.nextName() != "model") { r.skipValue(); continue }
                r.beginObject()
                while (r.hasNext()) {
                    when (r.nextName()) {
                        "unk_id" -> unkId = r.nextInt()
                        "vocab" -> {
                            r.beginArray()
                            while (r.hasNext()) {
                                r.beginArray()
                                val piece = r.nextString()
                                val score = r.nextDouble().toFloat()
                                r.endArray()
                                ids.putIfAbsent(piece, list.size)
                                list += score
                                if (piece.length > maxLen) maxLen = piece.length
                            }
                            r.endArray()
                        }
                        else -> r.skipValue()
                    }
                }
                r.endObject()
            }
            r.endObject()
        }
        scores = list.toFloatArray()
        maxLen = maxLen.coerceAtMost(24)
        require(ids.size > 1000) { "ملف المقسّم غير صالح" }
    }

    /** يعيد أرقام الأجزاء مع رمزي البداية والنهاية. */
    fun encode(text: String, maxTokens: Int = 128): LongArray {
        val clean = Normalizer.normalize(text, Normalizer.Form.NFKC).replace(Regex("\\s+"), " ").trim()
        val s = "▁" + clean.replace(' ', '▁')
        val n = s.length
        val best = FloatArray(n + 1) { Float.NEGATIVE_INFINITY }
        val from = IntArray(n + 1)
        val tok = IntArray(n + 1)
        best[0] = 0f
        for (end in 1..n) {
            for (start in maxOf(0, end - maxLen) until end) {
                if (best[start] == Float.NEGATIVE_INFINITY) continue
                val id = ids[s.substring(start, end)]
                val score = when {
                    id != null -> scores[id]
                    end - start == 1 -> UNK_PENALTY
                    else -> continue
                }
                val cand = best[start] + score
                if (cand > best[end]) { best[end] = cand; from[end] = start; tok[end] = id ?: unkId }
            }
        }
        val pieces = ArrayList<Long>()
        var i = n
        while (i > 0) { pieces += tok[i].toLong(); i = from[i] }
        pieces.reverse()
        val body = pieces.take(maxTokens - 2)
        return (listOf(BOS) + body + listOf(EOS)).toLongArray()
    }

    companion object {
        const val BOS = 0L
        const val EOS = 2L
        const val UNK_PENALTY = -20f
    }
}

/** يحوّل النص إلى «بصمة معنى»: متجه أرقام طوله ١ يتشابه للنصوص المتقاربة في المعنى. */
class Embedder(model: File, tokenizer: File) : AutoCloseable {
    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession = env.createSession(model.absolutePath, OrtSession.SessionOptions())
    private val tok = UnigramTokenizer(tokenizer)

    @Synchronized
    fun embed(text: String): FloatArray {
        val idsArr = tok.encode(text)
        val len = idsArr.size.toLong()
        val shape = longArrayOf(1, len)
        val mask = LongArray(idsArr.size) { 1L }
        val inputs = HashMap<String, OnnxTensor>()
        try {
            for (name in session.inputNames) {
                inputs[name] = when (name) {
                    "input_ids" -> OnnxTensor.createTensor(env, LongBuffer.wrap(idsArr), shape)
                    "attention_mask" -> OnnxTensor.createTensor(env, LongBuffer.wrap(mask), shape)
                    else -> OnnxTensor.createTensor(env, LongBuffer.wrap(LongArray(idsArr.size)), shape) // token_type_ids
                }
            }
            session.run(inputs).use { res ->
                @Suppress("UNCHECKED_CAST")
                val hidden = (res[0].value as Array<Array<FloatArray>>)[0]
                // متوسط كل الأجزاء ثم توحيد الطول
                val dim = hidden[0].size
                val v = FloatArray(dim)
                for (row in hidden) for (d in 0 until dim) v[d] += row[d]
                var norm = 0f
                for (d in 0 until dim) { v[d] /= hidden.size; norm += v[d] * v[d] }
                norm = sqrt(norm).coerceAtLeast(1e-6f)
                for (d in 0 until dim) v[d] /= norm
                return v
            }
        } finally {
            inputs.values.forEach { it.close() }
        }
    }

    override fun close() { session.close() }

    companion object {
        /** تشابه بين بصمتين موحّدتين (من ‎-1 إلى 1). */
        fun cosine(a: FloatArray, b: FloatArray): Float {
            var s = 0f
            for (i in a.indices) s += a[i] * b[i]
            return s
        }
    }
}
