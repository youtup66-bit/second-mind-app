package app.notes.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import app.notes.ai.SectionLink
import app.notes.ai.SuggestedLink
import app.notes.data.Note
import app.notes.data.Section
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

enum class GKind { BRAIN, SECTION, NOTE }

class GNode(
    val key: String,
    val kind: GKind,
    val label: String,
    val color: Color,
    /** نصف القطر بوحدة dp. */
    val radius: Float,
    val section: Section?,
    val note: Note?,
    var x: Float,
    var y: Float,
) {
    var vx = 0f
    var vy = 0f
    var label0: TextLayoutResult? = null
    val charge = when (kind) { GKind.BRAIN -> -900f; GKind.SECTION -> -420f; GKind.NOTE -> -90f }
}

/** خط بين عقدتين. [shared] = كلمات مشتركة إن كان رابطاً مقترحاً. */
class GEdge(val a: Int, val b: Int, val length: Float, val strength: Float, val kind: Kind, val weight: Int = 1) {
    enum class Kind { STRUCTURE, SHARED }
}

/**
 * محاكاة فيزيائية خفيفة (على نمط d3-force): العقدات تتنافر، والخطوط نوابض،
 * والعقل ثابت في الوسط فتندفع الأقسام للخارج وتدور ملاحظاتها حولها.
 * الإحداثيات بوحدة dp ومركزها كرة العقل.
 */
class MindGraph(
    sections: List<Section>,
    notes: List<Note>,
    links: List<SuggestedLink>,
    sectionLinks: List<SectionLink>,
    previous: MindGraph?,
) {
    val nodes = mutableListOf<GNode>()
    val edges = mutableListOf<GEdge>()
    private var alpha = 1f
    var dragged = -1
    private var t = 0f

    init {
        val old = previous?.nodes?.associateBy { it.key } ?: emptyMap()
        val rnd = Random(7)
        fun place(key: String, fx: Float, fy: Float): Pair<Float, Float> =
            old[key]?.let { it.x to it.y } ?: (fx + rnd.nextFloat() * 6 - 3 to fy + rnd.nextFloat() * 6 - 3)

        nodes += GNode("brain", GKind.BRAIN, "عقلي", Color(0xFFB9A6FF), 13f, null, null, 0f, 0f)

        val secIndex = HashMap<Long, Int>()
        val ids = sections.map { it.id }.toSet()
        // الأقسام الرئيسية حول العقل
        val roots = sections.filter { it.parentId == 0L || it.parentId !in ids || it.parentId == it.id }
        roots.forEachIndexed { i, s ->
            val a = (2 * PI * i / roots.size.coerceAtLeast(1) - PI / 2).toFloat()
            val (x, y) = place("s:${s.id}", 130 * cos(a), 130 * sin(a))
            secIndex[s.id] = nodes.size
            nodes += GNode("s:${s.id}", GKind.SECTION, s.name, sectionColor(i), 7f + minOf(s.count, 30) * 0.25f, s, null, x, y)
            edges += GEdge(0, nodes.size - 1, 125f, 0.5f, GEdge.Kind.STRUCTURE)
        }
        // الأقسام الفرعية حول أقسامها الأب (بأي عمق)، بلون أبيها وحجم أصغر
        var pending = sections.filter { it.id !in secIndex }
        var guard = 0
        while (pending.isNotEmpty() && guard++ < 10) {
            val ready = pending.filter { it.parentId in secIndex }
            if (ready.isEmpty()) break
            ready.forEach { s ->
                val pi = secIndex.getValue(s.parentId)
                val parent = nodes[pi]
                val a = rnd.nextFloat() * 2 * PI.toFloat()
                val (x, y) = place("s:${s.id}", parent.x * 1.35f + 40 * cos(a), parent.y * 1.35f + 40 * sin(a))
                secIndex[s.id] = nodes.size
                nodes += GNode("s:${s.id}", GKind.SECTION, s.name, parent.color, 5.5f + minOf(s.count, 30) * 0.2f, s, null, x, y)
                edges += GEdge(pi, nodes.size - 1, 75f, 0.6f, GEdge.Kind.STRUCTURE)
            }
            pending = pending - ready.toSet()
        }

        // آخر الملاحظات فقط حتى تبقى الحركة سلسة
        val noteIndex = HashMap<Long, Int>()
        notes.takeLast(MAX_NOTES).forEach { n ->
            val si = secIndex[n.sectionId] ?: return@forEach
            val sec = nodes[si]
            val a = rnd.nextFloat() * 2 * PI.toFloat()
            val (x, y) = place("n:${n.id}", sec.x * 1.4f + 30 * cos(a), sec.y * 1.4f + 30 * sin(a))
            noteIndex[n.id] = nodes.size
            nodes += GNode("n:${n.id}", GKind.NOTE, shortLabel(n.text), sec.color, 4.5f, sec.section, n, x, y)
            edges += GEdge(si, nodes.size - 1, 48f, 0.7f, GEdge.Kind.STRUCTURE)
        }

        // روابط الأمور المشتركة
        links.forEach { l ->
            val a = noteIndex[l.a] ?: return@forEach
            val b = noteIndex[l.b] ?: return@forEach
            edges += GEdge(a, b, 70f, 0.12f, GEdge.Kind.SHARED, l.shared.size)
        }
        sectionLinks.forEach { l ->
            val a = secIndex[l.a] ?: return@forEach
            val b = secIndex[l.b] ?: return@forEach
            edges += GEdge(a, b, 150f, 0.03f * minOf(l.strength, 5), GEdge.Kind.SHARED, l.strength)
        }
        if (previous != null) alpha = 0.5f
    }

    fun reheat(a: Float = 0.4f) { if (alpha < a) alpha = a }

    /** خطوة واحدة لكل إطار. */
    fun step() {
        t += 0.016f
        alpha += (ALPHA_REST - alpha) * 0.015f
        val n = nodes.size

        // التنافر بين كل عقدتين
        for (i in 0 until n) {
            val a = nodes[i]
            for (j in i + 1 until n) {
                val b = nodes[j]
                var dx = b.x - a.x
                var dy = b.y - a.y
                var l2 = dx * dx + dy * dy
                if (l2 < 1f) { dx = 0.5f; dy = 0.5f; l2 = 1f }
                if (l2 > 160_000f) continue
                val wa = b.charge * alpha / l2
                val wb = a.charge * alpha / l2
                a.vx += dx * wa; a.vy += dy * wa
                b.vx -= dx * wb; b.vy -= dy * wb
            }
        }

        // النوابض على الخطوط
        for (e in edges) {
            val a = nodes[e.a]; val b = nodes[e.b]
            var dx = b.x + b.vx - a.x - a.vx
            var dy = b.y + b.vy - a.y - a.vy
            val l = sqrt(dx * dx + dy * dy).coerceAtLeast(0.01f)
            val k = (l - e.length) / l * alpha * e.strength
            dx *= k; dy *= k
            b.vx -= dx * 0.5f; b.vy -= dy * 0.5f
            a.vx += dx * 0.5f; a.vy += dy * 0.5f
        }

        // جاذبية خفيفة نحو الوسط، وطفو هادئ يجعلها حيّة
        nodes.forEachIndexed { i, nd ->
            nd.vx -= nd.x * 0.0015f
            nd.vy -= nd.y * 0.0015f
            nd.vx += 0.03f * sin(t * 0.7f + i * 1.7f)
            nd.vy += 0.03f * cos(t * 0.6f + i * 2.3f)
        }

        nodes.forEachIndexed { i, nd ->
            if (i == 0) { nd.x = 0f; nd.y = 0f; nd.vx = 0f; nd.vy = 0f; return@forEachIndexed }
            if (i == dragged) { nd.vx = 0f; nd.vy = 0f; return@forEachIndexed }
            nd.vx *= 0.6f; nd.vy *= 0.6f
            nd.x += nd.vx.coerceIn(-12f, 12f)
            nd.y += nd.vy.coerceIn(-12f, 12f)
        }
    }

    fun move(i: Int, x: Float, y: Float) { if (i > 0) { nodes[i].x = x; nodes[i].y = y; reheat(0.25f) } }

    /** أقرب عقدة لنقطة (بوحدة dp)، أو ‎-1. */
    fun hit(x: Float, y: Float, slop: Float): Int {
        var best = -1
        var bestD = Float.MAX_VALUE
        nodes.forEachIndexed { i, nd ->
            val d = sqrt((nd.x - x) * (nd.x - x) + (nd.y - y) * (nd.y - y)) - nd.radius
            if (d < slop && d < bestD) { best = i; bestD = d }
        }
        return best
    }

    companion object {
        const val MAX_NOTES = 120
        const val ALPHA_REST = 0.06f

        private val palette = listOf(
            Color(0xFF6FA8FF), Color(0xFF4CD1B5), Color(0xFFFF8FB1), Color(0xFFFFC266), Color(0xFFB58CFF),
            Color(0xFF7FE07F), Color(0xFF5ED0FF), Color(0xFFFF9F7A), Color(0xFFD7DCEB),
        )
        fun sectionColor(i: Int) = palette[i % palette.size]

        fun shortLabel(s: String): String {
            val one = s.replace('\n', ' ').trim()
            return if (one.length <= 24) one else one.take(22).trimEnd() + "…"
        }
    }
}
