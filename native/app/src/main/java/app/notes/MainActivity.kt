package app.notes

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import app.notes.data.Db
import app.notes.data.Repo
import app.notes.ui.App
import app.notes.ui.NotesTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repo = Repo(Db.get(applicationContext))
        // إعادة الكرة العائمة إن كانت مفعّلة
        if (BubblePrefs(this).enabled && android.provider.Settings.canDrawOverlays(this)) runCatching { FloatingService.start(this) }
        setContent {
            NotesTheme {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    App(repo)
                }
            }
        }
    }
}
