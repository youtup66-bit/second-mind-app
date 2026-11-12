// حسابات الكرات (A40): الكرة تُصنع أولاً، ثم يُضاف لها حساب (مسؤول، معاون، موظف) برابط دعوة
// يضع به صاحبه كلمة مروره. هاتف رئيس القسم يتذكر لأي كرة كل دعوة، فإذا انضم صاحبها وُضع فيها تلقائياً.
import { getSetting, setSetting } from './storage.js';
import { createInvite, deleteInvite, removeMember } from './cloud.js';
import { withStructure, nodeById, placePerson, setHead, unplacePerson, removeCard } from './org-structure.js';

const KEY = 'ballInvites'; // رمز الدعوة ← { node, title: head|assistant|member, name, username, at }
export const TITLES = { head: 'مسؤول', assistant: 'معاون', member: 'موظف' };

export const ballInvites = async () => (await getSetting(KEY, {})) || {};

export async function inviteToBall({ node, title, name, username, card = null }) {
  const code = await createInvite({ name, username });
  const all = await ballInvites();
  all[code] = { node, title, name: String(name).trim(), username, at: Date.now(), ...(card ? { card } : {}) };
  await setSetting(KEY, all);
  return code;
}
export async function cancelBallInvite(code) {
  await deleteInvite(code).catch(() => {});
  const all = await ballInvites();
  delete all[code];
  await setSetting(KEY, all);
}
// دعوات كرة لم ينضم أصحابها بعد
export async function pendingAt(node) {
  return Object.entries(await ballInvites()).filter(([, x]) => x.node === node).map(([code, x]) => ({ code, ...x }));
}

// members: Map(uid ← { invite, role, node, title, replaces }). من انضم بدعوة كرة يوضع فيها بمنصبه:
// دعوة رئيس القسم يتذكرها هاتفه (ballInvites)، ودعوة مسؤول الفرع تحمل الكرة والمنصب في العضوية نفسها.
// ومن انضم برابط استعادة (replaces) يأخذ أماكن حسابه القديم، ويُحذف القديم.
const DONE_KEY = 'placedMembers';
let busy = false;
export async function placeJoined(members) {
  if (busy) return;
  busy = true;
  try {
    const all = await ballInvites();
    const codes = Object.keys(all).length;
    const done = new Set((await getSetting(DONE_KEY, [])) || []);
    let doneChanged = false;
    await withStructure(async (st) => {
    let changed = false;
    for (const [uid, m] of members) {
      if (done.has(uid)) continue;
      const x = (m.invite && all[m.invite]) || (m.node ? { node: m.node, title: m.title || 'member' } : null);
      if (m.replaces && st.people[m.replaces] && m.replaces !== uid) {
        st.people[uid] = { places: st.people[m.replaces].places.map((pl) => ({ ...pl })) };
        unplacePerson(st, m.replaces);
        await removeMember(m.replaces).catch(() => {});
        changed = true;
      } else if (x && nodeById(st, x.node)) {
        placePerson(st, uid, x.node, x.title === 'assistant');
        if (x.title === 'head') { setHead(st, uid, x.node, true); delete nodeById(st, x.node).person; }
        // كرات إضافية للبطاقة (ربط الموظف بأكثر من كرة) تنتقل معه إلى أماكنه
        for (const e of (x.card && nodeById(st, x.card)?.extraParents) || []) if (nodeById(st, e)) placePerson(st, uid, e, false);
        // بطاقة الشخص (إن كانت) تُحذف لأنه صار في مكانه
        if (x.card) removeCard(st, x.card);
        changed = true;
      }
      if (m.invite && all[m.invite]) delete all[m.invite];
      if (x || m.replaces) { done.add(uid); doneChanged = true; }
    }
    return changed;
    });
    if (Object.keys(all).length !== codes) await setSetting(KEY, all);
    if (doneChanged) await setSetting(DONE_KEY, [...done].slice(-2000));
  } finally { busy = false; }
}

// المهام التي أرسلتُها أنا إلى من سيُحذف حسابه: تُعاد إلى المستلم الجديد، وتُحذف عندي (تبقى عنده حتى يُحذف حسابه).
// المهام التي أرسلها غيري إليه لا أستطيع نقلها من جهازي؛ تُعرض على الشاشة لتعرف عددها.
export async function transferOpenTasks(from, to) {
  const { listTasks, sendTask, deleteTask } = await import('./tasks.js');
  const mine = (await listTasks()).filter((t) => t.mine && t.to === from && t.status !== 'done');
  for (const t of mine) {
    await sendTask({ to, title: t.title, text: `(نُقلت إليك من ${t.toName})${t.text ? `\n${t.text}` : ''}`.slice(0, 800), due: t.due });
    await deleteTask(t);
  }
  return mine.length;
}
export async function openTasksFrom(from) {
  const { listTasks } = await import('./tasks.js');
  return (await listTasks()).filter((t) => !t.mine && t.from === from && t.status !== 'done').length;
}

// رابط استعادة لمن نسي كلمة مروره: حساب جديد باسمه نفسه يأخذ مناصبه، والقديم يُحذف عند انضمامه
export async function recoveryInvite({ uid, name, username, node, title }) {
  const base = String(username || 'user').replace(/\.r\d+$/, '');
  const fresh = `${base.slice(0, 25)}.r${Math.floor(Date.now() / 1000) % 1000}`;
  const code = await createInvite({ name, username: fresh, node, title, replaces: uid });
  return { code, username: fresh };
}
