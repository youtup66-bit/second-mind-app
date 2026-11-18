package app.aqli

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

// تنزيل ملف النموذج إلى مكانه النهائي، مع استئناف من ملف .part إن انقطع التنزيل سابقاً
object ModelFiles {

    // تنزيل واحد في كل مرة، حتى لا يكتب تنزيلان على ملف .part نفسه؛ الثاني يجد الملف جاهزاً فيخرج
    // onProgress(تم تنزيله، الإجمالي أو -1 إن كان مجهولاً)
    fun fetch(url: String, target: File, onProgress: (Long, Long) -> Unit) = synchronized(this) {
        fetchOne(url, target, onProgress)
    }

    private fun fetchOne(url: String, target: File, onProgress: (Long, Long) -> Unit) {
        if (target.isFile && target.length() > 0) return
        val part = File(target.path + ".part")
        val have = if (part.exists()) part.length() else 0L

        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 30_000
            readTimeout = 60_000
            instanceFollowRedirects = true
            if (have > 0) setRequestProperty("Range", "bytes=$have-")
        }
        try {
            conn.connect()
            val code = conn.responseCode
            if (code !in 200..299) throw IllegalStateException("خطأ من خادم التنزيل: $code")
            val resumed = code == HttpURLConnection.HTTP_PARTIAL
            val start = if (resumed) have else 0L
            val remaining = conn.contentLengthLong
            val total = if (remaining >= 0) start + remaining else -1L

            var done = start
            var lastReport = 0L
            conn.inputStream.use { input ->
                FileOutputStream(part, resumed).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val now = System.currentTimeMillis()
                        if (now - lastReport > 400) {
                            lastReport = now
                            onProgress(done, total)
                        }
                    }
                }
            }
            onProgress(done, total)
            if (total > 0 && part.length() != total) throw IOException("انقطع التنزيل؛ أعد المحاولة ليكمل من حيث توقف.")
            // ملفات GGUF تبدأ بالنص GGUF؛ غير ذلك يعني رداً خاطئاً من الخادم
            val magic = ByteArray(4)
            part.inputStream().use { it.read(magic) }
            if (String(magic, Charsets.US_ASCII) != "GGUF") {
                part.delete()
                throw IllegalStateException("الملف المنزّل ليس نموذجاً صالحاً.")
            }
            if (!part.renameTo(target)) throw IllegalStateException("تعذّر حفظ النموذج على الجهاز.")
        } finally {
            conn.disconnect()
        }
    }
}
