package app.notes.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Section(val id: Long, val name: String, val icon: String, val keywords: String, val count: Int = 0)
data class Note(val id: Long, val text: String, val sectionId: Long, val convId: Long, val time: Long)
data class Msg(val id: Long, val convId: Long, val role: String, val text: String, val time: Long)
data class Conversation(val id: Long, val title: String, val time: Long)

/** كل البيانات محفوظة على الهاتف فقط في قاعدة SQLite. */
class Db(ctx: Context) : SQLiteOpenHelper(ctx, "notes.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sections(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, icon TEXT, keywords TEXT)")
        db.execSQL("CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, section_id INTEGER, conv_id INTEGER, time INTEGER)")
        db.execSQL("CREATE TABLE conversations(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, time INTEGER)")
        db.execSQL("CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER, role TEXT, text TEXT, time INTEGER)")
        DEFAULT_SECTIONS.forEach { (name, icon, kw) ->
            db.insert("sections", null, ContentValues().apply {
                put("name", name); put("icon", icon); put("keywords", kw)
            })
        }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    companion object {
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
            "SELECT s.id, s.name, s.icon, s.keywords, (SELECT COUNT(*) FROM notes n WHERE n.section_id = s.id) FROM sections s ORDER BY s.id",
            null
        ).use { c -> while (c.moveToNext()) out += Section(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getInt(4)) }
        return out
    }

    fun addSection(name: String, icon: String): Long = db.insert("sections", null, ContentValues().apply {
        put("name", name); put("icon", icon); put("keywords", "")
    })

    fun addNote(text: String, sectionId: Long, convId: Long): Long = db.insert("notes", null, ContentValues().apply {
        put("text", text); put("section_id", sectionId); put("conv_id", convId); put("time", System.currentTimeMillis())
    })

    fun moveNote(noteId: Long, sectionId: Long) {
        db.update("notes", ContentValues().apply { put("section_id", sectionId) }, "id = ?", arrayOf(noteId.toString()))
    }

    fun deleteNote(noteId: Long) {
        db.delete("notes", "id = ?", arrayOf(noteId.toString()))
    }

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
