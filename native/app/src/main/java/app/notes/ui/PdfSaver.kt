package app.notes.ui

import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.notes.data.Pdf
import app.notes.data.ReportBlock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** محتوى تقرير ينتظر اختيار مكان حفظه. */
data class Report(val fileName: String, val title: String, val subtitle: String, val blocks: List<ReportBlock>)

/** يعيد دالة: تسأل المستخدم أين يحفظ ملف PDF، ثم تكتبه وتفتحه. */
@Composable
fun rememberPdfSaver(): (Report) -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<Report?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val r = pending
        pending = null
        if (uri == null || r == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    ctx.contentResolver.openOutputStream(uri)!!.use { Pdf.write(it, r.title, r.subtitle, r.blocks) }
                }
                Toast.makeText(ctx, "حُفظ التقرير ✓", Toast.LENGTH_SHORT).show()
                runCatching {
                    ctx.startActivity(
                        Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }
            } catch (e: Throwable) {
                Toast.makeText(ctx, "تعذّر إنشاء التقرير: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }
    return { r -> pending = r; launcher.launch(r.fileName) }
}

/** زر صغير «PDF». */
@Composable
fun PdfChip(onClick: () -> Unit) {
    Text(
        "PDF ⤓", color = Accent, fontSize = 12.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Panel2).clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

fun safeFileName(s: String) = s.replace(Regex("[\\\\/:*?\"<>|\\n]"), " ").trim().take(40).ifEmpty { "تقرير" }
