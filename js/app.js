// الموجّه البسيط بين الشاشات
import * as home from './screens/home.js';
import * as mind from './screens/mind.js';
import * as folder from './screens/folder.js';
import * as settings from './screens/settings.js';
import * as org from './screens/org.js';
import * as staff from './screens/staff.js';
import * as group from './screens/group.js';
import * as structure from './screens/structure.js';
import * as points from './screens/points.js';
import * as reports from './screens/reports.js';
import { checkReminders } from './org-insights.js';
import { scanSoon } from './points.js';
import { startGroupSync, groupEvents, unreadCount } from './group.js';
import { autoSnapshot } from './backup.js';
import { getSetting } from './storage.js';
import { loadCategories } from './categories.js';

const routes = { home, mind, folder, settings, org, join: org, staff, group, structure, points, reports };
const app = document.getElementById('app');
const titleEl = document.getElementById('screen-title');

let current = null;
let navId = 0;

// الموظف: منشورات الأعمال والإعدادات فقط (لا عقل ولا رفيقة ولا ذكاء)
const EMPLOYEE_ROUTES = new Set(['group', 'settings', 'org', 'join']);
let role = null;

async function navigate() {
  const myNav = ++navId;
  let name = location.hash.replace(/^#\//, '').split('?')[0] || (role === 'employee' ? 'group' : 'home');
  if (role === 'employee' && !EMPLOYEE_ROUTES.has(name)) {
    name = 'group';
    history.replaceState(null, '', '#/group');
  }
  const screen = routes[name] || home;

  current?.unmount?.();
  // كل شاشة تحصل على حاوية خاصة، فلا تتداخل شاشة بطيئة مع التالية
  const view = document.createElement('div');
  view.className = 'view';
  app.replaceChildren(view);
  titleEl.textContent = screen.title;
  document.body.classList.toggle('on-home', screen === home);
  document.body.classList.toggle('on-group', screen === group);
  document.body.classList.toggle('on-structure', screen === structure);
  document.body.classList.toggle('on-mind', screen === mind);
  document.body.classList.toggle('on-staffnav', screen === staff || screen === points || screen === reports);
  document.title = `${screen.title} · عقلي الثاني`;

  document.querySelectorAll('.tabbar__item').forEach((a) => {
    const tabOf = { join: 'org', structure: 'staff', points: 'staff', reports: 'staff' };
    const active = a.dataset.route === (tabOf[name] || (routes[name] ? name : 'home'));
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  current = screen;
  floaterRoute = routes[name] ? name : 'home';
  syncFloater();
  await screen.mount(view);
  // إن انتقل المستخدم لشاشة أخرى أثناء التحميل نُنهي هذه
  if (myNav !== navId && current !== screen) screen.unmount?.();
}

// ---- تثبيت التطبيق: المتصفح يعرض فرصة التثبيت مرة عند الفتح، نحتفظ بها لزر "ثبّت التطبيق" ----
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event('sm:installable'));
});
window.addEventListener('appinstalled', () => { window.__installPrompt = null; });

// ---- الرفيقة الطافية داخل التطبيق ----
let floaterRoute = 'home';
// تطبيق مؤسسة: لا رفيقة مرسومة ولا رفيقة طافية
const noCompanion = true;
// لا تطفو فوق شاشات المحادثة (الرئيسية والمجموعة)
const syncFloater = () => {};
// بلا رفيقة: تبويب "المحادثة"، والشاشة الرئيسية بلا شريط عنوان (رأس المحادثة يكفي)
// تبويب "الموظفين" يظهر للمدير فقط (الصلاحية الفعلية تفرضها قاعدة البيانات)
function applyRole(next) {
  const changed = (next || null) !== role;
  role = next || null;
  const tab = document.querySelector('.tabbar__item[data-route="staff"]');
  if (tab) tab.hidden = role !== 'manager';
  const g = document.querySelector('.tabbar__item[data-route="group"]');
  if (g) g.hidden = !role;
  // الموظف لا يرى الرفيقة ولا العقل ولا المجلد
  for (const r of ['home', 'mind', 'folder']) {
    const t = document.querySelector(`.tabbar__item[data-route="${r}"]`);
    if (t) t.hidden = role === 'employee';
  }
  document.body.classList.toggle('is-employee', role === 'employee');
  syncFloater();
  if (changed && current) navigate();
  // عضو في المؤسسة: نستلم رسائل المجموعة ما دام التطبيق مفتوحاً، في أي شاشة
  if (role) startGroupSync().then(() => { refreshBadge(); if (role === 'manager') scanSoon(); }).catch(() => {});
}

// عدد رسائل المجموعة غير المقروءة على التبويب
async function refreshBadge() {
  const badge = document.querySelector('.tabbar__item[data-route="group"] .tabbar__badge');
  if (!badge) return;
  const n = await unreadCount().catch(() => 0);
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = !n;
}
groupEvents.addEventListener('message', refreshBadge);
groupEvents.addEventListener('seen', refreshBadge);

// المظهر: auto = واتساب حين تُخفى الرفيقة، وإلا البنفسجي
let appTheme = 'auto';
function applyTheme() {
  const wa = appTheme === 'whatsapp' || (appTheme === 'auto' && noCompanion);
  document.body.classList.toggle('theme-wa', wa);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', wa ? '#202c33' : '#140f2e');
}
function applyNoCompanion() {
  document.body.classList.toggle('no-companion', noCompanion);
  applyTheme();
  const tab = document.querySelector('.tabbar__item[data-route="home"]');
  if (tab) {
    tab.querySelector('.tabbar__icon').textContent = noCompanion ? '💬' : '✦';
    tab.querySelector('span:last-child').textContent = noCompanion ? 'المحادثة' : 'الرفيقة';
  }
}

(async () => {
  applyRole(await getSetting('orgRole', null));
  appTheme = await getSetting('appTheme', 'auto');
  applyNoCompanion();
})();

// الإعدادات تُعلن عن تغييراتها فنحدّث الرفيقة الطافية فوراً
window.addEventListener('sm:setting', (e) => {
  const { key, value } = e.detail;
  if (key === 'orgRole') applyRole(value);
  if (key === 'appTheme') { appTheme = value; applyTheme(); }
});

window.addEventListener('hashchange', navigate);
loadCategories().catch(() => {}).then(navigate).finally(() => { window.__appReady = true; });

// ---- التذكيرات: نفحصها عند الفتح وكل نصف دقيقة ----
function notice(text) {
  const el = Object.assign(document.createElement('div'), { className: 'toast toast--info', role: 'status' });
  el.textContent = `⏰ ${text} (المس للإغلاق)`;
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
}
const tickReminders = () => checkReminders((r) => notice(r.text)).catch(() => {});
tickReminders();
setInterval(tickReminders, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickReminders(); });

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
window.addEventListener('error', (e) => { if (e.message && !gpuLost(e.message)) toast(e.message); });
// فقدان اتصال كرت الشاشة (WebGPU) يتعافى منه الذكاء على الجهاز بنفسه، فلا نزعج المستخدم به
const gpuLost = (m) => /external Instance reference|Instance reference no longer|device (was |is )?lost/i.test(m || '');
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason);
  if (gpuLost(msg)) { e.preventDefault(); console.warn('WebGPU:', msg); return; }
  toast(msg);
});

// إن كان صوت Piper مختاراً نحمّله في الذاكرة بهدوء، فلا يتأخر أول رد
setTimeout(async () => {
  if (role === 'employee' || await getSetting('voiceEngine', 'device') !== 'piper') return;
  const { warmUpPiper, isPiperReady } = await import('./piper.js');
  if (await isPiperReady()) warmUpPiper();
}, 4000);

// الذكاء على الجهاز: نحفظ مكتبته مسبقاً وأنت متصل (ليعمل دون إنترنت)، ونجهّزه إن كان هو المستخدم دائماً
setTimeout(async () => {
  if (role === 'employee' || !(await getSetting('localModel', ''))) return;
  const { warmUpLocal, prefetchRuntime } = await import('./local-ai.js');
  await prefetchRuntime();
  if (await getSetting('aiMode', 'auto') === 'local' || !navigator.onLine) warmUpLocal();
}, 6000);

// لقطة يومية على الجهاز (لا شيء يغادره)
autoSnapshot().catch((err) => console.warn('snapshot:', err));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW:', err));
  });
}
