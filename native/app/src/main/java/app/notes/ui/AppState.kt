package app.notes.ui

import androidx.compose.runtime.getValue
import android.provider.Settings
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.notes.ai.AiEngine
import app.notes.ai.BasicEngine
import app.notes.BubblePrefs
import app.notes.FloatingService
import app.notes.ai.ActionPlanner
import app.notes.ai.AppAction
import app.notes.ai.Arabic
import app.notes.ai.Classifier
import app.notes.ai.MemoryAsk
import app.notes.data.Backup
import app.notes.data.path
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
                // أمر للتطبيق؟ يُعرض للموافقة ولا يُحفظ ملاحظة
                if (engine !is BasicEngine && ActionPlanner.looksLikeCommand(text)) {
                    status = "يفهم طلبك…"
                    val acts = runCatching { engine.plan(text, sections) }.getOrDefault(emptyList())
                    if (acts.isNotEmpty()) { proposeActions(id, acts); return@launch }
                }
                // سؤال عن ملاحظاته؟ يُجاب من محتويات عقله ولا يُحفظ ملاحظةً جديدة
                if (MemoryAsk.isAsk(text)) {
                    status = "يقرأ ملاحظاتك…"
                    val e0 = embedder
                    val qv0 = if (e0 != null) runCatching { withContext(Dispatchers.Default) { e0.embed(text) } }.getOrNull() else null
                    val memory0 = io {
                        val all = repo.notes()
                        if (qv0 != null) Semantic.recall(repo.vectors(), all, qv0, limit = 6).ifEmpty { Recall.find(all, text, 6) }
                        else Recall.find(all, text, 6)
                    }
                    answer(id, text, null, memory0, overview(text, full = engine is GeminiEngine || engine is BasicEngine))
                    return@launch
                }
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
    private suspend fun answer(convId: Long, text: String, section: Section?, memory: List<Note>, overview: String = "") {
        val local = engine !is BasicEngine
        val where = if (engine is GeminiEngine) "عبر الإنترنت" else "على هاتفك"
        if (local) status = "يفكر $where…"
        val reply = try {
            engine.reply(messages.toList(), memory, text, section, overview)
        } catch (e: Throwable) {
            // إن فشل النموذج (ذاكرة لا تكفي أو ملف تالف) لا تضيع الملاحظة
            BasicEngine().reply(messages.toList(), memory, text, section, overview) +
                "\n\n⚠️ تعذّر تشغيل النموذج: ${e.message ?: e.javaClass.simpleName}"
        }
        val tagged = if (local && section != null) "$reply\n\n— حُفظت في ${section.icon} ${section.name}" else reply
        messages += io { repo.addMessage(convId, "assistant", tagged) }
    }

    /**
     * نظرة على محتويات عقله: الأقسام وعدد ملاحظاتها، ثم الملاحظات (الأحدث أولاً).
     * إن ذُكر قسم باسمه تُعرض ملاحظاته هو. [full] لـ Gemini (سياق كبير)، وإلا ملخص قصير للنموذج الصغير.
     */
    private suspend fun overview(text: String, full: Boolean): String = io {
        val all = repo.sections()
        val notes = repo.notes().asReversed()
        val t = Arabic.normalize(text)
        val focus = all.filter { Arabic.normalize(it.name).let { n -> n.length >= 2 && t.contains(n) } }
            .flatMap { f -> all.filter { it.id == f.id || isUnder(it, f, all) } }.map { it.id }.toSet()
        val shown = if (focus.isEmpty()) notes else notes.filter { it.sectionId in focus }
        val limit = if (full) 20_000 else 650
        val per = if (full) 400 else 100
        val fmt = java.text.SimpleDateFormat("d MMM", java.util.Locale("ar"))
        buildString {
            append("عدد الملاحظات: ${notes.size}. الأقسام:\n")
            all.forEach { append("- ").append(it.path(all)).append(": ").append(it.count).append('\n') }
            if (shown.isEmpty()) { append("لا ملاحظات بعد."); return@buildString }
            append(if (focus.isEmpty()) "الملاحظات (الأحدث أولاً):\n" else "ملاحظات القسم المذكور (الأحدث أولاً):\n")
            for (n in shown) {
                val sec = all.firstOrNull { it.id == n.sectionId }?.name ?: ""
                val line = "- [$sec] (${fmt.format(java.util.Date(n.time))}) ${n.text.replace(Regex("\\s+"), " ").take(per)}\n"
                if (length + line.length > limit) { append("…وملاحظات أقدم لم تُعرض."); break }
                append(line)
            }
        }
    }

    // ================= أوامر الذكاء =================

    /** أوامر تنتظر موافقة المستخدم، مربوطة برسالة الذكاء التي تعرضها. */
    val pending = mutableStateMapOf<Long, List<Planned>>()

    /** طلب فتح كتاب (من أمر «افتح كتاب…»). */
    var openBookRequest by mutableStateOf<Long?>(null)

    private suspend fun proposeActions(convId: Long, acts: List<AppAction>) {
        val all = sections
        val notes = io { repo.notes() }
        val planned = mutableListOf<Planned>()
        val problems = mutableListOf<String>()
        for (a in acts) {
            try {
                resolve(a, all, notes)?.let { planned += it } ?: problems.add("لم أفهم أحد الأوامر (${a.type}).")
            } catch (e: IllegalArgumentException) { problems += e.message ?: "أمر غير صالح." }
        }
        val body = buildString {
            if (planned.isNotEmpty()) {
                append("سأنفّذ ما يلي بعد موافقتك:")
                planned.forEach { append("\n• ").append(it.describe) }
            }
            if (problems.isNotEmpty()) {
                if (isNotEmpty()) append("\n\n")
                append("⚠️ ").append(problems.joinToString("\n⚠️ "))
            }
        }
        val msg = io { repo.addMessage(convId, "assistant", body) }
        messages += msg
        if (planned.isNotEmpty()) pending[msg.id] = planned
    }

    fun runPending(msgId: Long) {
        if (busy) return
        val list = pending.remove(msgId) ?: return
        busy = true
        scope.launch {
            try {
                val results = list.map { p ->
                    try { "✓ " + p.run() } catch (e: Throwable) { "✗ ${p.describe}: ${e.message ?: "تعذّر التنفيذ"}" }
                }
                val cid = messages.firstOrNull { it.id == msgId }?.convId ?: convId
                messages += io { repo.addMessage(cid, "assistant", results.joinToString("\n")) }
            } finally {
                busy = false
                status = ""
                refresh()
            }
        }
    }

    fun cancelPending(msgId: Long) {
        if (pending.remove(msgId) == null) return
        val cid = messages.firstOrNull { it.id == msgId }?.convId ?: convId
        scope.launch { messages += io { repo.addMessage(cid, "assistant", "أُلغي، لم يتغير شيء.") } }
    }

    private fun fail(msg: String): Nothing = throw IllegalArgumentException(msg)

    private fun findSection(name: String, all: List<Section>): Section? {
        val q = Arabic.normalize(name.substringAfterLast("←").substringAfterLast(">").trim())
        if (q.isEmpty()) return null
        fun n(s: Section) = Arabic.normalize(s.name)
        return all.firstOrNull { n(it) == q }
            ?: all.firstOrNull { n(it).removePrefix("ال") == q.removePrefix("ال") }
            ?: all.firstOrNull { n(it).length >= 2 && (n(it).contains(q) || q.contains(n(it))) }
    }

    private fun need(name: String, all: List<Section>): Section =
        findSection(name, all) ?: fail("لم أجد قسماً اسمه «$name».")

    private fun isUnder(s: Section, ancestor: Section, all: List<Section>): Boolean {
        var p = s.parentId
        var guard = 0
        while (p != 0L && guard++ < 20) {
            if (p == ancestor.id) return true
            p = all.firstOrNull { it.id == p }?.parentId ?: return false
        }
        return false
    }

    private fun matchNotes(query: String, notes: List<Note>): List<Note> {
        val q = Arabic.normalize(query.trim())
        if (q.isEmpty()) return notes
        val q2 = q.removePrefix("ال")
        return notes.filter { Arabic.normalize(it.text).let { t -> t.contains(q) || (q2.length >= 2 && t.contains(q2)) } }
    }

    /** يتحقق من الأمر ويجهّز وصفه وتنفيذه؛ يرمي رسالة عربية إن كان غير صالح. */
    private fun resolve(a: AppAction, all: List<Section>, notes: List<Note>): Planned? {
        val ctx = models.ctx
        return when (a.type) {
            "create_section" -> {
                val name = a["name"].ifBlank { fail("لم يُذكر اسم القسم الجديد.") }
                val parent = a["parent"].takeIf { it.isNotBlank() }?.let { need(it, all) }
                if (all.any { Arabic.normalize(it.name) == Arabic.normalize(name) && it.parentId == (parent?.id ?: 0L) })
                    fail("يوجد قسم اسمه «$name» في المكان نفسه.")
                Planned("إنشاء قسم «$name»" + (parent?.let { " تحت «${it.path(all)}»" } ?: "")) {
                    io { repo.addSection(name, "📘", parent?.id ?: 0L) }; "أُنشئ قسم «$name»"
                }
            }
            "rename_section" -> {
                val s = need(a["section"], all)
                val new = a["new_name"].ifBlank { fail("لم يُذكر الاسم الجديد.") }
                Planned("تغيير اسم «${s.path(all)}» إلى «$new»") { io { repo.renameSection(s.id, new) }; "صار اسمه «$new»" }
            }
            "delete_section" -> {
                val s = need(a["section"], all)
                if (all.size <= 1) fail("لا يمكن حذف القسم الوحيد.")
                val target = a["move_to"].takeIf { it.isNotBlank() }?.let { need(it, all) }
                    ?: all.firstOrNull { it.id == s.parentId }
                    ?: all.firstOrNull { it.name == "تفكير" && it.id != s.id }
                    ?: all.first { it.id != s.id }
                if (target.id == s.id) fail("لا يمكن نقل ملاحظات القسم إليه نفسه.")
                val count = notes.count { it.sectionId == s.id }
                val kids = all.count { it.parentId == s.id }
                Planned(
                    "حذف قسم «${s.path(all)}»، وتنتقل ملاحظاته ($count) إلى «${target.path(all)}»" +
                        (if (kids > 0) "، وأقسامه الفرعية ($kids) إلى القسم الأعلى" else ""),
                ) { io { repo.deleteSection(s.id, target.id, s.parentId) }; "حُذف قسم «${s.name}»" }
            }
            "move_section" -> {
                val s = need(a["section"], all)
                val parent = a["parent"].takeIf { it.isNotBlank() }?.let { need(it, all) }
                if (parent != null && (parent.id == s.id || isUnder(parent, s, all))) fail("لا يمكن وضع قسم تحت نفسه أو تحت أحد فروعه.")
                Planned(if (parent == null) "جعل «${s.name}» قسماً رئيسياً" else "نقل قسم «${s.name}» تحت «${parent.path(all)}»") {
                    io { repo.setParent(s.id, parent?.id ?: 0L) }; "نُقل قسم «${s.name}»"
                }
            }
            "move_notes" -> {
                val to = need(a["to"], all)
                val from = a["from"].takeIf { it.isNotBlank() }?.let { need(it, all) }
                if (a["query"].isBlank() && from == null) fail("حدّد أي الملاحظات تُنقل (كلمة فيها أو قسمها).")
                val ns = matchNotes(a["query"], notes.filter { (from == null || it.sectionId == from.id) && it.sectionId != to.id })
                if (ns.isEmpty()) fail("لم أجد ملاحظات تطابق «${a["query"].ifBlank { from?.name.orEmpty() }}».")
                Planned("نقل ${ns.size} ملاحظة" + (if (a["query"].isNotBlank()) " فيها «${a["query"]}»" else "") +
                    (from?.let { " من «${it.name}»" } ?: "") + " إلى «${to.path(all)}»") {
                    io { repo.moveNotes(ns.map { it.id }, to.id) }; "نُقلت ${ns.size} ملاحظة إلى «${to.name}»"
                }
            }
            "delete_notes" -> {
                // لا حذف جماعي بلا كلمة محددة، حمايةً للملاحظات
                val q = a["query"].ifBlank { fail("حدّد كلمة في الملاحظات التي تريد حذفها.") }
                val sec = a["section"].takeIf { it.isNotBlank() }?.let { need(it, all) }
                val ns = matchNotes(q, notes.filter { sec == null || it.sectionId == sec.id })
                if (ns.isEmpty()) fail("لم أجد ملاحظات فيها «$q».")
                val preview = ns.take(2).joinToString("، ") { "«${it.text.take(30)}»" }
                Planned("حذف ${ns.size} ملاحظة نهائياً فيها «$q» (مثل $preview)") {
                    io { repo.deleteNotes(ns.map { it.id }) }; "حُذفت ${ns.size} ملاحظة"
                }
            }
            "summarize_section" -> {
                val s = need(a["section"], all)
                Planned("تلخيص كتاب «${s.path(all)}»") { summarize(s) ?: "لُخّص كتاب «${s.name}»، افتحه لترى الملخص على غلافه" }
            }
            "open_book" -> {
                val s = need(a["section"], all)
                Planned("فتح كتاب «${s.path(all)}»") { openBookRequest = s.id; "فُتح كتاب «${s.name}»" }
            }
            "backup_now" -> Planned("حفظ نسخة احتياطية الآن") {
                io { Backup(ctx).runNow() }; "حُفظت النسخة الاحتياطية في مجلدها"
            }
            "bubble" -> {
                val on = when (a["on"].lowercase()) { "true", "نعم" -> true; "false", "لا" -> false; else -> null }
                val color = bubbleColor(a["color"])
                val size = when {
                    a["size"].isBlank() -> null
                    Arabic.normalize(a["size"]).contains("صغير") -> 24f
                    Arabic.normalize(a["size"]).contains("كبير") -> 64f
                    Arabic.normalize(a["size"]).contains("متوسط") -> 40f
                    else -> a["size"].filter { it.isDigit() }.toFloatOrNull()?.coerceIn(20f, 80f)
                }
                if (on == null && color == null && size == null) fail("لم أفهم ما تريد تغييره في الكرة.")
                val parts = listOfNotNull(
                    on?.let { if (it) "تشغيل الكرة العائمة" else "إيقاف الكرة العائمة" },
                    color?.let { "لونها ${a["color"]}" }, size?.let { "حجمها ${a["size"]}" },
                )
                Planned(parts.joinToString("، ")) {
                    val bp = BubblePrefs(ctx)
                    color?.let { bp.color = it }
                    size?.let { bp.size = it }
                    when (on) {
                        true -> if (!Settings.canDrawOverlays(ctx)) return@Planned "الكرة تحتاج إذن «الظهور فوق التطبيقات»؛ فعّلها مرة من صفحة النماذج"
                            else { bp.enabled = true; FloatingService.start(ctx) }
                        false -> { bp.enabled = false; FloatingService.stop(ctx) }
                        null -> if (bp.enabled && Settings.canDrawOverlays(ctx)) FloatingService.start(ctx)
                    }
                    "عُدّلت الكرة العائمة"
                }
            }
            "switch_ai" -> {
                val t = Arabic.normalize(a["target"])
                when {
                    t.contains("gemini") || t.contains("جيمين") || t.contains("جمني") -> {
                        if (models.geminiKey.isBlank()) fail("أضف مفتاح Gemini أولاً من صفحة النماذج.")
                        Planned("استخدام Gemini 🌐 للرد") { useGemini(); "صار Gemini هو من يرد" }
                    }
                    t.contains("basic") || t.contains("اساسي") || t.contains("بلا") ->
                        Planned("استخدام الوضع الأساسي (بلا نموذج)") { useModel(null); "صار الوضع الأساسي" }
                    else -> {
                        val m = installed.firstOrNull { Arabic.normalize(it.label).contains(t) || t.contains(Arabic.normalize(it.label)) }
                            ?: installed.firstOrNull { t.isNotEmpty() && Arabic.normalize(it.label).replace(" ", "").contains(t.replace(" ", "")) }
                            ?: fail("لم أجد نموذجاً مثبّتاً اسمه «${a["target"]}».")
                        Planned("استخدام ${m.label} للرد") { useModel(m); "صار ${m.label} هو من يرد" }
                    }
                }
            }
            else -> null
        }
    }

    private fun bubbleColor(name: String): Int? {
        val n = Arabic.normalize(name)
        if (n.isBlank()) return null
        return when {
            n.contains("بنفسج") -> 0xFF8B6CFF.toInt()
            n.contains("زرق") -> 0xFF4FA3FF.toInt()
            n.contains("فيروز") -> 0xFF38A89A.toInt()
            n.contains("خضر") -> 0xFF4CD17F.toInt()
            n.contains("برتقال") -> 0xFFFFB547.toInt()
            n.contains("حمر") || n.contains("مرجان") -> 0xFFFF7A6B.toInt()
            n.contains("ورد") -> 0xFFFF7AB6.toInt()
            n.contains("بيض") -> 0xFFD7DCEB.toInt()
            n.contains("رماد") -> 0xFF5E6A85.toInt()
            else -> null
        }
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

/** أمر جاهز للتنفيذ بعد موافقة المستخدم: وصفه بالعربية، وتنفيذه (يعيد نص النتيجة). */
class Planned(val describe: String, val run: suspend () -> String)
