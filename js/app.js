// الموجّه البسيط بين الشاشات
import * as home from './screens/home.js';
import * as mind from './screens/mind.js';
import * as folder from './screens/folder.js';
import * as settings from './screens/settings.js';
import { autoSnapshot } from './backup.js';
import { createFloater } from './floater.js';
import { getSetting } from './storage.js';
import { loadCategories } from './categories.js';

const routes = { home, mind, folder, settings };
const app = document.getElementById('app');
const titleEl = document.getElementById('screen-title');

let current = null;
let navId = 0;

async function navigate() {
  const myNav = ++navId;
  const name = location.hash.replace(/^#\//, '').split('?')[0] || 'home';
  const screen = routes[name] || home;

  current?.unmount?.();
  // كل شاشة تحصل على حاوية خاصة، فلا تتداخل شاشة بطيئة مع التالية
  const view = document.createElement('div');
  view.className = 'view';
  app.replaceChildren(view);
  titleEl.textContent = screen.title;
  document.title = `${screen.title} · عقلي الثاني`;

  document.querySelectorAll('.tabbar__item').forEach((a) => {
    const active = a.dataset.route === (routes[name] ? name : 'home');
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
let floater = null;
let floaterOn = true;
let floaterRoute = 'home';
const syncFloater = () => floater?.setVisible(floaterOn && floaterRoute !== 'home');

(async () => {
  floaterOn = await getSetting('floaterOn', true);
  floater = createFloater({
    skin: await getSetting('companionSkin', 'star'),
    size: await getSetting('floaterSize', 'medium'),
    onTap: () => { location.hash = '#/home'; },
  });
  syncFloater();
})();

// الإعدادات تُعلن عن تغييراتها فنحدّث الرفيقة الطافية فوراً
window.addEventListener('sm:setting', (e) => {
  const { key, value } = e.detail;
  if (key === 'floaterOn') { floaterOn = value; syncFloater(); }
  if (key === 'floaterSize') floater?.setSize(value);
  if (key === 'companionSkin') floater?.setSkin(value);
});

window.addEventListener('hashchange', navigate);
loadCategories().catch(() => {}).then(navigate).finally(() => { window.__appReady = true; });

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

// إن كان صوت Piper مختاراً نحمّله في الذاكرة بهدوء، فلا يتأخر أول رد
setTimeout(async () => {
  if (await getSetting('voiceEngine', 'device') !== 'piper') return;
  const { warmUpPiper, isPiperReady } = await import('./piper.js');
  if (await isPiperReady()) warmUpPiper();
}, 4000);

// الذكاء على الجهاز: نحفظ مكتبته مسبقاً وأنت متصل (ليعمل دون إنترنت)، ونجهّزه إن كان هو المستخدم دائماً
setTimeout(async () => {
  if (!(await getSetting('localModel', ''))) return;
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
