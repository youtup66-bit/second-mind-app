package app.notes

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.notes.ai.Arabic
import app.notes.ai.Classifier
import app.notes.data.Db
import app.notes.data.Note
import app.notes.data.Repo
import app.notes.data.Section
import app.notes.data.path
import app.notes.ui.Accent
import app.notes.ui.Accent2
import app.notes.ui.Bg
import app.notes.ui.NotesTheme
import app.notes.ui.Panel
import app.notes.ui.Panel2
import app.notes.ui.TextDim
import app.notes.ui.TextMain
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** نافذة سريعة تفتحها الكرة العائمة: قائمة الملاحظات، وبحث، وإضافة ملاحظة. */
class QuickActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repo = Repo(Db.get(applicationContext))
        setContent {
            NotesTheme {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    QuickNotes(repo, onClose = { finish() }, onOpenApp = {
                        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        finish()
                    })
                }
            }
        }
    }
}

private val fmt = SimpleDateFormat("d MMM · HH:mm", Locale("ar"))

@Composable
private fun QuickNotes(repo: Repo, onClose: () -> Unit, onOpenApp: () -> Unit) {
    val scope = rememberCoroutineScope()
    var notes by remember { mutableStateOf(listOf<Note>()) }
    var sections by remember { mutableStateOf(listOf<Section>()) }
    var reload by remember { mutableIntStateOf(0) }
    var query by remember { mutableStateOf("") }
    var draft by remember { mutableStateOf("") }
    var info by remember { mutableStateOf("") }

    LaunchedEffect(reload) {
        val (n, s) = withContext(Dispatchers.IO) { repo.notes().asReversed() to repo.sections() }
        notes = n; sections = s
    }

    // الضغط خارج اللوحة يغلقها
    Box(Modifier.fillMaxSize().clickable(onClick = onClose), contentAlignment = Alignment.BottomCenter) {
        Column(
            Modifier.fillMaxWidth().fillMaxHeight(0.8f)
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                .background(Bg)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .imePadding()
                .padding(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("ملاحظاتي", color = TextMain, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                TextButton(onClick = onOpenApp) { Text("فتح التطبيق") }
                TextButton(onClick = onClose) { Text("إغلاق", color = TextDim) }
            }

            // إضافة ملاحظة سريعة (تُصنَّف بالكلمات، ويفهمها الذكاء لاحقاً داخل التطبيق)
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    draft, { draft = it }, modifier = Modifier.weight(1f), maxLines = 3,
                    placeholder = { Text("ملاحظة جديدة…", color = TextDim) },
                )
                TextButton(enabled = draft.isNotBlank(), onClick = {
                    val text = draft.trim(); draft = ""
                    scope.launch {
                        val sec = withContext(Dispatchers.IO) {
                            val all = repo.sections()
                            Classifier.classify(text, all).also { repo.addNote(text, it.id, 0) }
                        }
                        info = "حُفظت في ${sec.path(sections.ifEmpty { listOf(sec) })} ✓"
                        reload++
                    }
                }) { Text("حفظ") }
            }
            if (info.isNotEmpty()) Text(info, color = Accent2, fontSize = 13.sp)

            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                query, { query = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("ابحث في ملاحظاتك…", color = TextDim) },
            )
            Spacer(Modifier.height(8.dp))

            val q = Arabic.normalize(query.trim())
            val shown = if (q.isEmpty()) notes else notes.filter { Arabic.normalize(it.text).contains(q) }
            if (shown.isEmpty()) Text(if (notes.isEmpty()) "لا ملاحظات بعد" else "لا نتائج", color = TextDim)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(shown, key = { it.id }) { n -> QuickNote(n, sections) }
            }
        }
    }
}

@Composable
private fun QuickNote(n: Note, sections: List<Section>) {
    var open by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel)
            .clickable { open = !open }.padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val sec = sections.firstOrNull { it.id == n.sectionId }
            if (sec != null) Text(
                sec.path(sections), color = Accent, fontSize = 12.sp,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Panel2).padding(horizontal = 8.dp, vertical = 2.dp),
            )
            Spacer(Modifier.weight(1f))
            Text(fmt.format(Date(n.time)), color = TextDim, fontSize = 12.sp)
        }
        Spacer(Modifier.height(4.dp))
        Text(n.text, color = TextMain, fontSize = 15.sp, maxLines = if (open) Int.MAX_VALUE else 3)
    }
}
