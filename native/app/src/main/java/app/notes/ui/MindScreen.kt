package app.notes.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.notes.data.Section

/** شاشة العقل: كرات تتحرك بحرية، العقل في الوسط، والخطوط تربط ما بينها أمور مشتركة. */
@Composable
fun MindScreen(state: AppState, onOpen: (Section, Long?) -> Unit) {
    var adding by remember { mutableStateOf(false) }
    var graph by remember { mutableStateOf<MindGraph?>(null) }
    var frame by remember { mutableLongStateOf(0L) }
    var scale by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    val measurer = rememberTextMeasurer()
    val u = LocalDensity.current.density

    // إعادة بناء الشبكة عند تغيّر البيانات، مع إبقاء مواضع الكرات القديمة
    LaunchedEffect(state.sections, state.allNotes, state.links, state.sectionLinks) {
        if (state.sections.isNotEmpty()) graph = MindGraph(state.sections, state.allNotes, state.links, state.sectionLinks, graph)
    }
    // حلقة الحركة: خطوة لكل إطار ما دامت الشاشة ظاهرة
    LaunchedEffect(graph) {
        val g = graph ?: return@LaunchedEffect
        g.reheat(0.3f)
        while (true) {
            withFrameNanos { frame = it }
            g.step()
        }
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("العقل", color = TextMain, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("اسحب الكرات، وكبّر بإصبعين، واضغط قسماً لتفتح كتابه", color = TextDim, fontSize = 12.sp)
            }
            Box(
                Modifier.clip(CircleShape).background(Panel2).clickable { adding = true }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) { Text("＋ قسم", color = TextMain) }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            Canvas(
                Modifier.fillMaxSize().pointerInput(graph) {
                    val g = graph ?: return@pointerInput
                    fun toWorld(p: Offset) = Offset(
                        (p.x - size.width / 2f - pan.x) / (scale * u),
                        (p.y - size.height / 2f - pan.y) / (scale * u),
                    )
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val w0 = toWorld(down.position)
                        val hit = g.hit(w0.x, w0.y, 16f / scale)
                        var moved = false
                        var multi = false
                        while (true) {
                            val ev = awaitPointerEvent()
                            val pressed = ev.changes.filter { it.pressed }
                            if (pressed.isEmpty()) break
                            if (pressed.size >= 2) {
                                // تكبير وتحريك بإصبعين حول نقطة المنتصف
                                multi = true; moved = true; g.dragged = -1
                                val zoom = ev.calculateZoom()
                                val c = ev.calculateCentroid() - Offset(size.width / 2f, size.height / 2f)
                                val ns = (scale * zoom).coerceIn(0.3f, 3f)
                                pan = (pan - c) * (ns / scale) + c + ev.calculatePan()
                                scale = ns
                            } else if (!multi) {
                                val ch = pressed[0]
                                if (!moved && (ch.position - down.position).getDistance() > viewConfiguration.touchSlop) {
                                    moved = true
                                    if (hit > 0) g.dragged = hit
                                }
                                if (moved) {
                                    if (g.dragged > 0) toWorld(ch.position).let { g.move(g.dragged, it.x, it.y) }
                                    else pan += ch.position - ch.previousPosition
                                }
                            }
                            ev.changes.forEach { it.consume() }
                        }
                        g.dragged = -1
                        if (!moved && hit >= 0) {
                            val n = g.nodes[hit]
                            when (n.kind) {
                                GKind.BRAIN -> { scale = 1f; pan = Offset.Zero; g.reheat() }
                                GKind.SECTION -> n.section?.let { onOpen(it, null) }
                                GKind.NOTE -> n.section?.let { onOpen(it, n.note?.id) }
                            }
                        }
                    }
                },
            ) {
                frame // قراءة الإطار تعيد الرسم كل مرة
                val g = graph ?: return@Canvas
                val k = scale * u
                val cx = size.width / 2f + pan.x
                val cy = size.height / 2f + pan.y
                fun pos(n: GNode) = Offset(cx + n.x * k, cy + n.y * k)

                // الخطوط
                for (e in g.edges) {
                    val a = g.nodes[e.a]; val b = g.nodes[e.b]
                    val color = when {
                        e.kind == GEdge.Kind.SHARED -> SharedLine.copy(alpha = (0.3f + 0.12f * minOf(e.weight, 4)).coerceAtMost(0.8f))
                        e.a == 0 -> Color.White.copy(alpha = 0.12f)
                        else -> b.color.copy(alpha = 0.22f)
                    }
                    drawLine(color, pos(a), pos(b), strokeWidth = (if (e.kind == GEdge.Kind.SHARED) 1.4f else 1f) * u)
                }

                // الكرات وعناوينها
                val showNoteLabels = scale >= 0.75f
                for (n in g.nodes) {
                    val p = pos(n)
                    val r = n.radius * k
                    if (n.kind != GKind.NOTE) drawCircle(n.color.copy(alpha = 0.16f), r * 2.4f, p)
                    drawCircle(n.color, r, p)
                    if (n.kind == GKind.NOTE && !showNoteLabels) continue
                    val layout = n.label0 ?: measurer.measure(
                        n.label,
                        style = TextStyle(
                            color = if (n.kind == GKind.NOTE) LabelDim else LabelMain,
                            fontSize = when (n.kind) { GKind.BRAIN -> 14.sp; GKind.SECTION -> 13.sp; GKind.NOTE -> 11.sp },
                            fontWeight = if (n.kind == GKind.NOTE) FontWeight.Normal else FontWeight.Bold,
                            textAlign = TextAlign.Center,
                        ),
                        overflow = TextOverflow.Ellipsis,
                        maxLines = 2,
                        constraints = Constraints(maxWidth = (130 * u).toInt()),
                    ).also { n.label0 = it }
                    drawText(layout, topLeft = Offset(p.x - layout.size.width / 2f, p.y + r + 3 * u))
                }
            }

            // زر التوسيط
            Box(
                Modifier.align(Alignment.TopEnd).padding(12.dp).clip(CircleShape).background(Panel2)
                    .clickable { scale = 1f; pan = Offset.Zero; graph?.reheat() }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) { Text("⌖ توسيط", color = TextMain, fontSize = 13.sp) }
        }
    }

    if (adding) {
        var name by remember { mutableStateOf("") }
        var icon by remember { mutableStateOf("📘") }
        AlertDialog(
            onDismissRequest = { adding = false },
            containerColor = Panel,
            title = { Text("قسم جديد", color = TextMain) },
            text = {
                Column {
                    OutlinedTextField(name, { name = it }, label = { Text("الاسم") }, singleLine = true)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(icon, { icon = it.take(4) }, label = { Text("الأيقونة (رمز تعبيري)") }, singleLine = true)
                }
            },
            confirmButton = {
                TextButton(enabled = name.isNotBlank(), onClick = { state.addSection(name, icon); adding = false }) { Text("إضافة") }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("إلغاء") } },
        )
    }
}

private val SharedLine = Color(0xFF8FE3D3)
private val LabelMain = Color(0xFFECE9FF)
private val LabelDim = Color(0xFFB4AFD6)
