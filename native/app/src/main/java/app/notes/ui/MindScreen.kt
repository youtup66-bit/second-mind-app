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
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.graphics.Brush
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import app.notes.data.Section
import app.notes.data.path

/** شاشة العقل: العقل في الوسط، ولكل قسم جهة ولون، وملاحظاته نقاط منتظمة بلونه. */
@Composable
fun MindScreen(state: AppState, onOpen: (Section, Long?) -> Unit) {
    var adding by remember { mutableStateOf(false) }
    val layout = remember(state.sections, state.allNotes, state.links, state.sectionLinks) {
        if (state.sections.isEmpty()) null else MindLayout(state.sections, state.allNotes, state.links, state.sectionLinks)
    }
    // ‎-1 = لم يُضبط بعد على حجم الشاشة
    var zoom by remember { mutableFloatStateOf(-1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    val measurer = rememberTextMeasurer()
    val u = LocalDensity.current.density

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("العقل", color = TextMain, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("قرّب لترى أسماء الملاحظات وروابطها، واضغط قسماً لتفتح كتابه", color = TextDim, fontSize = 12.sp)
            }
            Box(
                Modifier.clip(CircleShape).background(Panel2).clickable { adding = true }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) { Text("＋ قسم", color = TextMain) }
        }

        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().background(MindBg)) {
            val minSide = minOf(constraints.maxWidth, constraints.maxHeight).toFloat()
            val fit = ((minSide / 2f - 20 * u) / (((layout?.extent ?: 200f) + 24f) * u)).coerceIn(0.3f, 1.3f)
            LaunchedEffect(fit) { if (zoom < 0f) zoom = fit }

            Canvas(
                Modifier.fillMaxSize().pointerInput(layout) {
                    val g = layout ?: return@pointerInput
                    fun toWorld(p: Offset) = Offset(
                        (p.x - size.width / 2f - pan.x) / (zoom * u),
                        (p.y - size.height / 2f - pan.y) / (zoom * u),
                    )
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var moved = false
                        while (true) {
                            val ev = awaitPointerEvent()
                            val pressed = ev.changes.filter { it.pressed }
                            if (pressed.isEmpty()) break
                            if (pressed.size >= 2) {
                                // تكبير وتحريك بإصبعين حول نقطة المنتصف
                                moved = true
                                val c = ev.calculateCentroid() - Offset(size.width / 2f, size.height / 2f)
                                val nz = (zoom * ev.calculateZoom()).coerceIn(0.25f, 5f)
                                pan = (pan - c) * (nz / zoom) + c + ev.calculatePan()
                                zoom = nz
                            } else {
                                val ch = pressed[0]
                                if (!moved && (ch.position - down.position).getDistance() > viewConfiguration.touchSlop) moved = true
                                if (moved) pan += ch.position - ch.previousPosition
                            }
                            ev.changes.forEach { it.consume() }
                        }
                        if (!moved) {
                            val w = toWorld(down.position)
                            val hit = g.hit(w.x, w.y, 14f / zoom)
                            if (hit >= 0) {
                                val n = g.nodes[hit]
                                when (n.kind) {
                                    GKind.BRAIN -> { zoom = fit; pan = Offset.Zero }
                                    GKind.SECTION -> n.section?.let { onOpen(it, null) }
                                    GKind.NOTE -> n.section?.let { onOpen(it, n.note?.id) }
                                }
                            }
                        }
                    }
                },
            ) {
                val g = layout ?: return@Canvas
                if (zoom < 0f) return@Canvas
                val k = zoom * u
                val cx = size.width / 2f + pan.x
                val cy = size.height / 2f + pan.y
                fun pos(n: GNode) = Offset(cx + n.x * k, cy + n.y * k)
                val detail = zoom >= DETAIL_ZOOM

                // خطوط وصل بيضاء خافتة بسماكة ١ بكسل؛ روابط الأمور المشتركة عند التقريب فقط
                for (e in g.edges) {
                    if (!e.always && !detail) continue
                    drawLine(Color.White.copy(alpha = if (e.always) 0.28f else 0.18f), pos(g.nodes[e.a]), pos(g.nodes[e.b]), strokeWidth = 1f)
                }

                for (n in g.nodes) {
                    val p = pos(n)
                    val r = (n.radius * k).coerceAtLeast(1.5f)
                    when (n.kind) {
                        GKind.BRAIN -> {
                            drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.45f), Color.Transparent), center = p, radius = r * 3f), r * 3f, p)
                            drawCircle(Brush.radialGradient(listOf(Color.White, Color(0xFFDCD6F5)), center = p, radius = r), r, p)
                        }
                        else -> {
                            drawCircle(Brush.radialGradient(listOf(n.color.copy(alpha = 0.35f), Color.Transparent), center = p, radius = r * 2.6f), r * 2.6f, p)
                            drawCircle(n.color, r, p)
                        }
                    }
                    // أسماء الأقسام دائماً، وأسماء الملاحظات عند التقريب
                    if (n.kind == GKind.BRAIN || (n.kind == GKind.NOTE && !detail)) continue
                    val layoutText = n.label0 ?: measurer.measure(
                        n.label,
                        style = TextStyle(
                            color = if (n.kind == GKind.NOTE) LabelDim else LabelMain,
                            fontSize = if (n.kind == GKind.NOTE) 10.sp else 13.sp,
                            textAlign = TextAlign.Center,
                        ),
                        overflow = TextOverflow.Ellipsis,
                        maxLines = 2,
                        constraints = Constraints(maxWidth = (120 * u).toInt()),
                    ).also { n.label0 = it }
                    // الاسم بعيداً عن المركز: فوق الكرات العليا وتحت السفلى
                    val above = n.y < 0 && n.kind == GKind.SECTION
                    val top = if (above) p.y - r - 4 * u - layoutText.size.height else p.y + r + 3 * u
                    drawText(layoutText, topLeft = Offset(p.x - layoutText.size.width / 2f, top))
                }
            }

            // زر التوسيط
            Box(
                Modifier.align(Alignment.TopEnd).padding(12.dp).clip(CircleShape).background(Panel2)
                    .clickable { zoom = fit; pan = Offset.Zero }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) { Text("⌖ توسيط", color = TextMain, fontSize = 13.sp) }

            // أزرار التكبير والتصغير
            Column(
                Modifier.align(AbsoluteAlignment.BottomRight).padding(12.dp)
                    .clip(RoundedCornerShape(14.dp)).background(Panel2.copy(alpha = 0.9f)),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                listOf("＋" to 1.4f, "－" to 1f / 1.4f).forEach { (t, f) ->
                    Box(
                        Modifier.size(44.dp).clickable {
                            val nz = (zoom * f).coerceIn(0.25f, 5f)
                            pan *= nz / zoom
                            zoom = nz
                        },
                        contentAlignment = Alignment.Center,
                    ) { Text(t, color = TextMain, fontSize = 20.sp) }
                }
            }
        }
    }

    if (adding) {
        var name by remember { mutableStateOf("") }
        var icon by remember { mutableStateOf("📘") }
        var parent by remember { mutableStateOf(0L) }
        AlertDialog(
            onDismissRequest = { adding = false },
            containerColor = Panel,
            title = { Text("قسم جديد", color = TextMain) },
            text = {
                Column {
                    OutlinedTextField(name, { name = it }, label = { Text("الاسم") }, singleLine = true)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(icon, { icon = it.take(4) }, label = { Text("الأيقونة (رمز تعبيري)") }, singleLine = true)
                    Spacer(Modifier.height(12.dp))
                    Text("يتبع لـ", color = TextDim, fontSize = 13.sp)
                    // قسم رئيسي، أو فرعي تحت أي قسم موجود
                    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
                        item { ParentRow("بلا — قسم رئيسي", parent == 0L) { parent = 0L } }
                        items(state.sections, key = { it.id }) { sec ->
                            ParentRow(sec.path(state.sections), parent == sec.id) { parent = sec.id }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(enabled = name.isNotBlank(), onClick = { state.addSection(name, icon, parent); adding = false }) { Text("إضافة") }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("إلغاء") } },
        )
    }
}

@Composable
private fun ParentRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (selected) "◉" else "○", color = if (selected) Accent else TextDim)
        Spacer(Modifier.width(10.dp))
        Text(label, color = TextMain, fontSize = 14.sp)
    }
}

private val MindBg = Color(0xFF07070C)
private const val DETAIL_ZOOM = 1.4f
private val LabelMain = Color(0xFFECE9FF)
private val LabelDim = Color(0xFFB4AFD6)
