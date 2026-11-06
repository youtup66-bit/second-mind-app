// شاشة "عقل المؤسسة" (للمدير فقط): القسم والشعب والوحدات وأقسامها، وكرات مخصصة (مشاريع...)
// يسمّيها المدير ويلوّنها ويربطها بأكثر من فرع، ومكان كل موظف ومعاون (وقد يكون في أكثر من كرة)
import { session, listMembers } from '../cloud.js';
import {
  TYPES, PERSON, ASSISTANT, PALETTE, canHaveAssistant, colorOf, loadStructure, saveStructure, nodeById, childrenOf,
  addNode, addCustom, setColor, toggleLink, renameNode, removeNode, placesOf, placePerson, removePlace, unplacePerson,
  assistantOf, peopleAt, pathOf, toGraph,
} from '../org-structure.js';
import { createOrgGraph } from '../org-graph.js';
import { totals, pointsEvents } from '../points.js';
import { getGroupMessages } from '../storage.js';
import { groupEvents, groupMembers } from '../group.js';
import { staffTabs } from '../staff-nav.js';

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
  const isMember = (u) => members.some((m) => m.user_id === u);
  const typeLabel = (n) => TYPES[n.type].label;
  const nodeLine = (x) => `${dot(colorOf(x))}<b>${esc(x.name)}</b><small>${typeLabel(x)}${x.parent ? ` · ${esc(pathOf(st, x.parent))}` : ''}</small>`;

  // ---- الفرز: نقاط الشهر ومنشورات الأسبوع لكل كرة ----
  let month = new Map(), posts = [];
  const loadStats = async () => { [month, posts] = await Promise.all([totals('month'), getGroupMessages()]); };
  await loadStats();
  const weekAgo = () => Date.now() - 7 * 86400000;
  // الموظفون في الكرة وما تحتها
  const peopleUnder = (nodeId) => {
    const ids = new Set([nodeId]);
    let grew = true;
    while (grew) { grew = false; for (const x of st.nodes) if (!ids.has(x.id) && ids.has(x.parent)) { ids.add(x.id); grew = true; } }
    return Object.entries(st.people).filter(([, p]) => p.places.some((pl) => ids.has(pl.node))).map(([u]) => u);
  };
  // node: الكرة المعروضة؛ المنشور الذي اختار له الموظف كرة يُحسب لتلك الكرة، وغيره يُحسب لكرات مرسله
  const statsLine = (users, node = null) => {
    const pts = users.reduce((a, u) => a + (month.get(u)?.points || 0), 0);
    const set = new Set(users);
    const n = posts.filter((m) => m.sentAt >= weekAgo() && (!node ? set.has(m.from)
      : node.id === 'root' ? true : m.tag ? m.tag === node.name : set.has(m.from))).length;
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
        <button type="button" class="struct-handle" id="handle" aria-label="القائمة" aria-expanded="false"><span></span></button>
        <div class="struct-menu" id="menu" hidden>
          ${staffTabs('structure')}
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
      ${custom.map((n) => `<span>${dot(colorOf(n))}${esc(n.name)}</span>`).join('')}`;
  };

  const panel = root.querySelector('#panel');
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
  nameBtn.addEventListener('click', openSheet);
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
    } else if (mode === 'pick-person' || mode === 'pick-assistant') {
      const list = members.filter((m) => {
        const pl = placesOf(st, m.user_id).find((x) => x.node === n.id);
        return mode === 'pick-assistant' ? !pl?.assistant : !pl;
      });
      sub = `<p class="struct-sub">${mode === 'pick-assistant' ? `اختر معاون ${esc(n.name)}` : `أضف موظفاً إلى ${esc(n.name)} (يبقى في أماكنه الأخرى أيضاً)`}:</p>
        <div class="struct-pick">${list.map((m) => `<button type="button" data-u="${esc(m.user_id)}"><b>${esc(m.display_name)}</b><small>${esc(placeLabel(m.user_id))}</small></button>`).join('') || '<p class="muted">لا موظفين متاحين.</p>'}</div>
        <button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button>`;
    }

    const where = n.parent ? ` · ${esc(pathOf(st, n.parent))}`
      : custom ? ` · مرتبطة بـ ${(n.links || []).map((l) => esc(nodeById(st, l)?.name || '')).join('، ')}` : ' · رئيس القسم: أنت';
    panel.innerHTML = `
      <div class="struct-title">${dot(colorOf(n))}<div><b>${esc(n.name)}</b><small>${t.label}${where}</small></div></div>
      ${sub ? '' : statsLine(n.parent || custom ? peopleUnder(n.id) : members.map((m) => m.user_id), n)}
      ${sub ? '' : `<p class="struct-meta">
        ${canHaveAssistant(n.type) ? `المعاون: <b>${asst ? esc(nameOf(asst)) : 'لا يوجد'}</b> · ` : ''}
        ${t.child ? `${count(kids.length, t.child)} · ` : ''}${count(here.length, 'person')}
      </p>`}
      ${sub || `<div class="struct-actions">
        ${childT ? `<button type="button" data-a="add">إضافة ${childT.label}</button>` : ''}
        <button type="button" data-a="custom">إضافة كرة مخصصة</button>
        <button type="button" data-a="pick-person">إضافة موظف</button>
        ${canHaveAssistant(n.type) ? `<button type="button" data-a="pick-assistant">${asst ? 'تغيير المعاون' : 'إضافة معاون'}</button>` : ''}
        ${asst ? '<button type="button" data-a="no-assistant">إلغاء المعاون</button>' : ''}
        ${custom ? '<button type="button" data-a="links">الربط بفروع</button><button type="button" data-a="color">اللون</button>' : ''}
        <button type="button" data-a="rename">تعديل الاسم</button>
        ${n.id !== 'root' ? '<button type="button" data-a="delete" class="is-danger">حذف</button>' : ''}
      </div>`}`;

    panel.querySelector('#nf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = panel.querySelector('#nf-name').value;
      if (mode === 'add') addNode(st, n.id, name); else renameNode(st, n.id, name);
      await commit(n.id);
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
    panel.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', async () => {
      placePerson(st, b.dataset.u, n.id, mode === 'pick-assistant');
      await commit(n.id);
    }));
    panel.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      if (a === 'cancel') { mode = null; renderPanel(); return; }
      if (a === 'no-assistant') { placePerson(st, asst, n.id, false); await commit(n.id); return; }
      if (a === 'delete') {
        if (!confirm(`حذف «${n.name}»${custom ? '' : ' وكل ما تحته'}؟ يُزال موظفوه من هذا المكان فقط.`)) return;
        const back = n.parent || (custom ? n.links?.[0] : null);
        removeNode(st, n.id);
        await commit(back);
        return;
      }
      if (a === 'custom') draftColor = PALETTE[st.nodes.filter((x) => x.type === 'custom').length % PALETTE.length];
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
        return `<li>${dot(colorOf(n))}<span><b>${esc(n.name)}</b>${pl.assistant ? ' <span class="struct-tag">معاون</span>' : ''}<small>${typeLabel(n)}</small></span>
          ${canHaveAssistant(n.type) ? `<button type="button" data-asst="${esc(n.id)}">${pl.assistant ? 'إلغاء المعاون' : 'معاون'}</button>` : ''}
          <button type="button" data-rm="${esc(n.id)}" class="is-danger">إزالة</button></li>`;
      }).join('')}</ul>
      ${recentPosts(u)}
      <div class="struct-actions">
        <button type="button" data-a="add-place">إضافة إلى كرة أخرى</button>
        <a href="#/staff?id=${encodeURIComponent(u)}">صفحة الموظف</a>
        <button type="button" data-a="unplace" class="is-danger">إخراج من الهيكل</button>
      </div>`}`;
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
