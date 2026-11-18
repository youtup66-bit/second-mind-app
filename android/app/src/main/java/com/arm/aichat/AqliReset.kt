package com.arm.aichat

// دالة إضافية لتطبيق عقلي الثاني: تمسح سجل المحادثة وذاكرة السياق في المحرك الأصلي
// دون إعادة تحميل النموذج. تُنفَّذ في الكود الأصلي المُلحق بـ ai_chat.cpp (aqli_reset.inc).
object AqliReset {
    init {
        System.loadLibrary("ai-chat")
    }

    @JvmStatic
    external fun reset()
}
