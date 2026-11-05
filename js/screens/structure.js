// شاشة "الهيكل" (للمدير فقط): القسم والشعب والوحدات وأقسامها، ومكان كل موظف ومعاون
import { session, listMembers } from '../cloud.js';
import {
  TYPES, PERSON, ASSISTANT, canHaveAssistant, loadStructure, saveStructure, nodeById, childrenOf,
  addNode, renameNode, removeNode, placePerson, unplacePerson, assistantOf, pathOf, toGraph,
} from '../org-structure.js';
import { createOrgGraph } from '../org-graph.js';
import { totals, pointsEvents } from '../points.js';
import { getGroupMessages } from '../storage.js';
import { groupEvents, groupMembers } from '../group.js';

export const title = 'عقل المؤسسة';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// العدّ بالعربية: واحد، مثنى، جمع
const WORDS = {
  division: ['شعبة واحدة', 'شعبتان', 'شعب', 'شعبة'],
  unit: ['وحدة واحدة', 'وحدتان', 'وحدات', 'وحدة'],
  section: ['قسم وحدة واحد', 'قسما وحدة', 'أقسام وحدات', 'قسم وحدة'],
  person: ['موظف واحد', 'موظفان', 'موظفين', 'موظفاً'],
};
const count = (n, kind) => {
  const [one, two, few, many] = WORDS[kind];
  if (!n) return kind === 'person' ? 'لا موظفين' : `لا ${few}`;
  return n === 1 ? one : n === 2 ? two : `${n} ${n <= 10 ? few : many}`;
};
const dot = (c) => `<i class="sdot" style="background:${c}"></i>`;

let graph = null;
let alive = false;
let offStats = null;

export async function mount(root) {
  alive = true;
  root.innerHTML = '<p class="muted org-wait">لحظة…</p>';
  let s, members;
  try {
    s = await session();
    if (s?.member?.role === 'manager') members = (await listMembers()).filter((m) => m.role === 'employee');
  } catch (e) {
    if (alive) root.innerHTML = `<p class="status status--err">${esc(e.message)}</p>`;
    return;
  }
  if (!alive) return;
  if (s?.member?.role !== 'manager') {
    root.innerHTML = `<div class="org"><div class="org-hero"><div class="org-hero__icon" aria-hidden="true">🔐</div>
      <h2>للمدير فقط</h2></div><a class="btn org-wide" href="#/org">تسجيل الدخول</a></div>`;
    return;
  }

  const st = await loadStructure(s.org?.name || 'القسم');
  const nameOf = (u) => members.find((m) => m.user_id === u)?.display_name || '—';

  // الفرز: نقاط الشهر ومنشورات كل موظف، تُجمع لكل فرع من الهيكل
  let month = new Map(), posts = [];
  const loadStats = async () => {
    [month, posts] = await Promise.all([totals('month'), getGroupMessages()]);
  };
  await loadStats();
  const weekAgo = () => Date.now() - 7 * 86400000;
  const peopleUnder = (nodeId) => {
    const ids = new Set([nodeId]);
    let grew = true;
    while (grew) { grew = false; for (const x of st.nodes) if (!ids.has(x.id) && ids.has(x.parent)) { ids.add(x.id); grew = true; } }
    return Object.entries(st.people).filter(([, p]) => ids.has(p.node)).map(([u]) => u);
  };
  const statsLine = (users) => {
    const pts = users.reduce((a, u) => a + (month.get(u)?.points || 0), 0);
    const set = new Set(users);
    const n = posts.filter((m) => set.has(m.from) && m.sentAt >= weekAgo()).length;
    return `<p class="struct-stats">⭐ <b>${pts}</b> نقطة هذا الشهر · 📝 <b>${n}</b> منشور هذا الأسبوع</p>`;
  };

  root.innerHTML = `
    <div class="struct">
      <div class="struct-legend">
        <span>${dot(TYPES.dept.color)}القسم</span><span>${dot(TYPES.division.color)}شعبة</span>
        <span>${dot(TYPES.unit.color)}وحدة</span><span>${dot(TYPES.section.color)}قسم وحدة</span>
        <span>${dot(PERSON.color)}موظف</span><span>${dot(ASSISTANT.color)}معاون</span>
      </div>
      <div class="struct-stage">
        <canvas id="sg" aria-label="الهيكل الإداري"></canvas>
        <div class="struct-zoom">
          <button type="button" data-z="in" aria-label="تكبير">＋</button>
          <button type="button" data-z="out" aria-label="تصغير">－</button>
          <button type="button" data-z="fit" aria-label="عرض الكل">⤢</button>
        </div>
      </div>
      <div class="struct-panel" id="panel" aria-live="polite"></div>
    </div>`;

  const panel = root.querySelector('#panel');
  let mode = null; // نموذج فرعي في اللوحة: add | rename | pick-person | pick-assistant | move
  // اختيار كرة أخرى يُغلق أي نموذج فرعي مفتوح في اللوحة
  graph = createOrgGraph(root.querySelector('#sg'), { onSelect: () => { mode = null; renderPanel(); } });
  root.querySelector('.struct-zoom').addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (z === 'in') graph.zoom(1.4); else if (z === 'out') graph.zoom(1 / 1.4); else if (z === 'fit') graph.fit();
  });

  const commit = async (keepSel = graph.selected()) => {
    await saveStructure(st);
    graph.setData(toGraph(st, members));
    if (keepSel) graph.select(keepSel); else graph.select(null);
    mode = null;
    renderPanel();
  };

  const unplaced = () => members.filter((m) => !st.people[m.user_id] || !nodeById(st, st.people[m.user_id].node));
  const placeLabel = (u) => {
    const p = st.people[u];
    if (!p || !nodeById(st, p.node)) return 'غير موزع';
    return `${p.assistant ? 'معاون · ' : ''}${pathOf(st, p.node)}`;
  };

  function renderPanel() {
    const id = graph.selected();
    const n = id && (id.startsWith('p:') ? null : nodeById(st, id));
    if (!id) {
      const free = unplaced();
      panel.innerHTML = `
        <p class="struct-hint">المس كرة لترى ما يرتبط بها وتعدّلها. قرّب بإصبعين لتظهر الأسماء.</p>
        ${free.length ? `<p class="struct-free">${dot(PERSON.color)} غير موزعين: <b>${free.map((m) => esc(m.display_name)).join('، ')}</b> · المس القسم أو أي فرع لتضعهم فيه.</p>` : ''}
        ${members.length ? '' : '<p class="muted">لا موظفين بعد. أضفهم من <a href="#/staff">الأسماء</a>.</p>'}`;
      return;
    }
    if (id.startsWith('p:')) return renderPersonPanel(id.slice(2));
    if (!n) { panel.innerHTML = ''; return; }
    const t = TYPES[n.type];
    const childT = t.child && TYPES[t.child];
    const asst = assistantOf(st, n.id);
    const here = Object.entries(st.people).filter(([u, p]) => p.node === n.id && !p.assistant && members.some((m) => m.user_id === u));
    const kids = childrenOf(st, n.id);

    let sub = '';
    if (mode === 'add' || mode === 'rename') {
      sub = `<form class="struct-form" id="nf">
          <input id="nf-name" maxlength="50" required placeholder="${mode === 'add' ? `اسم ${childT.label} الجديدة` : 'الاسم الجديد'}" value="${mode === 'rename' ? esc(n.name) : ''}">
          <button class="btn" type="submit">حفظ</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button>
        </form>`;
    } else if (mode === 'pick-person' || mode === 'pick-assistant') {
      const list = members.filter((m) => !(st.people[m.user_id]?.node === n.id && st.people[m.user_id]?.assistant === (mode === 'pick-assistant')));
      sub = `<p class="struct-sub">${mode === 'pick-assistant' ? `اختر معاون ${esc(n.name)}` : `اختر موظفاً ليكون في ${esc(n.name)}`}:</p>
        <div class="struct-pick">${list.map((m) => `<button type="button" data-u="${esc(m.user_id)}"><b>${esc(m.display_name)}</b><small>${esc(placeLabel(m.user_id))}</small></button>`).join('') || '<p class="muted">لا موظفين متاحين.</p>'}</div>
        <button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button>`;
    }

    panel.innerHTML = `
      <div class="struct-title">${dot(t.color)}<div><b>${esc(n.name)}</b><small>${t.label}${n.parent ? ` · ${esc(pathOf(st, n.parent))}` : ' · رئيس القسم: أنت'}</small></div></div>
      ${statsLine(n.parent ? peopleUnder(n.id) : members.map((m) => m.user_id))}
      <p class="struct-meta">
        ${canHaveAssistant(n.type) ? `المعاون: <b>${asst ? esc(nameOf(asst)) : 'لا يوجد'}</b> · ` : ''}
        ${t.child ? `${count(kids.length, t.child)} · ` : ''}${count(here.length, 'person')}
      </p>
      ${sub || `<div class="struct-actions">
        ${childT ? `<button type="button" data-a="add">＋ ${childT.label}</button>` : ''}
        <button type="button" data-a="pick-person">＋ موظف هنا</button>
        ${canHaveAssistant(n.type) ? `<button type="button" data-a="pick-assistant">${asst ? 'تغيير المعاون' : '＋ معاون'}</button>` : ''}
        ${asst ? '<button type="button" data-a="no-assistant">إلغاء المعاون</button>' : ''}
        <button type="button" data-a="rename">تعديل الاسم</button>
        ${n.parent ? '<button type="button" data-a="delete" class="is-danger">حذف</button>' : ''}
      </div>`}`;

    panel.querySelector('#nf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = panel.querySelector('#nf-name').value;
      if (mode === 'add') addNode(st, n.id, name); else renameNode(st, n.id, name);
      await commit(n.id);
    });
    panel.querySelector('#nf-name')?.focus();
    panel.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', async () => {
      placePerson(st, b.dataset.u, n.id, mode === 'pick-assistant');
      await commit(n.id);
    }));
    panel.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      if (a === 'cancel') { mode = null; renderPanel(); return; }
      if (a === 'no-assistant') { unplacePerson(st, asst); await commit(n.id); return; }
      if (a === 'delete') {
        if (!confirm(`حذف «${n.name}» وكل ما تحته؟ موظفوه يصبحون غير موزعين.`)) return;
        removeNode(st, n.id);
        await commit(n.parent);
        return;
      }
      mode = a;
      renderPanel();
    }));
  }

  // آخر منشورات الموظف (من أرشيف جهاز المدير)
  const fmtDay = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' });
  const recentPosts = (u) => {
    const mine = posts.filter((m) => m.from === u && m.text).slice(-3).reverse();
    return mine.length ? `<ul class="struct-posts">${mine.map((m) => `<li><small>${fmtDay.format(m.sentAt)}</small> ${esc(m.text.slice(0, 120))}</li>`).join('')}</ul>` : '';
  };

  function renderPersonPanel(u) {
    const p = st.people[u];
    const n = p && nodeById(st, p.node);
    if (!n) { panel.innerHTML = ''; return; }
    let sub = '';
    if (mode === 'move') {
      sub = `<p class="struct-sub">انقل ${esc(nameOf(u))} إلى:</p>
        <div class="struct-pick">${st.nodes.filter((x) => x.id !== p.node || p.assistant).map((x) => `<button type="button" data-n="${esc(x.id)}">${dot(TYPES[x.type].color)}<b>${esc(x.name)}</b><small>${TYPES[x.type].label}${x.parent ? ` · ${esc(pathOf(st, x.parent))}` : ''}</small></button>`).join('')}</div>
        <button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button>`;
    }
    panel.innerHTML = `
      <div class="struct-title">${dot(p.assistant ? ASSISTANT.color : PERSON.color)}<div><b>${esc(nameOf(u))}</b><small>${p.assistant ? 'معاون' : 'موظف'} · ${esc(pathOf(st, p.node))}</small></div></div>
      ${sub ? '' : statsLine([u])}
      ${sub ? '' : recentPosts(u)}
      ${sub || `<div class="struct-actions">
        <button type="button" data-a="move">نقل إلى…</button>
        ${canHaveAssistant(n.type) ? `<button type="button" data-a="toggle">${p.assistant ? 'إلغاء المعاون' : 'اجعله معاون ' + esc(n.name)}</button>` : ''}
        <a href="#/staff?id=${encodeURIComponent(u)}">صفحة الموظف</a>
        <button type="button" data-a="unplace" class="is-danger">إخراج من الهيكل</button>
      </div>`}`;
    panel.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', async () => {
      placePerson(st, u, b.dataset.n, false);
      await commit(`p:${u}`);
    }));
    panel.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      if (a === 'cancel') { mode = null; renderPanel(); return; }
      if (a === 'toggle') { placePerson(st, u, p.node, !p.assistant); await commit(`p:${u}`); return; }
      if (a === 'unplace') { unplacePerson(st, u); await commit(p.node); return; }
      mode = a;
      renderPanel();
    }));
  }

  graph.setData(toGraph(st, members), { keepView: false });
  // منشور جديد أو نقاط جديدة: نحدّث الأرقام في اللوحة
  const refreshStats = async () => { await loadStats(); if (!mode) renderPanel(); };
  pointsEvents.addEventListener('change', refreshStats);
  groupEvents.addEventListener('message', refreshStats);
  // موظف انضم أو أُزيل: نحدّث الكرات دون مغادرة الشاشة
  const onMembers = () => {
    const live = [...groupMembers()].filter(([, m]) => m.role === 'employee')
      .map(([user_id, m]) => ({ user_id, display_name: m.name, role: 'employee' }));
    const sig = (l) => l.map((m) => m.user_id + m.display_name).sort().join('|');
    if (sig(live) === sig(members)) return;
    members = live;
    graph.setData(toGraph(st, members));
    if (!mode) renderPanel();
  };
  groupEvents.addEventListener('members', onMembers);
  offStats = () => {
    pointsEvents.removeEventListener('change', refreshStats);
    groupEvents.removeEventListener('message', refreshStats);
    groupEvents.removeEventListener('members', onMembers);
  };
  renderPanel();
}

export function unmount() {
  alive = false;
  offStats?.();
  offStats = null;
  graph?.destroy();
  graph = null;
}
