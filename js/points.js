// نقاط الموظفين (للمدير فقط، على جهازه؛ لا تُرفع إلى السحابة ولا يراها الموظفون)
// المدير يحدد الأعمال ونقاط كل عمل، والذكاء يقرأ رسائل المجموعة ويقترح النقاط، والمدير يوافق،
// أو تُحتسب تلقائياً إن فعّل ذلك.
import { getPoints, putPoint, deletePoint, getSetting, setSetting, getGroupMessages, putGroupMessage, patchGroupMessage } from './storage.js';
import { detectWorks } from './gemini.js';
import { groupEvents, groupMe, groupMembers, countsForPoints } from './group.js';

export const pointsEvents = new EventTarget(); // change
const changed = () => pointsEvents.dispatchEvent(new Event('change'));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---- قائمة الأعمال ----
export const getWorks = () => getSetting('orgWorks', []);
async function saveWorks(list) {
  await setSetting('orgWorks', list);
  // الفحص يبدأ من لحظة إنشاء أول عمل (لا نعيد احتساب الماضي كله)
  if (!(await getSetting('pointsSince', 0))) await setSetting('pointsSince', Date.now());
  changed();
}
const cleanPoints = (p) => Math.max(1, Math.min(1000, Math.round(Number(p) || 0)));
export async function addWork(name, points) {
  name = String(name || '').trim();
  if (!name) throw new Error('اكتب اسم العمل.');
  const list = await getWorks();
  if (list.some((w) => w.name === name)) throw new Error('هذا العمل موجود.');
  list.push({ id: uid(), name: name.slice(0, 60), points: cleanPoints(points) });
  await saveWorks(list);
  scanSoon();
}
export async function updateWork(id, { name, points }) {
  const list = await getWorks();
  const w = list.find((x) => x.id === id);
  if (!w) return;
  if (name !== undefined && String(name).trim()) w.name = String(name).trim().slice(0, 60);
  if (points !== undefined) w.points = cleanPoints(points);
  await saveWorks(list);
}
export async function removeWork(id) {
  await saveWorks((await getWorks()).filter((w) => w.id !== id));
}

// ---- الاحتساب التلقائي ----
export const isAuto = () => getSetting('pointsAuto', false);
export async function setAuto(on) {
  await setSetting('pointsAuto', !!on);
  // تفعيله يعتمد الاقتراحات المعلقة أيضاً
  if (on) for (const p of await getPoints()) if (p.status === 'suggested') await putPoint({ ...p, status: 'approved' });
  changed();
}

// ---- السجل ----
export async function addManual({ user, workId, count = 1, note = '' }) {
  const w = (await getWorks()).find((x) => x.id === workId);
  if (!w || !user) throw new Error('اختر الموظف والعمل.');
  const n = Math.max(1, Math.min(50, Math.round(Number(count) || 1)));
  await putPoint({
    id: `m:${uid()}`, user, workId: w.id, workName: w.name, points: w.points * n, count: n,
    at: Date.now(), status: 'approved', source: 'manual', ...(note ? { quote: String(note).slice(0, 200) } : {}),
  });
  changed();
}
async function setStatus(id, status) {
  const p = (await getPoints()).find((x) => x.id === id);
  if (p) { await putPoint({ ...p, status }); changed(); }
}
export const approve = (id) => setStatus(id, 'approved');
export const reject = (id) => setStatus(id, 'rejected');
export async function remove(id) { await deletePoint(id); changed(); }

// ---- الفترات: الأسبوع يبدأ يوم السبت ----
export const PERIODS = { week: 'هذا الأسبوع', month: 'هذا الشهر', year: 'هذه السنة', all: 'الكل' };
export function periodStart(period, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'week') { d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return d.getTime(); }
  if (period === 'month') { d.setDate(1); return d.getTime(); }
  if (period === 'year') { d.setMonth(0, 1); return d.getTime(); }
  return 0;
}

// المعتمد في الفترة: Map(user ← { points, count, items })
export async function totals(period = 'month') {
  const from = periodStart(period);
  const out = new Map();
  for (const p of await getPoints()) {
    if (p.status !== 'approved' || p.at < from) continue;
    const t = out.get(p.user) || { points: 0, count: 0, items: [] };
    t.points += p.points;
    t.count += p.count || 1;
    t.items.push(p);
    out.set(p.user, t);
  }
  for (const t of out.values()) t.items.sort((a, b) => b.at - a.at);
  return out;
}
export async function suggestions() {
  return (await getPoints()).filter((p) => p.status === 'suggested').sort((a, b) => b.at - a.at);
}

// ---- قراءة رسائل المجموعة واقتراح النقاط ----
let scanning = false, again = false, timer = 0;
export function scanSoon() { clearTimeout(timer); timer = setTimeout(() => scan().catch(() => {}), 1500); }
groupEvents.addEventListener('message', scanSoon);

const STOP = new Set(['NO_KEY', 'BAD_KEY', 'RATE', 'NETWORK', 'TIMEOUT']);
export async function scan() {
  if (groupMe()?.role !== 'manager') return;
  if (scanning) { again = true; return; }
  scanning = true;
  try {
    const works = await getWorks();
    if (!works.length) return;
    const since = await getSetting('pointsSince', Date.now());
    const auto = await isAuto();
    const members = groupMembers();
    const queue = (await getGroupMessages()).filter((m) => !m.mine && !m.pointsChecked && m.text && m.sentAt >= since
      && members.get(m.from)?.role !== 'manager' && countsForPoints(m));
    let found = 0;
    for (const m of queue) {
      try {
        const done = await detectWorks(m.text, works.map((w) => ({ key: w.id, name: w.name })));
        for (const d of done) {
          const w = works.find((x) => x.id === d.key);
          await putPoint({
            id: `${m.id}:${w.id}`, user: m.from, workId: w.id, workName: w.name, points: w.points * d.count, count: d.count,
            at: m.sentAt, msgId: m.id, quote: m.text.slice(0, 200), status: auto ? 'approved' : 'suggested', source: 'ai',
          });
          found++;
        }
        await patchGroupMessage(m.id, { pointsChecked: true });
      } catch (err) {
        if (STOP.has(err.code)) break; // بلا مفتاح أو إنترنت: نكمل لاحقاً
        await patchGroupMessage(m.id, { pointsChecked: true });
      }
    }
    if (found) changed();
  } finally {
    scanning = false;
    if (again) { again = false; scanSoon(); }
  }
}
