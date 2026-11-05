// الرفيقة الطافية داخل التطبيق: صغيرة (نحو ١ سم)، تظهر في كل الشاشات عدا شاشة الرفيقة نفسها،
// تُسحب بالإصبع وتلتصق بأقرب حافة، ولمسة عليها تفتح المحادثة.
import { createCompanion } from './companion.js';

const POS_KEY = 'sm-floater-pos';
export const FLOATER_SIZES = { small: 48, medium: 64, large: 84 }; // عرض بالبكسل: 64 ≈ ١ سم وقليل على أغلب الجوالات

function loadPos() {
  try { return JSON.parse(localStorage.getItem(POS_KEY)) || null; } catch { return null; }
}
function savePos(p) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* تخزين غير متاح */ }
}

export function createFloater({ skin, size = 'medium', onTap }) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'افتح المحادثة مع الرفيقة');
  el.hidden = true;
  document.body.append(el);

  let companion = createCompanion(el, { skin });
  companion.el.style.pointerEvents = 'none';
  let width = FLOATER_SIZES[size] || FLOATER_SIZES.medium;
  // side: الحافة (يسار أو يمين)، y: نسبة الارتفاع من 0 إلى 1
  let pos = loadPos() || { side: 'left', y: 0.62 };

  const bounds = () => {
    const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect().height || 64;
    const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 60) + 8;
    return { top, bottom: innerHeight - tabbar - width * 1.25 - 8 };
  };

  function place(animate = true) {
    el.style.width = `${width}px`;
    const { top, bottom } = bounds();
    const y = top + (bottom - top) * Math.min(1, Math.max(0, pos.y));
    const x = pos.side === 'left' ? 6 : innerWidth - width - 6;
    el.style.transition = animate ? 'left .25s ease, top .25s ease' : 'none';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  place(false);
  addEventListener('resize', () => place(false));

  // ---- السحب واللمس ----
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    drag = { sx: e.clientX, sy: e.clientY, ox: el.offsetLeft, oy: el.offsetTop, moved: false };
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'none';
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true;
    el.classList.add('is-dragging');
    el.style.left = `${Math.min(innerWidth - width, Math.max(0, drag.ox + dx))}px`;
    el.style.top = `${Math.min(innerHeight - width * 1.25, Math.max(0, drag.oy + dy))}px`;
  });
  const end = () => {
    if (!drag) return;
    const wasMoved = drag.moved;
    drag = null;
    el.classList.remove('is-dragging');
    if (!wasMoved) {
      companion.setState('happy');
      setTimeout(() => onTap?.(), 180);
      return;
    }
    // تلتصق بأقرب حافة
    const cx = el.offsetLeft + width / 2;
    const { top, bottom } = bounds();
    pos = { side: cx < innerWidth / 2 ? 'left' : 'right', y: (el.offsetTop - top) / Math.max(1, bottom - top) };
    savePos(pos);
    place(true);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  return {
    setVisible(v) { el.hidden = !v; if (v) place(false); },
    setSkin(next) {
      companion.destroy();
      companion = createCompanion(el, { skin: next });
      companion.el.style.pointerEvents = 'none';
    },
    setSize(next) { width = FLOATER_SIZES[next] || width; place(false); },
    setState: (s) => companion.setState(s),
  };
}
