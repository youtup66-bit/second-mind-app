package app.notes.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import app.notes.ai.ModelManager
import app.notes.data.Repo
import app.notes.data.Section

@Composable
fun App(repo: Repo) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val state = remember { AppState(repo, ModelManager(ctx.applicationContext), scope) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var openBook by remember { mutableStateOf<Section?>(null) }
    var openNote by remember { mutableStateOf<Long?>(null) }

    // أمر «افتح كتاب…» من المحادثة
    LaunchedEffect(state.openBookRequest) {
        val id = state.openBookRequest ?: return@LaunchedEffect
        state.sections.firstOrNull { it.id == id }?.let { openNote = null; openBook = it }
        state.openBookRequest = null
    }

    val book = openBook
    if (book != null) {
        BackHandler { openBook = null }
        BookScreen(state, book, startNoteId = openNote, onBack = { openBook = null })
    } else {
        Scaffold(
            containerColor = Bg,
            bottomBar = {
                // شريط سفلي صغير: كتابة فقط
                Row(Modifier.fillMaxWidth().height(48.dp).background(Panel)) {
                    listOf("المحادثة", "العقل", "النماذج").forEachIndexed { i, label ->
                        val on = tab == i
                        Box(
                            Modifier.weight(1f).fillMaxHeight().clickable { tab = i },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                label, fontSize = 14.sp,
                                color = if (on) TextMain else TextDim,
                                fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                            )
                            if (on) Box(
                                Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp)
                                    .width(22.dp).height(3.dp).clip(RoundedCornerShape(2.dp)).background(Accent),
                            )
                        }
                    }
                }
            },
        ) { pad ->
            Box(Modifier.fillMaxSize().padding(pad)) {
                when (tab) {
                    0 -> ChatScreen(state, onModels = { tab = 2 })
                    1 -> MindScreen(state, onOpen = { s, noteId -> openNote = noteId; openBook = s })
                    else -> ModelsScreen(state)
                }
            }
        }
    }
}
