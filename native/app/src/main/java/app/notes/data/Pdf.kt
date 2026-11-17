package app.notes.data

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** فقرة في التقرير: عنوان اختياري ونص. */
data class ReportBlock(val heading: String?, val body: String)

/** صانع تقارير PDF بالعربية (من اليمين لليسار)، بصفحات A4 تُقسَّم تلقائياً. */
object Pdf {
    private const val W = 595
    private const val H = 842
    private const val M = 44

    fun write(out: OutputStream, title: String, subtitle: String, blocks: List<ReportBlock>) {
        val doc = PdfDocument()
        val titlePaint = paint(22f, bold = true, color = Color.rgb(70, 85, 168))
        val subPaint = paint(11f, color = Color.rgb(119, 126, 145))
        val headPaint = paint(13f, bold = true, color = Color.rgb(32, 36, 56))
        val bodyPaint = paint(12f, color = Color.rgb(32, 36, 56))
        val footPaint = paint(9f, color = Color.rgb(150, 150, 160))
        val width = W - 2 * M

        var pageNo = 0
        var page: PdfDocument.Page? = null
        var y = 0f

        fun newPage() {
            page?.let { doc.finishPage(it) }
            pageNo++
            page = doc.startPage(PdfDocument.PageInfo.Builder(W, H, pageNo).create())
            y = M.toFloat()
            // رقم الصفحة في الأسفل
            val foot = layout("صفحة $pageNo — عقلي (ملاحظات)", footPaint, width, Layout.Alignment.ALIGN_CENTER)
            page!!.canvas.save(); page!!.canvas.translate(M.toFloat(), (H - M / 2 - foot.height).toFloat()); foot.draw(page!!.canvas); page!!.canvas.restore()
        }

        /** يرسم النص سطراً سطراً وينقل إلى صفحة جديدة عند امتلاء الصفحة. */
        fun draw(l: StaticLayout, gapAfter: Float) {
            for (i in 0 until l.lineCount) {
                val top = l.getLineTop(i).toFloat()
                val bottom = l.getLineBottom(i).toFloat()
                if (y + (bottom - top) > H - M - 20) newPage()
                val c = page!!.canvas
                c.save()
                c.translate(M.toFloat(), y - top)
                c.clipRect(0f, top, width.toFloat(), bottom)
                l.draw(c)
                c.restore()
                y += bottom - top
            }
            y += gapAfter
        }

        newPage()
        draw(layout(title, titlePaint, width), 4f)
        draw(layout(subtitle, subPaint, width), 18f)
        for (b in blocks) {
            if (y > H - M - 80) newPage()
            b.heading?.let { draw(layout(it, headPaint, width), 4f) }
            draw(layout(b.body, bodyPaint, width), 16f)
        }
        page?.let { doc.finishPage(it) }
        doc.writeTo(out)
        doc.close()
    }

    fun now(): String = SimpleDateFormat("EEEE d MMMM yyyy · HH:mm", Locale("ar")).format(Date())

    private fun paint(size: Float, bold: Boolean = false, color: Int) = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply {
        textSize = size
        this.color = color
        typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
    }

    private fun layout(text: String, p: TextPaint, width: Int, align: Layout.Alignment = Layout.Alignment.ALIGN_NORMAL): StaticLayout =
        StaticLayout.Builder.obtain(text, 0, text.length, p, width)
            .setAlignment(align)
            .setTextDirection(TextDirectionHeuristics.FIRSTSTRONG_RTL)
            .setLineSpacing(0f, 1.35f)
            .build()
}
