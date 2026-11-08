// أوامر الذكاء لإدارة المؤسسة (للمدير فقط): عقل المؤسسة، والموظفون، والأعمال والنقاط، والمنشورات.
// كل أمر يعيد { ok, text, link } لعرضه تحت الرد. الحذف لا يتم إلا بعد تأكيد المدير.
import { getSetting } from './storage.js';
import { normalize } from './recall.js';
import {
  TYPES, loadStructure, saveStructure, nodeById, addNode, addCustom, setColor, toggleLink, renameNode,
  removeNode, placesOf, placePerson, removePlace, unplacePerson, canHaveAssistant,
} from './org-structure.js';
import {
  getWorks, addWork, updateWork, removeWork, addManual, suggestions, approve, reject, setAuto,
} from './points.js';
import { sendGroup, groupMembers, startGroupSync } from './group.js';
import { createInvite, inviteLink, listMembers, session } from './cloud.js';
import { makeReport, assignTask, listTasks, completeTask, insightsContext } from './org-insights.js';

const orgName = async () => (await session().catch(() => null))?.org?.name || 'القسم';

const say = (ok, text, link) => ({ ok, text, link });
export const ORG_ACTIONS = new Set([
  'org_add_branch', 'org_add_custom', 'org_rename', 'org_delete', 'org_move', 'org_set_color', 'org_link',
  'org_place_employee', 'org_remove_employee', 'org_set_assistant',
  'work_add', 'work_update', 'work_delete', 'points_add', 'points_review', 'points_auto',
  'post_to_group', 'invite_employee', 'make_org_report', 'assign_task', 'complete_org_task',
]);

// يطابق الأسماء مع تسامح في الهمزات والتشكيل و"ال" التعريف
const norm = (s) => normalize(String(s || '')).replace(/(^|\s)ال/g, '$1').replace(/\s+/g, ' ').trim();
function best(list, name, key) {
  const q = norm(name);
  if (!q) return null;
  return list.find((x) => norm(key(x)) === q)
    || list.find((x) => norm(key(x)).includes(q) || q.includes(norm(key(x))))
    || null;
}
const findNode = (st, name) => (name === 'root' ? nodeById(st, 'root') : best(st.nodes, name, (n) => n.name));

async function employees() {
  try { return (await listMembers()).filter((m) => m.role === 'employee'); } catch {
    return [...groupMembers()].filter(([, m]) => m.role === 'employee').map(([user_id, m]) => ({ user_id, display_name: m.name }));
  }
}
const findEmployee = (list, name) => best(list, name, (m) => m.display_name);
const nodesList = (v) => String(v || '').split(/[،,]| و /).map((x) => x.trim()).filter(Boolean);

export async function runOrgAction(a) {
  if (await getSetting('orgRole', null) !== 'manager') return say(false, 'إدارة المؤسسة للمدير فقط. ادخل بحساب المدير أولاً.', '#/org');
  // أول مرة: القسم الرئيسي باسم المؤسسة
  const st = await loadStructure(await orgName());
  const save = () => saveStructure(st);
  const need = (x, what) => { if (!x) throw new Error(`لم أجد ${what}`); return x; };

  switch (a.action) {
    // ---- عقل المؤسسة ----
    case 'org_add_branch': {
      const parent = need(findNode(st, a.target || 'root'), `«${a.target}»`);
      const childType = TYPES[parent.type].child;
      if (!childType) return say(false, `لا يُضاف فرع تحت ${TYPES[parent.type].label} «${parent.name}»`);
      const n = addNode(st, parent.id, a.name);
      await save();
      return say(true, `أضفتُ ${TYPES[childType].label} «${n.name}» تحت «${parent.name}»`, '#/structure');
    }
    case 'org_add_custom': {
      const links = nodesList(a.target).map((t) => findNode(st, t)).filter(Boolean);
      const color = /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : undefined;
      const n = addCustom(st, links[0]?.id || 'root', a.name, color);
      for (const l of links.slice(1)) toggleLink(st, n.id, l.id);
      await save();
      return say(true, `أضفتُ كرة «${n.name}»${links.length ? ` مرتبطة بـ ${links.map((l) => `«${l.name}»`).join('، ')}` : ''}`, '#/structure');
    }
    case 'org_rename': {
      const n = need(findNode(st, a.target), `«${a.target}»`);
      const old = n.name;
      renameNode(st, n.id, a.name);
      await save();
      return say(true, `غيّرتُ «${old}» إلى «${n.name}»`, '#/structure');
    }
    case 'org_delete': {
      const n = need(findNode(st, a.target), `«${a.target}»`);
      if (n.id === 'root') return say(false, 'القسم الرئيسي لا يُحذف');
      if (!confirm(`الذكاء يريد حذف «${n.name}»${n.type === 'custom' ? '' : ' وكل ما تحته'} من عقل المؤسسة. موافق؟`)) return say(false, 'لم يُحذف (ألغيتَ)');
      removeNode(st, n.id);
      await save();
      return say(true, `حذفتُ «${n.name}»`, '#/structure');
    }
    case 'org_move': {
      // نقل فرع إلى أب آخر من النوع الصحيح (وحدة تحت شعبة، قسم وحدة تحت وحدة...)
      const n = need(findNode(st, a.target), `«${a.target}»`);
      const to = need(findNode(st, a.value), `«${a.value}»`);
      if (n.type === 'custom') return say(false, 'الكرات المخصصة تُربط ولا تُنقل؛ اطلب ربطها بفرع');
      if (TYPES[to.type].child !== n.type) return say(false, `«${n.name}» (${TYPES[n.type].label}) لا تكون تحت ${TYPES[to.type].label}`);
      n.parent = to.id;
      await save();
      return say(true, `نقلتُ «${n.name}» إلى تحت «${to.name}»`, '#/structure');
    }
    case 'org_set_color': {
      const n = need(findNode(st, a.target), `«${a.target}»`);
      if (n.type !== 'custom') return say(false, 'ألوان القسم والشعب والوحدات ثابتة؛ اللون للكرات المخصصة');
      if (!/^#[0-9a-f]{6}$/i.test(a.color || '')) return say(false, 'اللون غير مفهوم');
      setColor(st, n.id, a.color);
      await save();
      return say(true, `غيّرتُ لون «${n.name}»`, '#/structure');
    }
    case 'org_link': {
      const n = need(findNode(st, a.target), `«${a.target}»`);
      if (n.type !== 'custom') return say(false, 'الربط بعدة فروع للكرات المخصصة فقط');
      const added = [];
      for (const t of nodesList(a.value)) {
        const o = findNode(st, t);
        if (o && !(n.links || []).includes(o.id)) { toggleLink(st, n.id, o.id); added.push(o.name); }
      }
      await save();
      return added.length ? say(true, `ربطتُ «${n.name}» بـ ${added.map((x) => `«${x}»`).join('، ')}`, '#/structure') : say(false, 'لم أجد فروعاً جديدة للربط');
    }
    case 'org_place_employee': {
      const emp = need(findEmployee(await employees(), a.employee || a.name), `موظفاً باسم «${a.employee || a.name}»`);
      const n = need(findNode(st, a.target), `«${a.target}»`);
      placePerson(st, emp.user_id, n.id, false);
      await save();
      return say(true, `وضعتُ ${emp.display_name} في «${n.name}»`, '#/structure');
    }
    case 'org_remove_employee': {
      const emp = need(findEmployee(await employees(), a.employee || a.name), `موظفاً باسم «${a.employee || a.name}»`);
      if (a.target) {
        const n = need(findNode(st, a.target), `«${a.target}»`);
        removePlace(st, emp.user_id, n.id);
        await save();
        return say(true, `أخرجتُ ${emp.display_name} من «${n.name}»`, '#/structure');
      }
      unplacePerson(st, emp.user_id);
      await save();
      return say(true, `أخرجتُ ${emp.display_name} من كل الهيكل (يبقى في المؤسسة)`, '#/structure');
    }
    case 'org_set_assistant': {
      const emp = need(findEmployee(await employees(), a.employee || a.name), `موظفاً باسم «${a.employee || a.name}»`);
      const n = need(findNode(st, a.target), `«${a.target}»`);
      if (!canHaveAssistant(n.type)) return say(false, 'المعاون للقسم والشعب والوحدات فقط');
      placePerson(st, emp.user_id, n.id, true);
      await save();
      return say(true, `جعلتُ ${emp.display_name} معاون «${n.name}»`, '#/structure');
    }

    // ---- الأعمال والنقاط ----
    case 'work_add': {
      await addWork(a.name, Number(a.value) || 1);
      return say(true, `أضفتُ عمل «${a.name}» بـ ${Number(a.value) || 1} نقطة`, '#/points');
    }
    case 'work_update': {
      const w = need(best(await getWorks(), a.target, (x) => x.name), `عملاً باسم «${a.target}»`);
      await updateWork(w.id, { name: a.name || undefined, points: a.value ? Number(a.value) : undefined });
      return say(true, `عدّلتُ عمل «${w.name}»`, '#/points');
    }
    case 'work_delete': {
      const w = need(best(await getWorks(), a.target, (x) => x.name), `عملاً باسم «${a.target}»`);
      if (!confirm(`الذكاء يريد حذف عمل «${w.name}» من قائمة الأعمال (النقاط المسجلة تبقى). موافق؟`)) return say(false, 'لم يُحذف (ألغيتَ)');
      await removeWork(w.id);
      return say(true, `حذفتُ عمل «${w.name}»`, '#/points');
    }
    case 'points_add': {
      const emp = need(findEmployee(await employees(), a.employee || a.name), `موظفاً باسم «${a.employee || a.name}»`);
      const w = need(best(await getWorks(), a.target, (x) => x.name), `عملاً باسم «${a.target}» في قائمة الأعمال`);
      const count = Math.max(1, Math.min(50, parseInt(a.value, 10) || 1));
      await addManual({ user: emp.user_id, workId: w.id, count, note: 'سجّلها الذكاء بطلبك' });
      return say(true, `سجّلتُ لـ ${emp.display_name}: ${w.name}${count > 1 ? ` ×${count}` : ''} (+${w.points * count})`, '#/points');
    }
    case 'points_review': {
      const list = await suggestions();
      if (!list.length) return say(true, 'لا اقتراحات معلقة');
      const ok = String(a.value || '').toLowerCase().startsWith('a') || /قبول|موافق/.test(a.value || '');
      for (const p of list) await (ok ? approve(p.id) : reject(p.id));
      return say(true, `${ok ? 'قبلتُ' : 'رفضتُ'} ${list.length} من اقتراحات النقاط`, '#/points');
    }
    case 'points_auto': {
      const on = !['off', 'false', '0', 'لا', 'إيقاف'].includes(String(a.value || '').toLowerCase());
      await setAuto(on);
      return say(true, on ? 'فعّلتُ الاحتساب التلقائي للنقاط' : 'أوقفتُ الاحتساب التلقائي؛ النقاط تنتظر موافقتك', '#/points');
    }

    // ---- المنشورات والموظفون ----
    case 'post_to_group': {
      const text = String(a.value || a.name || '').trim();
      if (!text) return say(false, 'لا نص للنشر');
      if (!confirm(`الذكاء سينشر في مجموعة المؤسسة باسمك:\n\n«${text}»\n\nموافق؟`)) return say(false, 'لم يُنشر (ألغيتَ)');
      await startGroupSync();
      await sendGroup({ text });
      return say(true, 'نشرتُ في المجموعة', '#/group');
    }
    case 'invite_employee': {
      const code = await createInvite({ name: a.name, username: a.value });
      const link = await inviteLink(code);
      try { await navigator.clipboard.writeText(link); } catch { /* يُنسخ من صفحة الموظفين */ }
      return say(true, `أنشأتُ دعوة ${a.name} (اسم الدخول ${a.value}) ونسختُ رابطها لترسله له`, '#/staff');
    }
    // ---- التقارير والمهام ----
    case 'make_org_report': {
      const period = String(a.value || '').startsWith('m') || /شهر/.test(a.value || '') ? 'month' : 'week';
      const r = await makeReport(period);
      return say(true, `جهّزتُ ${period === 'month' ? 'تقرير الشهر' : 'تقرير الأسبوع'}: «${r.headline}»`, '#/reports');
    }
    case 'assign_task': {
      const emp = need(findEmployee(await employees(), a.employee || a.name), `موظفاً باسم «${a.employee || a.name}»`);
      const text = String(a.value || '').trim();
      if (!text) return say(false, 'ما المهمة؟');
      const w = a.target ? best(await getWorks(), a.target, (x) => x.name) : null;
      if (!confirm(`الذكاء سيكلّف ${emp.display_name} بهذه المهمة وينشرها في المجموعة:\n\n«${text}»${w ? `\n(عند إنجازها: ${w.name} +${w.points})` : ''}\n\nموافق؟`)) return say(false, 'لم تُكلَّف (ألغيتَ)');
      await assignTask({ user: emp.user_id, name: emp.display_name, text, workId: w?.id || null });
      return say(true, `كلّفتُ ${emp.display_name}: ${text}`, '#/reports');
    }
    case 'complete_org_task': {
      const open = (await listTasks()).filter((x) => !x.done);
      const t = need(best(open, a.target, (x) => `${x.name} ${x.text}`) || best(open, a.target, (x) => x.text), 'مهمة مفتوحة بهذا الوصف');
      await completeTask(t.id);
      return say(true, `علّمتُ مهمة ${t.name} كمنجزة${t.workId ? ' وسجّلتُ نقاطها' : ''}`, '#/reports');
    }
    default:
      return null;
  }
}

// ملخص المؤسسة للذكاء (يُرفق بالطلب ليعرف الأسماء الحالية)
export async function orgContext() {
  const role = await getSetting('orgRole', null);
  if (role === 'employee') return branchContext();
  if (role !== 'manager') return '';
  const st = await loadStructure(await orgName());
  const emps = [...groupMembers()].filter(([, m]) => m.role === 'employee');
  const nodes = st.nodes.map((n) => `${n.name} (${TYPES[n.type].label}${n.parent ? ` تحت ${nodeById(st, n.parent)?.name}` : ''}${n.links ? ` مرتبطة بـ ${n.links.map((l) => nodeById(st, l)?.name).join('/')}` : ''})`);
  const people = emps.map(([u, m]) => {
    const pl = placesOf(st, u).map((x) => `${x.assistant ? 'معاون ' : ''}${nodeById(st, x.node).name}`);
    return `${m.name}${pl.length ? `: ${pl.join('، ')}` : ': غير موزع'}`;
  });
  const works = (await getWorks()).map((w) => `${w.name} = ${w.points}`);
  const pending = (await suggestions()).length;
  return `
المدير يدير مؤسسة. عقل المؤسسة (الهيكل) الآن:
${nodes.slice(0, 80).join('\n')}
الموظفون: ${people.slice(0, 80).join(' | ') || 'لا أحد بعد'}
الأعمال ونقاطها: ${works.join('، ') || 'لا شيء بعد'}
اقتراحات نقاط تنتظر موافقته: ${pending}
${await insightsContext().catch(() => '')}`;
}

// المسؤول: يعرف المساعد فرعه فقط (لا ينفّذ أوامر إدارة المؤسسة، فهي لرئيس القسم)
async function branchContext() {
  const { groupBranch } = await import('./group.js');
  const b = groupBranch();
  if (!b?.perms?.assistant) return '';
  const byId = new Map(b.nodes.map((n) => [n.id, n]));
  const nodes = b.nodes.map((n) => `${n.name} (${TYPES[n.type]?.label || ''}${n.parent ? ` تحت ${byId.get(n.parent)?.name}` : ''})`);
  const people = b.people.map((p) => `${p.name}: ${p.places.map((pl) => `${pl.head ? 'مسؤول ' : pl.assistant ? 'معاون ' : ''}${byId.get(pl.node)?.name || ''}`).join('، ')}`);
  const evals = b.evals ? b.people.filter((p) => b.evals[p.uid]).map((p) => `${p.name}: ${b.evals[p.uid].month} نقطة هذا الشهر${b.evals[p.uid].works.length ? ` (${b.evals[p.uid].works.join('، ')})` : ''}`) : [];
  return `
أنت تساعد مسؤولاً في المؤسسة على فرعه. فرعه: ${b.heads.map((h) => byId.get(h)?.name).filter(Boolean).join('، ')}.
الكرات: ${nodes.join('؛ ')}.
الأشخاص: ${people.join('؛ ')}.${evals.length ? `\nالتقييمات: ${evals.join('؛ ')}.` : ''}
أوامر إدارة الهيكل (org_*) لرئيس القسم وحده؛ إن طلبها المسؤول فاشرح له أنها من شاشة «الأقسام».`;
}
