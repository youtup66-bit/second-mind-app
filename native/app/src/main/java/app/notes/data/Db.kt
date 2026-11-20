package app.notes.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Section(
    val id: Long, val name: String, val icon: String, val keywords: String, val count: Int = 0,
    /** آخر ملخص للكتاب، وعدد صفحاته وقت التلخيص. */
    val summary: String = "", val summaryCount: Int = 0,
    /** القسم الأب (0 = قسم رئيسي). */
    val parentId: Long = 0,
)

/** الاسم الكامل مع الآباء، مثل: رياضة ← جيم. */
fun Section.path(all: List<Section>): String {
    val names = mutableListOf(name)
    var p = parentId
    var guard = 0
    while (p != 0L && guard++ < 10) {
        val parent = all.firstOrNull { it.id == p } ?: break
        names.add(0, parent.name); p = parent.parentId
    }
    return names.joinToString(" ← ")
}
data class Note(val id: Long, val text: String, val sectionId: Long, val convId: Long, val time: Long)
data class Msg(val id: Long, val convId: Long, val role: String, val text: String, val time: Long)
data class Conversation(val id: Long, val title: String, val time: Long)

/** كل البيانات محفوظة على الهاتف فقط في قاعدة SQLite. */
class Db(ctx: Context) : SQLiteOpenHelper(ctx, "notes.db", null, 5) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sections(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, icon TEXT, keywords TEXT, summary TEXT DEFAULT '', summary_count INTEGER DEFAULT 0, parent_id INTEGER DEFAULT 0)")
        db.execSQL("CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, section_id INTEGER, conv_id INTEGER, time INTEGER)")
        db.execSQL("CREATE TABLE conversations(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, time INTEGER)")
        db.execSQL(EMBED_TABLE)
        db.execSQL(RELATIONS_TABLE); db.execSQL(LINKED_TABLE)
        db.execSQL("CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER, role TEXT, text TEXT, time INTEGER)")
        DEFAULT_SECTIONS.forEach { (name, icon, kw) ->
            db.insert("sections", null, ContentValues().apply {
                put("name", name); put("icon", icon); put("keywords", kw)
            })
        }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE sections ADD COLUMN summary TEXT DEFAULT ''")
            db.execSQL("ALTER TABLE sections ADD COLUMN summary_count INTEGER DEFAULT 0")
        }
        if (oldVersion < 3) db.execSQL(EMBED_TABLE)
        if (oldVersion < 4) db.execSQL("ALTER TABLE sections ADD COLUMN parent_id INTEGER DEFAULT 0")
        if (oldVersion < 5) { db.execSQL(RELATIONS_TABLE); db.execSQL(LINKED_TABLE) }
    }

    companion object {
        @Volatile private var instance: Db? = null

        /** نسخة واحدة لكل التطبيق (الواجهة والنسخ الاحتياطي في الخلفية). */
        fun get(ctx: Context): Db = instance ?: synchronized(this) {
            instance ?: Db(ctx.applicationContext).also { instance = it }
        }

        /** بصمة المعنى لكل ملاحظة (متجه أرقام). */
        /** علاقات أكدها الذكاء بين الملاحظات، مع سببها (a < b دائماً). */
        const val RELATIONS_TABLE = "CREATE TABLE relations(a INTEGER, b INTEGER, why TEXT, time INTEGER, PRIMARY KEY(a, b))"
        /** ملاحظات فحصها الذكاء بحثاً عن روابط. */
        const val LINKED_TABLE = "CREATE TABLE linked(note_id INTEGER PRIMARY KEY)"
        const val EMBED_TABLE = "CREATE TABLE embeddings(note_id INTEGER PRIMARY KEY, vec BLOB)"

        /** الأقسام الافتراضية: الاسم، الأيقونة، كلمات دالة (للتصنيف المبدئي قبل الذكاء الصناعي). */
        val DEFAULT_SECTIONS = listOf(
            Triple("مهام", "✅", "لازم يجب اعمل افعل انجز موعد اشتري ارسل اتصل غدا بكره مهمه واجب"),
            Triple("أفكار", "💡", "فكره خطر تطبيق مشروع ابتكار لو نعمل اقتراح تصميم ابداع"),
            Triple("قلق", "😟", "قلق خايف خوف متوتر توتر مشكله ضغط حزين زعلان تعبان"),
            Triple("تفكير", "🤔", "افكر اتساءل ربما يمكن احس اشعر معنى لماذا"),
            Triple("ذكريات", "📷", "تذكرت ذكرى زمان كنت طفولتي امس يوم سافرت"),
            Triple("امتنان", "🙏", "شكرا الحمد ممتن سعيد فرحان جميل نعمه"),
            Triple("أحلام", "🌙", "حلمت حلم نمت منام الليله"),
            Triple("قرارات", "⚖️", "قررت قرار ساختار اخترت سابدا ساتوقف"),
            Triple("أسئلة", "❓", "كيف متى اين هل ماذا من سؤال"),
        )
    }
}

class Repo(private val helper: Db) {
    private val db get() = helper.writableDatabase

    fun sections(): List<Section> {
        val out = mutableListOf<Section>()
        db.rawQuery(
            "SELECT s.id, s.name, s.icon, s.keywords, (SELECT COUNT(*) FROM notes n WHERE n.section_id = s.id), s.summary, s.summary_count, s.parent_id FROM sections s ORDER BY s.id",
            null
        ).use { c -> while (c.moveToNext()) out += Section(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getInt(4), c.getString(5) ?: "", c.getInt(6), c.getLong(7)) }
        return out
    }

    fun addSection(name: String, icon: String, parentId: Long = 0): Long = db.insert("sections", null, ContentValues().apply {
        put("name", name); put("icon", icon); put("keywords", ""); put("parent_id", parentId)
    })

    fun renameSection(id: Long, name: String) {
        db.update("sections", ContentValues().apply { put("name", name) }, "id = ?", arrayOf(id.toString()))
    }

    fun setParent(id: Long, parentId: Long) {
        db.update("sections", ContentValues().apply { put("parent_id", parentId) }, "id = ?", arrayOf(id.toString()))
    }

    /** حذف قسم: تنتقل ملاحظاته إلى [moveTo]، وأقسامه الفرعية إلى أبيه. لا تُحذف أي ملاحظة. */
    fun deleteSection(id: Long, moveTo: Long, parentOfDeleted: Long) {
        db.beginTransaction()
        try {
            db.update("notes", ContentValues().apply { put("section_id", moveTo) }, "section_id = ?", arrayOf(id.toString()))
            db.update("sections", ContentValues().apply { put("parent_id", parentOfDeleted) }, "parent_id = ?", arrayOf(id.toString()))
            db.delete("sections", "id = ?", arrayOf(id.toString()))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun moveNotes(ids: List<Long>, to: Long) = ids.forEach { moveNote(it, to) }

    fun deleteNotes(ids: List<Long>) = ids.forEach { deleteNote(it) }

    fun setSummary(sectionId: Long, summary: String, count: Int) {
        db.update("sections", ContentValues().apply { put("summary", summary); put("summary_count", count) }, "id = ?", arrayOf(sectionId.toString()))
    }

    fun addNote(text: String, sectionId: Long, convId: Long): Long = db.insert("notes", null, ContentValues().apply {
        put("text", text); put("section_id", sectionId); put("conv_id", convId); put("time", System.currentTimeMillis())
    })

    fun moveNote(noteId: Long, sectionId: Long) {
        db.update("notes", ContentValues().apply { put("section_id", sectionId) }, "id = ?", arrayOf(noteId.toString()))
    }

    fun deleteNote(noteId: Long) {
        db.delete("notes", "id = ?", arrayOf(noteId.toString()))
        db.delete("embeddings", "note_id = ?", arrayOf(noteId.toString()))
        clearRelations(noteId)
    }

    /** تعديل نص ملاحظة (وقسمها اختيارياً)؛ تُحذف بصمة المعنى القديمة لتُحسب من جديد. */
    // ---- روابط الذكاء ----
    fun addRelation(r: app.notes.ai.Relation) {
        val (a, b) = if (r.a < r.b) r.a to r.b else r.b to r.a
        db.insertWithOnConflict("relations", null, ContentValues().apply {
            put("a", a); put("b", b); put("why", r.why); put("time", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun relations(): List<app.notes.ai.Relation> {
        val out = mutableListOf<app.notes.ai.Relation>()
        db.rawQuery("SELECT a, b, why FROM relations", null).use { c ->
            while (c.moveToNext()) out += app.notes.ai.Relation(c.getLong(0), c.getLong(1), c.getString(2) ?: "")
        }
        return out
    }

    fun clearRelations(noteId: Long) {
        db.delete("relations", "a = ? OR b = ?", arrayOf(noteId.toString(), noteId.toString()))
        db.delete("linked", "note_id = ?", arrayOf(noteId.toString()))
    }

    fun markLinked(noteId: Long) {
        db.insertWithOnConflict("linked", null, ContentValues().apply { put("note_id", noteId) }, SQLiteDatabase.CONFLICT_IGNORE)
    }

    /** ملاحظات لم يفحصها الذكاء بعد (الأحدث أولاً). */
    fun unlinkedNotes(): List<Note> {
        val out = mutableListOf<Note>()
        db.rawQuery(
            "SELECT id, text, section_id, conv_id, time FROM notes WHERE id NOT IN (SELECT note_id FROM linked) ORDER BY time DESC",
            null,
        ).use { c -> while (c.moveToNext()) out += Note(c.getLong(0), c.getString(1), c.getLong(2), c.getLong(3), c.getLong(4)) }
        return out
    }

    fun updateNote(noteId: Long, text: String, sectionId: Long? = null) {
        clearRelations(noteId)
        db.update("notes", ContentValues().apply {
            put("text", text); if (sectionId != null) put("section_id", sectionId)
        }, "id = ?", arrayOf(noteId.toString()))
        db.delete("embeddings", "note_id = ?", arrayOf(noteId.toString()))
    }

    /** الملاحظة المحفوظة من رسالة في محادثة. */
    fun findNote(convId: Long, text: String): Long? =
        db.rawQuery("SELECT id FROM notes WHERE conv_id = ? AND text = ? ORDER BY id DESC LIMIT 1", arrayOf(convId.toString(), text))
            .use { c -> if (c.moveToFirst()) c.getLong(0) else null }

    fun updateMessage(id: Long, text: String) {
        db.update("messages", ContentValues().apply { put("text", text) }, "id = ?", arrayOf(id.toString()))
    }

    fun deleteMessage(id: Long) { db.delete("messages", "id = ?", arrayOf(id.toString())) }

    fun saveVector(noteId: Long, v: FloatArray) {
        val buf = java.nio.ByteBuffer.allocate(v.size * 4).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        v.forEach { buf.putFloat(it) }
        db.insertWithOnConflict("embeddings", null, ContentValues().apply {
            put("note_id", noteId); put("vec", buf.array())
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun vectors(): Map<Long, FloatArray> {
        val out = HashMap<Long, FloatArray>()
        db.rawQuery("SELECT note_id, vec FROM embeddings", null).use { c ->
            while (c.moveToNext()) {
                val b = java.nio.ByteBuffer.wrap(c.getBlob(1)).order(java.nio.ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
                out[c.getLong(0)] = FloatArray(b.remaining()).also { b.get(it) }
            }
        }
        return out
    }

    /** ملاحظات بلا بصمة معنى بعد (لفهرستها). */
    fun notesWithoutVector(): List<Note> {
        val out = mutableListOf<Note>()
        db.rawQuery(
            "SELECT id, text, section_id, conv_id, time FROM notes WHERE id NOT IN (SELECT note_id FROM embeddings) ORDER BY time DESC",
            null,
        ).use { c -> while (c.moveToNext()) out += Note(c.getLong(0), c.getString(1), c.getLong(2), c.getLong(3), c.getLong(4)) }
        return out
    }

    fun clearVectors() { db.delete("embeddings", null, null) }

    fun notes(sectionId: Long? = null): List<Note> {
        val out = mutableListOf<Note>()
        val (where, args) = if (sectionId == null) "" to null else "WHERE section_id = ?" to arrayOf(sectionId.toString())
        db.rawQuery("SELECT id, text, section_id, conv_id, time FROM notes $where ORDER BY time", args).use { c ->
            while (c.moveToNext()) out += Note(c.getLong(0), c.getString(1), c.getLong(2), c.getLong(3), c.getLong(4))
        }
        return out
    }

    fun newConversation(title: String): Long = db.insert("conversations", null, ContentValues().apply {
        put("title", title); put("time", System.currentTimeMillis())
    })

    fun conversations(): List<Conversation> {
        val out = mutableListOf<Conversation>()
        db.rawQuery("SELECT id, title, time FROM conversations ORDER BY time DESC", null).use { c ->
            while (c.moveToNext()) out += Conversation(c.getLong(0), c.getString(1), c.getLong(2))
        }
        return out
    }

    fun addMessage(convId: Long, role: String, text: String): Msg {
        val time = System.currentTimeMillis()
        val id = db.insert("messages", null, ContentValues().apply {
            put("conv_id", convId); put("role", role); put("text", text); put("time", time)
        })
        db.update("conversations", ContentValues().apply { put("time", time) }, "id = ?", arrayOf(convId.toString()))
        return Msg(id, convId, role, text, time)
    }

    fun messages(convId: Long): List<Msg> {
        val out = mutableListOf<Msg>()
        db.rawQuery("SELECT id, conv_id, role, text, time FROM messages WHERE conv_id = ? ORDER BY id", arrayOf(convId.toString())).use { c ->
            while (c.moveToNext()) out += Msg(c.getLong(0), c.getLong(1), c.getString(2), c.getString(3), c.getLong(4))
        }
        return out
    }
}
