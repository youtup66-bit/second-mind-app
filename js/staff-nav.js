// كلمات التنقل أعلى شاشات المدير: الأسماء · عقل المؤسسة · النقاط (بلا أزرار ولا مربعات)
const TABS = [['staff', 'الأسماء'], ['points', 'النقاط'], ['reports', 'التقارير']];

// تبويب "العقل" عند رئيس القسم: عرضان لعقل المؤسسة
// الأقسام: الهيكل (الشعب والوحدات والموظفون والمشاريع) · عقل المؤسسة: التصنيفات (سؤال، تفكير، قرار...)
const MIND_TABS = [['structure', 'الأقسام'], ['mind', 'عقل المؤسسة'], ['folder', 'المجلد']];
export const MIND_VIEW_KEY = 'sm-mind-view';
// sections: مسار «الأقسام» (رئيس القسم: الهيكل كله، والمسؤول: فرعه) أو null إن لم يُسمح له به
// withFolder: المجلد كلمة في التبويب (لرئيس القسم فقط)
export function mindTabs(current, sections = 'structure', withFolder = false) {
  if (current === 'structure' || current === 'mind') {
    try { localStorage.setItem(MIND_VIEW_KEY, current); } catch { /* لا شيء */ }
    window.dispatchEvent(new Event('sm:mindview'));
  }
  const tabs = MIND_TABS.map(([route, label]) => [route === 'structure' ? sections : route, label])
    .filter(([r]) => r && (r !== 'folder' || withFolder));
  if (tabs.length < 2) return '';
  return `<nav class="struct-tabs page-tabs" aria-label="عرض العقل">${tabs.map(([route, label]) =>
    (route === current ? `<b aria-current="page">${label}</b>` : `<a href="#/${route}">${label}</a>`)).join('')}</nav>`;
}

export function staffTabs(current) {
  return `<nav class="struct-tabs page-tabs" aria-label="الموظفين">${TABS.map(([route, label]) =>
    (route === current ? `<b aria-current="page">${label}</b>` : `<a href="#/${route}">${label}</a>`)).join('')}</nav>`;
}
