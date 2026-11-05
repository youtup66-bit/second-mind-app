// الرفيقة: شخصية أنمي صغيرة (SVG متحرك) تطفو وترمش وتتبع اللمس بعينيها.
// الحالات: idle | listening | thinking | talking | happy
import { skinSVG } from './skins.js';



const STATES = ['idle', 'listening', 'thinking', 'talking', 'happy'];

export function createCompanion(host, { onTap, skin } = {}) {
  const el = document.createElement('div');
  el.className = 'companion is-idle';
  el.innerHTML = skinSVG(skin);
  el.dataset.skin = skin || '';
  host.append(el);

  const svg = el.querySelector('svg');
  const pupils = el.querySelectorAll('.cmp-pupil');
  let state = 'idle';
  let blinkTimer = 0;
  let happyTimer = 0;

  function setState(next) {
    if (!STATES.includes(next)) return;
    el.classList.remove(`is-${state}`);
    state = next;
    el.classList.add(`is-${state}`);
  }

  // رمشة طبيعية على فترات عشوائية
  function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      el.classList.add('is-blinking');
      setTimeout(() => el.classList.remove('is-blinking'), 140);
      scheduleBlink();
    }, 2200 + Math.random() * 3500);
  }
  scheduleBlink();

  // العينان تتبعان الإصبع أو المؤشر
  function look(e) {
    const r = svg.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.42;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 200);
    const x = (dx / d) * 3 * k, y = (dy / d) * 3 * k;
    pupils.forEach((p) => p.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`));
  }
  window.addEventListener('pointermove', look);
  window.addEventListener('pointerdown', look);

  // لمسة: تفرح قليلاً
  function tap() {
    const prev = state === 'happy' ? 'idle' : state;
    setState('happy');
    clearTimeout(happyTimer);
    happyTimer = setTimeout(() => setState(prev), 1400);
    onTap?.();
  }
  el.addEventListener('click', tap);

  return {
    el,
    setState,
    get state() { return state; },
    destroy() {
      clearTimeout(blinkTimer);
      clearTimeout(happyTimer);
      window.removeEventListener('pointermove', look);
      window.removeEventListener('pointerdown', look);
      el.remove();
    },
  };
}
