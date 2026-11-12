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
// كل حساب قائمته على الجهاز، ولا تُقرأ ولا تُكتب بلا حساب مسجّل (حتى لا تختلط بين الحسابات)
const key = () => (groupMe()?.uid ? `tasks_${groupMe().uid}` : null);
// لا تظهر إلا المهام التي أرسلها هذا الحساب، أو استلمها هو
export async function listTasks() {
  const k = key();
  if (!k) return [];
  const me = groupMe();
  return ((await getSetting(k, [])) || []).filter((t) => (t.mine ? t.from === me.uid : t.to === me.uid));
}
async function saveTasks(list) { const k = key(); if (!k) return; await setSetting(k, list.slice(0, 500)); emit(); }
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
// كروب المُصدِر: كروب كرته، ورئيس القسم كروبه العامة. يُحفظ مع المهمة فيكون الرد فيه افتراضياً
function issuerRoom() {
  const me = groupMe();
  if (me?.role === 'manager') return GENERAL;
  const head = groupBranch()?.heads?.[0];
  return head ? `n_${head}` : GENERAL;
}
export async function sendTask({ to, title, text = '', due = '' }) {
  const me = groupMe();
  title = String(title || '').trim().slice(0, 120);
  if (!title) throw new Error('اكتب عنوان المهمة.');
  const who = groupMembers().get(to);
  if (!who) throw new Error('اختر من تكلّفه.');
  const t = {
    id: uid(), from: me.uid, fromName: me.name, to, toName: who.name, title, text: String(text).trim().slice(0, 800),
    due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '', createdAt: Date.now(), lastAt: Date.now(), status: 'sent', updates: [], mine: true, room: issuerRoom(),
  };
  await upsert(t);
  try {
    await relay([to], `📌 مهمة: ${title}`, { kind: 'new', id: t.id, title: t.title, text: t.text, due: t.due, toName: t.toName, room: t.room });
  } catch (err) {
    await upsert({ ...t, failed: String(err?.code || err?.message || err) });
    throw new Error(/permission/i.test(String(err?.code)) ? 'لا تستطيع تكليف هذا الشخص (خارج فرعك)، أو القواعد في Firebase قديمة.' : err.message);
  }
  return t;
}
export async function deleteTask(t) { await saveTasks((await listTasks()).filter((x) => !(x.id === t.id && x.from === t.from))); }

// ---- المكلَّف ----
// status: done | ongoing · works: [{ id, name, count }] (أكثر من عمل في المهمة الواحدة)
// helpers: [{ uid?, name }] من ذهب معه (من وحدته، أو اسم يكتبه) · room: مجموعة النشر (تُحفظ ثابتة)
export const worksLine = (works) => works.map((w) => `${w.name}${w.count > 1 ? ` ×${w.count}` : ''}`).join('، ');
export async function replyTask(t, { status, works = [], helpers = [], note = '', image = null, room = GENERAL }) {
  const me = groupMe();
  works = works.slice(0, 10).map((w) => ({ id: w.id, name: w.name, count: Math.max(1, Math.min(50, Math.round(Number(w.count) || 1))) }));
  helpers = helpers.slice(0, 20).map((h) => ({ ...(h.uid ? { uid: h.uid } : {}), name: String(h.name || '').trim().slice(0, 60) })).filter((h) => h.name);
  note = String(note || '').trim().slice(0, 600);
  const wl = worksLine(works);
  const hl = helpers.map((h) => h.name).join('، ');
  const upd = { at: Date.now(), status, ...(wl ? { work: wl } : {}), ...(hl ? { helpers: hl } : {}), ...(note ? { note } : {}), ...(image ? { image: true } : {}) };
  await upsert({ id: t.id, from: t.from, status, lastAt: upd.at, updates: [...(t.updates || []), upd] });
  await setSetting(`taskRoom_${me.uid}`, room);
  // ١) الرد إلى المسؤول
  const head = status === 'done' ? '✅ تم' : '⏳ مازال يستأنف';
  const line = `${head}: ${t.title}${wl ? ` — ${wl}` : ''}${hl ? `\nمعي: ${hl}` : ''}${note ? `\n${note}` : ''}`;
  await relay([t.from], line, { kind: 'update', id: t.id, status, ...(wl ? { work: wl } : {}), ...(hl ? { helpers: hl } : {}), ...(note ? { note } : {}) });
  // ٢) النشر الذاتي في مجموعة الأعمال: يُحسب منه العمل له ولمعاونيه في النقاط والتقارير
  const ids = helpers.map((h) => h.uid).filter(Boolean);
  await sendGroup({ text: line, image, room, ...(works.length ? { works } : {}), ...(ids.length ? { helpers: ids } : {}) });
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
      due: k.due || '', createdAt: x.sentAt || Date.now(), lastAt: Date.now(), status: 'received', updates: [], mine: false, unseen: true, room: k.room || '',
    });
    // إشعار الاستلام للمرسل («وصلت»)
    relay([x.from], `📥 وصلت: ${k.title || ''}`, { kind: 'update', id: k.id, status: 'received' }).catch(() => {});
  } else if (k.kind === 'update') {
    const t = (await listTasks()).find((y) => y.id === k.id && y.from === me.uid);
    if (!t) return;
    // «وصلت» لا يغيّر مهمة أُنجزت أو مستمرة
    if (k.status === 'received' && t.status !== 'sent') return;
    const upd = { at: x.sentAt || Date.now(), status: k.status, ...(k.work ? { work: k.work, ...(k.count > 1 ? { count: k.count } : {}) } : {}), ...(k.helpers ? { helpers: k.helpers } : {}), ...(k.note ? { note: k.note } : {}) };
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
