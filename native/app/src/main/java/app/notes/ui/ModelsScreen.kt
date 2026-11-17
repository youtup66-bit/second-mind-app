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
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import android.content.Intent
import android.net.Uri
import app.notes.ai.DownloadState
import app.notes.ai.GeminiEngine
import app.notes.data.AppVersion
import app.notes.data.Updater
import kotlinx.coroutines.CoroutineScope
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
    // القوائم المنسدلة: كلها مغلقة في البداية
    val open = remember { mutableStateMapOf<String, Boolean>() }
    var gKey by remember { mutableStateOf(mm.geminiKey) }
    var gModel by remember { mutableStateOf(mm.geminiModel) }
    val ctx = LocalContext.current
    val update = remember { UpdateUi(Updater(ctx.applicationContext), scope) }

    // تحديث نسب التنزيل كل ثانية
    var downloads by remember { mutableStateOf(mapOf<String, DownloadState>()) }
    var embedDl by remember { mutableStateOf<DownloadState?>(null) }
    LaunchedEffect(tick) {
        while (true) {
            val e = withContext(Dispatchers.IO) { mm.embedState() }
            if (embedDl != null && e == null) state.initEmbedder()
            embedDl = e
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("الذكاء الصناعي على هاتفك", color = TextMain, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Text("يُنزَّل النموذج مرة واحدة ثم يعمل دون إنترنت، ولا يغادر كلامك الهاتف.", color = TextDim, fontSize = 13.sp)
                }
                UpdateButton(update)
            }
            UpdateCard(update)
        }

        // النماذج الموجودة على الهاتف: اختر أحدها
        item { SectionTitle("المثبّتة على الهاتف", open["installed"] == true) { open["installed"] = open["installed"] != true } }
        if (open["installed"] == true) item {
            Choice(
                title = "أساسي (بلا نموذج)", sub = "يحفظ ويصنّف ويتذكّر دون ذكاء صناعي",
                selected = state.engine.name == "أساسي (بلا نموذج)", onClick = { state.useModel(null) },
            )
        }
        if (open["installed"] == true) items(state.installed, key = { it.file.absolutePath }) { m: InstalledModel ->
            Choice(
                title = m.label, sub = "${m.file.length() / 1_000_000} ميجا",
                selected = mm.activePath == m.file.absolutePath && state.engine.name == m.label,
                onClick = { state.useModel(m) },
                trailing = { TextButton(onClick = { state.deleteModel(m.file) }) { Text("حذف", color = TextDim) } },
            )
        }

        item { SectionTitle("على الإنترنت (Gemini)", open["online"] == true) { open["online"] = open["online"] != true } }
        if (open["online"] == true) item {
            Choice(
                title = "Gemini 🌐", sub = if (gKey.isBlank()) "أدخل المفتاح بالأسفل أولاً" else "ذكاء Google على الإنترنت",
                selected = state.usingGemini,
                onClick = { if (!state.useGemini()) message = "أدخل مفتاح Gemini أولاً." },
            )
            Spacer(Modifier.height(12.dp))
            Card {
                Text("مفتاح Gemini", color = TextMain)
                Text("مجاني من Google AI Studio. يُحفظ على هاتفك فقط ويُرسل إلى Google وحدها.", color = TextDim, fontSize = 13.sp)
                OutlinedTextField(
                    gKey, { gKey = it; mm.geminiKey = it; if (state.usingGemini) state.useGemini() }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                TextButton(onClick = {
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://aistudio.google.com/apikey")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }) { Text("احصل على مفتاح مجاني ↗") }

                Spacer(Modifier.height(8.dp))
                Text("النموذج", color = TextMain)
                listOf(
                    GeminiEngine.MODEL_FLASH to "Flash — الأذكى",
                    GeminiEngine.MODEL_LITE to "Flash-Lite — أسرع وحصته المجانية أكبر",
                ).forEach { (id, label) ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                            .clickable { gModel = id; mm.geminiModel = id; if (state.usingGemini) state.useGemini() }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(if (gModel == id) "◉" else "○", color = if (gModel == id) Accent else TextDim)
                        Spacer(Modifier.size(10.dp))
                        Text(label, color = TextMain, fontSize = 14.sp)
                    }
                }

                Spacer(Modifier.height(8.dp))
                Text(
                    "🔒 الخصوصية: مع Gemini تُرسل إلى Google رسائل المحادثة الأخيرة، وأقرب ملاحظاتك صلة بها، وما تطلب تصنيفه أو تلخيصه. " +
                        "في المستوى المجاني قد تستخدم Google البيانات لتحسين خدماتها. للخصوصية الكاملة اختر نموذجاً على الهاتف.",
                    color = TextDim, fontSize = 12.sp,
                )
            }
        }

        item { SectionTitle("الفهم بالمعنى", open["embed"] == true) { open["embed"] = open["embed"] != true } }
        if (open["embed"] == true) item {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("نموذج الفهم (MiniLM متعدد اللغات)", color = TextMain, fontWeight = FontWeight.Bold)
                        Text(
                            "يربط الملاحظات المتشابهة في المعنى حتى لو اختلفت كلماتها، ويحسّن تذكّر المساعد. يعمل على الهاتف دون إنترنت.\nالحجم ≈ ١٣٠ ميجا",
                            color = TextDim, fontSize = 13.sp,
                        )
                    }
                    val dl = embedDl
                    when {
                        dl?.running == true -> TextButton(onClick = { mm.deleteEmbed(); tick++ }) { Text("إلغاء") }
                        state.embedReady || mm.embedReady() -> TextButton(onClick = { state.deleteEmbedder(); tick++ }) { Text("حذف", color = TextDim) }
                        else -> TextButton(onClick = { mm.startEmbedDownload(); tick++ }) { Text(if (dl?.failed == true) "إعادة" else "تنزيل") }
                    }
                }
                embedDl?.let { dl ->
                    if (dl.running) {
                        Spacer(Modifier.height(8.dp))
                        LinearProgressIndicator(progress = { dl.percent / 100f }, modifier = Modifier.fillMaxWidth())
                        Text("${dl.percent}٪", color = TextDim, fontSize = 12.sp)
                    }
                    if (dl.failed) Text("فشل التنزيل. تأكد من الإنترنت وأعد المحاولة.", color = TextDim, fontSize = 12.sp)
                }
                if (state.embedStatus.isNotEmpty()) Text(state.embedStatus, color = Accent2, fontSize = 13.sp)
            }
        }

        item { SectionTitle("تنزيل نموذج", open["catalog"] == true) { open["catalog"] = open["catalog"] != true } }
        if (open["catalog"] == true) items(MODEL_CATALOG, key = { it.id }) { m -> CatalogCard(state, m, downloads[m.id], onStart = {
            message = if (m.gated && token.isBlank()) "هذا النموذج يحتاج رمز HuggingFace (بالأسفل)." else {
                mm.startDownload(m); tick++; "بدأ التنزيل، ويمكنك متابعته في الإشعارات."
            }
        }, onCancel = { mm.cancelDownload(m); tick++ }) }

        item { SectionTitle("خيارات أخرى", open["other"] == true) { open["other"] = open["other"] != true } }
        if (open["other"] == true) item {
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

/** عنوان قائمة منسدلة: تنفتح وتنغلق بالضغط على السهم. */
@Composable
private fun SectionTitle(t: String, expanded: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onToggle)
            .padding(top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(t, color = TextMain, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Icon(
            Icons.Filled.KeyboardArrowDown,
            contentDescription = if (expanded) "إغلاق" else "فتح",
            tint = TextDim,
            modifier = Modifier.size(26.dp).rotate(if (expanded) 180f else 0f),
        )
    }
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

/** حالة زر تحديث التطبيق. */
class UpdateUi(private val up: Updater, private val scope: CoroutineScope) {
    var busy by mutableStateOf(false)
    var text by mutableStateOf("")
    var available by mutableStateOf<AppVersion?>(null)
    var progress by mutableIntStateOf(-1)

    fun check() {
        if (busy) return
        busy = true; text = "يبحث عن تحديث…"; available = null
        scope.launch {
            text = try {
                val cur = up.current()
                val last = up.latest()
                if (last.code > cur.code) { available = last; "نسخة جديدة ${last.versionLabel()} متاحة (لديك ${cur.name})" }
                else "أنت على آخر نسخة (${cur.name}) ✓"
            } catch (e: Throwable) { "تعذّر البحث عن تحديث. تأكد من الإنترنت." }
            busy = false
        }
    }

    fun install() {
        if (busy) return
        if (!up.canInstall()) {
            text = "اسمح للتطبيق بتثبيت التحديثات، ثم ارجع واضغط «تنزيل وتثبيت» مرة أخرى."
            up.openInstallPermission(); return
        }
        busy = true; progress = 0; text = "ينزّل التحديث…"
        scope.launch {
            try {
                val apk = up.download { progress = it }
                text = "اضغط «تحديث» في نافذة أندرويد. ملاحظاتك تبقى كما هي."
                up.install(apk)
            } catch (e: Throwable) { text = "فشل تنزيل التحديث: ${e.message ?: ""}" }
            progress = -1; busy = false
        }
    }

    private fun AppVersion.versionLabel() = name
}

@Composable
private fun UpdateButton(u: UpdateUi) {
    val spin = rememberInfiniteTransition(label = "spin")
    val angle by spin.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "a")
    androidx.compose.foundation.layout.Box(
        Modifier.size(44.dp).clip(CircleShape).background(Panel2).clickable { u.check() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.Refresh, contentDescription = "تحديث التطبيق", tint = TextMain,
            modifier = Modifier.size(24.dp).rotate(if (u.busy && u.progress < 0) angle else 0f),
        )
    }
}

@Composable
private fun UpdateCard(u: UpdateUi) {
    if (u.text.isEmpty()) return
    Spacer(Modifier.height(10.dp))
    Card {
        Text(u.text, color = TextMain, fontSize = 14.sp)
        if (u.progress >= 0) {
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(progress = { u.progress / 100f }, modifier = Modifier.fillMaxWidth())
            Text("${u.progress}٪", color = TextDim, fontSize = 12.sp)
        }
        if (u.available != null && !u.busy) TextButton(onClick = { u.install() }) { Text("تنزيل وتثبيت") }
    }
}
