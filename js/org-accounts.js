// حسابات الكرات (A40): الكرة تُصنع أولاً، ثم يُضاف لها حساب (مسؤول، معاون، موظف) برابط دعوة
// يضع به صاحبه كلمة مروره. هاتف رئيس القسم يتذكر لأي كرة كل دعوة، فإذا انضم صاحبها وُضع فيها تلقائياً.
import { getSetting, setSetting } from './storage.js';
import { createInvite, deleteInvite } from './cloud.js';
import { loadStructure, saveStructure, nodeById, placePerson, setHead } from './org-structure.js';

const KEY = 'ballInvites'; // رمز الدعوة ← { node, title: head|assistant|member, name, username, at }
export const TITLES = { head: 'مسؤول', assistant: 'معاون', member: 'موظف' };

export const ballInvites = async () => (await getSetting(KEY, {})) || {};

export async function inviteToBall({ node, title, name, username }) {
  const code = await createInvite({ name, username });
  const all = await ballInvites();
  all[code] = { node, title, name: String(name).trim(), username, at: Date.now() };
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

// members: Map(uid ← { invite, role }). من انضم بدعوة كرة يوضع فيها بمنصبه
let busy = false;
export async function placeJoined(members) {
  if (busy) return;
  busy = true;
  try {
    const all = await ballInvites();
    const codes = Object.keys(all);
    if (!codes.length) return;
    const st = await loadStructure();
    let changed = false;
    for (const [uid, m] of members) {
      const x = m.invite && all[m.invite];
      if (!x) continue;
      if (nodeById(st, x.node)) {
        placePerson(st, uid, x.node, x.title === 'assistant');
        if (x.title === 'head') setHead(st, uid, x.node, true);
        changed = true;
      }
      delete all[m.invite];
    }
    if (changed) { await saveStructure(st); window.dispatchEvent(new Event('sm:placed')); }
    if (Object.keys(all).length !== codes.length) await setSetting(KEY, all);
  } finally { busy = false; }
}
