// شاشة "عقل المؤسسة" (للمدير فقط): القسم والشعب والوحدات وأقسامها، وكرات مخصصة (مشاريع...)
// يسمّيها المدير ويلوّنها ويربطها بأكثر من فرع، ومكان كل موظف ومعاون (وقد يكون في أكثر من كرة)
import { session, listMembers, inviteLink, removeMember, changePassword, linkRecoveryEmail, currentEmail } from '../cloud.js';
import { inviteToBall, cancelBallInvite, ballInvites, recoveryInvite, TITLES } from '../org-accounts.js';
import { checkUsername } from '../cloud.js';
import {
  TYPES, PERSON, ASSISTANT, PALETTE, canHaveAssistant, colorOf, loadStructure, saveStructure, nodeById, childrenOf,
  addNode, addCustom, setColor, toggleLink, renameNode, removeNode, placesOf, placePerson, removePlace, unplacePerson,
  assistantOf, peopleAt, pathOf, toGraph, canHaveHead, headsOf, setHead, PERMS, permsOf, setPerm, addPersonnel,
  projOf, setProject, projectLine, projectLate, moveMemberPlaces,
} from '../org-structure.js';
import { createOrgGraph } from '../org-graph.js';
import { ballSearchHTML, bindBallSearch } from '../ball-search.js';
import { totals, pointsEvents } from '../points.js';
import { getGroupMessages } from '../storage.js';
import { groupEvents, groupMembers, countsForPoints, roomPeople } from '../group.js';
import { mindTabs } from '../staff-nav.js';
import { IS_DEV } from '../env.js';

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

// كرات الموظفين (بحساب أو بلا) التي يصح نقلها إلى الكرة n: لا كرات الأقسام، ولا ما فوق n أو n نفسها
function cardsToPick(st, n) {
  const above = new Set();
  for (let c = n.id, g = 0; c && !above.has(c) && g < 500; c = nodeById(st, c)?.parent, g++) above.add(c);
  return st.nodes.filter((x) => x.type === 'employee' && x.parent !== n.id && !(x.extraParents || []).includes(n.id) && !above.has(x.id));
}

// أعضاء كروب الكرة: إضافة شخص أو كرة (أهلها)، وإخراج شخص أو كرة. تُحفظ على الكرة نفسها
function roomMembersHTML(st, n, members) {
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));
  const nameOfNode = (id) => st.nodes.find((x) => x.id === id)?.name || '';
  const cur = roomPeople(st, n, (u) => names.has(u)).filter((u) => names.has(u));
  const ov = n.room || {};
  const notIn = members.filter((m) => !cur.includes(m.user_id));
  // كرات الموظفين بلا حساب بعد المرتبطة بهذه الكرة أو المتفرعة منها: تظهر هنا كما يظهر الحساب
  const pending = st.nodes.filter((x) => x.type === 'employee' && (x.parent === n.id || (x.extraParents || []).includes(n.id)));
  const balls = st.nodes.filter((x) => x.id !== 'root' && x.id !== n.id && x.type !== 'employee' && x.type !== 'personnel');
  const ballEntries = [
    ...(ov.addNodes || []).map((id) => ({ id, label: 'أُضيفت' })),
    ...(ov.removeNodes || []).map((id) => ({ id, label: 'أُخرجت' })),
  ];
  return `<details class="struct-more struct-room"><summary>أعضاء كروب الكرة (${cur.length + pending.length})</summary>
    <ul class="struct-report-list">${cur.map((u) => `<li><span>${esc(names.get(u))}</span> <button type="button" class="text-btn text-btn--danger" data-rp="${esc(u)}">إخراج</button></li>`).join('')}${pending.map((c) => `<li><span>${esc(c.name)}</span> <small class="muted">بلا حساب بعد</small></li>`).join('')}${cur.length || pending.length ? '' : '<li class="muted">لا أحد بعد</li>'}</ul>
    <div class="struct-actions">
      <select id="rp-add" aria-label="شخص للإضافة">${notIn.map((m) => `<option value="${esc(m.user_id)}">${esc(m.display_name)}</option>`).join('')}</select>
      <button type="button" class="text-btn" id="rp-add-go">إضافة شخص</button>
    </div>
    <div class="struct-actions">
      <select id="rb-add" aria-label="كرة للإضافة">${balls.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>
      <button type="button" class="text-btn" id="rb-add-go">إضافة كرة (أهلها)</button>
      <select id="rb-rem" aria-label="كرة للإخراج">${balls.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>
      <button type="button" class="text-btn text-btn--danger" id="rb-rem-go">إخراج كرة (أهلها)</button>
    </div>
    ${ballEntries.length ? `<ul class="struct-report-list">${ballEntries.map((e) => `<li><span>${esc(e.label)}: ${esc(nameOfNode(e.id))}</span> <button type="button" class="text-btn text-btn--muted" data-rbdel="${esc(e.id)}">إزالة</button></li>`).join('')}</ul>` : ''}
  </details>`;
}

// الكرات تحت الكرة مع خيار دخولها في التقرير (الافتراضي: تدخل). إلغاء العلامة يُخرجها مع ما تحتها
function reportScopeHTML(st, n) {
  const rows = [];
  const walk = (pid, depth) => st.nodes.filter((x) => x.parent === pid).forEach((c) => { rows.push({ c, depth }); walk(c.id, depth + 1); });
  walk(n.id, 0);
  if (!rows.length) return '';
  return `<details class="struct-more struct-report"><summary>الكرات التي تدخل في التقرير</summary>
    <ul class="struct-report-list">${rows.map(({ c, depth }) => `<li style="padding-inline-start:${depth * 14}px"><label><input type="checkbox" data-rep="${esc(c.id)}" ${c.noReport ? '' : 'checked'}> ${esc(c.name)}</label></li>`).join('')}</ul></details>`;
}
let alive = false;
let accountPref = null; // المنصب المختار مسبقاً في نموذج الحساب
let accountName = ''; // اسم مُعبّأ مسبقاً (كرة الموظف التي أنشأتها ثم نضيف لها الرابط)
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
  const isMember = (u) => members.some((m) => m.user_id === u);
  const typeLabel = (n) => TYPES[n.type].label;
  const nodeLine = (x) => `${dot(colorOf(x))}<b>${esc(x.name)}</b><small>${typeLabel(x)}${x.parent ? ` · ${esc(pathOf(st, x.parent))}` : ''}</small>`;

  // ---- الفرز: نقاط الشهر ومنشورات الأسبوع لكل كرة ----
  let month = new Map(), posts = [];
  const loadStats = async () => { [month, posts] = await Promise.all([totals('month'), getGroupMessages().then((l) => l.filter(countsForPoints))]); };
  await loadStats();
  const weekAgo = () => Date.now() - 7 * 86400000;
  // الموظفون في الكرة وما تحتها
  const peopleUnder = (nodeId) => {
    const ids = new Set([nodeId]);
    let grew = true;
    while (grew) { grew = false; for (const x of st.nodes) if (!ids.has(x.id) && ids.has(x.parent)) { ids.add(x.id); grew = true; } }
    return Object.entries(st.people).filter(([, p]) => p.places.some((pl) => ids.has(pl.node))).map(([u]) => u);
  };
  // node: الكرة المعروضة؛ منشورات مجموعتها ومجموعات ما تحتها، ومنشورات العامة من موظفيها
  const roomsUnder = (node) => {
    if (node.type === 'custom') return new Set([`n_${node.id}`]);
    const ids = new Set([node.id]);
    let grew = true;
    while (grew) { grew = false; for (const x of st.nodes) if (!ids.has(x.id) && ids.has(x.parent)) { ids.add(x.id); grew = true; } }
    return new Set([...ids].map((i) => `n_${i}`));
  };
  const statsLine = (users, node = null) => {
    const pts = users.reduce((a, u) => a + (month.get(u)?.points || 0), 0);
    const set = new Set(users);
    const rs = node && node.id !== 'root' ? roomsUnder(node) : null;
    const n = posts.filter((m) => m.sentAt >= weekAgo() && (!node ? set.has(m.from)
      : node.id === 'root' ? true
        : m.room && m.room !== 'general' ? rs.has(m.room)
          : m.tag ? m.tag === node.name : set.has(m.from))).length;
    return `<p class="struct-stats">نقاط هذا الشهر <b>${pts}</b> · منشورات هذا الأسبوع <b>${n}</b></p>`;
  };
  const fmtDay = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' });
  const recentPosts = (u) => {
    const mine = posts.filter((m) => m.from === u && m.text).slice(-3).reverse();
    return mine.length ? `<ul class="struct-posts">${mine.map((m) => `<li><small>${fmtDay.format(m.sentAt)}</small> ${esc(m.text.slice(0, 120))}</li>`).join('')}</ul>` : '';
  };

  root.innerHTML = `
    <div class="struct struct--full">
      <div class="struct-stage">
        <canvas id="sg" aria-label="عقل المؤسسة"></canvas>
        ${ballSearchHTML()}
        <button type="button" class="struct-handle" id="handle" aria-label="القائمة" aria-expanded="false"><span></span></button>
        <div class="struct-menu" id="menu" hidden>
          ${mindTabs('structure', 'structure', true)}
          <div class="struct-legend" id="legend"></div>
          <p class="struct-free" id="free" hidden></p>
          <button type="button" class="struct-fit" id="fit">عرض الكل</button>
        </div>
        <button type="button" class="struct-name" id="name" hidden></button>
      </div>
    </div>
    <div class="sheet" id="sheet" hidden>
      <div class="sheet__panel struct-sheet" role="dialog" aria-label="تعديل">
        <div class="struct-panel" id="panel" aria-live="polite"></div>
      </div>
    </div>`;

  // دليل الألوان، ومعه الكرات المخصصة بألوانها
  const renderLegend = () => {
    const custom = st.nodes.filter((n) => n.type === 'custom');
    root.querySelector('#legend').innerHTML = `
      <span>${dot(TYPES.dept.color)}القسم</span><span>${dot(TYPES.division.color)}شعبة</span>
      <span>${dot(TYPES.unit.color)}وحدة</span><span>${dot(TYPES.section.color)}قسم وحدة</span>
      <span>${dot(PERSON.color)}موظف</span><span>${dot(ASSISTANT.color)}معاون</span>
      ${st.nodes.some((x) => x.type === 'personnel') ? `<span>${dot(TYPES.personnel.color)}الذاتية</span>` : ''}
      ${custom.map((n) => `<span>${dot(colorOf(n))}${esc(n.name)}</span>`).join('')}`;
  };

  const panel = root.querySelector('#panel');
  // دعوات الكرات التي لم ينضم أصحابها بعد
  let pending = await ballInvites();
  const reloadPending = async () => { pending = await ballInvites(); };
  let lastInvite = null; // { code, name } آخر دعوة أُنشئت لعرض رابطها
  // نموذج فرعي في اللوحة: add | custom | rename | color | links | pick-person | pick-assistant | add-place
  let mode = null;
  let draftColor = PALETTE[0];
  const sheet = root.querySelector('#sheet');
  const nameBtn = root.querySelector('#name');
  const menu = root.querySelector('#menu');
  const handle = root.querySelector('#handle');
  const sheetOpen = () => !sheet.hidden;
  const openSheet = () => { sheet.hidden = false; renderPanel(); };
  const closeSheet = () => { sheet.hidden = true; mode = null; };
  // لمس كرة: يظهر اسمها فقط في الأسفل؛ ولمس الاسم يفتح التعديلات
  const renderName = () => {
    const id = graph.selected();
    if (!id) { nameBtn.hidden = true; return; }
    const n = id.startsWith('p:') ? null : nodeById(st, id);
    const label = n ? n.name : nameOf(id.slice(2));
    const color = n ? colorOf(n) : placesOf(st, id.slice(2)).some((x) => x.assistant) ? ASSISTANT.color : PERSON.color;
    nameBtn.innerHTML = `${dot(color)}<span>${esc(label)}</span>`;
    nameBtn.hidden = false;
  };
  graph = createOrgGraph(root.querySelector('#sg'), {
    onSelect: (n) => {
      mode = null;
      renderName();
      if (!n) closeSheet(); else if (sheetOpen()) renderPanel();
      if (n) setMenu(false);
    },
  });
  bindBallSearch(root, { focus: (id) => graph?.focus(id), nodes: () => toGraph(st, members).nodes });
  nameBtn.addEventListener('click', openSheet);
  if (IS_DEV) window.__structGraph = graph; // للاختبار في نسخة التجربة فقط
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  // النقطة المتوهجة في الأعلى تُسدل القائمة ودليل الألوان
  function setMenu(on) {
    menu.hidden = !on;
    handle.setAttribute('aria-expanded', String(on));
    handle.classList.toggle('is-open', on);
    if (on) renderFree();
  }
  handle.addEventListener('click', () => setMenu(menu.hidden));
  root.querySelector('#fit').addEventListener('click', () => { graph.fit(); setMenu(false); });
  const renderFree = () => {
    const free = unplaced();
    const el = root.querySelector('#free');
    el.hidden = !free.length && members.length > 0;
    el.innerHTML = !members.length ? 'لا موظفين بعد. أضفهم من <a href="#/staff">الأسماء</a>.'
      : `${dot(PERSON.color)} غير موزعين: <b>${free.map((m) => esc(m.display_name)).join('، ')}</b> · المس أي كرة ثم اسمها لتضعهم فيها.`;
  };

  const commit = async (keepSel = graph.selected()) => {
    await saveStructure(st);
    graph.setData(toGraph(st, members));
    renderLegend();
    graph.select(keepSel || null);
    mode = null;
    renderName();
    if (keepSel) renderPanel(); else closeSheet();
  };

  const unplaced = () => members.filter((m) => !placesOf(st, m.user_id).length);
  const placeLabel = (u) => {
    const pl = placesOf(st, u);
    return pl.length ? pl.map((x) => `${x.assistant ? 'معاون ' : ''}${nodeById(st, x.node).name}`).join('، ') : 'غير موزع';
  };

  // ---- اختيار اللون ----
  const colorPicker = (current) => `
    <div class="struct-colors" role="radiogroup" aria-label="اللون">
      ${PALETTE.map((c) => `<button type="button" class="struct-color${c === current ? ' is-on' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
      <label class="struct-color struct-color--any" title="لون آخر"><input type="color" id="any-color" value="${current}" aria-label="لون آخر"></label>
    </div>`;
  const bindColors = (onPick) => {
    panel.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.color)));
    panel.querySelector('#any-color')?.addEventListener('input', (e) => onPick(e.target.value));
  };

  function renderPanel() {
    if (!alive) return;
    panel.scrollTop = 0;
    const id = graph.selected();
    if (!sheetOpen()) return;
    if (!id) { closeSheet(); return; }
    if (id.startsWith('p:')) return renderPersonPanel(id.slice(2));
    const n = nodeById(st, id);
    if (!n) { panel.innerHTML = ''; return; }
    const t = TYPES[n.type];
    const childT = t.child && TYPES[t.child];
    const asst = assistantOf(st, n.id);
    const heads = headsOf(st, n.id).filter(isMember);
    const waiting = Object.entries(pending).filter(([, x]) => x.node === n.id);
    const here = peopleAt(st, n.id, { assistants: false }).filter(isMember);
    const kids = childrenOf(st, n.id);
    const custom = n.type === 'custom';

    let sub = '';
    if (mode === 'add' || mode === 'rename') {
      sub = `<form class="struct-form" id="nf">
          <input id="nf-name" maxlength="50" required placeholder="${mode === 'add' ? `اسم ${childT.label} الجديدة` : 'الاسم الجديد'}" value="${mode === 'rename' ? esc(n.name) : ''}">
          <button class="btn" type="submit">حفظ</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button>
        </form>`;
    } else if (mode === 'custom') {
      sub = `<form class="struct-form struct-form--col" id="cf">
          <p class="struct-sub">كرة جديدة مرتبطة بـ «${esc(n.name)}» (مشروع، لجنة، مهمة كبيرة...):</p>
          <input id="cf-name" maxlength="50" required placeholder="اسمها، مثل: مشروع كاميرات المبنى الجديد">
          ${colorPicker(draftColor)}
          <div class="row"><button class="btn" type="submit">إضافة</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div>
        </form>`;
    } else if (mode === 'color') {
      sub = `<p class="struct-sub">لون «${esc(n.name)}»:</p>${colorPicker(n.color)}<button class="btn btn--ghost" type="button" data-a="cancel">تم</button>`;
    } else if (mode === 'links') {
      sub = `<p class="struct-sub">اربط «${esc(n.name)}» بالفروع (يمكن اختيار أكثر من فرع):</p>
        <div class="struct-pick">${st.nodes.filter((x) => x.id !== n.id).map((x) => `<button type="button" data-link="${esc(x.id)}" class="${n.links?.includes(x.id) ? 'is-on' : ''}">${n.links?.includes(x.id) ? '✓ ' : ''}${nodeLine(x)}</button>`).join('')}</div>
        <button class="btn btn--ghost" type="button" data-a="cancel">تم</button>`;
    } else if (mode === 'person-ball') {
      // كرة شخص: الاسم واسم المستخدم والمنصب، ويُرسل الرابط لاحقاً من داخل الكرة
      // الخيارات: شعبة أو وحدة حسب ما تحت هذه الكرة، ثم معاون وذاتية ومخصصة وموظف
      const childT = TYPES[n.type]?.child;
      const opts = [];
      if (childT === 'division') opts.push(['division', 'شعبة']);
      if (childT === 'unit') opts.push(['unit', 'وحدة']);
      if (childT === 'section') opts.push(['section', 'قسم وحدة']);
      if (canHaveAssistant(n.type)) opts.push(['assistant', 'معاون']);
      opts.push(['personnel', 'ذاتية'], ['custom', 'مخصصة'], ['member', 'موظف']);
      sub = `<form class="struct-form struct-form--col" id="pbf">
          <p class="struct-sub">كرة جديدة في «${esc(n.name)}». أرسل الرابط لاحقاً من داخلها:</p>
          <input id="pbf-name" maxlength="60" required placeholder="الاسم الكامل">
          <input id="pbf-user" maxlength="30" dir="ltr" placeholder="اسم المستخدم (إنجليزي، لا يلزم للمخصصة)" autocapitalize="off" autocomplete="off">
          <div class="pbf-roles" role="radiogroup" aria-label="المنصب">${opts.map(([v, l]) => `<label class="pbf-role"><span>${l}</span><input type="radio" name="pbf-title" value="${v}" ${v === 'member' ? 'checked' : ''}></label>`).join('')}</div>
          <p class="status" id="msg" role="status"></p>
          <div class="row"><button class="btn" type="submit">إنشاء الكرة</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div>
        </form>`;
    } else if (mode === 'employee-ball') {
      sub = `<form class="struct-form" id="ebf">
          <input id="ebf-name" maxlength="60" required placeholder="اسم الموظف، مثل: أحمد علي">
          <div class="row"><button class="btn" type="submit">إنشاء الكرة</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div>
          <p class="muted struct-note">تُنشأ الكرة الآن، ويُضاف حسابه لاحقاً من لوحة الكرة (إضافة حساب).</p>
        </form>`;
    } else if (mode === 'account') {
      const titles = n.id === 'root' ? ['assistant', 'member'] : canHaveHead(n.type) ? ['head', 'assistant', 'member'] : ['member'];
      // «موظف جديد» يفتح النموذج على «موظف» مختاراً
      const pref = accountPref && titles.includes(accountPref) ? accountPref : titles[0];
      sub = `<form class="struct-form struct-form--col" id="af">
          <p class="struct-sub">حساب جديد في «${esc(n.name)}». يصله رابط فيضع كلمة مروره بنفسه:</p>
          <input id="af-name" maxlength="60" required placeholder="الاسم الكامل" value="${esc(accountName)}">
          <input id="af-user" maxlength="30" required dir="ltr" placeholder="اسم المستخدم (إنجليزي)" autocapitalize="off" autocomplete="off">
          <div class="struct-pick struct-pick--row">${titles.map((t) => `<label class="switch"><input type="radio" name="af-title" value="${t}" ${t === pref ? 'checked' : ''}><span>${TITLES[t]}</span></label>`).join('')}</div>
          <p class="status" id="af-msg" role="status"></p>
          <div class="row"><button class="btn" type="submit">إنشاء الرابط</button>${n.type !== 'employee' ? '<button class="btn btn--ghost" type="button" id="af-ball">إنشاء كرة</button>' : ''}<button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div>
        </form>`;
    } else if (mode === 'invite-out' && lastInvite) {
      sub = `<div class="struct-form struct-form--col">
          <p class="struct-sub">أرسل هذا الرابط إلى <b>${esc(lastInvite.name)}</b> (واتساب مثلاً). يفتحه ويضع كلمة مروره، فيظهر في «${esc(n.name)}» تلقائياً. يُستخدم مرة واحدة، وصالح ٧ أيام.</p>
          <input class="invite-out__link" dir="ltr" readonly value="${esc(lastInvite.link)}">
          <div class="row">${navigator.share ? '<button class="btn" type="button" id="inv-share">مشاركة</button>' : ''}<button class="btn btn--ghost" type="button" id="inv-copy">نسخ</button><button class="btn btn--ghost" type="button" data-a="cancel">تم</button></div>
          <p class="status" id="inv-msg" role="status"></p>
        </div>`;
    } else if (mode === 'perms') {
      const p = permsOf(n);
      sub = `<p class="struct-sub">ما يُسمح لمسؤول «${esc(n.name)}» (ولمعاونه إن فعّلت صلاحيات المعاون):</p>
        <ul class="struct-perms">${PERMS.map(([k, label, hint]) => `<li><label class="switch"><input type="checkbox" data-perm="${k}" ${p[k] ? 'checked' : ''}><span><b>${label}</b><small>${hint}</small></span></label></li>`).join('')}</ul>
        <p class="muted struct-note">تُحفظ الآن، وتعمل حين يصل لكل مسؤول فرعه (المرحلة التالية: الأقسام وإدارة الحسابات وكرات المشاريع، ثم المساعد وعقل المؤسسة والتقييمات).</p>
        <button class="btn btn--ghost" type="button" data-a="cancel">تم</button>`;
    } else if (mode === 'project') {
      const p = projOf(n);
      sub = `<form class="struct-form struct-form--col" id="pf">
          <p class="struct-sub">تفاصيل مشروع «${esc(n.name)}»:</p>
          <div class="struct-pick struct-pick--row">${[['open', 'مفتوح'], ['closed', 'مغلق']].map(([v, l]) => `<label class="switch"><input type="radio" name="pf-status" value="${v}" ${p.status === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <label class="struct-field">تاريخ البدء<input type="date" id="pf-start" value="${esc(p.start)}"></label>
          <label class="struct-field">تاريخ الانتهاء<input type="date" id="pf-end" value="${esc(p.end)}"></label>
          <label class="struct-field">نسبة الإنجاز: <b id="pf-pv">${p.progress}٪</b><input type="range" id="pf-progress" min="0" max="100" step="5" value="${p.progress}"></label>
          <p class="muted struct-note">عند الإغلاق يُعتَّم المشروع، وتُغلق مجموعته (تبقى رسائلها عند أعضائها للقراءة)، ويبقى تقريره ونقاطه.</p>
          <div class="row"><button class="btn" type="submit">حفظ</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div>
        </form>`;
    } else if (mode === 'me') {
      sub = `<div class="struct-form struct-form--col">
          <p class="struct-sub">رئيس القسم: <b>${esc(s.member.display_name)}</b> · اسم المستخدم: <b dir="ltr">${esc(s.member.username)}</b></p>
          <p class="muted" id="me-email">البريد للاستعادة: …</p>
          <form class="struct-form struct-form--col" id="pw">
            <b>تغيير كلمة المرور</b>
            <input type="password" id="pw-cur" required placeholder="كلمة المرور الحالية" autocomplete="current-password">
            <input type="password" id="pw-new" required minlength="8" placeholder="الجديدة (٨ أحرف على الأقل)" autocomplete="new-password">
            <button class="btn" type="submit">تغيير</button>
          </form>
          <form class="struct-form struct-form--col" id="em">
            <b>الاستعادة بالبريد</b>
            <small class="muted"><b>القرار:</b> البريد هو طريقة دخولك من الآن. تصل رسالة تأكيد إلى بريدك، وبعد تأكيدها يتوقف الدخول باسم المستخدم، وتستعيد كلمة المرور منه إن نسيتها.</small>
            <input type="email" id="em-addr" required dir="ltr" placeholder="name@example.com">
            <input type="password" id="em-cur" required placeholder="كلمة المرور الحالية" autocomplete="current-password">
            <button class="btn" type="submit">ربط البريد</button>
          </form>
          <p class="status" id="me-msg" role="status"></p>
          <button class="btn btn--ghost" type="button" data-a="cancel">تم</button>
        </div>`;
    } else if (mode === 'pick-person' || mode === 'pick-assistant') {
      const list = members.filter((m) => {
        const pl = placesOf(st, m.user_id).find((x) => x.node === n.id);
        return mode === 'pick-assistant' ? !pl?.assistant : !pl;
      });
      sub = `<p class="struct-sub">${mode === 'pick-assistant' ? `اختر معاون ${esc(n.name)}` : `أضف موظفاً إلى ${esc(n.name)} (يبقى في أماكنه الأخرى أيضاً)`}:</p>
        <div class="struct-pick">${list.map((m) => `<button type="button" data-u="${esc(m.user_id)}"><b>${esc(m.display_name)}</b><small>${esc(placeLabel(m.user_id))}</small></button>`).join('')}${mode === 'pick-person' ? cardsToPick(st, n).map((c) => `<button type="button" data-card="${esc(c.id)}"><b>${esc(c.name)}</b><small>كرة موظف · ${esc(pathOf(st, c.parent))}</small></button>`).join('') : ''}${list.length || (mode === 'pick-person' && cardsToPick(st, n).length) ? '' : '<p class="muted">لا موظفين متاحين.</p>'}</div>
        <button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button>`;
    }

    const where = n.parent ? ` · ${esc(pathOf(st, n.parent))}`
      : custom ? ` · مرتبطة بـ ${(n.links || []).map((l) => esc(nodeById(st, l)?.name || '')).join('، ')}` : ' · رئيس القسم: أنت';
    panel.innerHTML = `
      <div class="struct-title">${dot(colorOf(n))}<div><b>${esc(n.name)}</b><small>${t.label}${where}</small></div></div>
      ${sub ? '' : statsLine(n.parent || custom ? peopleUnder(n.id) : members.map((m) => m.user_id), n)}
      ${custom && !sub ? `<p class="struct-proj${projectLate(n) ? ' is-late' : ''}">${esc(projectLine(n))}<i style="--p:${projOf(n).progress}%"></i></p>` : ''}
      ${sub ? '' : `<p class="struct-meta">
        ${canHaveHead(n.type) ? `المسؤول: <b>${heads.length ? heads.map((u) => esc(nameOf(u))).join('، ') : 'لا يوجد'}</b> · ` : ''}
        ${canHaveAssistant(n.type) ? `المعاون: <b>${asst ? esc(nameOf(asst)) : 'لا يوجد'}</b> · ` : ''}
        ${t.child ? `${count(kids.length, t.child)} · ` : ''}${count(here.length, 'person')}
      </p>
      ${waiting.length ? `<ul class="struct-waiting">${waiting.map(([code, x]) => `<li><span>بانتظار التسجيل: <b>${esc(x.name)}</b> (${TITLES[x.title]})</span><button type="button" data-link-code="${esc(code)}" data-link-name="${esc(x.name)}">الرابط</button><button type="button" data-cancel-code="${esc(code)}" class="is-danger">إلغاء</button></li>`).join('')}</ul>` : ''}`}
      ${sub || `<div class="struct-actions">
        ${n.id === 'root' ? '<button type="button" data-a="me">حسابك: كلمة المرور والاستعادة</button>' : ''}
        ${n.type !== 'employee' ? '<button type="button" data-a="person-ball">إنشاء كرة</button>' : ''}
        ${n.person ? '<button type="button" data-a="send-link">إرسال رابط</button>' : ''}
        ${n.type === 'employee' && !n.person ? '<button type="button" data-a="account-new">إنشاء رابط</button>' : ''}
        ${n.type === 'employee' && (n.extraParents || []).length ? `<div class="struct-report-list"><b>مرتبط أيضاً بـ:</b>${n.extraParents.map((e) => `<div><span>${esc(nodeById(st, e)?.name || '')}</span> <button type="button" class="text-btn text-btn--danger" data-unlink="${esc(e)}">إزالة</button></div>`).join('')}</div>` : ''}
        ${canHaveHead(n.type) ? '<button type="button" data-a="perms">خيارات الإظهار</button>' : ''}
        ${st.nodes.some((x) => x.parent === n.id) ? reportScopeHTML(st, n) : ''}
        ${n.id !== 'root' && n.type !== 'employee' && n.type !== 'personnel' ? roomMembersHTML(st, n, members) : ''}
        ${custom ? '<button type="button" data-a="project">تفاصيل المشروع: الحالة والتواريخ والإنجاز</button><button type="button" data-a="report">تقرير المشروع</button>' : ''}
        ${custom ? '<label class="struct-field">تغيير النوع إلى<select id="conv-type"><option value="">اختر النوع</option><option value="division">شعبة</option><option value="unit">وحدة</option><option value="section">قسم وحدة</option></select></label>' : ''}
        <button type="button" data-a="rename">تعديل الاسم</button>
        ${n.id !== 'root' ? '<button type="button" data-a="delete" class="is-danger">حذف</button>' : ''}
        <details class="struct-more"><summary>المزيد</summary>
          <div class="struct-actions">
            ${n.type !== 'employee' ? '<button type="button" data-a="account">إنشاء رابط لشخص موجود أو مسؤول</button>' : ''}
            ${n.type !== 'employee' ? '<button type="button" data-a="pick-person">ربط موظف موجود بالكرة</button>' : ''}
            ${custom ? '<button type="button" data-a="links">الربط بفروع</button><button type="button" data-a="color">اللون</button>' : ''}
          </div>
        </details>
      </div>`}`;

    panel.querySelector('#af')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = panel.querySelector('#af-msg');
      const btn = panel.querySelector('#af [type=submit]');
      btn.disabled = true;
      try {
        const name = panel.querySelector('#af-name').value;
        const code = await inviteToBall({ node: n.id, title: panel.querySelector('[name=af-title]:checked').value, name, username: panel.querySelector('#af-user').value });
        await reloadPending();
        lastInvite = { code, name: name.trim(), link: await inviteLink(code) };
        mode = 'invite-out';
        renderPanel();
      } catch (err) { msg.textContent = err.message; msg.className = 'status status--err'; btn.disabled = false; }
    });
    const bindLinkOut = () => {
      const msg = panel.querySelector('#inv-msg');
      panel.querySelector('#inv-share')?.addEventListener('click', () => {
        navigator.share({ title: 'دعوة إلى المؤسسة', text: `${lastInvite.name}، هذه دعوتك للانضمام:`, url: lastInvite.link }).catch(() => {});
      });
      panel.querySelector('#inv-copy')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(lastInvite.link); msg.textContent = 'نُسخ الرابط ✓'; } catch {
          panel.querySelector('.invite-out__link').select(); msg.textContent = 'حدّد الرابط وانسخه يدوياً.';
        }
      });
    };
    if (mode === 'invite-out') bindLinkOut();
    panel.querySelectorAll('[data-link-code]').forEach((b) => b.addEventListener('click', async () => {
      lastInvite = { code: b.dataset.linkCode, name: b.dataset.linkName, link: await inviteLink(b.dataset.linkCode) };
      mode = 'invite-out';
      renderPanel();
    }));
    panel.querySelectorAll('[data-cancel-code]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('إلغاء هذه الدعوة؟ لن يعمل رابطها بعد ذلك.')) return;
      await cancelBallInvite(b.dataset.cancelCode);
      await reloadPending();
      renderPanel();
    }));
    const roomOv = () => (n.room ||= { addPeople: [], removePeople: [], addNodes: [], removeNodes: [] });
    const onRoom = (fn) => async () => { fn(roomOv()); await commit(n.id); };
    panel.querySelectorAll('[data-rp]').forEach((b) => b.addEventListener('click', onRoom((r) => {
      const u = b.dataset.rp;
      r.removePeople = [...new Set([...r.removePeople, u])];
      r.addPeople = r.addPeople.filter((x) => x !== u);
    })));
    panel.querySelector('#rp-add-go')?.addEventListener('click', onRoom((r) => {
      const u = panel.querySelector('#rp-add').value;
      if (!u) return;
      r.addPeople = [...new Set([...r.addPeople, u])];
      r.removePeople = r.removePeople.filter((x) => x !== u);
    }));
    panel.querySelector('#rb-add-go')?.addEventListener('click', onRoom((r) => {
      const id = panel.querySelector('#rb-add').value;
      r.addNodes = [...new Set([...r.addNodes, id])];
      r.removeNodes = r.removeNodes.filter((x) => x !== id);
    }));
    panel.querySelector('#rb-rem-go')?.addEventListener('click', onRoom((r) => {
      const id = panel.querySelector('#rb-rem').value;
      r.removeNodes = [...new Set([...r.removeNodes, id])];
      r.addNodes = r.addNodes.filter((x) => x !== id);
    }));
    panel.querySelectorAll('[data-rbdel]').forEach((b) => b.addEventListener('click', onRoom((r) => {
      const id = b.dataset.rbdel;
      r.addNodes = r.addNodes.filter((x) => x !== id);
      r.removeNodes = r.removeNodes.filter((x) => x !== id);
    })));
    // تحويل الكرة المخصصة إلى نوع تنظيمي: تُزال بيانات المشروع والروابط واللون الخاص
    panel.querySelector('#conv-type')?.addEventListener('change', async (e) => {
      const t = e.target.value;
      if (!t) return;
      const label = { division: 'شعبة', unit: 'وحدة', section: 'قسم وحدة' }[t];
      if (!confirm(`تحويل «${n.name}» إلى ${label}؟ تُحذف تفاصيل المشروع وروابطه، ولا يمكن التراجع.`)) { e.target.value = ''; return; }
      n.type = t;
      delete n.project;
      delete n.links;
      delete n.color;
      await commit(n.id);
    });
    panel.querySelectorAll('[data-rep]').forEach((c) => c.addEventListener('change', async () => {
      const x = nodeById(st, c.dataset.rep);
      if (!x) return;
      if (c.checked) delete x.noReport; else x.noReport = true;
      await saveStructure(st);
    }));
    panel.querySelectorAll('[data-perm]').forEach((c) => c.addEventListener('change', async () => {
      setPerm(st, n.id, c.dataset.perm, c.checked);
      await saveStructure(st);
    }));
    if (mode === 'me') {
      const msg = panel.querySelector('#me-msg');
      const say = (t, ok) => { msg.textContent = t; msg.className = `status ${ok ? 'status--ok' : 'status--err'}`; };
      currentEmail().then((e) => { const el = panel.querySelector('#me-email'); if (el) el.textContent = e ? `البريد: ${e} · تدخل به الآن` : 'البريد: لم يُربط بعد · بدونه لا استعادة لك'; }).catch(() => {});
      panel.querySelector('#pw').addEventListener('submit', async (e) => {
        e.preventDefault();
        const next = panel.querySelector('#pw-new').value;
        try {
          await changePassword(panel.querySelector('#pw-cur').value, next);
          e.target.reset();
          say('غُيّرت كلمة المرور ✓', true);
          // نسخة التجربة: مبدّل الأدوار يحفظ كلمة مرور المدير، فنحدّثها
          if (IS_DEV) import('../dev-tools.js').then((d) => d.updateManagerPassword?.(next)).catch(() => {});
        } catch (err) { say(err.message); }
      });
      panel.querySelector('#em').addEventListener('submit', async (e) => {
        e.preventDefault();
        const addr = panel.querySelector('#em-addr').value;
        try { await linkRecoveryEmail(panel.querySelector('#em-cur').value, addr); e.target.reset(); say(`أرسلنا رسالة تأكيد إلى ${addr}. افتحها واضغط الرابط، ثم ادخل ببريدك.`, true); } catch (err) { say(err.message); }
      });
    }

    panel.querySelector('#pf-progress')?.addEventListener('input', (e) => { panel.querySelector('#pf-pv').textContent = `${e.target.value}٪`; });
    panel.querySelector('#pf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      setProject(st, n.id, {
        status: panel.querySelector('[name=pf-status]:checked').value, start: panel.querySelector('#pf-start').value,
        end: panel.querySelector('#pf-end').value, progress: panel.querySelector('#pf-progress').value,
      });
      await commit(n.id);
    });

    panel.querySelector('#nf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = panel.querySelector('#nf-name').value;
      if (mode === 'add') addNode(st, n.id, name); else renameNode(st, n.id, name);
      await commit(n.id);
    });
    // إنشاء كرة للموظف من نموذج الحساب (يُضاف الرابط لاحقاً من الكرة نفسها)
    panel.querySelector('#af-ball')?.addEventListener('click', async () => {
      const name = panel.querySelector('#af-name').value.trim();
      const msg = panel.querySelector('#msg') || panel.appendChild(Object.assign(document.createElement('p'), { id: 'msg', className: 'status' }));
      if (!name) { msg.textContent = 'اكتب اسم الموظف أولاً.'; msg.className = 'status status--err'; return; }
      const { addEmployeeBall } = await import('../org-structure.js');
      const b = addEmployeeBall(st, n.id, name);
      accountName = ''; accountPref = null;
      await commit(b.id);
    });
    panel.querySelector('#pbf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = panel.querySelector('#msg');
      try {
        const name = panel.querySelector('#pbf-name').value.trim();
        const title = panel.querySelector('[name=pbf-title]:checked').value;
        const { addPersonBall, addNode, addCustom, PALETTE: PAL } = await import('../org-structure.js');
        let made;
        if (title === 'division' || title === 'unit' || title === 'section') {
          // شعبة أو وحدة أو قسم وحدة باسم الاسم المكتوب (تُضاف تحت هذه الكرة حسب نوعها)
          made = addNode(st, n.id, name);
        } else if (title === 'custom') {
          // كرة مخصصة (مشروع أو لجنة): بلا حساب
          made = addCustom(st, n.id, name, PAL[st.nodes.filter((x) => x.type === 'custom').length % PAL.length]);
        } else {
          const username = checkUsername(panel.querySelector('#pbf-user').value);
          made = addPersonBall(st, n.id, name, { username, title, name });
        }
        await commit(made.id);
      } catch (err) { msg.textContent = err.message; msg.className = 'status status--err'; }
    });
    panel.querySelector('#ebf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { addEmployeeBall } = await import('../org-structure.js');
      const b = addEmployeeBall(st, n.id, panel.querySelector('#ebf-name').value);
      await commit(b.id);
    });
    panel.querySelector('#cf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = addCustom(st, n.id, panel.querySelector('#cf-name').value, draftColor);
      await commit(c.id);
    });
    if (mode === 'custom') {
      bindColors((c) => {
        draftColor = c;
        panel.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('is-on', b.dataset.color === c));
      });
    }
    if (mode === 'color') {
      bindColors(async (c) => {
        setColor(st, n.id, c);
        await saveStructure(st);
        graph.setData(toGraph(st, members));
        renderLegend();
        panel.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('is-on', b.dataset.color === c));
        panel.querySelector('.struct-title .sdot').style.background = c;
      });
    }
    panel.querySelector('#nf-name, #cf-name')?.focus();
    panel.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', async () => {
      toggleLink(st, n.id, b.dataset.link);
      await saveStructure(st);
      graph.setData(toGraph(st, members));
      renderPanel();
    }));
    panel.querySelectorAll('[data-unlink]').forEach((b) => b.addEventListener('click', async () => {
      n.extraParents = (n.extraParents || []).filter((x) => x !== b.dataset.unlink);
      await commit(n.id);
    }));
    panel.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', async () => {
      placePerson(st, b.dataset.u, n.id, mode === 'pick-assistant');
      await commit(n.id);
    }));
    // كرة موظف بلا حساب بعد: تُنقل إلى هذه الكرة (تبقى كرة الموظف نفسها ورابطها)
    panel.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', async () => {
      const c = nodeById(st, b.dataset.card);
      if (!c) return;
      c.extraParents = [...new Set([...(c.extraParents || []), n.id])];
      await commit(n.id);
    }));
    panel.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      if (a === 'cancel') { mode = null; renderPanel(); return; }
      if (a === 'no-assistant') { placePerson(st, asst, n.id, false); await commit(n.id); return; }
      if (a === 'personnel') { const p = addPersonnel(st); await commit(p.id); return; }
      if (a === 'report') {
        b.disabled = true;
        b.textContent = 'أكتب تقرير المشروع…';
        try {
          const { makeReport } = await import('../org-insights.js');
          await makeReport('project', { node: n.id });
          location.hash = '#/reports';
        } catch (err) { b.disabled = false; b.textContent = `تعذّر: ${err.message}`; }
        return;
      }
      if (a === 'delete') {
        if (!confirm(`حذف «${n.name}»${custom ? '' : ' وكل ما تحته'}؟ يُزال موظفوه من هذا المكان فقط.`)) return;
        const back = n.parent || (custom ? n.links?.[0] : null);
        removeNode(st, n.id);
        await commit(back);
        return;
      }
      if (a === 'custom') draftColor = PALETTE[st.nodes.filter((x) => x.type === 'custom').length % PALETTE.length];
      // إضافة موظف جديد: نموذج الحساب مختاراً فيه «موظف»
      if (a === 'send-link') {
        const pr = n.person;
        if (!pr) return;
        try {
          // المسؤول: الرابط يضعه مسؤولاً للكرة نفسها. الآخرون: يُوضعون في الكرة الأم بمنصبهم، وتُحذف البطاقة عند انضمامهم
          let node = n.parent, card = n.id, title = pr.title;
          if (pr.title === 'head') { node = n.id; card = null; }
          else if (pr.title === 'personnel') { const ps = addPersonnel(st); node = ps.id; title = 'member'; await saveStructure(st); }
          else if (pr.title === 'member' || pr.title === 'assistant') { /* الافتراضي */ }
          const code = await inviteToBall({ node, title, name: pr.name || n.name, username: pr.username, card });
          lastInvite = { code, name: pr.name || n.name, link: await inviteLink(code) };
          mode = 'invite-out';
          renderPanel();
        } catch (err) { alert(err.message); }
        return;
      }
      if (a === 'person-ball') { mode = 'person-ball'; renderPanel(); return; }
      if (a === 'account-new') { accountPref = 'member'; accountName = n.type === 'employee' ? n.name : ''; mode = 'account'; renderPanel(); return; }
      if (a === 'account') { accountPref = null; accountName = ''; }
      mode = a;
      renderPanel();
    }));
  }

  function renderPersonPanel(u) {
    const places = placesOf(st, u);
    if (!places.length) { panel.innerHTML = ''; return; }
    const asst = places.some((x) => x.assistant);
    let sub = '';
    if (mode === 'add-place') {
      sub = `<p class="struct-sub">أضف ${esc(nameOf(u))} إلى كرة أخرى:</p>
        <div class="struct-pick">${st.nodes.filter((x) => !places.some((p) => p.node === x.id)).map((x) => `<button type="button" data-n="${esc(x.id)}">${nodeLine(x)}</button>`).join('') || '<p class="muted">موجود في كل الكرات.</p>'}</div>
        <button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button>`;
    }
    panel.innerHTML = `
      <div class="struct-title">${dot(asst ? ASSISTANT.color : PERSON.color)}<div><b>${esc(nameOf(u))}</b><small>${places.length === 2 ? 'في كرتين' : places.length > 2 ? `في ${places.length} كرات` : asst ? 'معاون' : 'موظف'}</small></div></div>
      ${sub ? '' : statsLine([u])}
      ${sub || `<ul class="struct-places">${places.map((pl) => {
        const n = nodeById(st, pl.node);
        return `<li>${dot(colorOf(n))}<span><b>${esc(n.name)}</b>${pl.head ? ' <span class="struct-tag">مسؤول</span>' : ''}${pl.assistant ? ' <span class="struct-tag">معاون</span>' : ''}<small>${typeLabel(n)}</small></span>
          ${canHaveHead(n.type) ? `<button type="button" data-head="${esc(n.id)}">${pl.head ? 'إلغاء المسؤول' : 'مسؤول'}</button>` : ''}
          ${canHaveAssistant(n.type) && !pl.head ? `<button type="button" data-asst="${esc(n.id)}">${pl.assistant ? 'إلغاء المعاون' : 'معاون'}</button>` : ''}
          <button type="button" data-rm="${esc(n.id)}" class="is-danger">إزالة</button></li>`;
      }).join('')}</ul>
      ${recentPosts(u)}
      <div class="struct-actions">
        <button type="button" data-a="add-place">إضافة إلى كرة أخرى</button>
        <a href="#/staff?id=${encodeURIComponent(u)}">صفحة الموظف</a>
        <button type="button" data-a="unplace" class="is-danger">إخراج من الهيكل</button>
        <button type="button" data-a="recover">رابط استعادة (نسي كلمة المرور)</button>
        <button type="button" data-a="delete-account" class="is-danger">حذف الحساب</button>
      </div>`}`;
    panel.querySelectorAll('[data-head]').forEach((b) => b.addEventListener('click', async () => {
      const pl = places.find((x) => x.node === b.dataset.head);
      setHead(st, u, b.dataset.head, !pl.head);
      await commit(`p:${u}`);
    }));
    panel.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', async () => {
      placePerson(st, u, b.dataset.n, false);
      await commit(`p:${u}`);
    }));
    panel.querySelectorAll('[data-asst]').forEach((b) => b.addEventListener('click', async () => {
      const pl = places.find((x) => x.node === b.dataset.asst);
      placePerson(st, u, b.dataset.asst, !pl.assistant);
      await commit(`p:${u}`);
    }));
    panel.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      removePlace(st, u, b.dataset.rm);
      await commit(placesOf(st, u).length ? `p:${u}` : b.dataset.rm);
    }));
    panel.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      if (a === 'cancel') { mode = null; renderPanel(); return; }
      if (a === 'recover') {
        const m = members.find((x) => x.user_id === u);
        const pl = places[0];
        try {
          const r = await recoveryInvite({ uid: u, name: nameOf(u), username: m?.username || 'user', node: pl.node, title: pl.head ? 'head' : pl.assistant ? 'assistant' : 'member' });
          lastInvite = { code: r.code, name: `${nameOf(u)} (اسم مستخدمه الجديد: ${r.username})`, link: await inviteLink(r.code) };
          graph.select(pl.node);
          mode = 'invite-out';
          renderPanel();
        } catch (err) { alert(err.message); }
        return;
      }
      if (a === 'delete-account') {
        // تسليم قبل الحذف (A46): يختار الخليفة، فتنتقل الكرات والمناصب ومهامه التي أرسلتها أنت
        const others = members.filter((m) => m.user_id !== u);
        if (!others.length) return alert('لا أحد يستلم الأماكن. أضف موظفاً أولاً.');
        const pick = prompt(`سلّم أماكن ${nameOf(u)} قبل الحذف. اختر الخليفة:\n${others.map((m, i) => `${i + 1}- ${m.display_name}`).join('\n')}\n\nاكتب رقمه:`);
        const chosen = others[Number(pick) - 1];
        if (!chosen) return;
        if (!confirm(`سيُسلَّم ${nameOf(u)} إلى ${chosen.display_name}، ثم يُحذف حسابه من المؤسسة، ولا يستطيع الدخول بعدها. متابعة؟`)) return;
        try {
          // لقطة قبل أي نقل: تبقى في قائمة المحذوفين داخل شاشة الموظفين
          const { snapshotMember, archiveMember } = await import('../removed-staff.js');
          const snap = await snapshotMember(u, st, chosen.display_name);
          const { transferOpenTasks } = await import('../org-accounts.js');
          const moved = await transferOpenTasks(u, chosen.user_id);
          moveMemberPlaces(st, u, chosen.user_id);
          await saveStructure(st);
          await removeMember(u);
          await archiveMember(snap);
          if (moved) alert(`أُعيدت ${moved} ${moved === 1 ? "مهمة" : "مهام"} إلى ${chosen.display_name}`);
        } catch (err) { alert(err.message); return; }
        members = members.filter((m) => m.user_id !== u);
        await commit(placesOf(st, chosen.user_id).length ? `p:${chosen.user_id}` : null);
        return;
      }
      if (a === 'unplace') {
        if (!confirm(`إخراج ${nameOf(u)} من كل كرات الهيكل؟`)) return;
        const back = places[0].node;
        unplacePerson(st, u);
        await commit(back);
        return;
      }
      mode = a;
      renderPanel();
    }));
  }

  graph.setData(toGraph(st, members), { keepView: false });
  renderLegend();
  // أول مرة: نُظهر القائمة لحظة ليعرف المدير مكانها، إن لم يكن الهيكل مبنياً بعد
  if (st.nodes.length < 2) setMenu(true);
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
    if (!menu.hidden) renderFree();
    if (!mode) renderPanel();
  };
  groupEvents.addEventListener('members', onMembers);
  // انضم صاحب دعوة كرة فوُضع فيها: نعيد قراءة الهيكل
  const onPlaced = async () => {
    const fresh = await loadStructure();
    st.nodes = fresh.nodes; st.people = fresh.people;
    await reloadPending();
    graph.setData(toGraph(st, members));
    if (!mode) renderPanel();
  };
  window.addEventListener('sm:placed', onPlaced);
  offStats = () => {
    window.removeEventListener('sm:placed', onPlaced);
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
