package app.notes

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.core.app.ServiceCompat
import kotlin.math.abs

/** إعدادات الكرة العائمة (محفوظة على الهاتف). */
class BubblePrefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("bubble", Context.MODE_PRIVATE)
    var enabled: Boolean
        get() = p.getBoolean("enabled", false)
        set(v) = p.edit().putBoolean("enabled", v).apply()
    /** قطر الكرة بوحدة dp. */
    var size: Float
        get() = p.getFloat("size", 52f)
        set(v) = p.edit().putFloat("size", v).apply()
    /** قوة الهالة المضيئة من 0 (بلا) إلى 1. */
    var glow: Float
        get() = p.getFloat("glow", 0.6f)
        set(v) = p.edit().putFloat("glow", v).apply()
    var x: Int
        get() = p.getInt("x", 0)
        set(v) = p.edit().putInt("x", v).apply()
    var y: Int
        get() = p.getInt("y", 400)
        set(v) = p.edit().putInt("y", v).apply()
}

/** رسم الكرة: قلب متدرج بنفسجي/أزرق وحوله هالة مضيئة قابلة للضبط. */
class BubbleView(ctx: Context) : View(ctx) {
    var glow = 0.6f
        set(v) { field = v; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val core = width / 2f / GLOW_SPACE
        if (glow > 0.01f) {
            val a = (glow * 170).toInt().coerceIn(0, 255)
            paint.shader = RadialGradient(
                cx, cy, width / 2f,
                intArrayOf(Color.argb(a, 139, 108, 255), Color.argb(a / 2, 79, 163, 255), Color.TRANSPARENT),
                floatArrayOf(core / (width / 2f), 0.7f, 1f), Shader.TileMode.CLAMP,
            )
            canvas.drawCircle(cx, cy, width / 2f, paint)
        }
        paint.shader = RadialGradient(
            cx - core * 0.3f, cy - core * 0.3f, core * 1.3f,
            intArrayOf(Color.rgb(196, 182, 255), Color.rgb(139, 108, 255), Color.rgb(79, 120, 230)),
            floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP,
        )
        canvas.drawCircle(cx, cy, core, paint)
        paint.shader = null
        paint.color = Color.argb(200, 255, 255, 255)
        canvas.drawCircle(cx - core * 0.35f, cy - core * 0.35f, core * 0.16f, paint)
    }

    companion object {
        /** مساحة الهالة: عرض المنظر = قطر الكرة × هذا الرقم. */
        const val GLOW_SPACE = 1.8f
    }
}

/** خدمة تُبقي الكرة فوق التطبيقات (تحتاج إذن «الظهور فوق التطبيقات»). */
class FloatingService : Service() {
    private var view: BubbleView? = null
    private var params: WindowManager.LayoutParams? = null
    private val wm by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
    private val prefs by lazy { BubblePrefs(this) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) prefs.enabled = false
        if (intent?.action == ACTION_STOP || !Settings.canDrawOverlays(this)) {
            removeBubble(); stopSelf(); return START_NOT_STICKY
        }
        startInForeground()
        if (view == null) addBubble() else applySettings()
        return START_STICKY
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "الكرة العائمة", NotificationManager.IMPORTANCE_MIN))
        val stop = PendingIntent.getService(
            this, 1, Intent(this, FloatingService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setContentTitle("الكرة العائمة تعمل")
            .setContentText("اضغطها لتفتح ملاحظاتك")
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), "إيقاف", stop).build())
            .setOngoing(true)
            .build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIF_ID, notif, type)
    }

    private fun sidePx(): Int = (prefs.size * BubbleView.GLOW_SPACE * resources.displayMetrics.density).toInt()

    @SuppressLint("ClickableViewAccessibility")
    private fun addBubble() {
        val v = BubbleView(this).apply { glow = prefs.glow }
        val side = sidePx()
        val lp = WindowManager.LayoutParams(
            side, side,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = prefs.x; y = prefs.y
        }
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        v.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; moved = false; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (abs(dx) > 12 || abs(dy) > 12) moved = true
                    if (moved) { lp.x = startX + dx.toInt(); lp.y = startY + dy.toInt(); wm.updateViewLayout(v, lp) }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) { prefs.x = lp.x; prefs.y = lp.y }
                    else startActivity(Intent(this, QuickActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    true
                }
                else -> false
            }
        }
        wm.addView(v, lp)
        view = v; params = lp
    }

    private fun applySettings() {
        val v = view ?: return
        val lp = params ?: return
        v.glow = prefs.glow
        lp.width = sidePx(); lp.height = sidePx()
        wm.updateViewLayout(v, lp)
    }

    private fun removeBubble() {
        view?.let { runCatching { wm.removeView(it) } }
        view = null; params = null
    }

    override fun onDestroy() { removeBubble(); super.onDestroy() }

    companion object {
        private const val CHANNEL = "bubble"
        private const val NOTIF_ID = 7
        const val ACTION_STOP = "stop"

        /** تشغيل الكرة أو تحديث حجمها وهالتها. */
        fun start(ctx: Context) {
            ctx.startForegroundService(Intent(ctx, FloatingService::class.java))
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, FloatingService::class.java))
        }
    }
}
