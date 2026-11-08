// إثراء عقل المؤسسة (A27): المساعد على جهاز رئيس القسم يصنّف منشورات المجموعات
// (سؤال، فكرة، قرار، مهمة…) دفعات، فتكبر بها كرات التصنيفات، وتظهر المجموعات كرات مرتبطة بها.
// يُثري العقل: المجموعة العامة، ومجموعات المشاريع، ومجموعات المحادثة التي سمح صاحبها بذلك (A32).
// لا يُرسل إلا نص المنشور واسم مجموعته إلى Gemini، والنتيجة تبقى على الجهاز.
import { groupEvents, groupMe, groupRooms, roomOf, enrichesMind, GENERAL, startGroupSync, groupBranch } from './group.js';
import { getGroupMessages, patchGroupMessage } from './storage.js';
import { classifyPosts } from './gemini.js';

const BATCH = 20;      // منشورات في الطلب الواحد
const PER_RUN = 60;    // حد كل تشغيل (يكمل في التالي)
const MIN_LEN = 6;     // "تمام" و"شكراً" لا تستحق طلباً
const STOP = new Set(['NO_KEY', 'BAD_KEY', 'RATE', 'NETWORK', 'TIMEOUT']);

let running = false, again = false, timer = 0;
export function enrichSoon() { clearTimeout(timer); timer = setTimeout(() => enrich().catch(() => {}), 3000); }
groupEvents.addEventListener('message', enrichSoon);
groupEvents.addEventListener('rooms', enrichSoon);

const roomName = (m) => {
  const id = roomOf(m);
  return id === GENERAL ? 'العامة' : groupRooms().get(id)?.name || m.roomName || '';
};

export async function enrich() {
  if (groupMe()?.role !== 'manager') return;
  if (running) { again = true; return; }
  running = true;
  try {
    const queue = (await getGroupMessages())
      .filter((m) => !m.mindChecked && enrichesMind(roomOf(m)))
      .sort((a, b) => a.sentAt - b.sentAt)
      .slice(0, PER_RUN);
    let changed = 0;
    for (let k = 0; k < queue.length; k += BATCH) {
      const chunk = queue.slice(k, k + BATCH);
      const ask = chunk.map((m, i) => ({ i, text: m.text || '', room: roomName(m) })).filter((x) => x.text.trim().length >= MIN_LEN);
      let out = [];
      try { out = ask.length ? await classifyPosts(ask) : []; } catch (err) {
        if (STOP.has(err.code)) break; // بلا مفتاح أو إنترنت: نكمل لاحقاً
      }
      const cat = new Map(out.map((x) => [x.i, x.category]));
      for (const [i, m] of chunk.entries()) {
        await patchGroupMessage(m.id, { mindChecked: true, mindCat: cat.get(i) || 'none' });
        if (cat.get(i) && cat.get(i) !== 'none') changed++;
      }
    }
    if (queue.length) window.dispatchEvent(new CustomEvent('sm:orgmind', { detail: { changed } }));
    if (queue.length === PER_RUN) again = true;
  } finally {
    running = false;
    if (again) { again = false; enrichSoon(); }
  }
}

// منشورات تُثري العقل الآن (تُستبعد مجموعة محادثة أُوقف إثراؤها)
// المسؤول المسموح له بعقل المؤسسة: تصنيف منشورات فرعه يصله من هاتف رئيس القسم، والرسائل نفسها على جواله
export async function mindPosts() {
  await startGroupSync().catch(() => {});
  if (groupMe()?.role === 'manager') return (await getGroupMessages()).filter((m) => m.mindCat && m.mindCat !== 'none' && enrichesMind(roomOf(m)));
  const map = groupBranch()?.perms?.mind ? groupBranch().mind || {} : null;
  if (!map) return [];
  return (await getGroupMessages()).filter((m) => map[m.id] && map[m.id] !== 'none').map((m) => ({ ...m, mindCat: map[m.id] }));
}
export const hasOrgMind = () => groupMe()?.role === 'manager' || !!groupBranch()?.perms?.mind;

// المجموعات التي تُثري العقل: { id, name, color, kind }
export function mindRooms(orgName = 'المؤسسة') {
  const out = [{ id: GENERAL, name: `العامة · ${orgName}`, color: '#00a884', kind: 'general' }];
  const b = groupMe()?.role === 'manager' ? null : groupBranch();
  const mine = b ? new Set(b.nodes.map((n) => `n_${n.id}`)) : null;
  for (const [id, r] of groupRooms()) {
    if (!enrichesMind(id)) continue;
    // المسؤول: مشاريع فرعه، والمحادثات المُثرية التي هو فيها
    if (mine && !(mine.has(id) || r.kind === 'chat')) continue;
    out.push({ id, name: r.name, color: r.color, kind: r.kind });
  }
  return out;
}
