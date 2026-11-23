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

// لون الخلفية مستقل عن لون التمييز: يلوّن التدرج الخلفي للتطبيق كله
export function setBackdrop(hex) {
  if (!isHex(hex)) return clearBackdrop();
  document.documentElement.style.setProperty('--backdrop', hex);
}

export function clearBackdrop() {
  document.documentElement.style.removeProperty('--backdrop');
}

// الأدوار اللونية: كل لون يُضبط على حدة، ويُحفظ بمفتاح إعداد خاص به
export const ROLES = [
  { key: 'accent', label: 'التمييز', hint: 'الأزرار والروابط والعلامات', def: '#22c55e', setting: 'accentColor', css: ['--accent', '--accent-2', '--ok', '--wa-green'] },
  { key: 'backdrop', label: 'الخلفية', hint: 'التدرج الملوّن خلف الشاشات', def: '#22c55e', setting: 'backdropColor', css: ['--backdrop'] },
  { key: 'bg', label: 'العتمة', hint: 'لون الخلفية الداكن الأساسي', def: '#071a14', setting: 'bgColor', css: ['--bg'] },
  { key: 'bg2', label: 'الأسطح', hint: 'البطاقات والشريط العلوي', def: '#0f2e24', setting: 'bg2Color', css: ['--bg-2'] },
  { key: 'text', label: 'النص', hint: 'العناوين والنص الأساسي', def: '#ecfdf5', setting: 'textColor', css: ['--text'] },
  { key: 'orb', label: 'الكرة', hint: 'كرة الذكاء وتوهجها', def: '#4ade80', setting: 'orbColor', css: ['--orb'] },
  { key: 'icon', label: 'الأيقونات', hint: 'أيقونات القوائم الجانبية', def: '#4ade80', setting: 'iconColor', css: ['--icon-color'] },
];
export const roleOf = (key) => ROLES.find((r) => r.key === key);
export function applyRole(role, hex) {
  if (!isHex(hex)) return clearRole(role);
  role.css.forEach((p) => document.documentElement.style.setProperty(p, hex));
}
export function clearRole(role) {
  role.css.forEach((p) => document.documentElement.style.removeProperty(p));
}
// يطبّق كل الألوان المحفوظة عند فتح التطبيق
export async function applyPalette(getSetting) {
  for (const r of ROLES) {
    const v = await getSetting(r.setting, '');
    if (isHex(v)) applyRole(r, v);
  }
}
