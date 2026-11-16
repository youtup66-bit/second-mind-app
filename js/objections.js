// اعتراض الموظف على نقطة سُجّلت له (A49): يرسله من رسالته، ويقرره المدير مع ملاحظة، ويصل القرار إليه.
// الموظف لا يرى نقاطه؛ يكتب سبب اعتراضه فقط. القرار والملاحظة على جهاز المدير وينتقلان بالرسائل.
import { api } from './cloud.js';
import { getSetting, setSetting, getPoints, putPoint } from './storage.js';
import { groupMe, groupMembers } from './group.js';

const KEY = 'objections'; // [{ id, msgId, from?, fromName?, reason, status: 'sent'|'open'|'accepted'|'rejected', reply, at }]
const uid = () => Math.random().toString(36).slice(2, 10);

export const listObjections = async () => (await getSetting(KEY, [])) || [];
async function save(list) {
  await setSetting(KEY, list.slice(0, 300));
  window.dispatchEvent(new Event('sm:objections'));
}

// رسالة مخصصة إلى أعضاء محددين عبر قناة الرسائل نفسها التي تستعملها المهام
async function relayTo(pending, text, task) {
  const me = groupMe();
  const { db, F } = await api();
  const ref = F.doc(F.collection(db, 'relay'));
  await F.setDoc(ref, {
    mid: ref.id, from: me.uid, fromName: me.name, text: String(text).slice(0, 4000), sentAt: Date.now(),
    createdAt: F.serverTimestamp(), pending, task,
  });
}

// الموظف: يعترض على رسالة من رسائله تحمل عملاً
export async function sendObjection(msg, reason) {
  const boss = [...groupMembers()].filter(([, m]) => m.role === 'manager').map(([u]) => u);
  if (!boss.length) throw new Error('لا يوجد مدير متاح لاستلام الاعتراض الآن.');
  const id = uid();
  const list = await listObjections();
  list.unshift({ id, msgId: msg.id, quote: String(msg.text || '').slice(0, 120), reason, status: 'sent', sentByMe: true, at: Date.now() });
  await save(list);
  await relayTo(boss, `⚠️ اعتراض: ${reason}`, { kind: 'objection', id, msgId: msg.id, reason: String(reason).slice(0, 300) });
}

// استقبال الاعتراض أو قراره (يستدعيه استقبال المجموعة)
export async function onObjectionMessage(x) {
  const k = x.task;
  const list = await listObjections();
  if (k.kind === 'objection') {
    if (list.some((o) => o.id === k.id)) return;
    list.unshift({ id: k.id, msgId: k.msgId, from: x.from, fromName: x.fromName, reason: k.reason || '', status: 'open', at: x.sentAt || Date.now() });
    await save(list);
  } else if (k.kind === 'objection-result') {
    const o = list.find((y) => y.id === k.id);
    if (!o) return;
    o.status = k.decision; o.reply = k.reply || '';
    await save(list);
  }
}

// المدير: يقبل الاعتراض (تُلغى النقطة من المجموع) أو يرفضه، مع ملاحظة تصل إلى الموظف
export async function decideObjection(id, decision, reply = '') {
  const list = await listObjections();
  const o = list.find((y) => y.id === id);
  if (!o || o.status !== 'open') return;
  if (decision === 'accepted') {
    for (const p of await getPoints()) if (p.msgId === o.msgId && p.user === o.from) await putPoint({ ...p, status: 'rejected', objected: true });
  }
  o.status = decision; o.reply = reply;
  await save(list);
  const head = decision === 'accepted' ? '✅ قُبل اعتراضك' : '❌ لم يُقبل اعتراضك';
  await relayTo([o.from], `${head}${reply ? `: ${reply}` : ''}`, { kind: 'objection-result', id, decision, reply: String(reply).slice(0, 300) });
}
