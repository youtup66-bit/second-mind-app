package app.notes.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.notes.ai.AiEngine
import app.notes.ai.BasicEngine
import app.notes.ai.Classifier
import app.notes.ai.Recall
import app.notes.data.Conversation
import app.notes.data.Msg
import app.notes.data.Note
import app.notes.data.Repo
import app.notes.data.Section
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AppState(private val repo: Repo, private val scope: CoroutineScope) {
    var sections by mutableStateOf(listOf<Section>())
    var conversations by mutableStateOf(listOf<Conversation>())
    val messages = mutableStateListOf<Msg>()
    var convId by mutableStateOf(0L)
    var busy by mutableStateOf(false)
    var engine: AiEngine = BasicEngine()

    init { refresh() }

    private fun refresh() = scope.launch {
        val (s, c) = io { repo.sections() to repo.conversations() }
        sections = s; conversations = c
    }

    fun newChat() { convId = 0L; messages.clear() }

    fun openChat(id: Long) = scope.launch {
        val list = io { repo.messages(id) }
        convId = id; messages.clear(); messages.addAll(list)
    }

    fun send(raw: String) {
        val text = raw.trim()
        if (text.isEmpty() || busy) return
        busy = true
        scope.launch {
            try {
                if (convId == 0L) convId = io { repo.newConversation(text.take(40)) }
                val id = convId
                messages += io { repo.addMessage(id, "user", text) }
                val section = Classifier.classify(text, sections)
                // الذاكرة تُبحث قبل حفظ الملاحظة الجديدة حتى لا تتذكر نفسها
                val memory = io { Recall.find(repo.notes(), text) }
                io { repo.addNote(text, section.id, id) }
                val reply = engine.reply(messages.toList(), memory, text, section)
                messages += io { repo.addMessage(id, "assistant", reply) }
            } finally {
                busy = false
                refresh()
            }
        }
    }

    suspend fun notesOf(sectionId: Long): List<Note> = io { repo.notes(sectionId) }

    fun addSection(name: String, icon: String) = scope.launch {
        io { repo.addSection(name.trim(), icon.trim().ifEmpty { "📘" }) }
        refresh()
    }

    fun moveNote(noteId: Long, sectionId: Long) = scope.launch { io { repo.moveNote(noteId, sectionId) }; refresh() }
    fun deleteNote(noteId: Long) = scope.launch { io { repo.deleteNote(noteId) }; refresh() }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }
}
