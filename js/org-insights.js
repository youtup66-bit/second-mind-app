// أدوات المدير الذكية: التقارير، والتنبيهات، والمهام المكلّفة، والتذكيرات، والتراجع عن أوامر الذكاء.
// كل شيء هنا على جهاز المدير فقط.
import {
  getSetting, setSetting, deleteSetting, getGroupMessages, getPoints, putPoint, deletePoint, getEntries, updateEntry,
} from './storage.js';
import { totals, periodStart, getWorks, addManual, suggestions } from './points.js';
import { loadStructure, nodeById, placesOf, projOf, projectLine, projectLate } from './org-structure.js';
import { groupMembers, sendGroup, startGroupSync, countsForPoints } from './group.js';
import { writeOrgReport } from './gemini.js';

export const insightsEvents = new EventTarget(); // change
const changed = () => insightsEvents.dispatchEvent(new Event('change'));
const uid = () => Math.random().toString(36).slice(2, 10);
const DAY = 86400000;
const fmtDay = new Intl.DateTimeFormat('ar', { weekday: 'short', day: 'numeric', month: 'short' });

const employees = () => [...groupMembers()].filter(([, m]) => m.role === 'employee');

// ---- التقارير ----
export const REPORT_PERIODS = { week: 'هذا الأسبوع', month: 'هذا الشهر' };
export const listReports = () => getSetting('orgReports', []);

// period: week | month | project (مع node: كرة المشروع؛ منشورات مجموعته ونقاطها منذ بدايته)
export async function makeReport(period = 'week', { node = null } = {}) {
  if (period === 'project') return makeProjectReport(node);
  const from = periodStart(period);
  const [t, posts, st, works] = await Promise.all([totals(period), getGroupMessages().then((l) => l.filter(countsForPoints)), loadStructure(), getWorks()]);
  const emps = employees();
  const name = (u) => emps.find(([id]) => id === u)?.[1].name || 'موظف سابق';
  const inPeriod = posts.filter((m) => m.sentAt >= from && m.text);
  const people = emps.map(([u, m]) => ({
    name: m.name,
    places: placesOf(st, u).map((x) => nodeById(st, x.node).name),
    points: t.get(u)?.points || 0,
    works: (t.get(u)?.items || []).map((p) => `${p.workName}${p.count > 1 ? ` ×${p.count}` : ''}`),
    posts: inPeriod.filter((x) => x.from === u).length,
  }));
  const data = {
    period: REPORT_PERIODS[period] || period,
    org: st.nodes.find((n) => n.id === 'root')?.name || '',
    people,
    works: works.map((w) => `${w.name} (${w.points})`),
    posts: inPeriod.slice(-150).map((x) => `[${fmtDay.format(x.sentAt)}] ${x.mine ? 'المدير' : name(x.from)}${x.roomName ? ` [${x.roomName}]` : x.tag ? ` (${x.tag})` : ''}: ${x.text.slice(0, 300)}`),
  };
  const r = await writeOrgReport(data);
  const report = { id: uid(), period, from, to: Date.now(), createdAt: Date.now(), ...r };
  await setSetting('orgReports', [report, ...(await listReports())].slice(0, 30));
  changed();
  return report;
}
async function makeProjectReport(nodeId) {
  const [posts, st, works, pts] = await Promise.all([getGroupMessages(), loadStructure(), getWorks(), getPoints()]);
  const n = nodeById(st, nodeId);
  if (!n) throw new Error('لم أجد المشروع.');
  const p = projOf(n);
  const room = `n_${n.id}`;
  const mine = posts.filter((m) => m.room === room && m.text);
  const ids = new Set(mine.map((m) => m.id));
  const emps = employees();
  const name = (u) => emps.find(([id]) => id === u)?.[1].name || 'موظف سابق';
  const team = Object.entries(st.people).filter(([, x]) => x.places.some((pl) => pl.node === n.id)).map(([u]) => u);
  const people = team.map((u) => {
    const mp = pts.filter((x) => x.status === 'approved' && x.user === u && ids.has(x.msgId));
    return {
      name: name(u), places: [n.name], points: mp.reduce((a, x) => a + x.points, 0),
      works: mp.map((x) => `${x.workName}${x.count > 1 ? ` ×${x.count}` : ''}`), posts: mine.filter((x) => x.from === u).length,
    };
  });
  const label = `مشروع «${n.name}»: ${projectLine(n)}`;
  const r = await writeOrgReport({
    period: label, org: st.nodes.find((x) => x.id === 'root')?.name || '', people,
    works: works.map((w) => `${w.name} (${w.points})`),
    posts: mine.slice(-150).map((x) => `[${fmtDay.format(x.sentAt)}] ${x.mine ? 'المدير' : name(x.from)}: ${x.text.slice(0, 300)}`),
  });
  const from = p.start ? new Date(`${p.start}T00:00`).getTime() : (mine[0]?.sentAt || Date.now());
  const report = { id: uid(), period: 'project', label: /^مشروع/.test(n.name) ? `«${n.name}»` : `مشروع «${n.name}»`, node: n.id, from, to: Date.now(), createdAt: Date.now(), ...r };
  await setSetting('orgReports', [report, ...(await listReports())].slice(0, 30));
  changed();
  return report;
}

export async function deleteReport(id) {
  await setSetting('orgReports', (await listReports()).filter((r) => r.id !== id));
  changed();
}
// نص التقرير للمشاركة (واتساب، بريد...)
export function reportText(r) {
  const lines = [`📋 ${r.headline}`, `${r.label || REPORT_PERIODS[r.period] || ''}`, '', r.overview, ''];
  if (r.highlights?.length) lines.push('أبرز الأعمال:', ...r.highlights.map((x) => `- ${x}`), '');
  if (r.people?.length) lines.push('الموظفون:', ...r.people.map((p) => `- ${p.name}: ${p.summary}`), '');
  if (r.problems?.length) lines.push('مشاكل ومتابعات:', ...r.problems.map((x) => `- ${x}`), '');
  if (r.suggestions?.length) lines.push('مقترحات:', ...r.suggestions.map((x) => `- ${x}`));
  return lines.join('\n').trim();
}

// ---- التنبيهات ----
export async function alerts() {
  const out = [];
  const posts = (await getGroupMessages()).filter(countsForPoints);
  const now = Date.now();
  for (const [u, m] of employees()) {
    if (m.joinedAt && now - m.joinedAt < 5 * DAY) continue;
    const last = posts.filter((x) => x.from === u).at(-1)?.sentAt || 0;
    const days = Math.floor((now - last) / DAY);
    if (!last) out.push({ text: `${m.name} لم ينشر أي عمل بعد`, link: '#/group' });
    else if (days >= 5) out.push({ text: `${m.name} لم ينشر منذ ${days} أيام`, link: '#/group' });
  }
  const pending = (await suggestions()).length;
  if (pending) out.push({ text: `${pending} من اقتراحات النقاط تنتظر موافقتك`, link: '#/points' });
  const late = (await listTasks()).filter((x) => !x.done && now - x.at > 3 * DAY);
  for (const x of late) out.push({ text: `مهمة لم تُنجز منذ ${Math.floor((now - x.at) / DAY)} أيام: ${x.text.slice(0, 50)}`, link: '#/reports' });
  // مشاريع تجاوزت موعدها ولم تكتمل
  for (const n of (await loadStructure()).nodes) if (n.type === 'custom' && projectLate(n)) out.push({ text: `مشروع «${n.name}»: ${projectLine(n)}`, link: '#/structure' });
  return out;
}

// ---- المهام المكلّفة ----
export const listTasks = () => getSetting('orgTasks', []);
async function saveTasks(list) { await setSetting('orgTasks', list); changed(); }

// تُنشر في مجموعة المؤسسة ليراها الموظف، وتُحفظ هنا لمتابعتها
// تكليف من المساعد: يصير مهمة حقيقية في «المهام» (يرد عليها المكلَّف بتأشيرة العمل)
export async function assignTask({ user, name, text, workId = null }) {
  await startGroupSync();
  const { sendTask } = await import('./tasks.js');
  const t = await sendTask({ to: user, title: String(text).trim().slice(0, 120) });
  return { id: t.id, user, name, text: t.title, workId, at: t.createdAt, done: false };
}
export async function completeTask(id) {
  const list = await listTasks();
  const t = list.find((x) => x.id === id);
  if (!t || t.done) return;
  t.done = true;
  t.doneAt = Date.now();
  if (t.workId) await addManual({ user: t.user, workId: t.workId, count: 1, note: `مهمة: ${t.text}` }).catch(() => {});
  await saveTasks(list);
}
export async function deleteTask(id) { await saveTasks((await listTasks()).filter((x) => x.id !== id)); }

// ---- التذكيرات ----
export const listReminders = () => getSetting('reminders', []);
export async function addReminder({ at, text }) {
  const when = new Date(at).getTime();
  if (!Number.isFinite(when)) throw new Error('موعد التذكير غير مفهوم');
  const r = { id: uid(), at: when, text: String(text).trim().slice(0, 200), fired: false };
  await setSetting('reminders', [...(await listReminders()), r].sort((a, b) => a.at - b.at));
  try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* لا شيء */ }
  changed();
  return r;
}
export async function deleteReminder(id) {
  await setSetting('reminders', (await listReminders()).filter((r) => r.id !== id));
  changed();
}
// يُستدعى كل نصف دقيقة: ما حان موعده يظهر إشعاراً (وفي التطبيق)
export async function checkReminders(onDue) {
  const list = await listReminders();
  const due = list.filter((r) => !r.fired && r.at <= Date.now());
  if (!due.length) return;
  for (const r of due) {
    r.fired = true;
    onDue?.(r);
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker?.getRegistration();
        const opts = { body: r.text, icon: 'icons/icon-192.png', tag: r.id };
        if (reg) await reg.showNotification('تذكير · عقلي الثاني', opts); else new Notification('تذكير · عقلي الثاني', opts);
      }
    } catch { /* الإشعارات غير متاحة */ }
  }
  await setSetting('reminders', list);
  changed();
}

// ---- التراجع عن أوامر الذكاء ----
// لقطة لما قد تغيّره الأوامر: الهيكل والأعمال والنقاط والأقسام والملاحظات والمهام والتذكيرات وبعض الإعدادات
const UNDO_KEYS = ['orgStructure', 'orgWorks', 'pointsAuto', 'customCategories', 'appTheme', 'speakReplies',
  'mindColorMode', 'mindSpacing', 'showEmptyCats', 'orgTasks', 'reminders'];
const MISSING = '__sm_missing__'; // الإعداد لم يكن موجوداً قبل الأوامر
export async function takeUndoSnapshot() {
  const settings = {};
  for (const k of UNDO_KEYS) settings[k] = await getSetting(k, MISSING);
  return { settings, points: await getPoints(), entries: await getEntries() };
}
export async function restoreUndoSnapshot(snap) {
  for (const [k, v] of Object.entries(snap.settings)) {
    if (v === MISSING) await deleteSetting(k); else await setSetting(k, v);
  }
  const keep = new Set(snap.points.map((p) => p.id));
  for (const p of await getPoints()) if (!keep.has(p.id)) await deletePoint(p.id);
  for (const p of snap.points) await putPoint(p);
  // الملاحظات: نعيد ما حُذف أو تغيّر قسمه (ولا نحذف رسالتك الجديدة)
  for (const e of snap.entries) await updateEntry(e);
  changed();
}

// ملخص إضافي للذكاء: النقاط والمنشورات الأخيرة والتنبيهات والمهام والتذكيرات
export async function insightsContext() {
  const emps = employees();
  const name = (u) => emps.find(([id]) => id === u)?.[1].name || 'موظف سابق';
  const [w, mo, posts, al, tasks, rem] = await Promise.all([totals('week'), totals('month'), getGroupMessages().then((l) => l.filter(countsForPoints)), alerts(), listTasks(), listReminders()]);
  const pts = emps.map(([u, m]) => `${m.name}: أسبوع ${w.get(u)?.points || 0}، شهر ${mo.get(u)?.points || 0}`);
  const recent = posts.filter((x) => x.text).slice(-25).map((x) => `[${fmtDay.format(x.sentAt)}] ${x.mine ? 'المدير' : name(x.from)}${x.roomName ? ` [${x.roomName}]` : x.tag ? ` (${x.tag})` : ''}: ${x.text.slice(0, 160)}`);
  return `
الوقت الآن: ${new Date().toISOString()} (المنطقة الزمنية للجهاز: ${Intl.DateTimeFormat().resolvedOptions().timeZone}).
نقاط الموظفين: ${pts.join(' | ') || 'لا شيء'}
آخر المنشورات في المجموعة:
${recent.join('\n') || 'لا شيء'}
تنبيهات: ${al.map((a) => a.text).join(' | ') || 'لا شيء'}
مهام مكلّفة مفتوحة: ${tasks.filter((x) => !x.done).map((x) => `${x.name}: ${x.text}`).join(' | ') || 'لا شيء'}
تذكيرات قادمة: ${rem.filter((r) => !r.fired).map((r) => `${new Date(r.at).toISOString()} ${r.text}`).join(' | ') || 'لا شيء'}
أجيبي عن أسئلة المدير عن مؤسسته من هذه البيانات فقط، بدقة ودون اختراع.`;
}
