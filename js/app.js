// الموجّه البسيط بين الشاشات
import * as home from './screens/home.js';
import * as mind from './screens/mind.js';
import * as settings from './screens/settings.js';

const routes = { home, mind, settings };
const app = document.getElementById('app');
const titleEl = document.getElementById('screen-title');

let current = null;
let navId = 0;

async function navigate() {
  const myNav = ++navId;
  const name = location.hash.replace(/^#\//, '') || 'home';
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
  await screen.mount(view);
  // إن انتقل المستخدم لشاشة أخرى أثناء التحميل نُنهي هذه
  if (myNav !== navId && current !== screen) screen.unmount?.();
}

window.addEventListener('hashchange', navigate);
navigate();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW:', err));
  });
}
