package app.notes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.notes.data.Msg

@Composable
fun ChatScreen(state: AppState, onModels: () -> Unit) {
    var input by remember { mutableStateOf("") }
    var showHistory by remember { mutableStateOf(false) }
    val list = rememberLazyListState()

    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) list.animateScrollToItem(state.messages.size - 1)
    }

    Column(Modifier.fillMaxSize().background(Bg).imePadding()) {
        // الشريط العلوي: السجل، اسم النموذج، محادثة جديدة
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TopIcon("☰") { showHistory = true }
            Spacer(Modifier.weight(1f))
            Surface(shape = RoundedCornerShape(50), color = Panel2, modifier = Modifier.clickable(onClick = onModels)) {
                Text(
                    "✦ ${state.engine.name} ▾",
                    color = TextMain, fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
            Spacer(Modifier.weight(1f))
            TopIcon("＋") { state.newChat() }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.messages.isNotEmpty()) {
                LazyColumn(
                    state = list,
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                ) {
                    items(state.messages, key = { it.id }) { MessageRow(it) }
                    if (state.busy) item { Text("✦ ${state.status.ifEmpty { "يفكر…" }}", color = TextDim) }
                }
            }
        }

        // صندوق الكتابة
        Row(
            Modifier.fillMaxWidth().padding(12.dp)
                .clip(RoundedCornerShape(28.dp)).background(Panel)
                .padding(start = 6.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("اكتب ما في بالك…", color = TextDim) },
                modifier = Modifier.weight(1f),
                maxLines = 5,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    focusedTextColor = TextMain,
                    unfocusedTextColor = TextMain,
                ),
            )
            val canSend = input.isNotBlank() && !state.busy
            Box(
                Modifier.size(42.dp).clip(CircleShape)
                    .background(if (canSend) Brush.linearGradient(listOf(Accent, Accent2)) else Brush.linearGradient(listOf(Panel2, Panel2)))
                    .clickable(enabled = canSend) { state.send(input); input = "" },
                contentAlignment = Alignment.Center,
            ) { Text("↑", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
        }
    }

    if (showHistory) {
        AlertDialog(
            onDismissRequest = { showHistory = false },
            containerColor = Panel,
            title = { Text("المحادثات السابقة", color = TextMain) },
            text = {
                if (state.conversations.isEmpty()) Text("لا محادثات بعد", color = TextDim)
                else LazyColumn(Modifier.height(360.dp)) {
                    items(state.conversations, key = { it.id }) { c ->
                        Text(
                            c.title, color = TextMain, maxLines = 1,
                            modifier = Modifier.fillMaxWidth()
                                .clickable { state.openChat(c.id); showHistory = false }
                                .padding(vertical = 12.dp),
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showHistory = false }) { Text("إغلاق") } },
        )
    }
}

@Composable
private fun TopIcon(glyph: String, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(glyph, color = TextMain, fontSize = 20.sp) }
}

@Composable
private fun MessageRow(m: Msg) {
    if (m.role == "user") {
        // رسالة المستخدم: فقاعة في جهة البداية
        Row(Modifier.fillMaxWidth()) {
            Surface(shape = RoundedCornerShape(20.dp), color = Panel2, modifier = Modifier.widthIn(max = 300.dp)) {
                Text(m.text, color = TextMain, fontSize = 16.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
            }
        }
    } else {
        // رد الذكاء: نص حر مع شعار صغير، كبرامج الذكاء الصناعي
        Row(Modifier.fillMaxWidth()) {
            Box(
                Modifier.padding(top = 2.dp).size(26.dp).clip(CircleShape)
                    .background(Brush.linearGradient(listOf(Accent, Accent2))),
                contentAlignment = Alignment.Center,
            ) { Text("✦", color = Color.White, fontSize = 13.sp) }
            Spacer(Modifier.width(10.dp))
            Text(m.text, color = TextMain, fontSize = 16.sp, lineHeight = 24.sp, modifier = Modifier.weight(1f))
        }
    }
}
