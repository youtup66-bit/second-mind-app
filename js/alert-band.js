// شريط الحالة في الشاشة الرئيسية: عشرة خطوط متدرجة السطوع داخل شريط نحيف قرب الحافة العليا.
// طارئة = أحمر سريع، تسترعي الانتباه = أصفر أبطأ، عادية = أخضر هادئ (الافتراضي).
import { getGroupMessages } from './storage.js';

const DAY = 86400000;
const RANK = { urgent: 3, attention: 2, normal: 1 };

// أعلى أهمية بين رسائل آخر ٢٤ ساعة؛ الرسالة بلا أهمية تُعدّ عادية
export async function alertLevel() {
  const since = Date.now() - DAY;
  const msgs = (await getGroupMessages().catch(() => [])).filter((m) => (m.sentAt || 0) >= since);
  let best = 'normal';
  for (const m of msgs) {
    const p = Object.prototype.hasOwnProperty.call(RANK, m.priority) ? m.priority : 'normal';
    if (RANK[p] > RANK[best]) best = p;
  }
  return best;
}

// كل الحالات: ١٠ خطوط متدرجة السطوع داخل ٥٦ نقطة (نحو ٧٪ من الشاشة)
const TOPS = Array.from({ length: 10 }, (_, i) => 4 + i * 5);
const BRIGHT = [0.35, 0.55, 0.9, 0.45, 1.0, 0.6, 0.8, 0.3, 0.95, 0.7];
const SPARKS = [[14, 10], [170, 26], [300, 38], [240, 14], [70, 44], [330, 20]];

const SETUP = {
  urgent: { color: '#ef4444', glow: 'rgba(239,68,68,.9)', speed: 1.1, label: 'رسالة طارئة' },
  attention: { color: '#f59e0b', glow: 'rgba(245,158,11,.85)', speed: 2.4, label: 'تسترعي الانتباه' },
  normal: { color: '#22c55e', glow: 'rgba(34,197,94,.7)', speed: 5, label: 'لا رسائل مهمة' },
};

// الشريط نفسه: يُعرض أعلى الشاشة الرئيسية، ويفتح قائمة المجموعات عند اللمس
export function bandMarkup(level) {
  const s = SETUP[level] || SETUP.normal;
  const lines = TOPS.map((t, i) => {
    const b = BRIGHT[i];
    const w = 22 + (i % 4) * 6;
    const dur = (s.speed * (0.7 + ((i * 41) % 11) * 0.06)).toFixed(2);
    const d = ((i * 0.4) % 4).toFixed(2);
    return `<i class="ab-line" style="top:${t}px;background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--ab-color) ${Math.round(b * 100)}%,transparent) ${w}%,transparent ${w + 22}%);box-shadow:0 0 4px color-mix(in srgb,var(--ab-color) ${Math.round(b * 80)}%,transparent);animation-duration:${dur}s;animation-delay:-${d}s"></i>`;
  }).join('');
  const sparks = SPARKS.map(([x, y], i) => {
    const dur = (s.speed * (0.8 + (i % 5) * 0.15)).toFixed(2);
    return `<i class="ab-spark" style="left:${x}px;top:${y}px;animation-duration:${dur}s;animation-delay:${((i * 0.7) % 3).toFixed(2)}s"></i>`;
  }).join('');
  return `<a class="alert-band" href="#/chats?tab=chats&view=groups" aria-label="${s.label}" style="--ab-color:${s.color};--ab-glow:${s.glow}">${lines}${sparks}</a>`;
}
