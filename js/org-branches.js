// فروع المسؤولين (A40، المرحلة ٢). هاتف رئيس القسم هو النسخة الأصلية للهيكل (حتى تأخذ دوره حواسيب المؤسسة، A18):
// - ينشر لكل مسؤول فرعه فقط (كراته وما تحتها، ومن فيها، وخيارات إظهاره) في branches/{uid}، فيحتفظ به جواله.
// - يستلم طلبات المسؤولين (إضافة كرة، تسمية، حذف، وضع شخص، حذف حساب)، فيتحقق أنها داخل فرع الطالب وصلاحياته، ثم يطبّقها.
import { api, removeMember } from './cloud.js';
import { getSetting, setSetting } from './storage.js';
import {
  TYPES, colorOf, nodeById, permsOf, withStructure, addNode, addCustom, renameNode, removeNode,
  placePerson, setHead, removePlace, unplacePerson, canHaveHead, setProject,
} from './org-structure.js';

const KEY = 'branchesPublished'; // uid ← توقيع آخر ما نُشر
const PERM_KEYS = ['sections', 'accounts', 'projects', 'assistantAsHead', 'assistant', 'mind', 'evals'];

// كرات المسؤول: ما هو مسؤوله، أو معاونه إن كان للمعاون صلاحيات المسؤول
export function headedBy(st, uid) {
  return (st.people[uid]?.places || []).filter((pl) => {
    const n = nodeById(st, pl.node);
    if (!n || n.id === 'root') return false;
    return pl.head || (pl.assistant && permsOf(n).assistantAsHead);
  }).map((pl) => pl.node);
}
// الكرة وما تحتها، ومعها كرات المشاريع المرتبطة بها
export function subtree(st, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of st.nodes) {
      if (ids.has(n.id)) continue;
      if ((n.parent && ids.has(n.parent)) || (n.type === 'custom' && (n.links || []).some((l) => ids.has(l)))) { ids.add(n.id); grew = true; }
    }
  }
  return ids;
}

// يحسب فرع مسؤول: { heads, nodes, people, perms, manage }
export function branchOf(st, uid, names) {
  const heads = headedBy(st, uid);
  if (!heads.length) return null;
  const ids = new Set(), manage = new Set(), projects = new Set();
  const perms = Object.fromEntries(PERM_KEYS.map((k) => [k, false]));
  for (const h of heads) {
    const sub = subtree(st, h);
    sub.forEach((x) => ids.add(x));
    const p = permsOf(nodeById(st, h));
    for (const k of PERM_KEYS) perms[k] ||= !!p[k];
    if (p.accounts) sub.forEach((x) => { if (nodeById(st, x)?.type !== 'custom') manage.add(x); });
    if (p.projects) sub.forEach((x) => projects.add(x));
  }
  const nodes = st.nodes.filter((n) => ids.has(n.id)).map((n) => ({
    id: n.id, type: n.type, name: n.name, parent: ids.has(n.parent) ? n.parent : null, color: colorOf(n),
    ...(n.type === 'custom' ? { links: (n.links || []).filter((l) => ids.has(l)), ...(n.project ? { project: n.project } : {}) } : {}),
    ...(projects.has(n.id) ? { proj: true } : {}),
  }));
  const people = Object.entries(st.people).map(([u, p]) => {
    const places = p.places.filter((pl) => ids.has(pl.node)).map((pl) => ({ node: pl.node, ...(pl.head ? { head: true } : {}), ...(pl.assistant ? { assistant: true } : {}) }));
    return places.length && names.has(u) ? { uid: u, name: names.get(u), places } : null;
  }).filter(Boolean);
  return { heads, nodes, people, perms, manage: [...manage] };
}

// members: Map(uid ← { name, role })
export async function publishBranches(st, members) {
  const names = new Map([...members].map(([u, m]) => [u, m.name]));
  const { db, F } = await api();
  const done = (await getSetting(KEY, {})) || {};
  const now = {};
  for (const [uid, m] of members) {
    if (m.role === 'manager') continue;
    const b = branchOf(st, uid, names);
    if (!b) continue;
    const sig = JSON.stringify(b);
    now[uid] = sig;
    if (done[uid] === sig) continue;
    await F.setDoc(F.doc(db, 'branches', uid), { ...b, at: F.serverTimestamp() });
  }
  // لم يعد مسؤولاً: يُحذف فرعه
  for (const uid of Object.keys(done)) if (!now[uid]) await F.deleteDoc(F.doc(db, 'branches', uid)).catch(() => {});
  await setSetting(KEY, now);
}

// ---- طلبات المسؤولين ----
const clean = (s, max = 50) => String(s || '').trim().slice(0, max);
function check(st, from, op, p, members) {
  const heads = headedBy(st, from);
  if (!heads.length) return 'ليس مسؤولاً';
  const mine = new Set(), manage = new Set(), proj = new Set();
  for (const h of heads) {
    const sub = subtree(st, h);
    const pm = permsOf(nodeById(st, h));
    sub.forEach((x) => mine.add(x));
    if (pm.accounts) sub.forEach((x) => manage.add(x));
    if (pm.projects) sub.forEach((x) => proj.add(x));
  }
  const inBranch = (u) => (st.people[u]?.places || []).some((pl) => mine.has(pl.node));
  switch (op) {
    case 'addNode': return manage.has(p.parent) && TYPES[nodeById(st, p.parent)?.type]?.child && clean(p.name) ? null : 'خارج صلاحيته';
    case 'addProject': return proj.has(p.link) && clean(p.name) ? null : 'خارج صلاحيته';
    case 'rename': return (manage.has(p.id) || (proj.has(p.id) && nodeById(st, p.id)?.type === 'custom')) && clean(p.name) ? null : 'خارج صلاحيته';
    case 'project': return proj.has(p.id) && nodeById(st, p.id)?.type === 'custom' ? null : 'خارج صلاحيته';
    case 'removeNode': return !heads.includes(p.id) && (manage.has(p.id) || (proj.has(p.id) && nodeById(st, p.id)?.type === 'custom')) ? null : 'خارج صلاحيته';
    case 'place': {
      const n = nodeById(st, p.node);
      const okNode = manage.has(p.node) || (n?.type === 'custom' && proj.has(p.node) && (p.title || 'member') === 'member');
      return okNode && members.has(p.uid) && inBranch(p.uid) && ['head', 'assistant', 'member'].includes(p.title || 'member') ? null : 'خارج صلاحيته';
    }
    case 'unplace': return (manage.has(p.node) || (proj.has(p.node) && nodeById(st, p.node)?.type === 'custom')) && p.uid !== from ? null : 'خارج صلاحيته';
    case 'deleteAccount': {
      const pl = st.people[p.uid]?.places || [];
      return p.uid !== from && members.get(p.uid)?.role === 'employee' && pl.length && pl.every((x) => manage.has(x.node)) ? null : 'خارج صلاحيته';
    }
    default: return 'طلب غير معروف';
  }
}

let running = false, again = false;
// docs: [{ id, data }] من requests؛ يطبّق الصالح ويحذف الكل
export async function handleRequests(docs, members) {
  if (running) { again = true; return; }
  running = true;
  try {
    if (!docs.length) return;
    const { db, F } = await api();
    const del = [];
    await withStructure(async (st) => {
    let changed = false;
    for (const { id, data } of docs.sort((a, b) => (a.data.at?.toMillis?.() || 0) - (b.data.at?.toMillis?.() || 0))) {
      const p = data.payload || {};
      const why = check(st, data.from, data.op, p, members);
      if (!why) {
        try {
          if (data.op === 'addNode') addNode(st, p.parent, clean(p.name));
          else if (data.op === 'addProject') addCustom(st, p.link, clean(p.name), /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : undefined);
          else if (data.op === 'rename') renameNode(st, p.id, clean(p.name));
          else if (data.op === 'removeNode') removeNode(st, p.id);
          else if (data.op === 'project') setProject(st, p.id, { status: p.status, start: p.start, end: p.end, progress: p.progress });
          else if (data.op === 'place') {
            const n = nodeById(st, p.node);
            placePerson(st, p.uid, p.node, p.title === 'assistant');
            if (canHaveHead(n.type)) setHead(st, p.uid, p.node, p.title === 'head');
          } else if (data.op === 'unplace') removePlace(st, p.uid, p.node);
          else if (data.op === 'deleteAccount') { await removeMember(p.uid); unplacePerson(st, p.uid); }
          changed = true;
        } catch (e) { console.warn('request', data.op, e); }
      } else console.warn('رُفض طلب', data.op, 'من', data.from, ':', why);
      del.push(id);
    }
    return changed;
    });
    // تُحذف بعد الحفظ: إن انقطع شيء قبله تبقى الطلبات فتُطبَّق لاحقاً
    for (const id of del) await F.deleteDoc(F.doc(db, 'requests', id)).catch(() => {});
  } finally {
    running = false;
    if (again) { again = false; }
  }
}

// المسؤول: يرسل طلباً إلى هاتف رئيس القسم
export async function sendRequest(op, payload) {
  const { auth, db, F } = await api();
  await F.addDoc(F.collection(db, 'requests'), { from: auth.currentUser.uid, op, payload, at: F.serverTimestamp() });
}
