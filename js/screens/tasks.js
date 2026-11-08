// شاشة المهام: «مهامي» (ما كُلّفت به، وأرد عليه بتأشيرة العمل) و«أرسلتُها» (للمسؤول ورئيس القسم)
import { startGroupSync, groupEvents, groupRooms, groupMe, groupMembers, myContacts, GENERAL, compressImage, isChatRoom } from '../group.js';
import {
  taskEvents, listTasks, sendTask, replyTask, deleteTask, assignable, canAssign, catalog, taskRoom, isSilent, markSeen, STATUS,
} from '../tasks.js';
import { session } from '../cloud.js';

export const title = 'المهام';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long' });
let offs = [];
let alive = false;

export async function mount(root) {
  alive = true;
  root.innerHTML = '<p class="muted org-wait">لحظة…</p>';
  const s = await session().catch(() => null);
  if (!s?.member) { root.innerHTML = '<div class="org"><p class="muted">ادخل إلى المؤسسة أولاً.</p><a class="btn org-wide" href="#/org">الدخول</a></div>'; return; }
  await startGroupSync().catch(() => {});
  const { waitBranch } = await import('../group.js');
  if (s.member.role !== 'manager') await waitBranch();
  if (!alive) return;
  const assigner = canAssign();
  let tab = assigner ? 'sent' : 'mine';
  const list0 = await listTasks();
  if (list0.some((t) => !t.mine && t.status !== 'done')) tab = 'mine';

  root.innerHTML = `
    <section class="tasks">
      <header class="wa-head"><div class="wa-head__who"><span class="wa-head__text"><b>المهام</b><small id="t-sub"></small></span></div></header>
      ${assigner ? `<nav class="struct-tabs page-tabs tasks-tabs"><a href="#" data-tab="mine">مهامي</a><a href="#" data-tab="sent">أرسلتُها</a></nav>` : ''}
      <p class="wa-note" id="t-note" hidden role="status"></p>
      <ul class="tasks-list" id="t-list"></ul>
      ${assigner ? '<button type="button" class="g-new" id="t-new">مهمة جديدة</button>' : ''}
    </section>
    <div class="sheet g-sheet" id="t-sheet" hidden><form class="sheet__panel sheet__panel--tall" id="t-form"></form></div>`;
  const $ = (q) => root.querySelector(q);
  const sheet = $('#t-sheet'), form = $('#t-form');
  const say = (t, ok = false) => { const n = $('#t-note'); n.textContent = t; n.hidden = !t; n.classList.toggle('is-ok', ok); };

  async function render() {
    if (!alive) return;
    const all = await listTasks();
    root.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('is-on', a.dataset.tab === tab));
    const list = all.filter((t) => (tab === 'mine' ? !t.mine : t.mine)).sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.lastAt - a.lastAt);
    const open = all.filter((t) => !t.mine && t.status !== 'done').length;
    $('#t-sub').textContent = tab === 'mine' ? (open ? `${open} مفتوحة` : 'لا مهام مفتوحة') : `${list.filter((t) => t.status !== 'done').length} لم تكتمل`;
    $('#t-list').innerHTML = list.map((t) => card(t)).join('') || `<li class="wa-day">${tab === 'mine' ? 'لا مهام لك بعد.' : 'لم ترسل مهاماً بعد. أرسل أول مهمة من الزر بالأسفل.'}</li>`;
    if (tab === 'mine') markSeen();
  }
  function card(t) {
    const last = (t.updates || []).at(-1);
    const silent = isSilent(t);
    const late = t.due && t.status !== 'done' && new Date(`${t.due}T23:59`) < new Date();
    return `<li class="task task--${t.status}${silent ? ' is-silent' : ''}" data-id="${esc(t.id)}" data-from="${esc(t.from)}">
      <div class="task__top"><b>${esc(t.title)}</b><span class="task__st">${STATUS[t.status] || ''}</span></div>
      <small class="task__who">${t.mine ? `إلى ${esc(t.toName)}` : `من ${esc(t.fromName)}`} · ${fmt.format(t.createdAt)}${t.due ? ` · الموعد ${fmtDay.format(new Date(`${t.due}T00:00`))}${late ? ' <span class="task__late">متأخرة</span>' : ''}` : ''}</small>
      ${t.text ? `<p class="task__text">${esc(t.text)}</p>` : ''}
      ${last && last.status !== 'received' ? `<p class="task__last">${last.status === 'done' ? '✅' : '⏳'} ${esc(STATUS[last.status])}${last.work ? ` · ${esc(last.work)}${last.count > 1 ? ` ×${last.count}` : ''}` : ''}${last.helpers ? ` · معه: ${esc(last.helpers)}` : ''}${last.note ? ` · ${esc(last.note)}` : ''} <small>${fmt.format(last.at)}</small></p>` : ''}
      ${silent ? '<p class="task__silent">لم ينشر حتى الآن</p>' : ''}
      ${t.failed ? '<p class="task__silent">لم تُرسل. احذفها وأعد الإرسال.</p>' : ''}
      <div class="task__acts">
        ${!t.mine && t.status !== 'done' ? '<button type="button" class="text-btn" data-reply="done">تم</button><button type="button" class="text-btn" data-reply="ongoing">مازال يستأنف</button>' : ''}
        ${t.mine ? '<button type="button" class="text-btn text-btn--muted" data-del>حذف</button>' : ''}
      </div>
    </li>`;
  }

  // ---- مهمة جديدة ----
  function openNew() {
    const people = assignable();
    form.innerHTML = `
      <p class="sheet__title">مهمة جديدة</p>
      <label class="struct-field">إلى<select id="tn-to" required>${people.map((p) => `<option value="${esc(p.uid)}">${esc(p.name)}</option>`).join('')}</select></label>
      <input id="tn-title" maxlength="120" required placeholder="المهمة، مثل: تسليك كاميرات الطابق الثاني">
      <textarea id="tn-text" rows="3" maxlength="800" placeholder="تفاصيل (اختياري)"></textarea>
      <label class="struct-field">الموعد (اختياري)<input type="date" id="tn-due"></label>
      <p class="status" id="tn-msg" role="status"></p>
      <div class="g-sheet__actions"><button class="btn" type="submit">إرسال</button><button class="btn btn--ghost" type="button" data-close>إلغاء</button></div>`;
    if (!people.length) form.querySelector('#tn-msg').textContent = 'لا أحد في فرعك بعد.';
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await sendTask({ to: form.querySelector('#tn-to').value, title: form.querySelector('#tn-title').value, text: form.querySelector('#tn-text').value, due: form.querySelector('#tn-due').value });
        sheet.hidden = true; tab = 'sent'; render(); say('أُرسلت المهمة ✓', true);
      } catch (err) { form.querySelector('#tn-msg').textContent = err.message; btn.disabled = false; }
    };
    sheet.hidden = false;
    form.querySelector('#tn-title').focus();
  }

  // ---- الرد على مهمة: أعمال متعددة (لكل عمل عدده)، ومعاونون ذهبوا معه، وملاحظة وصورة، ومجموعة النشر (ثابتة) ----
  async function openReply(t, status) {
    const [works, room] = await Promise.all([catalog(), taskRoom()]);
    const rooms = [[GENERAL, 'العامة'], ...[...groupRooms()].filter(([id]) => !isChatRoom(id)).map(([id, r]) => [id, r.name])];
    const all = groupMembers();
    const me = groupMe();
    // من في وحدته (ومن تحتها)؛ ورئيس القسم يرى الجميع
    const unit = myContacts().filter((u) => u !== me.uid && all.has(u)).map((u) => ({ uid: u, name: all.get(u).name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const picked = new Map(); // id ← count
    const helpers = new Map(); // مفتاح ← { uid?, name }
    let image = null;
    form.innerHTML = `
      <p class="sheet__title">${status === 'done' ? '✅ تم' : '⏳ مازال يستأنف'}: ${esc(t.title)}</p>
      <p class="g-sub">الأعمال <small>اختر كل ما أنجزته، ولكل عمل عدده</small></p>
      <div class="task-tags">${works.map((w) => `<button type="button" class="task-tag" data-w="${esc(w.id)}">${esc(w.name)}</button>`).join('') || '<span class="muted">لا تأشيرات بعد (يضيفها رئيس القسم في النقاط).</span>'}</div>
      <ul class="task-counts" id="tr-counts"></ul>
      <p class="g-sub">المعاونون <small>من ذهب معك</small></p>
      <ul class="g-pick task-helpers" id="tr-helpers">${unit.map((p) => `<li><label><input type="checkbox" value="${esc(p.uid)}"><span>${esc(p.name)}</span></label></li>`).join('')}</ul>
      <div class="task-add-helper">
        <input id="tr-hname" placeholder="إضافة شخص غير موجود في القائمة" autocomplete="off">
        <button type="button" class="text-btn" id="tr-hadd">إضافة</button>
      </div>
      <ul class="g-found" id="tr-hfound"></ul>
      <ul class="g-invited" id="tr-hextra"></ul>
      <textarea id="tr-note" rows="2" maxlength="600" placeholder="ملاحظة (اختياري): المكان، المدة، ما بقي…"></textarea>
      <div class="row"><button type="button" class="btn btn--ghost" id="tr-photo">📷 صورة</button><span class="muted" id="tr-photo-st"></span></div>
      <input type="file" id="tr-file" accept="image/*" hidden>
      <label class="struct-field">يُنشر في<select id="tr-room">${rooms.map(([id, n]) => `<option value="${esc(id)}" ${id === room ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <small class="muted">تبقى مجموعة النشر كما اخترتها للمرات القادمة.</small>
      <p class="status" id="tr-msg" role="status"></p>
      <div class="g-sheet__actions"><button class="btn" type="submit">نشر</button><button class="btn btn--ghost" type="button" data-close>إلغاء</button></div>`;
    const $f = (q) => form.querySelector(q);
    const renderCounts = () => {
      $f('#tr-counts').innerHTML = [...picked].map(([id, n]) => {
        const w = works.find((x) => x.id === id);
        return `<li><span>${esc(w.name)}</span><button type="button" class="task-step" data-step="-1" data-id="${esc(id)}" aria-label="أقل">−</button><b>${n}</b><button type="button" class="task-step" data-step="1" data-id="${esc(id)}" aria-label="أكثر">+</button></li>`;
      }).join('');
    };
    $f('.task-tags').addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      if (picked.has(b.dataset.w)) picked.delete(b.dataset.w); else picked.set(b.dataset.w, 1);
      b.classList.toggle('is-on', picked.has(b.dataset.w));
      renderCounts();
    });
    $f('#tr-counts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      picked.set(b.dataset.id, Math.max(1, Math.min(50, picked.get(b.dataset.id) + Number(b.dataset.step))));
      renderCounts();
    });
    // إضافة شخص: من المؤسسة بالاسم، أو اسم يُكتب كما هو (ليس له حساب)
    const renderExtra = () => {
      $f('#tr-hextra').innerHTML = [...helpers].filter(([k]) => !unit.some((p) => p.uid === k)).map(([k, h]) => `<li>معي: <b>${esc(h.name)}</b>${h.uid ? '' : ' <small>(بلا حساب)</small>'} <button type="button" class="text-btn text-btn--muted" data-hrm="${esc(k)}">إزالة</button></li>`).join('');
    };
    const addHelper = (h) => { helpers.set(h.uid || `n:${h.name}`, h); $f('#tr-hname').value = ''; $f('#tr-hfound').innerHTML = ''; renderExtra(); };
    $f('#tr-helpers').addEventListener('change', (e) => {
      const c = e.target;
      const p = unit.find((x) => x.uid === c.value);
      if (c.checked) helpers.set(p.uid, p); else helpers.delete(p.uid);
    });
    $f('#tr-hname').addEventListener('input', (e) => {
      const q = e.target.value.trim();
      const found = q.length < 2 ? [] : [...all].filter(([u, m]) => u !== me.uid && !helpers.has(u) && !unit.some((p) => p.uid === u) && m.name.includes(q)).slice(0, 5);
      $f('#tr-hfound').innerHTML = found.map(([u, m]) => `<li><span>${esc(m.name)}</span><button type="button" class="text-btn" data-hpick="${esc(u)}">إضافة</button></li>`).join('');
    });
    $f('#tr-hfound').addEventListener('click', (e) => {
      const b = e.target.closest('[data-hpick]');
      if (b) addHelper({ uid: b.dataset.hpick, name: all.get(b.dataset.hpick).name });
    });
    $f('#tr-hadd').addEventListener('click', () => { const n = $f('#tr-hname').value.trim(); if (n) addHelper({ name: n.slice(0, 60) }); });
    $f('#tr-hextra').addEventListener('click', (e) => { const b = e.target.closest('[data-hrm]'); if (b) { helpers.delete(b.dataset.hrm); renderExtra(); } });
    const file = $f('#tr-file');
    $f('#tr-photo').onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      $f('#tr-photo-st').textContent = 'أجهّز الصورة…';
      try { image = await compressImage(f); $f('#tr-photo-st').textContent = 'أُرفقت صورة ✓'; } catch (err) { $f('#tr-photo-st').textContent = err.message; }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await replyTask(t, {
          status, works: [...picked].map(([id, count]) => ({ ...works.find((w) => w.id === id), count })),
          helpers: [...helpers.values()], note: $f('#tr-note').value, image, room: $f('#tr-room').value,
        });
        sheet.hidden = true; render(); say(status === 'done' ? 'نُشر الإنجاز ✓ ووصل لمسؤولك.' : 'نُشر أنك مستمر ✓', true);
      } catch (err) { $f('#tr-msg').textContent = err.message; btn.disabled = false; }
    };
    sheet.hidden = false;
  }

  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) sheet.hidden = true; });
  $('#t-new')?.addEventListener('click', openNew);
  root.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); tab = a.dataset.tab; render(); }));
  $('#t-list').addEventListener('click', async (e) => {
    const li = e.target.closest('.task');
    if (!li) return;
    const t = (await listTasks()).find((x) => x.id === li.dataset.id && x.from === li.dataset.from);
    if (!t) return;
    const r = e.target.closest('[data-reply]');
    if (r) { openReply(t, r.dataset.reply); return; }
    if (e.target.closest('[data-del]') && confirm(`حذف المهمة «${t.title}» من قائمتك؟`)) { await deleteTask(t); render(); }
  });
  const onChange = () => render();
  taskEvents.addEventListener('change', onChange);
  groupEvents.addEventListener('members', onChange);
  offs.push(() => { taskEvents.removeEventListener('change', onChange); groupEvents.removeEventListener('members', onChange); });
  if (!groupMe()) say('لم تكتمل المزامنة بعد.');
  render();
}

export function unmount() {
  alive = false;
  offs.forEach((f) => f());
  offs = [];
}
