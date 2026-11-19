// المظهر الموحّد: الألوان كلها من متغيّرات :root في style.css، ولون التمييز يُضبط من الإعدادات
// ويمتد إلى كل الشاشات (الأزرار والروابط والعلامات والشريط) لأن الشاشات كلها تقرأ من المتغيّرات نفسها.
const ACCENT_VARS = ['--accent', '--accent-2', '--ok', '--wa-green'];

export const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

export function setAccent(hex) {
  if (!isHex(hex)) return clearAccent();
  ACCENT_VARS.forEach((p) => document.documentElement.style.setProperty(p, hex));
}

export function clearAccent() {
  ACCENT_VARS.forEach((p) => document.documentElement.style.removeProperty(p));
}
