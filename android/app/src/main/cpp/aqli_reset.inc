
// ---- إضافة أندرويد (A25): إعادة ضبط سياق المحادثة دون إعادة تحميل النموذج ----
// يُلحق هذا الملف بآخر ai_chat.cpp أثناء البناء (انظر android.yml)، ليصل إلى الدوال الساكنة فيه.
extern "C"
JNIEXPORT void JNICALL
Java_com_arm_aichat_AqliReset_reset(JNIEnv * /*env*/, jclass /*clazz*/) {
    if (g_context) reset_long_term_states(true);
}
