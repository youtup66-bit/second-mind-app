// تقرير يومي: نقاط اليوم لكل شعبة ووحدة، مع نسبة كل واحدة من أعلاها (طول الشريط)
// النقاط المعتمدة فقط، ومن يُحتسب للشعبة أو الوحدة هو من وُضع في فرعها أو في ما تحتها.
import { loadStructure } from './org-structure.js';
import { totals } from './points.js';

const SHOWN = new Set(['division', 'unit']);

// الكرة وما تحتها (بلا كرات المشاريع)
function branchIds(st, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of st.nodes) {
      if (!ids.has(n.id) && n.parent && ids.has(n.parent)) { ids.add(n.id); grew = true; }
    }
  }
  return ids;
}

// [{ id, name, type, points, ratio }] مرتبة من الأعلى نقاطاً
export async function dailyBars() {
  const st = await loadStructure();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();

  // نقاط اليوم لكل شخص
  const today = new Map();
  for (const [user, t] of await totals('all')) {
    const p = t.items.reduce((sum, it) => sum + (it.at >= from ? it.points : 0), 0);
    if (p) today.set(user, p);
  }

  const rows = st.nodes.filter((n) => SHOWN.has(n.type)).map((n) => {
    const ids = branchIds(st, n.id);
    let points = 0;
    for (const [user, p] of today) {
      if ((st.people[user]?.places || []).some((pl) => ids.has(pl.node))) points += p;
    }
    return { id: n.id, name: n.name, type: n.type, points };
  });
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ar'));
  const max = Math.max(0, ...rows.map((r) => r.points));
  return rows.map((r) => ({ ...r, ratio: max ? r.points / max : 0 }));
}
