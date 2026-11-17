package app.notes.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.notes.ai.DownloadState
import app.notes.ai.InstalledModel
import app.notes.ai.MODEL_CATALOG
import app.notes.ai.ModelInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ModelsScreen(state: AppState) {
    val mm = state.models
    val scope = rememberCoroutineScope()
    var tick by remember { mutableIntStateOf(0) }
    var token by remember { mutableStateOf(mm.hfToken) }
    var message by remember { mutableStateOf("") }

    // تحديث نسب التنزيل كل ثانية
    var downloads by remember { mutableStateOf(mapOf<String, DownloadState>()) }
    LaunchedEffect(tick) {
        while (true) {
            val map = withContext(Dispatchers.IO) {
                MODEL_CATALOG.mapNotNull { m -> mm.downloadState(m)?.let { m.id to it } }.toMap()
            }
            val finished = downloads.keys - map.keys
            downloads = map
            if (finished.isNotEmpty()) state.refreshModels()
            delay(1000)
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            message = "جارٍ نسخ النموذج…"
            message = try {
                withContext(Dispatchers.IO) { mm.import(uri) }
                state.refreshModels(); "تم استيراد النموذج ✅"
            } catch (e: Throwable) { "تعذّر الاستيراد: ${e.message}" }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().background(Bg),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("الذكاء الصناعي على هاتفك", color = TextMain, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("يُنزَّل النموذج مرة واحدة ثم يعمل دون إنترنت، ولا يغادر كلامك الهاتف.", color = TextDim, fontSize = 13.sp)
        }

        // النماذج الموجودة على الهاتف: اختر أحدها
        item { SectionTitle("المثبّتة على الهاتف") }
        item {
            Choice(
                title = "أساسي (بلا نموذج)", sub = "يحفظ ويصنّف ويتذكّر دون ذكاء صناعي",
                selected = state.engine.name == "أساسي (بلا نموذج)", onClick = { state.useModel(null) },
            )
        }
        items(state.installed, key = { it.file.absolutePath }) { m: InstalledModel ->
            Choice(
                title = m.label, sub = "${m.file.length() / 1_000_000} ميجا",
                selected = mm.activePath == m.file.absolutePath && state.engine.name == m.label,
                onClick = { state.useModel(m) },
                trailing = { TextButton(onClick = { state.deleteModel(m.file) }) { Text("حذف", color = TextDim) } },
            )
        }

        item { SectionTitle("تنزيل نموذج") }
        items(MODEL_CATALOG, key = { it.id }) { m -> CatalogCard(state, m, downloads[m.id], onStart = {
            message = if (m.gated && token.isBlank()) "هذا النموذج يحتاج رمز HuggingFace (بالأسفل)." else {
                mm.startDownload(m); tick++; "بدأ التنزيل، ويمكنك متابعته في الإشعارات."
            }
        }, onCancel = { mm.cancelDownload(m); tick++ }) }

        item {
            SectionTitle("خيارات أخرى")
            Card {
                Text("استيراد ملف نموذج (‎.task) من الهاتف", color = TextMain)
                Text("إن نزّلته من المتصفح أو من تطبيق آخر.", color = TextDim, fontSize = 13.sp)
                TextButton(onClick = { picker.launch(arrayOf("*/*")) }) { Text("اختر ملفاً") }
            }
            Spacer(Modifier.height(12.dp))
            Card {
                Text("رمز HuggingFace (لنماذج Gemma)", color = TextMain)
                Text("اقبل ترخيص Gemma في صفحة النموذج على huggingface.co ثم أنشئ رمز قراءة. يُحفظ على الهاتف فقط.", color = TextDim, fontSize = 13.sp)
                OutlinedTextField(
                    token, { token = it; mm.hfToken = it }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (message.isNotEmpty()) item { Text(message, color = Accent2) }
    }
}

@Composable
private fun CatalogCard(state: AppState, m: ModelInfo, dl: DownloadState?, onStart: () -> Unit, onCancel: () -> Unit) {
    val have = state.installed.any { it.file.name == m.fileName }
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(m.label, color = TextMain, fontWeight = FontWeight.Bold)
                Text("${m.note}\nالحجم ≈ ${m.sizeMB} ميجا", color = TextDim, fontSize = 13.sp)
            }
            when {
                have -> Text("✓ مثبّت", color = Accent2)
                dl?.running == true -> TextButton(onClick = onCancel) { Text("إلغاء") }
                else -> TextButton(onClick = onStart) { Text(if (dl?.failed == true) "إعادة" else "تنزيل") }
            }
        }
        if (dl?.running == true) {
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(progress = { dl.percent / 100f }, modifier = Modifier.fillMaxWidth())
            Text("${dl.percent}٪", color = TextDim, fontSize = 12.sp)
        }
        if (dl?.failed == true) Text(
            if (m.gated) "فشل التنزيل. تأكد من قبول الترخيص ومن الرمز." else "فشل التنزيل. تأكد من الإنترنت وأعد المحاولة.",
            color = TextDim, fontSize = 12.sp,
        )
    }
}

@Composable
private fun SectionTitle(t: String) {
    Text(t, color = TextDim, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Panel).padding(14.dp)) { content() }
}

@Composable
private fun Choice(title: String, sub: String, selected: Boolean, onClick: () -> Unit, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Panel)
            .border(if (selected) 2.dp else 0.dp, if (selected) Accent else Panel, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (selected) "◉" else "○", color = if (selected) Accent else TextDim, fontSize = 18.sp)
        Spacer(Modifier.padding(start = 10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = TextMain)
            Text(sub, color = TextDim, fontSize = 12.sp)
        }
        trailing()
    }
}
