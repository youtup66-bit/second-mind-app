// الموجّه البسيط بين الشاشات
import * as home from './screens/home.js';
import * as mind from './screens/mind.js';
import * as folder from './screens/folder.js';
import * as settings from './screens/settings.js';
import * as org from './screens/org.js';
import * as staff from './screens/staff.js';
import * as group from './screens/group.js';
import * as chats from './screens/chats.js';
import * as structure from './screens/structure.js';
import * as points from './screens/points.js';
import * as reports from './screens/reports.js';
import { checkReminders } from './org-insights.js';
import { scanSoon } from './points.js';
import { startGroupSync, groupEvents, unreadCount } from './group.js';
import { autoSnapshot } from './backup.js';
import { getSetting } from './storage.js';
import { IS_DEV } from './env.js';
import { loadCategories } from './categories.js';
import { setPersonaMode } from './gemini.js';

const routes = { home, mind, folder, settings, org, join: org, staff, group, chats, structure, points, reports };
const app = document.getElementById('app');
const titleEl = document.getElementById('screen-title');

let current = null;
let navId = 0;

// الموظف: منشورات الأعمال والإعدادات فقط (لا عقل ولا رفيقة ولا ذكاء)
const EMPLOYEE_ROUTES = new Set(['group', 'chats', 'settings', 'org', 'join']);
let role = null;

async function navigate() {
  const myNav = ++navId;
  // رئيس القسم يبدأ من المحادثات (المساعد كرة فيها)، والموظف من الأعمال
  let name = location.hash.replace(/^#\//, '').split('?')[0] || (role === 'employee' ? 'group' : role === 'manager' ? 'chats' : 'home');
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
  document.body.classList.toggle('on-group', screen === group || screen === chats);
  document.body.classList.toggle('on-structure', screen === structure);
  document.body.classList.toggle('on-mind', screen === mind);
  document.body.classList.toggle('on-staffnav', screen === staff || screen === points || screen === reports);
  document.title = `${screen.title} · عقلي الثاني`;

  document.querySelectorAll('.tabbar__item').forEach((a) => {
    const tabOf = { join: 'org', structure: 'mind', points: 'staff', reports: 'staff', ...(role ? { home: 'chats' } : {}) };
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
  for (const r of ['group', 'chats']) {
    const t = document.querySelector(`.tabbar__item[data-route="${r}"]`);
    if (t) t.hidden = !role;
  }
  // الموظف لا يرى المساعد ولا العقل ولا المجلد؛ ورئيس القسم يجد المساعد كرة في المحادثات
  for (const r of ['home', 'mind', 'folder']) {
    const t = document.querySelector(`.tabbar__item[data-route="${r}"]`);
    if (t) t.hidden = role === 'employee' || (r === 'home' && role === 'manager');
  }
  syncMindTab();
  setPersonaMode(role ? 'org' : 'personal');
  document.body.classList.toggle('is-employee', role === 'employee');
  if (changed) applyNoCompanion();
  syncFloater();
  if (changed && current) navigate();
  // عضو في المؤسسة: نستلم رسائل المجموعة ما دام التطبيق مفتوحاً، في أي شاشة
  if (role) startGroupSync().then(() => { refreshBadge(); if (role === 'manager') scanSoon(); }).catch(() => {});
}

// تبويب العقل عند رئيس القسم: يفتح آخر عرض اختاره (الأقسام أو عقل المؤسسة)
function syncMindTab() {
  const t = document.querySelector('.tabbar__item[data-route="mind"]');
  if (!t) return;
  let view = 'structure';
  try { view = localStorage.getItem('sm-mind-view') || 'structure'; } catch { /* لا شيء */ }
  t.setAttribute('href', role === 'manager' ? `#/${view === 'mind' ? 'mind' : 'structure'}` : '#/mind');
}
window.addEventListener('sm:mindview', syncMindTab);

// عدد رسائل المجموعة غير المقروءة على التبويب
async function refreshBadge() {
  for (const [route, kind] of [['group', 'work'], ['chats', 'chat']]) {
    const badge = document.querySelector(`.tabbar__item[data-route="${route}"] .tabbar__badge`);
    if (!badge) continue;
    const n = await unreadCount(kind).catch(() => 0);
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = !n;
  }
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
    // في المؤسسة "المحادثات" تبويب للمجموعات، فالذكاء يُسمى "المساعد"
    tab.querySelector('span:last-child').textContent = noCompanion ? (role ? 'المساعد' : 'المحادثة') : 'الرفيقة';
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
// وصلنا هنا = حُمّلت كل الملفات؛ فحص الإقلاع لا ينتظر الشاشة الأولى (قد تنتظر الإنترنت)
window.__appReady = true;
loadCategories().catch(() => {}).then(navigate);

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

// ---- التحديث: يظهر "تحديث متاح"، والمستخدم يضغط فيتحدث فوراً ----
function showUpdate(worker) {
  if (document.getElementById('update-bar')) return;
  const bar = Object.assign(document.createElement('div'), { id: 'update-bar', className: 'update-bar', role: 'status' });
  bar.innerHTML = '<span>يتوفر تحديث جديد للتطبيق</span><button type="button" class="text-btn" id="update-now">تحديث الآن</button><button type="button" class="text-btn text-btn--muted" id="update-later">لاحقاً</button>';
  document.body.append(bar);
  bar.querySelector('#update-now').addEventListener('click', () => {
    bar.querySelector('#update-now').textContent = 'جارٍ التحديث…';
    worker.postMessage('SKIP_WAITING');
  });
  bar.querySelector('#update-later').addEventListener('click', () => bar.remove());
}
// للإعدادات: فحص يدوي للتحديث
window.__checkUpdate = async () => {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return 'none';
  await reg.update();
  if (reg.waiting) { showUpdate(reg.waiting); return 'found'; }
  if (reg.installing) return 'installing';
  return 'latest';
};

if ('serviceWorker' in navigator) {
  let reloading = false;
  // حين تتسلم النسخة الجديدة نعيد التحميل مرة واحدة
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const watch = (w) => w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // نفحص عند العودة إلى التطبيق، وكل نصف ساعة
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 30 * 60 * 1000);
    } catch (err) { console.warn('SW:', err); }
  });
}

// نسخة التجربة: علامة واضحة حتى لا تُخلط بالنسخة الحقيقية
if (IS_DEV) {
  document.body.classList.add('is-dev');
  document.title = `🧪 ${document.title}`;
  const tag = Object.assign(document.createElement('div'), { className: 'dev-tag', textContent: 'نسخة تجريبية' });
  document.body.append(tag);
}
