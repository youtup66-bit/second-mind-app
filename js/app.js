// الموجّه البسيط بين الشاشات
// المدير: عقل المؤسسة، والمنشورات، والموظفون (مع النقاط)، والإعدادات
// الموظف: المنشورات والإعدادات فقط
import * as settings from './screens/settings.js';
import * as org from './screens/org.js';
import * as staff from './screens/staff.js';
import * as group from './screens/group.js';
import * as structure from './screens/structure.js';
import * as points from './screens/points.js';
import { scanSoon } from './points.js';
import { startGroupSync, groupEvents, unreadCount } from './group.js';
import { autoSnapshot } from './backup.js';
import { getSetting } from './storage.js';

const routes = { settings, org, join: org, staff, group, structure, points };
// الشاشات المسموحة لكل دور (والصلاحية الفعلية تفرضها قواعد Firebase)
const ALLOWED = {
  manager: new Set(['structure', 'group', 'staff', 'points', 'settings', 'org', 'join']),
  employee: new Set(['group', 'settings', 'org', 'join']),
  none: new Set(['org', 'join', 'settings']),
};
const HOME = { manager: 'structure', employee: 'group', none: 'org' };
const app = document.getElementById('app');
const titleEl = document.getElementById('screen-title');

let role = null;
let current = null;
let navId = 0;

async function navigate() {
  const myNav = ++navId;
  const r = role || 'none';
  let name = location.hash.replace(/^#\//, '').split('?')[0];
  if (!routes[name] || !ALLOWED[r].has(name)) {
    name = HOME[r];
    if (location.hash !== `#/${name}`) { history.replaceState(null, '', `#/${name}`); }
  }
  const screen = routes[name];

  current?.unmount?.();
  // كل شاشة تحصل على حاوية خاصة، فلا تتداخل شاشة بطيئة مع التالية
  const view = document.createElement('div');
  view.className = 'view';
  app.replaceChildren(view);
  titleEl.textContent = screen.title;
  document.body.classList.toggle('on-group', screen === group);
  document.title = `${screen.title} · عقلي الثاني`;

  const tabOf = { join: 'org', points: 'staff' };
  document.querySelectorAll('.tabbar__item').forEach((a) => {
    const active = a.dataset.route === (tabOf[name] || name);
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  current = screen;
  await screen.mount(view);
  if (myNav !== navId && current !== screen) screen.unmount?.();
}

// ---- تثبيت التطبيق: المتصفح يعرض فرصة التثبيت مرة عند الفتح، نحتفظ بها لزر "ثبّت التطبيق" ----
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event('sm:installable'));
});
window.addEventListener('appinstalled', () => { window.__installPrompt = null; });

// ---- الدور: يحدد التبويبات الظاهرة ----
function applyRole(next, { renavigate = true } = {}) {
  const changed = next !== role;
  role = next || null;
  const show = { structure: role === 'manager', group: !!role, staff: role === 'manager', settings: true };
  document.querySelectorAll('.tabbar__item').forEach((a) => { a.hidden = !show[a.dataset.route]; });
  // عضو في المؤسسة: نستلم المنشورات ما دام التطبيق مفتوحاً، في أي شاشة
  if (role) startGroupSync().then(() => { refreshBadge(); if (role === 'manager') scanSoon(); }).catch(() => {});
  if (changed && renavigate && current) navigate();
}

// عدد المنشورات غير المقروءة على التبويب
async function refreshBadge() {
  const badge = document.querySelector('.tabbar__item[data-route="group"] .tabbar__badge');
  if (!badge) return;
  const n = await unreadCount().catch(() => 0);
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = !n;
}
groupEvents.addEventListener('message', refreshBadge);
groupEvents.addEventListener('seen', refreshBadge);

window.addEventListener('sm:setting', (e) => {
  if (e.detail.key === 'orgRole') applyRole(e.detail.value);
});

// ألوان واتساب دائماً
document.body.classList.add('theme-wa', 'no-companion');
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#202c33');

window.addEventListener('hashchange', navigate);
(async () => {
  applyRole(await getSetting('orgRole', null), { renavigate: false });
  await navigate();
})().finally(() => { window.__appReady = true; });

// أي خطأ غير متوقع يظهر كشريط صغير بدل أن يتعطل التطبيق بصمت
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast', role: 'alert' });
    el.addEventListener('click', () => el.remove());
    document.body.append(el);
  }
  el.textContent = `حدث خطأ: ${msg} (المس للإغلاق)`;
}
window.addEventListener('error', (e) => { if (e.message) toast(e.message); });
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || String(e.reason)));

// لقطة يومية للهيكل والنقاط على الجهاز (لا شيء يغادره)
autoSnapshot().catch((err) => console.warn('snapshot:', err));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW:', err));
  });
}
