package app.notes.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import app.notes.ai.SectionLink
import app.notes.ai.SuggestedLink
import app.notes.data.Note
import app.notes.data.Section
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

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
    val x: Float,
    val y: Float,
) {
    var label0: TextLayoutResult? = null
}

/** خط بين عقدتين. [always] يظهر دائماً، وإلا يظهر عند التقريب فقط. */
class GEdge(val a: Int, val b: Int, val always: Boolean)

/**
 * تخطيط ثابت منتظم لشاشة العقل: العقل في الوسط، والأقسام الرئيسية حوله لكل منها جهة ولون،
 * وملاحظات كل قسم نقاط بلونه في شبكة منتظمة داخل جهته. الإحداثيات بوحدة dp ومركزها العقل.
 */
class MindLayout(
    sections: List<Section>,
    notes: List<Note>,
    links: List<SuggestedLink>,
    sectionLinks: List<SectionLink>,
) {
    val nodes = mutableListOf<GNode>()
    val edges = mutableListOf<GEdge>()
    /** أبعد نقطة عن المركز (لضبط التكبير الابتدائي). */
    var extent = 200f
        private set

    init {
        nodes += GNode("brain", GKind.BRAIN, "عقلي", Color.White, 16f, null, null, 0f, 0f)

        val ids = sections.map { it.id }.toSet()
        val roots = sections.filter { it.parentId == 0L || it.parentId !in ids || it.parentId == it.id }
        val n = roots.size.coerceAtLeast(1)
        val step = (2 * PI / n).toFloat()

        // جذر كل قسم (لمعرفة جهة الأقسام الفرعية وملاحظاتها)
        fun rootOf(s: Section): Section? {
            var cur: Section = s
            repeat(20) {
                val c = cur
                if (roots.any { it.id == c.id }) return c
                cur = sections.firstOrNull { it.id == c.parentId } ?: return null
            }
            return null
        }

        val secIndex = HashMap<Long, Int>()
        val angleOf = HashMap<Long, Float>()
        roots.forEachIndexed { i, s ->
            val a = -PI.toFloat() / 2 + step * i
            angleOf[s.id] = a
            secIndex[s.id] = nodes.size
            nodes += GNode("s:${s.id}", GKind.SECTION, s.name, PALETTE[i % PALETTE.size], 7f, s, null, R_SECTION * cos(a), R_SECTION * sin(a))
            edges += GEdge(0, nodes.size - 1, always = true)
        }
        // الأقسام الفرعية: أبعد قليلاً داخل جهة قسمها الرئيسي، بلونه
        roots.forEach { root ->
            val kids = sections.filter { it.id !in secIndex && rootOf(it)?.id == root.id }
            val a0 = angleOf.getValue(root.id)
            val spread = minOf(step * 0.6f / kids.size.coerceAtLeast(1), 0.35f)
            kids.forEachIndexed { j, s ->
                val a = a0 + (j - (kids.size - 1) / 2f) * spread
                val parentIdx = secIndex[s.parentId] ?: secIndex.getValue(root.id)
                secIndex[s.id] = nodes.size
                angleOf[s.id] = a0
                nodes += GNode("s:${s.id}", GKind.SECTION, s.name, nodes[secIndex.getValue(root.id)].color, 5f, s, null, R_SUB * cos(a), R_SUB * sin(a))
                edges += GEdge(parentIdx, nodes.size - 1, always = true)
            }
        }

        // الملاحظات: لكل قسم رئيسي أقرب نقاط الشبكة داخل جهته (الأحدث أقرب للمركز)
        val byRoot = notes.takeLast(MAX_NOTES).asReversed().groupBy { note ->
            sections.firstOrNull { it.id == note.sectionId }?.let { rootOf(it)?.id }
        }
        val half = step / 2f * 0.88f
        val maxCount = byRoot.values.maxOfOrNull { it.size } ?: 0
        // نصف قطر يكفي لأكبر قسم
        val rMax = sqrt(2f * maxCount * GRID * GRID / (2f * half).coerceAtLeast(0.2f) + R_NOTES * R_NOTES) + GRID * 3
        val lim = ceil(rMax / GRID).toInt()
        val lattice = ArrayList<Pair<Float, Float>>()
        for (gx in -lim..lim) for (gy in -lim..lim) {
            val x = gx * GRID; val y = gy * GRID
            val r = sqrt(x * x + y * y)
            if (r >= R_NOTES && r <= rMax) lattice += x to y
        }
        val noteIndex = HashMap<Long, Int>()
        roots.forEach { root ->
            val list = byRoot[root.id] ?: return@forEach
            val a0 = angleOf.getValue(root.id)
            val spots = lattice.filter { (x, y) -> angleDiff(atan2(y, x), a0) <= half }
                .sortedBy { (x, y) -> x * x + y * y }
            val color = nodes[secIndex.getValue(root.id)].color
            list.zip(spots).forEach { (note, p) ->
                noteIndex[note.id] = nodes.size
                val owner = sections.firstOrNull { it.id == note.sectionId }
                nodes += GNode("n:${note.id}", GKind.NOTE, shortLabel(note.text), color, 3.2f, owner, note, p.first, p.second)
                extent = maxOf(extent, sqrt(p.first * p.first + p.second * p.second))
            }
        }

        // خطوط الأمور المشتركة: تظهر عند التقريب فقط
        links.forEach { l ->
            val a = noteIndex[l.a] ?: return@forEach
            val b = noteIndex[l.b] ?: return@forEach
            edges += GEdge(a, b, always = false)
        }
        sectionLinks.forEach { l ->
            val a = secIndex[l.a] ?: return@forEach
            val b = secIndex[l.b] ?: return@forEach
            edges += GEdge(a, b, always = false)
        }
        extent = maxOf(extent, R_SUB + 20f)
    }

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
        const val MAX_NOTES = 600
        const val R_SECTION = 110f
        const val R_SUB = 160f
        const val R_NOTES = 150f
        const val GRID = 24f

        /** لكل نوع لونه الخاص. */
        val PALETTE = listOf(
            Color(0xFFB57BFF), Color(0xFFFFD66B), Color(0xFF5AA9FF), Color(0xFF7BE58A), Color(0xFFFF6FB5),
            Color(0xFF4FD8E8), Color(0xFFFFA45B), Color(0xFFFF6B6B), Color(0xFFC6F06B), Color(0xFF9AA8FF),
        )

        private fun angleDiff(a: Float, b: Float): Float {
            var d = abs(a - b) % (2 * PI.toFloat())
            if (d > PI) d = 2 * PI.toFloat() - d
            return d
        }

        fun shortLabel(s: String): String {
            val one = s.replace('\n', ' ').trim()
            return if (one.length <= 24) one else one.take(22).trimEnd() + "…"
        }
    }
}
