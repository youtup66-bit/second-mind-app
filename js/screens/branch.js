// شاشة «الأقسام» للمسؤول (A40، المرحلة ٢): فرعه فقط كما نشره هاتف رئيس القسم، ويبقى آخر تحديث على جهازه.
// بحسب خيارات إظهاره: ينشئ كرات وحسابات لما تحته، وكرات مشاريع، ويرسل روابط الاستعادة.
// الحسابات تُنشأ مباشرة (رابط دعوة)، وتعديل الكرات طلبٌ يطبّقه هاتف رئيس القسم حين يتصل.
import { startGroupSync, groupEvents, groupBranch, groupMembers, groupMe, waitBranch } from '../group.js';
import { TYPES, PERSON, ASSISTANT, PALETTE, colorOf, nodeById, toGraph, canHaveHead, projOf, projectLine, projectLate } from '../org-structure.js';
import { createOrgGraph } from '../org-graph.js';
import { ballSearchHTML, bindBallSearch } from '../ball-search.js';
import { createInvite, inviteLink } from '../cloud.js';
import { sendRequest } from '../org-branches.js';
import { recoveryInvite, TITLES } from '../org-accounts.js';
import { getSetting, setSetting } from '../storage.js';
import { IS_DEV } from '../env.js';
import { mindTabs } from '../staff-nav.js';

export const title = 'الأقسام';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dot = (c) => `<i class="sdot" style="background:${c}"></i>`;
const fmt = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const PENDING = 'branchPending'; // طلبات أُرسلت ولم تظهر في الفرع بعد

let graph = null, alive = false, offs = [];

export async function mount(root) {
  alive = true;
  root.innerHTML = '<p class="muted org-wait">لحظة…</p>';
  await startGroupSync().catch(() => {});
  await waitBranch();
  if (!alive) return;
  let b = groupBranch();
  if (!b?.perms?.sections) {
    root.innerHTML = `<div class="org"><div class="org-hero"><div class="org-hero__icon" aria-hidden="true">◉</div>
      <h2>الأقسام</h2><p class="muted">${b ? 'لم يُظهر لك رئيس القسم الأقسام بعد.' : 'لا فرع لك بعد. إن كنت مسؤولاً لكرة فيظهر فرعك حين يعيّنك رئيس القسم. وإن كنت معاوناً فلا صلاحيات إدارة لك حتى يفعّلها رئيس القسم في «صلاحيات المعاون».'}</p></div></div>`;
    return;
  }

  root.innerHTML = `
    <div class="struct struct--full">
      <div class="struct-stage">
        <canvas id="sg" aria-label="فرعك"></canvas>
        ${ballSearchHTML()}
        <button type="button" class="struct-handle" id="handle" aria-label="القائمة" aria-expanded="false"><span></span></button>
        <div class="struct-menu" id="menu" hidden>
          ${b.perms.mind ? mindTabs('branch', 'branch') : ''}
          <p class="struct-sub" id="info"></p>
          <div class="struct-legend" id="legend"></div>
          <div class="branch-evals" id="evals" hidden></div>
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
  const $ = (q) => root.querySelector(q);
  const panel = $('#panel'), sheet = $('#sheet'), nameBtn = $('#name'), menu = $('#menu'), handle = $('#handle');
  let st, names, manage, mode = null, lastLink = null, draftColor = PALETTE[0];
  const me = groupMe();
  const load = () => {
    b = groupBranch() || b;
    st = { nodes: b.nodes, people: Object.fromEntries(b.people.map((p) => [p.uid, { places: p.places }])) };
    names = new Map(b.people.map((p) => [p.uid, p.name]));
    manage = new Set(b.manage || []);
  };
  load();
  const nameOf = (u) => names.get(u) || groupMembers().get(u)?.name || 'عضو';
  const canProj = (id) => !!b.nodes.find((n) => n.id === id)?.proj;
  const isHeadBall = (id) => (b.heads || []).includes(id);

  async function renderInfo() {
    const pend = ((await getSetting(PENDING, [])) || []).filter((x) => x.at > (b.at || 0) - 5000);
    $('#info').innerHTML = `آخر تحديث من رئيس القسم: ${fmt.format(b.at || Date.now())}${pend.length ? ` · <b>${pend.length}</b> ${pend.length === 1 ? 'طلب ينتظر' : 'طلبات تنتظر'} تطبيقه` : ''}`;
    // التقييمات (إن سمح رئيس القسم): نقاط من تحته هذا الشهر
    const ev = b.perms.evals ? b.evals || {} : null;
    $('#evals').hidden = !ev;
    if (ev) {
      const rows = b.people.filter((p) => ev[p.uid]).sort((x, y) => ev[y.uid].month - ev[x.uid].month);
      $('#evals').innerHTML = `<b>التقييمات · نقاط هذا الشهر</b>${rows.length ? `<ul>${rows.map((p) => `<li><span>${esc(p.name)}</span><b>${ev[p.uid].month}</b></li>`).join('')}</ul>` : '<p class="muted">لا نقاط بعد.</p>'}`;
    }
    $('#legend').innerHTML = `<span>${dot(TYPES.division.color)}شعبة</span><span>${dot(TYPES.unit.color)}وحدة</span><span>${dot(TYPES.section.color)}قسم وحدة</span><span>${dot(PERSON.color)}موظف</span><span>${dot(ASSISTANT.color)}معاون</span>`;
  }
  const request = async (op, payload) => {
    await sendRequest(op, payload);
    const pend = ((await getSetting(PENDING, [])) || []).slice(-50);
    pend.push({ op, at: Date.now() });
    await setSetting(PENDING, pend);
    renderInfo();
  };

  const setMenu = (on) => { menu.hidden = !on; handle.classList.toggle('is-open', on); handle.setAttribute('aria-expanded', String(on)); };
  handle.addEventListener('click', () => setMenu(menu.hidden));
  $('#fit').addEventListener('click', () => { graph.fit(); setMenu(false); });
  const members = () => b.people.map((p) => ({ user_id: p.uid, display_name: p.name }));
  graph = createOrgGraph($('#sg'), { onSelect: (n) => { mode = null; renderName(); if (!n) sheet.hidden = true; else if (!sheet.hidden) renderPanel(); if (n) setMenu(false); } });
  bindBallSearch(root, { focus: (id) => graph?.focus(id), nodes: () => toGraph(st, members()).nodes });
  const renderName = () => {
    const id = graph.selected();
    if (!id) { nameBtn.hidden = true; return; }
    const n = id.startsWith('p:') ? null : nodeById(st, id);
    nameBtn.innerHTML = `${dot(n ? colorOf(n) : PERSON.color)}<span>${esc(n ? n.name : nameOf(id.slice(2)))}</span>`;
    nameBtn.hidden = false;
  };
  nameBtn.addEventListener('click', () => { sheet.hidden = false; renderPanel(); });
  if (IS_DEV) window.__branchGraph = graph; // للاختبار في نسخة التجربة فقط
  sheet.addEventListener('click', (e) => { if (e.target === sheet) { sheet.hidden = true; mode = null; } });

  const say = (t, ok) => { const m = panel.querySelector('#msg'); if (m) { m.textContent = t; m.className = `status ${ok ? 'status--ok' : 'status--err'}`; } };
  const linkOut = () => `<div class="struct-form struct-form--col">
      <p class="struct-sub">أرسل الرابط إلى <b>${esc(lastLink.name)}</b>. يفتحه ويضع كلمة مروره${lastLink.username ? ` (اسم مستخدمه الجديد: <b dir="ltr">${esc(lastLink.username)}</b>)` : ''}. يظهر في كرته حين يطبّق هاتف رئيس القسم ذلك.</p>
      <input class="invite-out__link" dir="ltr" readonly value="${esc(lastLink.link)}">
      <div class="row">${navigator.share ? '<button class="btn" type="button" id="inv-share">مشاركة</button>' : ''}<button class="btn btn--ghost" type="button" id="inv-copy">نسخ</button><button class="btn btn--ghost" type="button" data-a="cancel">تم</button></div>
      <p class="status" id="msg" role="status"></p></div>`;
  const bindLinkOut = () => {
    panel.querySelector('#inv-share')?.addEventListener('click', () => navigator.share({ title: 'دعوة إلى المؤسسة', text: `${lastLink.name}، هذا رابطك:`, url: lastLink.link }).catch(() => {}));
    panel.querySelector('#inv-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(lastLink.link); say('نُسخ الرابط ✓', true); } catch { panel.querySelector('.invite-out__link').select(); }
    });
  };

  function renderPanel() {
    if (!alive || sheet.hidden) return;
    const id = graph.selected();
    if (!id) { sheet.hidden = true; return; }
    if (id.startsWith('p:')) return renderPerson(id.slice(2));
    const n = nodeById(st, id);
    if (!n) return;
    const t = TYPES[n.type];
    const childT = t.child && TYPES[t.child];
    const can = manage.has(n.id);
    const heads = Object.entries(st.people).filter(([, p]) => p.places.some((pl) => pl.node === n.id && pl.head)).map(([u]) => nameOf(u));
    const here = Object.entries(st.people).filter(([, p]) => p.places.some((pl) => pl.node === n.id)).length;
    let sub = '';
    if (mode === 'account') {
      const titles = canHaveHead(n.type) && !isHeadBall(n.id) ? ['head', 'assistant', 'member'] : ['member', 'assistant'];
      sub = `<form class="struct-form struct-form--col" id="af">
          <p class="struct-sub">حساب جديد في «${esc(n.name)}»:</p>
          <input id="af-name" maxlength="60" required placeholder="الاسم الكامل">
          <input id="af-user" maxlength="30" required dir="ltr" placeholder="اسم المستخدم (إنجليزي)" autocapitalize="off" autocomplete="off">
          <div class="struct-pick struct-pick--row">${titles.map((x, i) => `<label class="switch"><input type="radio" name="af-title" value="${x}" ${i === 0 ? 'checked' : ''}><span>${TITLES[x]}</span></label>`).join('')}</div>
          <p class="status" id="msg" role="status"></p>
          <div class="row"><button class="btn" type="submit">إنشاء الرابط</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div></form>`;
    } else if (mode === 'add' || mode === 'rename' || mode === 'project') {
      sub = `<form class="struct-form struct-form--col" id="nf">
          <input id="nf-name" maxlength="50" required placeholder="${mode === 'add' ? `اسم ${childT.label} الجديدة` : mode === 'project' ? 'اسم المشروع' : 'الاسم الجديد'}" value="${mode === 'rename' ? esc(n.name) : ''}">
          ${mode === 'project' ? `<div class="struct-colors">${PALETTE.map((c) => `<button type="button" class="struct-color${c === draftColor ? ' is-on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</div>` : ''}
          <div class="row"><button class="btn" type="submit">إرسال</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div></form>`;
    } else if (mode === 'pick') {
      const list = b.people.filter((p) => !p.places.some((pl) => pl.node === n.id));
      sub = `<p class="struct-sub">أضف إلى «${esc(n.name)}» من فرعك:</p><div class="struct-pick">${list.map((p) => `<button type="button" data-u="${esc(p.uid)}"><b>${esc(p.name)}</b></button>`).join('') || '<p class="muted">لا أحد متاح.</p>'}</div>
        <button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button>`;
    } else if (mode === 'link' && lastLink) sub = linkOut();
    else if (mode === 'proj') {
      const p = projOf(n);
      sub = `<form class="struct-form struct-form--col" id="pf">
          <div class="struct-pick struct-pick--row">${[['open', 'مفتوح'], ['closed', 'مغلق']].map(([v, l]) => `<label class="switch"><input type="radio" name="pf-status" value="${v}" ${p.status === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <label class="struct-field">تاريخ البدء<input type="date" id="pf-start" value="${esc(p.start)}"></label>
          <label class="struct-field">تاريخ الانتهاء<input type="date" id="pf-end" value="${esc(p.end)}"></label>
          <label class="struct-field">نسبة الإنجاز: <b id="pf-pv">${p.progress}٪</b><input type="range" id="pf-progress" min="0" max="100" step="5" value="${p.progress}"></label>
          <div class="row"><button class="btn" type="submit">إرسال</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div></form>`;
    }
    panel.innerHTML = `
      <div class="struct-title">${dot(colorOf(n))}<div><b>${esc(n.name)}</b><small>${t.label}${isHeadBall(n.id) ? ' · أنت مسؤولها' : ''}</small></div></div>
      ${n.type === 'custom' && !sub ? `<p class="struct-proj${projectLate(n) ? ' is-late' : ''}">${esc(projectLine(n))}<i style="--p:${projOf(n).progress}%"></i></p>` : ''}
      ${sub || `<p class="struct-meta">${canHaveHead(n.type) ? `المسؤول: <b>${heads.length ? heads.map(esc).join('، ') : 'لا يوجد'}</b> · ` : ''}${here ? `${here} في الكرة` : 'لا أحد بعد'}</p>
      <div class="struct-actions">
        ${can ? '<button type="button" data-a="account">إضافة حساب</button>' : ''}
        ${can && childT ? `<button type="button" data-a="add">إضافة ${childT.label}</button>` : ''}
        ${(can || (n.type === 'custom' && canProj(n.id))) ? '<button type="button" data-a="pick">إضافة من فرعك</button>' : ''}
        ${canProj(n.id) && n.type !== 'custom' ? '<button type="button" data-a="project">إضافة مشروع</button>' : ''}
        ${canProj(n.id) && n.type === 'custom' ? '<button type="button" data-a="proj">تفاصيل المشروع: الحالة والتواريخ والإنجاز</button>' : ''}
        ${(can || (n.type === 'custom' && canProj(n.id))) ? '<button type="button" data-a="rename">تعديل الاسم</button>' : ''}
        ${(can || (n.type === 'custom' && canProj(n.id))) && !isHeadBall(n.id) ? '<button type="button" data-a="remove" class="is-danger">حذف</button>' : ''}
        ${!can && !canProj(n.id) ? '<p class="muted">للعرض فقط.</p>' : ''}
      </div>`}`;
    if (mode === 'link') bindLinkOut();
    panel.querySelector('#af')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nm = panel.querySelector('#af-name').value;
      try {
        const code = await createInvite({ name: nm, username: panel.querySelector('#af-user').value, node: n.id, title: panel.querySelector('[name=af-title]:checked').value });
        lastLink = { name: nm.trim(), link: await inviteLink(code) };
        mode = 'link'; renderPanel();
      } catch (err) { say(err.message); }
    });
    panel.querySelectorAll('[data-color]').forEach((x) => x.addEventListener('click', () => { draftColor = x.dataset.color; panel.querySelectorAll('[data-color]').forEach((y) => y.classList.toggle('is-on', y === x)); }));
    panel.querySelector('#nf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nm = panel.querySelector('#nf-name').value;
      if (mode === 'add') await request('addNode', { parent: n.id, name: nm });
      else if (mode === 'rename') await request('rename', { id: n.id, name: nm });
      else await request('addProject', { link: n.id, name: nm, color: draftColor });
      mode = null; renderPanel(); toast('أُرسل إلى هاتف رئيس القسم، ويظهر حين يطبّقه.');
    });
    panel.querySelector('#pf-progress')?.addEventListener('input', (e) => { panel.querySelector('#pf-pv').textContent = `${e.target.value}٪`; });
    panel.querySelector('#pf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await request('project', { id: n.id, status: panel.querySelector('[name=pf-status]:checked').value, start: panel.querySelector('#pf-start').value, end: panel.querySelector('#pf-end').value, progress: Number(panel.querySelector('#pf-progress').value) });
      mode = null; renderPanel(); toast('أُرسل إلى هاتف رئيس القسم، ويظهر حين يطبّقه.');
    });
    panel.querySelectorAll('[data-u]').forEach((x) => x.addEventListener('click', async () => {
      await request('place', { uid: x.dataset.u, node: n.id, title: 'member' });
      mode = null; renderPanel(); toast('أُرسل الطلب.');
    }));
    panel.querySelectorAll('[data-a]').forEach((x) => x.addEventListener('click', async () => {
      const a = x.dataset.a;
      if (a === 'cancel') { mode = null; renderPanel(); return; }
      if (a === 'remove') {
        if (!confirm(`حذف «${n.name}» وما تحته؟`)) return;
        await request('removeNode', { id: n.id }); toast('أُرسل طلب الحذف.'); return;
      }
      mode = a; renderPanel();
    }));
  }

  function renderPerson(u) {
    const p = st.people[u];
    if (!p) return;
    const can = p.places.every((pl) => manage.has(pl.node)) && u !== me?.uid;
    let sub = mode === 'link' && lastLink ? linkOut() : '';
    // تسليم قبل الحذف (A46): يختار الخليفة من فرعه، فتنتقل كراته ومناصبه ومهامه إليه
    if (mode === 'handover') {
      const others = b.people.filter((x) => x.uid !== u);
      sub = `<form class="struct-form struct-form--col" id="hf">
          <p class="struct-sub">قبل حذف حساب <b>${esc(nameOf(u))}</b> سلّم أماكنه لغيره في فرعك:</p>
          <label class="struct-field">الخليفة<select id="hf-to" required>${others.map((x) => `<option value="${esc(x.uid)}">${esc(x.name)}</option>`).join('')}</select></label>
          <p class="muted struct-note">تنتقل كراته ومناصبه إلى الخليفة. المهام التي أرسلتها له تُعاد إليه عند الخليفة. المهام التي أرسلها غيرك له تبقى على أجهزتهم.</p>
          <div class="row"><button class="btn" type="submit" ${others.length ? '' : 'disabled'}>تسليم وحذف الحساب</button><button class="btn btn--ghost" type="button" data-a="cancel">إلغاء</button></div>
        </form>`;
    }
    panel.innerHTML = `
      <div class="struct-title">${dot(p.places.some((x) => x.assistant) ? ASSISTANT.color : PERSON.color)}<div><b>${esc(nameOf(u))}</b><small>${u === me?.uid ? 'أنت' : ''}</small></div></div>
      ${!sub && b.perms.evals && b.evals?.[u] ? `<p class="struct-stats">نقاط هذا الأسبوع <b>${b.evals[u].week}</b> · هذا الشهر <b>${b.evals[u].month}</b>${b.evals[u].works.length ? `<br><small>${b.evals[u].works.map(esc).join('، ')}</small>` : ''}</p>` : ''}
      ${sub || `<ul class="struct-places">${p.places.map((pl) => { const n = nodeById(st, pl.node); return `<li>${dot(colorOf(n))}<span><b>${esc(n.name)}</b>${pl.head ? ' <span class="struct-tag">مسؤول</span>' : ''}${pl.assistant ? ' <span class="struct-tag">معاون</span>' : ''}</span>
          ${manage.has(pl.node) && u !== me?.uid ? `${canHaveHead(n.type) && !isHeadBall(n.id) ? `<button type="button" data-title="${esc(n.id)}" data-v="${pl.head ? 'member' : 'head'}">${pl.head ? 'إلغاء المسؤول' : 'مسؤول'}</button>` : ''}<button type="button" data-rm="${esc(n.id)}" class="is-danger">إزالة</button>` : ''}</li>`; }).join('')}</ul>
      <div class="struct-actions">
        ${can ? '<button type="button" data-a="recover">رابط استعادة (نسي كلمة المرور)</button><button type="button" data-a="delete" class="is-danger">حذف الحساب</button>' : ''}
      </div>`}
      <p class="status" id="msg" role="status"></p>`;
    if (mode === 'link') bindLinkOut();
    panel.querySelector('#hf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const to = panel.querySelector('#hf-to').value;
      const btn = panel.querySelector('#hf [type=submit]');
      btn.disabled = true;
      try {
        const { transferOpenTasks } = await import('../org-accounts.js');
        const moved = await transferOpenTasks(u, to);
        await request('deleteAccount', { uid: u, successor: to });
        mode = null; renderPerson(u);
        toast(`أُرسل طلب الحذف والتسليم${moved ? `، وأُعيدت ${moved} ${moved === 1 ? 'مهمة' : 'مهام'} إلى الخليفة` : ''}.`);
      } catch (err) { say(err.message); btn.disabled = false; }
    });
    panel.querySelectorAll('[data-title]').forEach((x) => x.addEventListener('click', async () => {
      await request('place', { uid: u, node: x.dataset.title, title: x.dataset.v }); toast('أُرسل الطلب.');
    }));
    panel.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', async () => {
      await request('unplace', { uid: u, node: x.dataset.rm }); toast('أُرسل الطلب.');
    }));
    panel.querySelectorAll('[data-a]').forEach((x) => x.addEventListener('click', async () => {
      const a = x.dataset.a;
      if (a === 'cancel') { mode = null; renderPerson(u); return; }
      if (a === 'delete') { mode = 'handover'; renderPerson(u); return; }
      if (a === 'recover') {
        try {
          const pl = p.places[0];
          const r = await recoveryInvite({ uid: u, name: nameOf(u), username: groupMembers().get(u)?.username || 'user', node: pl.node, title: pl.head ? 'head' : pl.assistant ? 'assistant' : 'member' });
          lastLink = { name: nameOf(u), username: r.username, link: await inviteLink(r.code) };
          mode = 'link'; renderPerson(u);
        } catch (err) { say(err.message); }
      }
    }));
  }

  const toast = (t) => { const m = panel.querySelector('#msg') || panel.appendChild(Object.assign(document.createElement('p'), { id: 'msg', className: 'status' })); m.textContent = t; m.className = 'status status--ok'; };

  const draw = (keep = true) => { graph.setData(toGraph(st, members()), keep ? undefined : { keepView: false }); };
  draw(false);
  renderInfo();
  if (b.nodes.length < 3) setMenu(true);
  // وصل تحديث جديد من رئيس القسم
  const onBranch = () => { if (!groupBranch()) return; load(); draw(); renderInfo(); renderName(); if (!mode) renderPanel(); };
  groupEvents.addEventListener('branch', onBranch);
  offs.push(() => groupEvents.removeEventListener('branch', onBranch));
}

export function unmount() {
  alive = false;
  offs.forEach((f) => f());
  offs = [];
  graph?.destroy();
  graph = null;
}
