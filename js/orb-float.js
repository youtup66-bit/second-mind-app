// كرة المساعد الطافية (A33): تبقى فوق كل الشاشات عند رئيس القسم، فالمساعد متوفر دائماً بلمسة.
// تُسحب إلى أي ارتفاع وتلتصق بأقرب حافة وتتذكر مكانها، وتختفي فوق شاشة المساعد نفسها وأثناء الكتابة.
const KEY = 'sm-orb-pos'; // { side: 'left'|'right', y: نسبة من الارتفاع }
const MOVE = 8; // أقل من هذا يُعدّ لمسة لا سحباً

let el = null;
let wanted = false; // رئيس القسم وليس على شاشة المساعد
let typing = false;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function save(pos) {
  try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch { /* لا شيء */ }
}

function place(pos) {
  const size = el.offsetWidth || 52;
  const top = 70, bottom = window.innerHeight - 64 - size - 12; // بين الرأس وشريط التبويب
  const y = Math.min(bottom, Math.max(top, pos.y * window.innerHeight));
  el.style.top = `${y}px`;
  el.style.left = pos.side === 'left' ? '10px' : `${window.innerWidth - size - 10}px`;
}

function create() {
  el = document.createElement('button');
  el.type = 'button';
  el.className = 'orb-float';
  el.setAttribute('aria-label', 'المساعد');
  el.innerHTML = '<span class="g-orb" aria-hidden="true"></span>';
  document.body.append(el);
  // افتراضياً: يمين الشاشة فوق شريط التبويب (زر «مجموعة جديدة» على اليسار)
  let pos = load() || { side: 'right', y: 0.72 };
  place(pos);

  let start = null, moved = false;
  el.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
    moved = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < MOVE) return;
    moved = true;
    el.classList.add('is-dragging');
    el.style.left = `${start.left + dx}px`;
    el.style.top = `${start.top + dy}px`;
  });
  const end = () => {
    if (!start) return;
    start = null;
    el.classList.remove('is-dragging');
    if (!moved) return;
    // تلتصق بأقرب حافة
    const mid = el.offsetLeft + el.offsetWidth / 2;
    pos = { side: mid < window.innerWidth / 2 ? 'left' : 'right', y: el.offsetTop / window.innerHeight };
    save(pos);
    place(pos);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', (e) => {
    if (moved) { e.preventDefault(); moved = false; return; }
    location.hash = '#/home';
  });
  window.addEventListener('resize', () => place(pos));

  // أثناء الكتابة تختفي (لوحة المفاتيح تغطي الشاشة)
  document.addEventListener('focusin', (e) => {
    if (e.target.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea')) { typing = true; sync(); }
  });
  document.addEventListener('focusout', () => { typing = false; setTimeout(sync, 50); });
}

function sync() {
  if (!el) return;
  el.hidden = !wanted || typing;
}

// show: رئيس القسم خارج شاشة المساعد
export function setOrbVisible(show) {
  wanted = !!show;
  if (wanted && !el) create();
  sync();
}
