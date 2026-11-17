package app.notes.ui

import androidx.compose.foundation.ExperimentalFoundationApi
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.notes.data.Note
import app.notes.data.Pdf
import app.notes.data.ReportBlock
import app.notes.data.Section
import app.notes.data.path
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val dateFmt = SimpleDateFormat("EEEE d MMMM yyyy · HH:mm", Locale("ar"))

/** الكرة تفتح كتاباً: غلاف، ثم صفحة لكل ملاحظة تُقلب أفقياً. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BookScreen(state: AppState, book: Section, startNoteId: Long? = null, onBack: () -> Unit) {
    // نسخة محدثة من القسم (العدد والملخص)
    val section = state.sections.firstOrNull { it.id == book.id } ?: book
    var notes by remember { mutableStateOf<List<Note>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var moving by remember { mutableStateOf<Note?>(null) }
    var editingNote by remember { mutableStateOf<Note?>(null) }
    var editText by remember { mutableStateOf("") }
    val savePdf = rememberPdfSaver()
    LaunchedEffect(section.id, reload, state.allNotes) { notes = state.notesOf(section.id) }

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(40.dp).clip(CircleShape).clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) { Text("→", color = TextMain, fontSize = 22.sp) }
            Text(section.path(state.sections), color = TextMain, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            // تقرير الكتاب: الملخص (إن وُجد) ثم كل الصفحات
            notes?.let { list ->
                PdfChip {
                    savePdf(Report(
                        fileName = "تقرير ${safeFileName(section.name)}.pdf",
                        title = "تقرير: ${section.path(state.sections)}",
                        subtitle = "${Pdf.now()} · ${list.size} ملاحظة",
                        blocks = listOfNotNull(
                            section.summary.takeIf { it.isNotEmpty() }?.let { ReportBlock("الملخص (كتبه الذكاء الصناعي)", it) },
                        ) + list.map { ReportBlock(dateFmt.format(Date(it.time)), it.text) },
                    ))
                }
            }
        }

        val list = notes ?: return@Column
        val start = list.indexOfFirst { it.id == startNoteId }.let { if (it < 0) 0 else it + 1 }
        val pager = rememberPagerState(initialPage = start) { list.size + 1 }
        HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth()) { page ->
            Surface(
                shape = RoundedCornerShape(topStart = 6.dp, bottomStart = 6.dp, topEnd = 18.dp, bottomEnd = 18.dp),
                color = Paper,
                shadowElevation = 6.dp,
                modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 12.dp),
            ) {
                if (page == 0) Cover(state, section, list.size)
                else NotePage(list[page - 1], page, list.size, onEdit = { editingNote = it; editText = it.text }, onMove = { moving = it }, onDelete = {
                    state.deleteNote(it.id); reload++
                })
            }
        }
        Text(
            if (list.isEmpty()) "الكتاب فارغ — اكتب في المحادثة وسيُملأ" else "اسحب لتقليب الصفحات",
            color = TextDim, fontSize = 13.sp, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
        )
    }

    editingNote?.let { note ->
        AlertDialog(
            onDismissRequest = { editingNote = null },
            containerColor = Panel,
            title = { Text("تعديل الملاحظة", color = TextMain) },
            text = {
                OutlinedTextField(editText, { editText = it }, modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp))
            },
            confirmButton = {
                TextButton(enabled = editText.isNotBlank(), onClick = {
                    state.updateNote(note.id, editText); editingNote = null; reload++
                }) { Text("حفظ") }
            },
            dismissButton = { TextButton(onClick = { editingNote = null }) { Text("إلغاء") } },
        )
    }

    moving?.let { note ->
        AlertDialog(
            onDismissRequest = { moving = null },
            containerColor = Panel,
            title = { Text("انقل إلى كتاب", color = TextMain) },
            text = {
                LazyColumn(Modifier.height(320.dp)) {
                    items(state.sections.filter { it.id != section.id }, key = { it.id }) { s ->
                        Text(
                            s.path(state.sections), color = TextMain,
                            modifier = Modifier.fillMaxWidth().clickable {
                                state.moveNote(note.id, s.id); moving = null; reload++
                            }.padding(vertical = 12.dp),
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { moving = null }) { Text("إلغاء") } },
        )
    }
}

@Composable
private fun Cover(state: AppState, section: Section, count: Int) {
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Accent, Panel2)))
            .verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(section.icon, fontSize = 64.sp)
        Spacer(Modifier.height(12.dp))
        Text(section.name, color = TextMain, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("$count صفحة", color = TextMain.copy(alpha = 0.8f), fontSize = 16.sp)

        if (count > 0) {
            Spacer(Modifier.height(20.dp))
            if (section.summary.isNotEmpty()) {
                Surface(shape = RoundedCornerShape(16.dp), color = Bg.copy(alpha = 0.35f), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text("✦ الملخص", color = TextMain, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(6.dp))
                        Text(section.summary, color = TextMain, fontSize = 15.sp, lineHeight = 24.sp)
                        if (section.summaryCount != count) Text(
                            "أُضيفت صفحات بعد هذا الملخص", color = TextMain.copy(alpha = 0.6f), fontSize = 12.sp,
                        )
                    }
                }
            }
            TextButton(enabled = !working, onClick = {
                working = true; error = null
                scope.launch { error = state.summarize(section); working = false }
            }) {
                Text(
                    when {
                        working -> "يلخّص على هاتفك…"
                        section.summary.isEmpty() -> "✦ لخّص الكتاب"
                        else -> "✦ حدّث الملخص"
                    },
                    color = TextMain,
                )
            }
            error?.let { Text(it, color = TextMain.copy(alpha = 0.8f), fontSize = 13.sp, textAlign = TextAlign.Center) }
        }
    }
}

@Composable
private fun NotePage(note: Note, page: Int, total: Int, onEdit: (Note) -> Unit, onMove: (Note) -> Unit, onDelete: (Note) -> Unit) {
    Column(Modifier.fillMaxSize().padding(22.dp)) {
        Text(dateFmt.format(Date(note.time)), color = Ink.copy(alpha = 0.6f), fontSize = 13.sp)
        Spacer(Modifier.height(14.dp))
        Text(
            note.text, color = Ink, fontSize = 19.sp, lineHeight = 32.sp, fontFamily = FontFamily.Serif,
            modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { onEdit(note) }) { Text("تعديل", color = Accent) }
            TextButton(onClick = { onMove(note) }) { Text("نقل", color = Accent) }
            TextButton(onClick = { onDelete(note) }) { Text("حذف", color = Ink.copy(alpha = 0.6f)) }
            Spacer(Modifier.weight(1f))
            Text("$page / $total", color = Ink.copy(alpha = 0.5f), fontSize = 13.sp)
        }
    }
}
