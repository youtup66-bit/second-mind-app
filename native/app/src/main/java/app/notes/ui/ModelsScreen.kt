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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import android.Manifest
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import app.notes.BubblePrefs
import app.notes.FloatingService
import app.notes.ai.DownloadState
import app.notes.data.Backup
import java.text.SimpleDateFormat
import java.util.Locale
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

    // الكرة العائمة
    val bubble = remember { BubblePrefs(ctxApp(state)) }
    var bubbleOn by remember { mutableStateOf(bubble.enabled && Settings.canDrawOverlays(ctxApp(state))) }
    var bubbleSize by remember { mutableStateOf(bubble.size) }
    var bubbleGlow by remember { mutableStateOf(bubble.glow) }
    var bubbleColor by remember { mutableStateOf(bubble.color) }
    var bubbleMsg by remember { mutableStateOf("") }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // النسخ الاحتياطي
    val backup = remember { Backup(ctxApp(state)) }
    var folderName by remember { mutableStateOf(runCatching { backup.folderName() }.getOrNull()) }
    var autoBackup by remember { mutableStateOf(backup.auto) }
    var lastBackup by remember { mutableStateOf(backup.lastTime) }
    var backupMsg by remember { mutableStateOf(backup.lastError.let { if (it.isEmpty()) "" else "آخر محاولة فشلت: $it" }) }
    var backupBusy by remember { mutableStateOf(false) }
    var restoreUri by remember { mutableStateOf<android.net.Uri?>(null) }
    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            backupMsg = try { backup.setFolder(uri); folderName = backup.folderName(); "" } catch (e: Throwable) { "تعذّر اختيار المجلد: ${e.message}" }
        }
    }
    val restorePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> restoreUri = uri }

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
            UpdateCard(update, onInstall = {
                if (Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                update.install()
            })
        }

        // الذكاء الصناعي: اختيار من يرد (أساسي، Gemini، أو نموذج على الهاتف)، ثم إعداد Gemini وتنزيل النماذج
        item { SectionTitle("الذكاء الصناعي", open["ai"] == true) { open["ai"] = open["ai"] != true } }
        if (open["ai"] == true) item {
            Text("اختر من يرد عليك:", color = TextDim, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            Choice(
                title = "أساسي (بلا نموذج)", sub = "يحفظ ويصنّف ويتذكّر دون ذكاء صناعي",
                selected = state.engine.name == "أساسي (بلا نموذج)", onClick = { state.useModel(null) },
            )
        }
        if (open["ai"] == true) items(state.installed, key = { it.file.absolutePath }) { m: InstalledModel ->
            Choice(
                title = m.label, sub = "${m.file.length() / 1_000_000} ميجا",
                selected = mm.activePath == m.file.absolutePath && state.engine.name == m.label,
                onClick = { state.useModel(m) },
                trailing = { TextButton(onClick = { state.deleteModel(m.file) }) { Text("حذف", color = TextDim) } },
            )
        }

        if (open["ai"] == true) item {
            Choice(
                title = "Gemini 🌐", sub = if (gKey.isBlank()) "على الإنترنت — أدخل المفتاح في «إعداد Gemini»" else "ذكاء Google على الإنترنت",
                selected = state.usingGemini,
                onClick = {
                    if (!state.useGemini()) { message = "أدخل مفتاح Gemini أولاً."; open["gemini"] = true }
                },
            )
        }
        if (open["ai"] == true) item { SubTitle("إعداد Gemini", open["gemini"] == true) { open["gemini"] = open["gemini"] != true } }
        if (open["ai"] == true && open["gemini"] == true) item {
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

        if (open["ai"] == true) item { SubTitle("تنزيل نموذج للهاتف (بلا إنترنت)", open["catalog"] == true) { open["catalog"] = open["catalog"] != true } }
        if (open["ai"] == true && open["catalog"] == true) items(MODEL_CATALOG, key = { it.id }) { m -> CatalogCard(
            state, m, downloads[m.id],
            token = token, onToken = { token = it; mm.hfToken = it },
            onStart = { mm.startDownload(m); tick++ },
            onCancel = { mm.cancelDownload(m); tick++ },
            onLink = { url -> ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) },
        ) }

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
        item { SectionTitle("الكرة العائمة", open["bubble"] == true) { open["bubble"] = open["bubble"] != true } }
        if (open["bubble"] == true) item {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("كرة فوق التطبيقات", color = TextMain, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Switch(
                        checked = bubbleOn,
                        modifier = Modifier.scale(0.8f),
                        onCheckedChange = { on ->
                            if (on && !Settings.canDrawOverlays(ctx)) {
                                bubbleMsg = "اسمح للتطبيق بـ«الظهور فوق التطبيقات»، ثم ارجع وفعّل الكرة."
                                ctx.startActivity(
                                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                                )
                            } else {
                                bubble.enabled = on; bubbleOn = on; bubbleMsg = ""
                                if (on) {
                                    if (Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                                    FloatingService.start(ctx)
                                } else FloatingService.stop(ctx)
                            }
                        },
                    )
                }
                if (bubbleMsg.isNotEmpty()) Text(bubbleMsg, color = Accent2, fontSize = 12.sp)

                // معاينة صغيرة بالحجم الحقيقي واللون والهالة
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("الحجم", color = TextDim, fontSize = 12.sp)
                        CompactSlider(bubbleSize, 20f..80f, { bubbleSize = it }) {
                            bubble.size = bubbleSize; if (bubble.enabled) FloatingService.start(ctx)
                        }
                        Text("الهالة المضيئة ${if (bubbleGlow < 0.02f) "(بلا)" else "${(bubbleGlow * 100).toInt()}٪"}", color = TextDim, fontSize = 12.sp)
                        CompactSlider(bubbleGlow, 0f..1f, { bubbleGlow = it }) {
                            bubble.glow = bubbleGlow; if (bubble.enabled) FloatingService.start(ctx)
                        }
                    }
                    Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                        BubblePreview(minOf(bubbleSize, 64f / 1.8f), bubbleGlow, Color(bubbleColor))
                    }
                }

                Text("اللون", color = TextDim, fontSize = 12.sp)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BUBBLE_COLORS.forEach { c ->
                        val on = c == bubbleColor
                        Box(
                            Modifier.size(24.dp).clip(CircleShape).background(Color(c))
                                .border(if (on) 2.dp else 0.dp, if (on) TextMain else Color.Transparent, CircleShape)
                                .clickable {
                                    bubbleColor = c; bubble.color = c
                                    if (bubble.enabled) FloatingService.start(ctx)
                                },
                        )
                    }
                }
            }
        }

        item { SectionTitle("النسخ الاحتياطي", open["backup"] == true) { open["backup"] = open["backup"] != true } }
        if (open["backup"] == true) item {
            Card {
                Text("مجلد النسخة", color = TextMain)
                Text(folderName ?: "لم يُختر مجلد بعد", color = if (folderName == null) TextDim else Accent2, fontSize = 13.sp)
                TextButton(onClick = { folderPicker.launch(null) }) { Text(if (folderName == null) "اختر المجلد" else "غيّر المجلد") }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("نسخ تلقائي كل ٢٤ ساعة", color = TextMain)
                        Text("يحدّث الملف نفسه في الخلفية حتى لو كان التطبيق مغلقاً.", color = TextDim, fontSize = 12.sp)
                    }
                    Switch(
                        checked = autoBackup,
                        enabled = folderName != null,
                        onCheckedChange = { backup.setAuto(it); autoBackup = it },
                    )
                }

                Spacer(Modifier.height(6.dp))
                Text(
                    if (lastBackup > 0) "آخر نسخة: ${backupFmt.format(java.util.Date(lastBackup))}" else "لم تُنشأ نسخة بعد",
                    color = TextDim, fontSize = 12.sp,
                )
                if (backupMsg.isNotEmpty()) Text(backupMsg, color = Accent2, fontSize = 13.sp)
                Row {
                    TextButton(enabled = folderName != null && !backupBusy, onClick = {
                        backupBusy = true; backupMsg = "جارٍ النسخ…"
                        scope.launch {
                            backupMsg = try {
                                withContext(Dispatchers.IO) { backup.runNow() }
                                lastBackup = backup.lastTime
                                "تم حفظ النسخة ✓ (${Backup.FILE_NAME})"
                            } catch (e: Throwable) { "فشل النسخ: ${e.message}" }
                            backupBusy = false
                        }
                    }) { Text("نسخ الآن") }
                    TextButton(onClick = { restorePicker.launch(arrayOf("*/*")) }) { Text("استعادة من نسخة", color = TextDim) }
                }
            }
        }

        if (message.isNotEmpty()) item { Text(message, color = Accent2) }
    }

    restoreUri?.let { uri ->
        AlertDialog(
            onDismissRequest = { restoreUri = null },
            containerColor = Panel,
            title = { Text("استعادة النسخة؟", color = TextMain) },
            text = { Text("ستُستبدل كل ملاحظاتك ومحادثاتك الحالية بما في النسخة، ثم يُعاد تشغيل التطبيق. تُحفظ القاعدة الحالية احتياطاً داخل التطبيق.", color = TextDim) },
            confirmButton = {
                TextButton(onClick = {
                    restoreUri = null
                    scope.launch {
                        try { withContext(Dispatchers.IO) { backup.restore(uri) } }
                        catch (e: Throwable) { backupMsg = "فشلت الاستعادة: ${e.message}" }
                    }
                }) { Text("استعادة") }
            },
            dismissButton = { TextButton(onClick = { restoreUri = null }) { Text("إلغاء") } },
        )
    }
}

@Composable
private fun CatalogCard(
    state: AppState, m: ModelInfo, dl: DownloadState?,
    token: String, onToken: (String) -> Unit,
    onStart: () -> Unit, onCancel: () -> Unit, onLink: (String) -> Unit,
) {
    val have = state.installed.any { it.file.name == m.fileName }
    // النماذج المقيّدة (Gemma) تحتاج رمزاً؛ تظهر الخطوات داخل البطاقة نفسها
    var askToken by remember { mutableStateOf(false) }
    val tryStart: () -> Unit = {
        if (m.gated && token.isBlank()) {
            askToken = true
        } else {
            askToken = false
            onStart()
        }
    }
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(m.label, color = TextMain, fontWeight = FontWeight.Bold)
                Text("${m.note}\nالحجم ≈ ${m.sizeMB} ميجا", color = TextDim, fontSize = 13.sp)
            }
            when {
                have -> Text("✓ مثبّت", color = Accent2)
                dl?.running == true -> TextButton(onClick = onCancel) { Text("إلغاء") }
                else -> TextButton(onClick = tryStart) { Text(if (dl?.failed == true) "إعادة" else "تنزيل") }
            }
        }
        if (dl?.running == true) {
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(progress = { dl.percent / 100f }, modifier = Modifier.fillMaxWidth())
            Text("${dl.percent}٪", color = TextDim, fontSize = 12.sp)
        }
        if (dl?.failed == true) Text(
            if (m.gated) "فشل التنزيل. غالباً لم يُقبل الترخيص بعد، أو الرمز غير صحيح (راجع الخطوات)." else "فشل التنزيل. تأكد من الإنترنت وأعد المحاولة.",
            color = TextDim, fontSize = 12.sp,
        )
        if (m.gated && !have && dl?.running != true && (askToken || dl?.failed == true)) {
            Spacer(Modifier.height(10.dp))
            Text("هذا النموذج من Google ويحتاج موافقة مرة واحدة:", color = TextMain, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Text(
                "١. افتح صفحة النموذج، وسجّل الدخول في HuggingFace (حساب مجاني)، واضغط قبول الترخيص (Acknowledge license).\n" +
                    "٢. افتح صفحة الرموز، وأنشئ رمزاً من نوع Read، وانسخه.\n" +
                    "٣. الصقه هنا واضغط «تنزيل الآن».",
                color = TextDim, fontSize = 12.sp, lineHeight = 20.sp,
            )
            Row {
                TextButton(onClick = { onLink(m.page) }) { Text("صفحة النموذج ↗", fontSize = 13.sp) }
                TextButton(onClick = { onLink("https://huggingface.co/settings/tokens") }) { Text("صفحة الرموز ↗", fontSize = 13.sp) }
            }
            OutlinedTextField(
                token, onToken, singleLine = true, placeholder = { Text("hf_…", color = TextDim) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(enabled = token.isNotBlank(), onClick = tryStart) { Text("تنزيل الآن") }
                Text("أو اختر Qwen، لا يحتاج رمزاً.", color = TextDim, fontSize = 12.sp)
            }
        }
    }
}

/** عنوان فرعي منسدل داخل قائمة. */
@Composable
private fun SubTitle(t: String, expanded: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClick = onToggle)
            .padding(start = 8.dp, top = 4.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(t, color = Accent2, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Icon(
            Icons.Filled.KeyboardArrowDown, contentDescription = if (expanded) "إغلاق" else "فتح", tint = TextDim,
            modifier = Modifier.size(22.dp).rotate(if (expanded) 180f else 0f),
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

    init {
        // تنزيل بدأ سابقاً (ولو خرجتَ من الصفحة) يُتابَع من حيث وصل
        if (up.downloadId() >= 0) watch()
    }

    fun install() {
        if (busy) return
        if (!up.canInstall()) {
            text = "اسمح للتطبيق بتثبيت التحديثات، ثم ارجع واضغط «تنزيل وتثبيت» مرة أخرى."
            up.openInstallPermission(); return
        }
        up.startDownload()
        watch()
    }

    /** متابعة التنزيل الجاري في الخلفية؛ عند انتهائه تُفتح شاشة التثبيت. */
    private fun watch() {
        busy = true; progress = 0
        text = "ينزّل التحديث… يمكنك الخروج من الصفحة أو التطبيق، وسيصلك إشعار حين يجهز."
        scope.launch {
            while (true) {
                val s = withContext(Dispatchers.IO) { up.state() }
                when {
                    s == null -> { text = ""; break }
                    s.failed -> { up.clear(); text = "فشل تنزيل التحديث. تأكد من الإنترنت وأعد المحاولة."; break }
                    s.done -> {
                        up.clear(); available = null
                        text = "اضغط «تحديث» في نافذة أندرويد. ملاحظاتك تبقى كما هي."
                        try { withContext(Dispatchers.IO) { up.install() } }
                        catch (e: Throwable) { text = "تعذّر بدء التثبيت: ${e.message}" }
                        break
                    }
                    else -> progress = s.percent
                }
                delay(1000)
            }
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
private fun UpdateCard(u: UpdateUi, onInstall: () -> Unit) {
    if (u.text.isEmpty()) return
    Spacer(Modifier.height(10.dp))
    Card {
        Text(u.text, color = TextMain, fontSize = 14.sp)
        if (u.progress >= 0) {
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(progress = { u.progress / 100f }, modifier = Modifier.fillMaxWidth())
            Text("${u.progress}٪", color = TextDim, fontSize = 12.sp)
        }
        if (u.available != null && !u.busy) TextButton(onClick = onInstall) { Text("تنزيل وتثبيت") }
    }
}

private val backupFmt = SimpleDateFormat("d MMMM yyyy · HH:mm", Locale("ar"))

private fun ctxApp(state: AppState) = state.models.ctx

@Composable
private fun BubblePreview(size: Float, glow: Float, color: Color) {
    androidx.compose.foundation.Canvas(Modifier.size((size * 1.8f).dp)) {
        val c = center
        val r = this.size.minDimension / 2f
        val core = r / 1.8f
        if (glow > 0.01f) drawCircle(
            Brush.radialGradient(
                0f to color.copy(alpha = glow * 0.67f), 0.7f to color.copy(alpha = glow * 0.25f), 1f to Color.Transparent,
                center = c, radius = r,
            ),
            radius = r, center = c,
        )
        val hl = androidx.compose.ui.geometry.Offset(core * 0.3f, core * 0.3f)
        drawCircle(
            Brush.radialGradient(listOf(lerp(color, Color.White, 0.55f), color, lerp(color, Color.Black, 0.3f)), center = c - hl, radius = core * 1.3f),
            radius = core, center = c,
        )
        drawCircle(Color.White.copy(alpha = 0.8f), radius = core * 0.16f, center = c - hl * 1.15f)
    }
}

/** منزلق نحيف صغير (من اليمين لليسار في العربية). */
@Composable
private fun CompactSlider(value: Float, range: ClosedFloatingPointRange<Float>, onChange: (Float) -> Unit, onDone: () -> Unit) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val change by rememberUpdatedState(onChange)
    val done by rememberUpdatedState(onDone)
    val active = Accent
    val track = Panel2
    val span = range.endInclusive - range.start
    androidx.compose.foundation.Canvas(
        Modifier.fillMaxWidth().height(26.dp).pointerInput(rtl) {
            fun at(x: Float) = range.start + ((if (rtl) size.width - x else x) / size.width).coerceIn(0f, 1f) * span
            awaitEachGesture {
                val d = awaitFirstDown()
                change(at(d.position.x))
                drag(d.id) { ch -> change(at(ch.position.x)); ch.consume() }
                done()
            }
        },
    ) {
        val cy = size.height / 2f
        val w = size.width
        val frac = ((value - range.start) / span).coerceIn(0f, 1f)
        val fx = if (rtl) w - frac * w else frac * w
        val stroke = 3.dp.toPx()
        drawLine(track, androidx.compose.ui.geometry.Offset(0f, cy), androidx.compose.ui.geometry.Offset(w, cy), stroke, StrokeCap.Round)
        drawLine(active, androidx.compose.ui.geometry.Offset(if (rtl) w else 0f, cy), androidx.compose.ui.geometry.Offset(fx, cy), stroke, StrokeCap.Round)
        drawCircle(active, 7.dp.toPx(), androidx.compose.ui.geometry.Offset(fx, cy))
    }
}

/** ألوان الكرة المتاحة. */
private val BUBBLE_COLORS = listOf(
    0xFF8B6CFF.toInt(), 0xFF4FA3FF.toInt(), 0xFF38A89A.toInt(), 0xFF4CD17F.toInt(), 0xFFFFB547.toInt(),
    0xFFFF7A6B.toInt(), 0xFFFF7AB6.toInt(), 0xFFD7DCEB.toInt(), 0xFF5E6A85.toInt(),
)
