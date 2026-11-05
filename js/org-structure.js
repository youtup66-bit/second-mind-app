// الهيكل الإداري للمؤسسة: القسم ← الشعب ← الوحدات ← أقسام الوحدات، ومكان كل موظف فيه.
// للمدير فقط، ويُحفظ على جهازه (لا يُرفع إلى السحابة).
import { getSetting, setSetting } from './storage.js';

const KEY = 'orgStructure';

// الألوان كما طلبها المدير: القسم أبيض، الشعب أزرق، الوحدات برتقالي، أقسام الوحدات أصفر، الموظفون أخضر
export const TYPES = {
  dept: { label: 'القسم', color: '#ffffff', child: 'division', r: 9, rest: 0 },
  division: { label: 'شعبة', color: '#5aa7ff', child: 'unit', r: 7, rest: 125 },
  unit: { label: 'وحدة', color: '#ff9a3d', child: 'section', r: 6, rest: 95 },
  section: { label: 'قسم وحدة', color: '#ffd23f', child: null, r: 5, rest: 75 },
};
export const PERSON = { label: 'موظف', color: '#3ddc84', r: 4.5, rest: 48 };
export const ASSISTANT = { label: 'معاون', color: '#2dd4bf', r: 5.5, rest: 42 };
// المعاون في القسم والشعب والوحدات (لا في أقسام الوحدات)
export const canHaveAssistant = (type) => type !== 'section';

const uid = () => Math.random().toString(36).slice(2, 10);

// { nodes: [{ id, type, name, parent }], people: { userId: { node, assistant } } }
export async function loadStructure(orgName = 'القسم') {
  const s = await getSetting(KEY, null);
  if (s?.nodes?.length) return s;
  return { nodes: [{ id: 'root', type: 'dept', name: orgName, parent: null }], people: {} };
}
export const saveStructure = (s) => setSetting(KEY, s);

export const nodeById = (s, id) => s.nodes.find((n) => n.id === id) || null;
export const childrenOf = (s, id) => s.nodes.filter((n) => n.parent === id);

export function addNode(s, parentId, name) {
  const parent = nodeById(s, parentId);
  const type = parent && TYPES[parent.type].child;
  if (!type) throw new Error('لا يمكن إضافة فرع هنا.');
  const n = { id: uid(), type, name: String(name).trim() || TYPES[type].label, parent: parentId };
  s.nodes.push(n);
  return n;
}

export function renameNode(s, id, name) {
  const n = nodeById(s, id);
  if (n && String(name).trim()) n.name = String(name).trim();
}

// يحذف الفرع وما تحته؛ موظفوه يصبحون "غير موزعين"
export function removeNode(s, id) {
  if (id === 'root') return;
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of s.nodes) if (!gone.has(n.id) && gone.has(n.parent)) { gone.add(n.id); grew = true; }
  }
  s.nodes = s.nodes.filter((n) => !gone.has(n.id));
  for (const [u, p] of Object.entries(s.people)) if (gone.has(p.node)) delete s.people[u];
}

// يضع موظفاً في مكان (assistant: معاون ذلك المكان؛ لكل مكان معاون واحد)
export function placePerson(s, userId, nodeId, assistant = false) {
  const n = nodeById(s, nodeId);
  if (!n) return;
  const asAssistant = assistant && canHaveAssistant(n.type);
  if (asAssistant) {
    for (const p of Object.values(s.people)) if (p.node === nodeId && p.assistant) p.assistant = false;
  }
  s.people[userId] = { node: nodeId, assistant: asAssistant };
}
export const unplacePerson = (s, userId) => { delete s.people[userId]; };
export const assistantOf = (s, nodeId) => Object.entries(s.people).find(([, p]) => p.node === nodeId && p.assistant)?.[0] || null;

// المسار للعرض: "شعبة الصيانة ← وحدة الكاميرات"
export function pathOf(s, nodeId) {
  const out = [];
  let n = nodeById(s, nodeId);
  while (n) { out.unshift(n.name); n = nodeById(s, n.parent); }
  return out.join(' ← ');
}

// يحوّل الهيكل إلى كرات وخطوط للرسم
export function toGraph(s, members) {
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));
  const nodes = s.nodes.map((n) => ({ ...TYPES[n.type], id: n.id, kind: n.type, label: n.name, parent: n.parent }));
  const edges = s.nodes.filter((n) => n.parent).map((n) => [n.parent, n.id]);
  for (const [u, p] of Object.entries(s.people)) {
    if (!names.has(u) || !nodeById(s, p.node)) continue; // أُزيل من المؤسسة
    const look = p.assistant ? ASSISTANT : PERSON;
    nodes.push({ ...look, id: `p:${u}`, kind: p.assistant ? 'assistant' : 'person', user: u, label: p.assistant ? `معاون: ${names.get(u)}` : names.get(u), parent: p.node });
    edges.push([p.node, `p:${u}`]);
  }
  return { nodes, edges };
}
