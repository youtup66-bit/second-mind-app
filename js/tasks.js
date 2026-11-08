// المهام (A34، A35، A39): المسؤول يرسل مهمة لمن تحته (رئيس القسم لأي أحد)، والمكلَّف يرد بتأشيرة العمل:
// «تم» أو «مازال يستأنف»، فيُنشر الرد ذاتياً في مجموعة الأعمال التي يختارها (تبقى ثابتة حتى يغيّرها)،
// ويُحسب العمل في النقاط والتقارير. وإن مرّت ١٢ ساعة دون نشر تظهر للمسؤول ملاحظة «لم ينشر حتى الآن».
// السحابة تنقل فقط (relay)، والمهام نفسها على جوال المرسل وجوال المكلَّف.
import { api } from './cloud.js';
import { getSetting, setSetting } from './storage.js';
import { groupMe, groupMembers, groupBranch, sendGroup, GENERAL } from './group.js';

export const taskEvents = new EventTarget(); // change
const emit = () => taskEvents.dispatchEvent(new Event('change'));
export const STATUS = { sent: 'أُرسلت', received: 'وصلت', ongoing: 'مازال يستأنف', done: 'تم' };
export const SILENT_MS = 12 * 3600 * 1000;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// مهام كل حساب منفصلة (قد يدخل أكثر من حساب من الجهاز نفسه في التجربة)
const key = () => `tasks_${groupMe()?.uid || 'x'}`;
export async function listTasks() { return (await getSetting(key(), [])) || []; }
async function saveTasks(list) { await setSetting(key(), list.slice(0, 500)); emit(); }
async function upsert(t) {
  const list = await listTasks();
  const i = list.findIndex((x) => x.id === t.id && x.from === t.from);
  if (i >= 0) list[i] = { ...list[i], ...t }; else list.unshift(t);
  await saveTasks(list);
}

// من يستطيع تكليفه: رئيس القسم كل الموظفين، والمسؤول فريق فرعه
export function assignable() {
  const me = groupMe();
  if (!me) return [];
  const all = groupMembers();
  const ids = me.role === 'manager' ? [...all.keys()].filter((u) => u !== me.uid) : (groupBranch()?.team || []);
  return ids.filter((u) => all.has(u)).map((u) => ({ uid: u, name: all.get(u).name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
export const canAssign = () => groupMe()?.role === 'manager' || (groupBranch()?.team || []).length > 0;

async function relay(pending, text, task, extra = {}) {
  const me = groupMe();
  const { db, F } = await api();
  const ref = F.doc(F.collection(db, 'relay'));
  await F.setDoc(ref, {
    mid: ref.id, from: me.uid, fromName: me.name, text: String(text).slice(0, 4000), sentAt: Date.now(),
    createdAt: F.serverTimestamp(), pending, task, ...extra,
  });
}

// ---- المرسل ----
export async function sendTask({ to, title, text = '', due = '' }) {
  const me = groupMe();
  title = String(title || '').trim().slice(0, 120);
  if (!title) throw new Error('اكتب عنوان المهمة.');
  const who = groupMembers().get(to);
  if (!who) throw new Error('اختر من تكلّفه.');
  const t = {
    id: uid(), from: me.uid, fromName: me.name, to, toName: who.name, title, text: String(text).trim().slice(0, 800),
    due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '', createdAt: Date.now(), lastAt: Date.now(), status: 'sent', updates: [], mine: true,
  };
  await upsert(t);
  try {
    await relay([to], `📌 مهمة: ${title}`, { kind: 'new', id: t.id, title: t.title, text: t.text, due: t.due, toName: t.toName });
  } catch (err) {
    await upsert({ ...t, failed: String(err?.code || err?.message || err) });
    throw new Error(/permission/i.test(String(err?.code)) ? 'لا تستطيع تكليف هذا الشخص (خارج فرعك)، أو القواعد في Firebase قديمة.' : err.message);
  }
  return t;
}
export async function deleteTask(t) { await saveTasks((await listTasks()).filter((x) => !(x.id === t.id && x.from === t.from))); }

// ---- المكلَّف ----
// status: done | ongoing · work: { id, name } · room: مجموعة النشر (تُحفظ ثابتة)
export async function replyTask(t, { status, work = null, count = 1, note = '', image = null, room = GENERAL }) {
  const me = groupMe();
  count = Math.max(1, Math.min(50, Math.round(Number(count) || 1)));
  note = String(note || '').trim().slice(0, 600);
  const upd = { at: Date.now(), status, ...(work ? { work: work.name, count } : {}), ...(note ? { note } : {}), ...(image ? { image: true } : {}) };
  await upsert({ id: t.id, from: t.from, status, lastAt: upd.at, updates: [...(t.updates || []), upd] });
  await setSetting(`taskRoom_${me.uid}`, room);
  // ١) الرد إلى المسؤول
  const head = status === 'done' ? '✅ تم' : '⏳ مازال يستأنف';
  const line = `${head}: ${t.title}${work ? ` — ${work.name}${count > 1 ? ` ×${count}` : ''}` : ''}${note ? `\n${note}` : ''}`;
  await relay([t.from], line, { kind: 'update', id: t.id, status, ...(work ? { work: work.name, count } : {}), ...(note ? { note } : {}) });
  // ٢) النشر الذاتي في مجموعة الأعمال: يُحسب منه العمل في النقاط والتقارير
  await sendGroup({ text: line, image, room, ...(work ? { work: { id: work.id, name: work.name, count } } : {}) });
}
export async function taskRoom() { return (await getSetting(`taskRoom_${groupMe()?.uid}`, GENERAL)) || GENERAL; }

// ---- الاستلام (من group.js) ----
export async function onTaskMessage(x) {
  const me = groupMe();
  const k = x.task || {};
  if (k.kind === 'new') {
    const exists = (await listTasks()).some((t) => t.id === k.id && t.from === x.from);
    if (exists) return;
    await upsert({
      id: k.id, from: x.from, fromName: x.fromName, to: me.uid, toName: me.name, title: k.title || x.text, text: k.text || '',
      due: k.due || '', createdAt: x.sentAt || Date.now(), lastAt: Date.now(), status: 'received', updates: [], mine: false, unseen: true,
    });
    // إشعار الاستلام للمرسل («وصلت»)
    relay([x.from], `📥 وصلت: ${k.title || ''}`, { kind: 'update', id: k.id, status: 'received' }).catch(() => {});
  } else if (k.kind === 'update') {
    const t = (await listTasks()).find((y) => y.id === k.id && y.from === me.uid);
    if (!t) return;
    // «وصلت» لا يغيّر مهمة أُنجزت أو مستمرة
    if (k.status === 'received' && t.status !== 'sent') return;
    const upd = { at: x.sentAt || Date.now(), status: k.status, ...(k.work ? { work: k.work, count: k.count || 1 } : {}), ...(k.note ? { note: k.note } : {}) };
    await upsert({ id: t.id, from: t.from, status: k.status, lastAt: k.status === 'received' ? t.lastAt : upd.at, updates: k.status === 'received' ? t.updates : [...(t.updates || []), upd], silentNoted: false });
  }
}

// ---- ١٢ ساعة بلا نشر: ملاحظة للمسؤول (على جواله) ----
export const isSilent = (t) => t.mine && t.status !== 'done' && Date.now() - (t.lastAt || t.createdAt) > SILENT_MS;
export async function checkSilent(onNote) {
  if (!groupMe()) return;
  const list = await listTasks();
  let changed = false;
  for (const t of list) {
    if (isSilent(t) && !t.silentNoted) {
      t.silentNoted = true;
      changed = true;
      onNote?.(`${t.toName} لم ينشر حتى الآن: ${t.title}`);
    }
  }
  if (changed) await saveTasks(list);
}
export async function unseenCount() {
  return (await listTasks()).filter((t) => (!t.mine && t.status !== 'done' && t.unseen) || (t.mine && isSilent(t))).length;
}
export async function markSeen() {
  const list = await listTasks();
  if (!list.some((t) => t.unseen)) return;
  list.forEach((t) => { delete t.unseen; });
  await saveTasks(list);
}

// ---- تأشيرات العمل: أسماء الأعمال (بلا نقاطها) ينشرها رئيس القسم، ويقرؤها الجميع ----
export async function publishCatalog(works) {
  const { db, F } = await api();
  await F.setDoc(F.doc(db, 'catalog', 'works'), { list: works.map((w) => ({ id: w.id, name: w.name })).slice(0, 200), at: F.serverTimestamp() });
}
export async function catalog() {
  if (groupMe()?.role === 'manager') {
    const { getWorks } = await import('./points.js');
    return (await getWorks()).map((w) => ({ id: w.id, name: w.name }));
  }
  const { db, F } = await api();
  try { const d = await F.getDoc(F.doc(db, 'catalog', 'works')); return d.exists() ? d.data().list || [] : []; } catch { return []; }
}
