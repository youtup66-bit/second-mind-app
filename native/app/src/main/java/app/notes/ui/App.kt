package app.notes.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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

    val book = openBook
    if (book != null) {
        BackHandler { openBook = null }
        BookScreen(state, book, startNoteId = openNote, onBack = { openBook = null })
    } else {
        Scaffold(
            containerColor = Bg,
            bottomBar = {
                NavigationBar(containerColor = Panel) {
                    listOf("💬" to "المحادثة", "🧠" to "العقل", "🤖" to "النماذج").forEachIndexed { i, (icon, label) ->
                        NavigationBarItem(
                            selected = tab == i,
                            onClick = { tab = i },
                            icon = { Text(icon, fontSize = 20.sp) },
                            label = { Text(label) },
                            colors = NavigationBarItemDefaults.colors(indicatorColor = Panel2),
                        )
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
