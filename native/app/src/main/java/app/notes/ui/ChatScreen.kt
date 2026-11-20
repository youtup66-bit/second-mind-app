package app.notes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.notes.data.Msg
import app.notes.data.Pdf
import app.notes.data.ReportBlock

@Composable
fun ChatScreen(state: AppState, onModels: () -> Unit) {
    var input by remember { mutableStateOf("") }
    // وضع تعديل آخر رسالة
    var editing by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    val savePdf = rememberPdfSaver()

    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) list.animateScrollToItem(state.messages.size - 1)
    }

    Column(Modifier.fillMaxSize().background(Bg).imePadding()) {
        // الشريط العلوي: السجل، اسم النموذج، محادثة جديدة
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TopIcon("☰") { showHistory = true }
            Spacer(Modifier.weight(1f))
            Surface(shape = RoundedCornerShape(50), color = Panel2, modifier = Modifier.clickable(onClick = onModels)) {
                Text(
                    "✦ ${state.engine.name} ▾",
                    color = TextMain, fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
            Spacer(Modifier.weight(1f))
            TopIcon("＋") { state.newChat() }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.messages.isNotEmpty()) {
                LazyColumn(
                    state = list,
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                ) {
                    items(state.messages, key = { it.id }) { m ->
                        MessageRow(m, canEdit = !state.busy && state.isLastUser(m),
                            saved = m.role == "user" && state.isSaved(m), onToggleSave = { state.toggleSaved(m) },
                            hasActions = state.pending.containsKey(m.id),
                            onRun = { state.runPending(m.id) }, onCancel = { state.cancelPending(m.id) },
                            onEdit = {
                            input = m.text; editing = true
                        }, onPdf = {
                            // التقرير: سؤالك (الرسالة السابقة) ثم رد الذكاء
                            val i = state.messages.indexOf(m)
                            val q = state.messages.subList(0, i.coerceAtLeast(0)).lastOrNull { it.role == "user" }
                            savePdf(Report(
                                fileName = "تقرير ${safeFileName(q?.text ?: "عقلي")}.pdf",
                                title = q?.text?.take(80) ?: "تقرير",
                                subtitle = "${Pdf.now()} · ${state.engine.name}",
                                blocks = listOfNotNull(
                                    q?.let { ReportBlock("السؤال", it.text) },
                                    ReportBlock("الرد (كتبه الذكاء الصناعي)", m.text),
                                ),
                            ))
                        })
                    }
                    if (state.busy) item { Text("✦ ${state.status.ifEmpty { "يفكر…" }}", color = TextDim) }
                }
            }
        }

        // شريط وضع التعديل
        if (editing) Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("✎ تعديل آخر رسالة — سيكتب الذكاء رداً جديداً", color = Accent, fontSize = 13.sp, modifier = Modifier.weight(1f))
            Text("✕", color = TextDim, fontSize = 18.sp, modifier = Modifier.clip(CircleShape).clickable { editing = false; input = "" }.padding(6.dp))
        }

        // صندوق الكتابة
        Row(
            Modifier.fillMaxWidth().padding(12.dp)
                .clip(RoundedCornerShape(28.dp)).background(Panel)
                .padding(start = 6.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // زر الحفظ: مفعّل = تُحفظ رسائلك ملاحظات، متوقف = محادثة فقط
            Text(
                if (state.saveMode) "✓ حفظ" else "حفظ",
                color = if (state.saveMode) Color.White else TextDim, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(14.dp))
                    .background(if (state.saveMode) Accent else Panel2)
                    .clickable { state.toggleSaveMode() }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            )
            TextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("اكتب ما في بالك…", color = TextDim) },
                modifier = Modifier.weight(1f),
                maxLines = 5,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    focusedTextColor = TextMain,
                    unfocusedTextColor = TextMain,
                ),
            )
            val canSend = input.isNotBlank() && !state.busy
            Box(
                Modifier.size(42.dp).clip(CircleShape)
                    .background(if (canSend) Brush.linearGradient(listOf(Accent, Accent2)) else Brush.linearGradient(listOf(Panel2, Panel2)))
                    .clickable(enabled = canSend) {
                        if (editing) state.editLast(input) else state.send(input)
                        input = ""; editing = false
                    },
                contentAlignment = Alignment.Center,
            ) { Text("↑", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
        }
    }

    if (showHistory) {
        AlertDialog(
            onDismissRequest = { showHistory = false },
            containerColor = Panel,
            title = { Text("المحادثات السابقة", color = TextMain) },
            text = {
                if (state.conversations.isEmpty()) Text("لا محادثات بعد", color = TextDim)
                else LazyColumn(Modifier.height(360.dp)) {
                    items(state.conversations, key = { it.id }) { c ->
                        Text(
                            c.title, color = TextMain, maxLines = 1,
                            modifier = Modifier.fillMaxWidth()
                                .clickable { state.openChat(c.id); showHistory = false }
                                .padding(vertical = 12.dp),
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showHistory = false }) { Text("إغلاق") } },
        )
    }
}

@Composable
private fun TopIcon(glyph: String, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(glyph, color = TextMain, fontSize = 20.sp) }
}

@Composable
private fun MessageRow(
    m: Msg, canEdit: Boolean, onEdit: () -> Unit, onPdf: () -> Unit,
    hasActions: Boolean = false, onRun: () -> Unit = {}, onCancel: () -> Unit = {},
    saved: Boolean = false, onToggleSave: () -> Unit = {},
) {
    if (m.role == "user") {
        // رسالة المستخدم: فقاعة في جهة البداية، وتحت آخرها زر تعديل
        Column(Modifier.fillMaxWidth()) {
            Surface(shape = RoundedCornerShape(20.dp), color = Panel2, modifier = Modifier.widthIn(max = 300.dp)) {
                Text(m.text, color = TextMain, fontSize = 16.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
            }
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                // علامة الحفظ: تضغطها لتحفظ الرسالة ملاحظة أو تلغي حفظها
                Text(
                    if (saved) "✓ محفوظة" else "＋ حفظ", color = if (saved) Accent2 else TextDim, fontSize = 12.sp,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onToggleSave)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
                if (canEdit) Text(
                    "✎ تعديل", color = TextDim, fontSize = 12.sp,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onEdit)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
        }
    } else {
        // رد الذكاء: نص حر مع شعار صغير، كبرامج الذكاء الصناعي
        Row(Modifier.fillMaxWidth()) {
            Box(
                Modifier.padding(top = 2.dp).size(26.dp).clip(CircleShape)
                    .background(Brush.linearGradient(listOf(Accent, Accent2))),
                contentAlignment = Alignment.Center,
            ) { Text("✦", color = Color.White, fontSize = 13.sp) }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(m.text, color = TextMain, fontSize = 16.sp, lineHeight = 24.sp)
                Spacer(Modifier.height(6.dp))
                if (hasActions) {
                    // بطاقة التأكيد: لا يتغير شيء قبل الضغط على «تنفيذ»
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "تنفيذ", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Accent).clickable(onClick = onRun)
                                .padding(horizontal = 18.dp, vertical = 8.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "إلغاء", color = TextMain, fontSize = 14.sp,
                            modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Panel2).clickable(onClick = onCancel)
                                .padding(horizontal = 18.dp, vertical = 8.dp),
                        )
                    }
                } else PdfChip(onPdf)
            }
        }
    }
}
