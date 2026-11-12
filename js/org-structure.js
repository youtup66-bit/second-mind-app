// عقل المؤسسة: القسم ← الشعب ← الوحدات ← أقسام الوحدات، وكرات مخصصة (مشاريع مثلاً) يسمّيها المدير
// ويلوّنها ويربطها بأكثر من فرع، ومكان كل موظف (قد يكون في أكثر من كرة).
// للمدير فقط، ويُحفظ على جهازه (لا يُرفع إلى السحابة).
import { getSetting, setSetting } from './storage.js';

const KEY = 'orgStructure';

// الألوان كما طلبها المدير: القسم أبيض، الشعب أزرق، الوحدات برتقالي، أقسام الوحدات أصفر، الموظفون أخضر
export const TYPES = {
  dept: { label: 'القسم', color: '#ffffff', child: 'division', r: 9, rest: 0 },
  division: { label: 'شعبة', color: '#5aa7ff', child: 'unit', r: 7, rest: 125 },
  unit: { label: 'وحدة', color: '#ff9a3d', child: 'section', r: 6, rest: 95 },
  section: { label: 'قسم وحدة', color: '#ffd23f', child: null, r: 5, rest: 75 },
  custom: { label: 'كرة مخصصة', color: '#c084fc', child: null, r: 6.5, rest: 110 },
  // الذاتية: البريد والكتب وإرسالها إلى مسؤولي الشعب والوحدات (A22)؛ كرة واحدة تحت القسم
  personnel: { label: 'الذاتية', color: '#e2e8f0', child: null, r: 6.5, rest: 110 },
  // كرة موظف: تُنشأ قبل أن يكون للموظف حساب، ويُضاف إليها الحساب لاحقاً برابط فينضم إليها تلقائياً
  employee: { label: 'كرة موظف', color: '#3ddc84', child: null, r: 6, rest: 90 },
};

// خيارات الإظهار لكل كرة: ما يُسمح لمسؤولها (يقررها رئيس القسم)
export const PERMS = [
  ['sections', 'الأقسام', 'يرى فرعه من الهيكل: كراته وأسماء من فيها'],
  ['accounts', 'إدارة الحسابات', 'ينشئ كرات وحسابات لما تحته ويحذفها'],
  ['projects', 'كرات المشاريع', 'ينشئ كرات مشاريع لفرعه ويضيف لها موظفيه'],
  ['assistantAsHead', 'صلاحيات المعاون', 'المعاون له صلاحيات المسؤول نفسها'],
  ['assistant', 'المساعد', 'يستشير المساعد الذكي'],
  ['mind', 'عقل المؤسسة', 'يرى عقل المؤسسة الخاص بفرعه'],
  ['evals', 'التقييمات', 'يرى تقييمات ونقاط من تحته'],
];
// المسؤول الافتراضي: يرى فرعه، ويدير حسابات وحدته (مسؤول الوحدة ينشئ موظفيه وأقسامها)
export const defaultPerms = (type) => ({ sections: true, accounts: type === 'division' || type === 'unit' || type === 'section' });
export const permsOf = (n) => ({ ...defaultPerms(n?.type), ...(n?.perms || {}) });
export function setPerm(s, id, key, on) {
  const n = nodeById(s, id);
  if (n) n.perms = { ...(n.perms || {}), [key]: !!on };
}
export function addPersonnel(s) {
  let n = s.nodes.find((x) => x.type === 'personnel');
  if (n) return n;
  n = { id: uid(), type: 'personnel', name: 'الذاتية', parent: 'root' };
  s.nodes.push(n);
  return n;
}
export const PERSON = { label: 'موظف', color: '#3ddc84', r: 4.5, rest: 48 };
export const ASSISTANT = { label: 'معاون', color: '#2dd4bf', r: 5.5, rest: 42 };
// ألوان مقترحة للكرات المخصصة (والمدير يختار أي لون)
export const PALETTE = ['#c084fc', '#f472b6', '#22d3ee', '#f87171', '#a3e635', '#e879f9', '#38bdf8', '#fb7185', '#facc15', '#94a3b8'];
// المعاون في القسم والشعب والوحدات
export const canHaveAssistant = (type) => type === 'dept' || type === 'division' || type === 'unit' || type === 'personnel';
// كرات لها مسؤول بحساب (المشروع بلا حساب: يُضاف له الموظفون فقط)
export const canHaveHead = (type) => type === 'division' || type === 'unit' || type === 'section' || type === 'personnel';
// المشروع المغلق يُعتَّم (يبقى للرجوع إليه)
const dim = (hex) => { const n = parseInt(hex.slice(1), 16); const m = (c) => Math.round(c * 0.35 + 0x3a * 0.65); return `#${[n >> 16, (n >> 8) & 255, n & 255].map((c) => m(c).toString(16).padStart(2, '0')).join('')}`; };
export const colorOf = (n) => {
  const c = (n?.type === 'custom' && n.color) || TYPES[n?.type]?.color || '#ffffff';
  return n?.type === 'custom' && n.project?.status === 'closed' ? dim(c) : c;
};

// ---- كرات المشاريع (A9): الحالة، وتاريخ البدء والانتهاء، ونسبة الإنجاز ----
export const projOf = (n) => ({ status: 'open', progress: 0, start: '', end: '', ...(n?.project || {}) });
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
export function setProject(s, id, patch = {}) {
  const n = nodeById(s, id);
  if (!n || n.type !== 'custom') return;
  const p = projOf(n);
  if (patch.status === 'open' || patch.status === 'closed') {
    if (patch.status === 'closed' && p.status !== 'closed') p.closedAt = Date.now();
    p.status = patch.status;
  }
  if ('progress' in patch) p.progress = Math.max(0, Math.min(100, Math.round(Number(patch.progress) || 0)));
  if ('start' in patch) p.start = isDate(patch.start) ? patch.start : '';
  if ('end' in patch) p.end = isDate(patch.end) ? patch.end : '';
  n.project = p;
}
const fmtDate = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long' });
const dayOf = (d) => new Date(`${d}T00:00`);
const days = (n) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يوماً`);
// سطر الحالة: مفتوح · ٤٠٪ · ينتهي ١٢ ديسمبر (بعد ٥ أيام) / متأخر ٣ أيام
export function projectLine(n) {
  const p = projOf(n);
  if (p.status === 'closed') return `مغلق${p.closedAt ? ` منذ ${fmtDate.format(p.closedAt)}` : ''} · أُنجز ${p.progress}٪`;
  const parts = ['مفتوح', `أُنجز ${p.progress}٪`];
  if (p.start) parts.push(`بدأ ${fmtDate.format(dayOf(p.start))}`);
  if (p.end) {
    const d = Math.round((dayOf(p.end) - new Date(new Date().toDateString())) / 86400000);
    parts.push(d < 0 ? `متأخر ${days(-d)} عن موعده` : d === 0 ? 'ينتهي اليوم' : `ينتهي ${fmtDate.format(dayOf(p.end))} (بعد ${days(d)})`);
  }
  return parts.join(' · ');
}
export const projectLate = (n) => { const p = projOf(n); return p.status === 'open' && !!p.end && dayOf(p.end) < new Date(new Date().toDateString()) && p.progress < 100; };

const uid = () => Math.random().toString(36).slice(2, 10);

// { nodes: [{ id, type, name, parent, color?, links? }], people: { userId: { places: [{ node, assistant }] } } }
export async function loadStructure(orgName = 'القسم') {
  const s = await getSetting(KEY, null);
  if (!s?.nodes?.length) return { nodes: [{ id: 'root', type: 'dept', name: orgName, parent: null }], people: {} };
  // النسخة الأولى: لكل موظف مكان واحد { node, assistant }
  for (const [u, p] of Object.entries(s.people || {})) {
    if (!Array.isArray(p.places)) s.people[u] = { places: p.node ? [{ node: p.node, assistant: !!p.assistant }] : [] };
  }
  s.people ||= {};
  return s;
}
export async function saveStructure(s) {
  await setSetting(KEY, s);
  // تُنشر أسماء كرات كل موظف له (ليختار منها عند النشر)
  window.dispatchEvent(new Event('sm:structure'));
}

// تعديل الهيكل في الخلفية بالدور: يُقرأ ثم يُعدَّل ثم يُحفظ، فلا يكتب تعديلٌ فوق آخر
// (انضمام موظف وطلبات المسؤولين قد تصل في اللحظة نفسها). fn(st) تعيد true إن غيّرت شيئاً.
let queue = Promise.resolve();
export function withStructure(fn) {
  const run = queue.then(async () => {
    const st = await loadStructure();
    const changed = await fn(st);
    if (changed) { await saveStructure(st); window.dispatchEvent(new Event('sm:placed')); }
    return changed;
  });
  queue = run.catch(() => {});
  return run;
}

export const nodeById = (s, id) => s.nodes.find((n) => n.id === id) || null;
export const childrenOf = (s, id) => s.nodes.filter((n) => n.parent === id);

export function addEmployeeBall(s, parentId, name) {
  const parent = nodeById(s, parentId);
  if (!parent || parent.type === 'employee') throw new Error('لا يمكن إضافة كرة موظف هنا.');
  const n = { id: uid(), type: 'employee', name: String(name).trim().slice(0, 60) || 'موظف', parent: parentId };
  s.nodes.push(n);
  return n;
}

// كرة شخص بياناته معه (اسم المستخدم والمنصب): تنتظر إرسال الرابط من داخلها
export function addPersonBall(s, parentId, name, person) {
  const n = addEmployeeBall(s, parentId, name);
  n.person = person;
  return n;
}
// حذف بطاقة من الهيكل (بعد انضمام صاحبها إلى مكانه)
export function removeCard(s, id) {
  s.nodes = s.nodes.filter((n) => n.id !== id);
  for (const p of Object.values(s.people)) p.places = p.places.filter((pl) => pl.node !== id);
}

export function addNode(s, parentId, name) {
  const parent = nodeById(s, parentId);
  const type = parent && TYPES[parent.type].child;
  if (!type) throw new Error('لا يمكن إضافة فرع هنا.');
  const n = { id: uid(), type, name: String(name).trim() || TYPES[type].label, parent: parentId };
  s.nodes.push(n);
  return n;
}

// كرة مخصصة (مشروع، لجنة...): اسمها ولونها يختارهما المدير، وترتبط بفرع أو أكثر
export function addCustom(s, linkTo, name, color) {
  const n = { id: uid(), type: 'custom', name: String(name).trim() || 'كرة مخصصة', parent: null, color: color || PALETTE[0], links: linkTo ? [linkTo] : ['root'] };
  s.nodes.push(n);
  return n;
}
export function setColor(s, id, color) {
  const n = nodeById(s, id);
  if (n?.type === 'custom' && /^#[0-9a-f]{6}$/i.test(color)) n.color = color;
}
// ربط كرة مخصصة بفرع آخر أو فكّه (يبقى رابط واحد على الأقل)
export function toggleLink(s, id, other) {
  const n = nodeById(s, id);
  if (!n || n.type !== 'custom' || id === other) return;
  n.links ||= [];
  if (n.links.includes(other)) { if (n.links.length > 1) n.links = n.links.filter((x) => x !== other); } else n.links.push(other);
}

export function renameNode(s, id, name) {
  const n = nodeById(s, id);
  if (n && String(name).trim()) n.name = String(name).trim();
}

// يحذف الفرع وما تحته؛ موظفوه يُزالون من هذه الأماكن فقط
export function removeNode(s, id) {
  if (id === 'root') return;
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of s.nodes) if (!gone.has(n.id) && gone.has(n.parent)) { gone.add(n.id); grew = true; }
  }
  s.nodes = s.nodes.filter((n) => !gone.has(n.id));
  for (const n of s.nodes) {
    if (n.links) {
      n.links = n.links.filter((x) => !gone.has(x));
      if (!n.links.length) n.links = ['root']; // كرة مخصصة فقدت روابطها تعود إلى القسم
    }
  }
  for (const p of Object.values(s.people)) p.places = p.places.filter((pl) => !gone.has(pl.node));
}

// ---- الموظفون: قد يكون الموظف في أكثر من كرة ----
export const placesOf = (s, userId) => (s.people[userId]?.places || []).filter((pl) => nodeById(s, pl.node));

// يضيف مكاناً للموظف (أو يحدّث كونه معاوناً فيه). لكل مكان معاون واحد
// مسؤول الكرة (قد يكون لها أكثر من حساب مسؤول)
export function setHead(s, userId, nodeId, on = true) {
  const pl = (s.people[userId]?.places || []).find((x) => x.node === nodeId);
  if (pl) { pl.head = !!on; if (on) pl.assistant = false; }
}
export const headsOf = (s, nodeId) =>
  Object.entries(s.people).filter(([, p]) => p.places.some((pl) => pl.node === nodeId && pl.head)).map(([u]) => u);

export function placePerson(s, userId, nodeId, assistant = false) {
  const n = nodeById(s, nodeId);
  if (!n) return;
  const asAssistant = assistant && canHaveAssistant(n.type);
  if (asAssistant) {
    for (const p of Object.values(s.people)) for (const pl of p.places) if (pl.node === nodeId) pl.assistant = false;
  }
  const p = (s.people[userId] ||= { places: [] });
  const cur = p.places.find((pl) => pl.node === nodeId);
  if (cur) cur.assistant = asAssistant; else p.places.push({ node: nodeId, assistant: asAssistant });
}
export function removePlace(s, userId, nodeId) {
  const p = s.people[userId];
  if (p) p.places = p.places.filter((pl) => pl.node !== nodeId);
}
export const unplacePerson = (s, userId) => { delete s.people[userId]; };
export const assistantOf = (s, nodeId) =>
  Object.entries(s.people).find(([, p]) => p.places.some((pl) => pl.node === nodeId && pl.assistant))?.[0] || null;
export const peopleAt = (s, nodeId, { assistants = true } = {}) =>
  Object.entries(s.people).filter(([, p]) => p.places.some((pl) => pl.node === nodeId && (assistants || !pl.assistant))).map(([u]) => u);

// المسار للعرض: "شعبة الصيانة ← وحدة الكاميرات"
export function pathOf(s, nodeId) {
  const out = [];
  let n = nodeById(s, nodeId);
  while (n) { out.unshift(n.name); n = nodeById(s, n.parent); }
  return out.join(' ← ');
}

// يحوّل الهيكل إلى كرات وخطوط للرسم: [من، إلى، طول الخط]
export function toGraph(s, members) {
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));
  const nodes = s.nodes.map((n) => ({ ...TYPES[n.type], id: n.id, kind: n.type, label: n.type === 'custom' && n.project?.status === 'closed' ? `${n.name} (مغلق)` : n.name, parent: n.parent, color: colorOf(n) }));
  const edges = [];
  for (const n of s.nodes) {
    if (n.parent) edges.push([n.parent, n.id, TYPES[n.type].rest]);
    for (const l of n.links || []) edges.push([l, n.id, TYPES.custom.rest]);
    // كرة موظف مرتبطة بكرات إضافية (يعمل في أكثر من اختصاص)
    for (const e of n.extraParents || []) edges.push([e, n.id, TYPES.employee.rest]);
  }
  for (const [u, p] of Object.entries(s.people)) {
    const places = p.places.filter((pl) => nodeById(s, pl.node));
    if (!names.has(u) || !places.length) continue; // أُزيل من المؤسسة أو غير موزع
    const asst = places.some((pl) => pl.assistant);
    const look = asst ? ASSISTANT : PERSON;
    nodes.push({ ...look, id: `p:${u}`, kind: asst ? 'assistant' : 'person', user: u, label: asst ? `معاون: ${names.get(u)}` : names.get(u) });
    // خط من الموظف إلى كل كرة فيها اسمه
    for (const pl of places) edges.push([pl.node, `p:${u}`, places.length > 1 ? 70 : look.rest]);
  }
  return { nodes, edges };
}

// تسليم أماكن شخص إلى آخر قبل حذف حسابه (A46): تنتقل كراته مع مناصبه (مسؤول، معاون)، ويبقى ما كان للمستلم
export function moveMemberPlaces(s, from, to) {
  if (!from || !to || from === to) return 0;
  const src = s.people[from]?.places || [];
  let moved = 0;
  for (const pl of src) {
    if (!nodeById(s, pl.node)) continue;
    const dst = (s.people[to] ||= { places: [] });
    if (!dst.places.some((x) => x.node === pl.node)) { dst.places.push({ node: pl.node, ...(pl.head ? { head: true } : {}), ...(pl.assistant ? { assistant: true } : {}) }); moved++; }
  }
  delete s.people[from];
  return moved;
}
