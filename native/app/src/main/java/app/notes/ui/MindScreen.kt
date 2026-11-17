package app.notes.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.notes.data.Section
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

private val ballColors = listOf(
    Color(0xFF8B6CFF), Color(0xFF4FA3FF), Color(0xFFFF7AB6), Color(0xFF46D9B0),
    Color(0xFFFFB547), Color(0xFF7C8CFF), Color(0xFFB57BFF), Color(0xFF5ED0FF), Color(0xFFFF8C6B),
)

@Composable
fun MindScreen(state: AppState, onOpen: (Section) -> Unit) {
    var adding by remember { mutableStateOf(false) }
    val float = rememberInfiniteTransition(label = "float")
    val phase by float.animateFloat(
        0f, (2 * PI).toFloat(),
        infiniteRepeatable(tween(6000, easing = LinearEasing), RepeatMode.Restart), label = "phase",
    )

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("العقل", color = TextMain, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("كل كرة كتاب. اضغط لتقرأه", color = TextDim, fontSize = 13.sp)
            }
            Box(
                Modifier.clip(CircleShape).background(Panel2).clickable { adding = true }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) { Text("＋ قسم", color = TextMain) }
        }

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val density = LocalDensity.current
            val w = constraints.maxWidth.toFloat()
            val h = constraints.maxHeight.toFloat()
            val center = Offset(w / 2, h / 2)
            val radius = min(w, h) * 0.36f
            val sections = state.sections
            val n = sections.size.coerceAtLeast(1)

            // موضع كل كرة على دائرة حول المركز، مع طفو خفيف
            val points = sections.mapIndexed { i, _ ->
                val a = (2 * PI * i / n - PI / 2).toFloat()
                val bob = with(density) { 6.dp.toPx() } * sin(phase + i * 1.3f)
                Offset(center.x + radius * cos(a), center.y + radius * sin(a) + bob)
            }

            // خطوط الترابط: كل كرة بالمركز وبجارتها
            Canvas(Modifier.fillMaxSize()) {
                points.forEachIndexed { i, p ->
                    drawLine(Accent.copy(alpha = 0.25f), center, p, strokeWidth = 2f)
                    val next = points[(i + 1) % points.size]
                    if (points.size > 1) drawLine(Accent2.copy(alpha = 0.15f), p, next, strokeWidth = 1.5f)
                }
            }

            // المركز
            val coreSize = 70.dp
            val corePx = with(density) { coreSize.toPx() }
            Box(
                Modifier.offset { IntOffset((center.x - corePx / 2).roundToInt(), (center.y - corePx / 2).roundToInt()) }
                    .size(coreSize).clip(CircleShape)
                    .background(Brush.radialGradient(listOf(Color.White, Accent, Accent.copy(alpha = 0.2f)))),
                contentAlignment = Alignment.Center,
            ) { Text("🧠", fontSize = 28.sp) }

            sections.forEachIndexed { i, s ->
                val size = (62 + min(s.count, 20) * 2).dp
                val px = with(density) { size.toPx() }
                val p = points[i]
                val color = ballColors[i % ballColors.size]
                Column(
                    Modifier.offset { IntOffset((p.x - px / 2).roundToInt(), (p.y - px / 2).roundToInt()) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.size(size).clip(CircleShape)
                            .background(Brush.radialGradient(listOf(color.copy(alpha = 0.95f), color.copy(alpha = 0.35f))))
                            .border(1.dp, Color.White.copy(alpha = 0.25f), CircleShape)
                            .clickable { onOpen(s) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(s.icon, fontSize = 22.sp)
                            Text("${s.count}", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(s.name, color = TextMain, fontSize = 13.sp, textAlign = TextAlign.Center)
                }
            }
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
