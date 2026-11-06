// كلمات التنقل أعلى شاشات المدير: الأسماء · عقل المؤسسة · النقاط (بلا أزرار ولا مربعات)
const TABS = [['staff', 'الأسماء'], ['structure', 'عقل المؤسسة'], ['points', 'النقاط'], ['reports', 'التقارير']];

export function staffTabs(current) {
  return `<nav class="struct-tabs page-tabs" aria-label="الموظفين">${TABS.map(([route, label]) =>
    (route === current ? `<b aria-current="page">${label}</b>` : `<a href="#/${route}">${label}</a>`)).join('')}</nav>`;
}
