package app.notes.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Bg = Color(0xFF0E0B1F)
val Panel = Color(0xFF1A1636)
val Panel2 = Color(0xFF241F4A)
val Accent = Color(0xFF8B6CFF)
val Accent2 = Color(0xFF4FA3FF)
val TextMain = Color(0xFFECE9FF)
val TextDim = Color(0xFF9C97C4)
val Paper = Color(0xFFF6EFDF)
val Ink = Color(0xFF2B2440)

@Composable
fun NotesTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Accent,
            secondary = Accent2,
            background = Bg,
            surface = Panel,
            surfaceVariant = Panel2,
            onBackground = TextMain,
            onSurface = TextMain,
            onSurfaceVariant = TextDim,
        ),
        content = content,
    )
}
