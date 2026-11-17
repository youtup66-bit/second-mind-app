package app.notes.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.notes.ai.AiEngine
import app.notes.ai.BasicEngine
import app.notes.ai.Classifier
import app.notes.ai.Links
import app.notes.ai.SectionLink
import app.notes.ai.SuggestedLink
import app.notes.ai.InstalledModel
import app.notes.ai.LocalEngine
import app.notes.ai.GeminiEngine
import app.notes.ai.ModelManager
import app.notes.ai.Recall
import app.notes.ai.Embedder
import app.notes.ai.Semantic
import app.notes.data.Conversation
import app.notes.data.Msg
import app.notes.data.Note
import app.notes.data.Repo
import app.notes.data.Section
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class AppState(private val repo: Repo, val models: ModelManager, private val scope: CoroutineScope) {
    var sections by mutableStateOf(listOf<Section>())
    /** كل الملاحظات والروابط المقترحة (لشاشة العقل). */
    var allNotes by mutableStateOf(listOf<Note>())
        private set
    var links by mutableStateOf(listOf<SuggestedLink>())
        private set
    var sectionLinks by mutableStateOf(listOf<SectionLink>())
        private set
    var conversations by mutableStateOf(listOf<Conversation>())
    val messages = mutableStateListOf<Msg>()
    var convId by mutableStateOf(0L)
    var busy by mutableStateOf(false)
    var engine: AiEngine by mutableStateOf<AiEngine>(BasicEngine())
        private set
    var installed by mutableStateOf(listOf<InstalledModel>())
        private set
    var status by mutableStateOf("")

    /** نموذج الفهم بالمعنى (إن نُزِّل)، وحالة فهرسة الملاحظات. */
    private var embedder: Embedder? = null
    var embedReady by mutableStateOf(false)
        private set
    var embedStatus by mutableStateOf("")
        private set

    init {
        refresh()
        refreshModels()
        if (models.activePath == GEMINI) useGemini()
        else installed.firstOrNull { it.file.absolutePath == models.activePath }?.let { useModel(it) }
        initEmbedder()
    }

    /** تحميل نموذج الفهم إن كان مثبّتاً، ثم إعطاء كل ملاحظة قديمة بصمة معنى. */
    fun initEmbedder() {
        if (embedder != null || !models.embedReady()) return
        embedStatus = "يحمّل نموذج الفهم…"
        scope.launch {
            try {
                embedder = withContext(Dispatchers.Default) { Embedder(models.embedModel, models.embedTokenizer) }
                embedReady = true
                indexMissing()
            } catch (e: Throwable) {
                embedStatus = "تعذّر تشغيل نموذج الفهم: ${e.message ?: e.javaClass.simpleName}"
            }
        }
    }

    private suspend fun indexMissing() {
        val e = embedder ?: return
        val todo = io { repo.notesWithoutVector() }
        todo.forEachIndexed { i, n ->
            embedStatus = "يفهم ملاحظاتك ${i + 1} من ${todo.size}…"
            val v = withContext(Dispatchers.Default) { e.embed(n.text) }
            io { repo.saveVector(n.id, v) }
        }
        embedStatus = "يعمل ✓ (كل الملاحظات مفهومة)"
        if (todo.isNotEmpty()) refresh()
    }

    fun deleteEmbedder() {
        embedder?.close(); embedder = null; embedReady = false; embedStatus = ""
        models.deleteEmbed()
    }

    fun refreshModels() { installed = models.installed() }

    /** اختيار نموذج محلي، أو null للمحرك الأساسي بلا نموذج. */
    /** الذكاء على الإنترنت (Gemini)؛ يحتاج مفتاحاً. */
    fun useGemini(): Boolean {
        if (models.geminiKey.isBlank()) return false
        (engine as? LocalEngine)?.close()
        engine = GeminiEngine(models.geminiKey, models.geminiModel)
        models.activePath = GEMINI
        return true
    }

    val usingGemini get() = engine is GeminiEngine

    fun useModel(m: InstalledModel?) {
        (engine as? LocalEngine)?.close()
        engine = if (m == null) BasicEngine() else LocalEngine(models.ctx, m.file, m.label, m.template)
        models.activePath = m?.file?.absolutePath ?: ""
    }

    fun deleteModel(f: File) {
        if (f.absolutePath == models.activePath) useModel(null)
        models.delete(f)
        refreshModels()
    }

    private fun refresh() = scope.launch {
        val (s, c) = io { repo.sections() to repo.conversations() }
        sections = s; conversations = c
        val notes = io { repo.notes() }
        val vectors = io { repo.vectors() }
        val (l, sl) = withContext(Dispatchers.Default) {
            Semantic.merge(Links.suggest(notes), Semantic.links(vectors, notes)).let { it to Links.bySection(it, notes) }
        }
        allNotes = notes; links = l; sectionLinks = sl
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
                // أي ذكاء صناعي (على الهاتف أو الإنترنت) يصنّف ويرد؛ الأساسي بالكلمات فقط
                val local = engine !is BasicEngine
                val where = if (engine is GeminiEngine) "عبر الإنترنت" else "على هاتفك"
                if (local) status = "يصنّف ملاحظتك $where…"
                val section = (if (local) runCatching { engine.classify(text, sections) }.getOrNull() else null)
                    ?: Classifier.classify(text, sections)
                // الذاكرة تُبحث قبل حفظ الملاحظة الجديدة حتى لا تتذكر نفسها
                val e = embedder
                val qv = if (e != null) runCatching { withContext(Dispatchers.Default) { e.embed(text) } }.getOrNull() else null
                val memory = io {
                    val all = repo.notes()
                    // بالمعنى إن توفر نموذج الفهم، وإلا بالكلمات المشتركة
                    if (qv != null) Semantic.recall(repo.vectors(), all, qv).ifEmpty { Recall.find(all, text) }
                    else Recall.find(all, text)
                }
                val noteId = io { repo.addNote(text, section.id, id) }
                if (qv != null) io { repo.saveVector(noteId, qv) }
                answer(id, text, section, memory)
            } finally {
                busy = false
                status = ""
                refresh()
            }
        }
    }

    /** رد الذكاء وحفظه في المحادثة. */
    private suspend fun answer(convId: Long, text: String, section: Section, memory: List<Note>) {
        val local = engine !is BasicEngine
        val where = if (engine is GeminiEngine) "عبر الإنترنت" else "على هاتفك"
        if (local) status = "يفكر $where…"
        val reply = try {
            engine.reply(messages.toList(), memory, text, section)
        } catch (e: Throwable) {
            // إن فشل النموذج (ذاكرة لا تكفي أو ملف تالف) لا تضيع الملاحظة
            BasicEngine().reply(messages.toList(), memory, text, section) +
                "\n\n⚠️ تعذّر تشغيل النموذج: ${e.message ?: e.javaClass.simpleName}"
        }
        val tagged = if (local) "$reply\n\n— حُفظت في ${section.icon} ${section.name}" else reply
        messages += io { repo.addMessage(convId, "assistant", tagged) }
    }

    /** هل يمكن تعديل هذه الرسالة؟ (آخر رسالة كتبها المستخدم فقط) */
    fun isLastUser(m: Msg) = m.role == "user" && messages.lastOrNull { it.role == "user" }?.id == m.id

    /**
     * تعديل آخر رسالة: يُحدَّث نصها ونص ملاحظتها، ويُعاد تصنيفها وفهمها،
     * ويُحذف الرد القديم ويكتب الذكاء رداً جديداً.
     */
    fun editLast(raw: String) {
        val text = raw.trim()
        val idx = messages.indexOfLast { it.role == "user" }
        if (text.isEmpty() || busy || idx < 0) return
        val old = messages[idx]
        if (old.text == text) return
        busy = true
        scope.launch {
            try {
                val after = messages.drop(idx + 1)
                io { after.forEach { repo.deleteMessage(it.id) }; repo.updateMessage(old.id, text) }
                while (messages.size > idx + 1) messages.removeAt(messages.lastIndex)
                messages[idx] = old.copy(text = text)

                val noteId = io { repo.findNote(old.convId, old.text) }
                val local = engine !is BasicEngine
                if (local) status = "يعيد تصنيف ملاحظتك…"
                val section = (if (local) runCatching { engine.classify(text, sections) }.getOrNull() else null)
                    ?: Classifier.classify(text, sections)
                val e = embedder
                val qv = if (e != null) runCatching { withContext(Dispatchers.Default) { e.embed(text) } }.getOrNull() else null
                val memory = io {
                    val all = repo.notes().filter { it.id != noteId }
                    if (qv != null) Semantic.recall(repo.vectors(), all, qv).ifEmpty { Recall.find(all, text) }
                    else Recall.find(all, text)
                }
                val nid = if (noteId != null) { io { repo.updateNote(noteId, text, section.id) }; noteId }
                else io { repo.addNote(text, section.id, old.convId) }
                if (qv != null) io { repo.saveVector(nid, qv) }
                answer(old.convId, text, section, memory)
            } finally {
                busy = false
                status = ""
                refresh()
            }
        }
    }

    /** تعديل ملاحظة من الكتاب (يبقى قسمها كما هو). */
    fun updateNote(noteId: Long, raw: String) {
        val text = raw.trim()
        if (text.isEmpty()) return
        scope.launch {
            io { repo.updateNote(noteId, text) }
            embedder?.let { e ->
                runCatching { withContext(Dispatchers.Default) { e.embed(text) } }.getOrNull()?.let { v -> io { repo.saveVector(noteId, v) } }
            }
            refresh()
        }
    }

    /** تلخيص كتاب بالنموذج المحلي وحفظ الملخص. يعيد رسالة خطأ أو null. */
    suspend fun summarize(section: Section): String? {
        if (engine is BasicEngine) return "اختر نموذجاً من «النماذج» ليلخّص لك الكتاب."
        val notes = notesOf(section.id)
        if (notes.isEmpty()) return "الكتاب فارغ."
        return try {
            val text = engine.summarize(section, notes) ?: return "لم يكتب النموذج ملخصاً، جرّب مرة أخرى."
            io { repo.setSummary(section.id, text, notes.size) }
            refresh().join()
            null
        } catch (e: Throwable) { "تعذّر التلخيص: ${e.message ?: e.javaClass.simpleName}" }
    }

    suspend fun notesOf(sectionId: Long): List<Note> = io { repo.notes(sectionId) }

    fun addSection(name: String, icon: String, parentId: Long = 0) = scope.launch {
        io { repo.addSection(name.trim(), icon.trim().ifEmpty { "📘" }, parentId) }
        refresh()
    }

    fun moveNote(noteId: Long, sectionId: Long) = scope.launch { io { repo.moveNote(noteId, sectionId) }; refresh() }
    fun deleteNote(noteId: Long) = scope.launch { io { repo.deleteNote(noteId) }; refresh() }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    companion object { const val GEMINI = "gemini" }
}
