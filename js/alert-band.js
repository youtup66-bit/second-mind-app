// شريط الحالة في الشاشة الرئيسية: خطوط متحركة تعكس أعلى أهمية في الرسائل الأخيرة.
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

const SETUP = {
  urgent: { color: '#ef4444', glow: 'rgba(239,68,68,.9)', speed: 1.1, lines: [18, 40, 62, 84, 106, 128, 146], sparks: 16, dim: 1, label: 'رسالة طارئة' },
  attention: { color: '#f59e0b', glow: 'rgba(245,158,11,.85)', speed: 2.4, lines: [18, 40, 62, 84, 106, 128], sparks: 11, dim: 1, label: 'تسترعي الانتباه' },
  normal: { color: '#22c55e', glow: 'rgba(34,197,94,.7)', speed: 5, lines: [18, 40, 62, 84, 106], sparks: 6, dim: 0.55, label: 'لا رسائل مهمة' },
};
const SPARKS = [[12, 22], [88, 36], [160, 14], [232, 52], [300, 26], [360, 70], [40, 70], [120, 96], [200, 88], [270, 110], [330, 130], [70, 128], [185, 122], [250, 76], [20, 110], [300, 140]];

// الشريط نفسه: يُعرض أعلى الشاشة الرئيسية، ويفتح قائمة المجموعات عند اللمس
export function bandMarkup(level) {
  const s = SETUP[level] || SETUP.normal;
  const lines = s.lines.map((t, i) => {
    const w = 26 + (i % 3) * 9;
    const d = ((i * 0.37) % 1.2).toFixed(2);
    const dur = (s.speed * (0.8 + (i % 4) * 0.12)).toFixed(2);
    return `<i class="ab-line" style="top:${t}px;height:1px;opacity:${(0.55 + (i % 3) * 0.15).toFixed(2)};background:linear-gradient(90deg,transparent 0%,var(--ab-color) ${w}%,transparent ${w + 22}%);animation-duration:${dur}s;animation-delay:-${d}s"></i>`;
  }).join('');
  const sparks = SPARKS.slice(0, s.sparks).map(([x, y], i) => {
    const sz = 3 + (i % 3);
    const dur = (s.speed * (1.1 + (i % 5) * 0.2)).toFixed(2);
    return `<i class="ab-spark" style="left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;box-shadow:0 0 ${sz * 3}px var(--ab-glow);animation-duration:${dur}s;animation-delay:${((i * 0.31) % 2).toFixed(2)}s"></i>`;
  }).join('');
  return `<a class="alert-band" href="#/chats?tab=chats&view=groups" aria-label="${s.label}" style="--ab-color:${s.color};--ab-glow:${s.glow};opacity:${s.dim}">${lines}${sparks}</a>`;
}
