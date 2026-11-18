// تحديث الصفحة من داخل تطبيق الأندرويد (زر في الإعدادات): ينزّل الملفات المتغيّرة من النسخة التجريبية
// ويعيد تحميل التطبيق. يعمل فقط داخل الـ APK؛ في المتصفح لا يظهر الزر.
import { IS_BUNDLED } from './env.js';

const handlers = new Set();
if (typeof window !== 'undefined') {
  // التطبيق يرسل تقدم التحديث إلى هذه الدالة
  window.__aqliApp = (ev) => handlers.forEach((h) => h(ev));
}

export const canUpdateApp = () => IS_BUNDLED && !!window.AqliApp;

// الإصدار الحالي المثبّت في التطبيق
export const appVersion = () => {
  try { return window.AqliApp.version(); } catch { return ''; }
};

// يبدأ التحديث. onEvent(ev) يستقبل: start و progress و done و uptodate و error
export function startAppUpdate(onEvent) {
  handlers.add(onEvent);
  const off = () => handlers.delete(onEvent);
  try { window.AqliApp.update(); } catch (err) { onEvent({ type: 'error', message: String(err.message || err) }); off(); }
  return off;
}
