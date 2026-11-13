// شاشة "النقاط" (للمدير فقط): مجموع نقاط كل موظف حسب الفترة، واقتراحات الذكاء، وقائمة الأعمال
import { session, listMembers } from '../cloud.js';
import {
  PERIODS, getWorks, addWork, updateWork, removeWork, isAuto, setAuto, addManual,
  approve, reject, remove, totals, suggestions, scan, pointsEvents,
} from '../points.js';
import { getSetting, setSetting } from '../storage.js';
import { listObjections, decideObjection } from '../objections.js';
import { staffTabs } from '../staff-nav.js';

export const title = 'النقاط';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const pts = (n) => (n === 1 ? 'نقطة' : n === 2 ? 'نقطتان' : n <= 10 ? `${n} نقاط` : `${n} نقطة`);
const initial = (name) => esc(String(name || '؟').trim().charAt(0));

let alive = false;
let off = null;

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
  const nameOf = (u) => members.find((m) => m.user_id === u)?.display_name || 'موظف سابق';
  let period = await getSetting('pointsPeriod', 'month');

  root.innerHTML = `
    <div class="pts">
      ${staffTabs('points')}
      <p class="muted pts-private">النقاط على جهازك فقط، ولا يراها أي موظف.</p>
      <div class="pts-periods" role="radiogroup" aria-label="الفترة">
        ${Object.entries(PERIODS).map(([k, l]) => `<button type="button" data-p="${k}" role="radio">${l}</button>`).join('')}
      </div>
      <section id="objs"></section>
      <section id="sugg"></section>
      <ul class="staff-list" id="totals" aria-label="نقاط الموظفين"></ul>
      <button type="button" class="text-row text-row--accent" id="open-add">الأعمال ونقاطها، وتسجيل نقاط</button>
      <label class="switch pts-auto"><input type="checkbox" id="auto"><span>احتساب تلقائي دون موافقتي</span></label>
      <p class="muted" id="hint"></p>
      <h3 class="subhead">السجل</h3>
      <ul class="pts-log" id="log"></ul>
    </div>
    <div class="sheet" id="sheet" hidden>
      <div class="sheet__panel sheet__panel--tall" role="dialog" aria-label="إضافة">
        <div class="struct-tabs pts-sheet-tabs" role="tablist">
          <button type="button" data-tab="works" class="is-active">الأعمال ونقاطها</button>
          <button type="button" data-tab="manual">تسجيل لموظف</button>
        </div>
        <div class="pts-sheet-body" id="sheet-body"></div>
        <button type="button" class="text-btn text-btn--muted pts-close" id="close-sheet">إغلاق</button>
      </div>
    </div>`;

  const $ = (q) => root.querySelector(q);
  const sheet = $('#sheet');
  let tab = 'works';

  async function render() {
    if (!alive) return;
    root.querySelectorAll('[data-p]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.p === period);
      b.setAttribute('aria-checked', String(b.dataset.p === period));
    });
    const [t, sug, works, auto, objList] = await Promise.all([totals(period), suggestions(), getWorks(), isAuto(), listObjections()]);
    const open = objList.filter((o) => o.status === 'open');
    $('#objs').innerHTML = open.length ? `
      <div class="pts-sugg">
        <h3>اعتراضات <span class="pts-count">${open.length}</span></h3>
        ${open.map((o) => `<div class="pts-sugg__item"><b>${esc(o.fromName || 'موظف')}</b><small>${esc(o.reason)}</small>
          <div class="text-btns"><button type="button" class="text-btn" data-obj="${esc(o.id)}" data-dec="accepted">قبول (إلغاء النقطة)</button><button type="button" class="text-btn text-btn--danger" data-obj="${esc(o.id)}" data-dec="rejected">رفض</button></div></div>`).join('')}
      </div>` : '';
    $('#objs').onclick = async (e) => {
      const b = e.target.closest('[data-obj]');
      if (!b) return;
      const reply = (window.prompt('ملاحظتك للموظف (اختياري):', '') || '').trim();
      await decideObjection(b.dataset.obj, b.dataset.dec, reply);
      render();
    };
    $('#auto').checked = auto;

    $('#sugg').innerHTML = sug.length ? `
      <div class="pts-sugg">
        <h3>اقتراحات الذكاء <span class="pts-count">${sug.length}</span></h3>
        ${sug.map((p) => `
          <div class="pts-sugg__item">
            <div><b>${esc(nameOf(p.user))}</b> · ${esc(p.workName)}${p.count > 1 ? ` ×${p.count}` : ''} <span class="pts-plus">+${p.points}</span>
              ${p.quote ? `<q>${esc(p.quote)}</q>` : ''}<small>${fmtDate.format(p.at)}</small></div>
            <div class="pts-sugg__btns">
              <button type="button" class="text-btn" data-ok="${esc(p.id)}">قبول</button>
              <button type="button" class="text-btn text-btn--muted" data-no="${esc(p.id)}">رفض</button>
            </div>
          </div>`).join('')}
      </div>` : '';

    const rows = members.map((m) => ({ m, t: t.get(m.user_id) || { points: 0, count: 0 } }))
      .sort((a, b) => b.t.points - a.t.points);
    $('#totals').innerHTML = rows.map(({ m, t: x }) => `
      <li><a class="staff-row" href="#/staff?id=${encodeURIComponent(m.user_id)}">
        <span class="staff-row__avatar" aria-hidden="true">${initial(m.display_name)}</span>
        <span class="staff-row__name">${esc(m.display_name)}<small>${x.count ? `${x.count} ${x.count === 1 ? 'عمل' : x.count === 2 ? 'عملان' : 'أعمال'}` : 'لا أعمال في هذه الفترة'}</small></span>
        <span class="pts-total">${x.points}</span>
      </a></li>`).join('') || '<li class="muted staff-empty">لا موظفين بعد.</li>';

    $('#hint').innerHTML = !works.length
      ? 'ابدأ بإضافة الأعمال ونقاطها (مثل: تسليك كاميرا = ٥ نقاط) من زر "＋ إضافة". بعدها يقرأ الذكاء رسائل المجموعة ويقترح النقاط.'
      : !(await getSetting('geminiApiKey', '')) ? 'أضف مفتاح Gemini في الإعدادات ليقرأ الذكاء رسائل المجموعة ويقترح النقاط. يمكنك التسجيل يدوياً في كل الأحوال.' : '';

    const log = [...t.values()].flatMap((x) => x.items).sort((a, b) => b.at - a.at).slice(0, 40);
    $('#log').innerHTML = log.map((p) => `
      <li><span><b>${esc(nameOf(p.user))}</b> · ${esc(p.workName)}${p.count > 1 ? ` ×${p.count}` : ''} <span class="pts-plus">+${p.points}</span>
        <small>${fmtDate.format(p.at)} · ${p.source === 'manual' ? 'يدوي' : 'من المجموعة'}</small></span>
        <button type="button" class="link-btn link-btn--danger" data-del="${esc(p.id)}">حذف</button></li>`).join('')
      || '<li class="muted">لا شيء في هذه الفترة.</li>';
  }

  function renderSheet() {
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    const body = $('#sheet-body');
    getWorks().then((works) => {
      if (tab === 'works') {
        body.innerHTML = `
          <form class="struct-form pts-form" id="wf">
            <input id="wf-name" placeholder="العمل (مثل: تسليك كاميرا)" maxlength="60" required>
            <input id="wf-pts" type="number" inputmode="numeric" min="1" max="1000" value="5" aria-label="النقاط" required>
            <button class="text-btn" type="submit">إضافة</button>
          </form>
          <p class="status" id="wf-msg" role="status"></p>
          <ul class="pts-works">${works.map((w) => `
            <li data-w="${esc(w.id)}">
              <input class="pts-works__name" value="${esc(w.name)}" maxlength="60" aria-label="اسم العمل">
              <input class="pts-works__pts" type="number" inputmode="numeric" min="1" max="1000" value="${w.points}" aria-label="النقاط">
              <span class="muted">نقطة</span>
              <button type="button" class="link-btn link-btn--danger" data-rm="${esc(w.id)}">حذف</button>
            </li>`).join('') || '<li class="muted">لا أعمال بعد.</li>'}</ul>`;
        body.querySelector('#wf').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await addWork(body.querySelector('#wf-name').value, body.querySelector('#wf-pts').value);
            renderSheet();
          } catch (err) { body.querySelector('#wf-msg').textContent = err.message; body.querySelector('#wf-msg').className = 'status status--err'; }
        });
        body.querySelectorAll('li[data-w]').forEach((li) => {
          const save = () => updateWork(li.dataset.w, { name: li.querySelector('.pts-works__name').value, points: li.querySelector('.pts-works__pts').value });
          li.querySelectorAll('input').forEach((i) => i.addEventListener('change', save));
        });
        body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
          if (!confirm('حذف هذا العمل من القائمة؟ النقاط المسجلة سابقاً تبقى.')) return;
          await removeWork(b.dataset.rm);
          renderSheet();
        }));
      } else {
        body.innerHTML = works.length && members.length ? `
          <form class="pts-manual" id="mf">
            <label class="org-field"><span>الموظف</span><select id="mf-user">${members.map((m) => `<option value="${esc(m.user_id)}">${esc(m.display_name)}</option>`).join('')}</select></label>
            <label class="org-field"><span>العمل</span><select id="mf-work">${works.map((w) => `<option value="${esc(w.id)}">${esc(w.name)} (${w.points})</option>`).join('')}</select></label>
            <label class="org-field"><span>العدد</span><input id="mf-count" type="number" inputmode="numeric" min="1" max="50" value="1"></label>
            <label class="org-field"><span>ملاحظة (اختياري)</span><input id="mf-note" maxlength="200"></label>
            <button class="text-btn pts-submit" type="submit">تسجيل</button>
            <p class="status" id="mf-msg" role="status"></p>
          </form>` : `<p class="muted">${works.length ? 'لا موظفين بعد.' : 'أضف الأعمال أولاً من تبويب "الأعمال ونقاطها".'}</p>`;
        body.querySelector('#mf')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const msg = body.querySelector('#mf-msg');
          try {
            await addManual({ user: body.querySelector('#mf-user').value, workId: body.querySelector('#mf-work').value, count: body.querySelector('#mf-count').value, note: body.querySelector('#mf-note').value });
            msg.textContent = 'سُجّلت النقاط ✓'; msg.className = 'status status--ok';
            body.querySelector('#mf-note').value = '';
          } catch (err) { msg.textContent = err.message; msg.className = 'status status--err'; }
        });
      }
    });
  }

  root.querySelector('.pts-periods').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    period = b.dataset.p;
    await setSetting('pointsPeriod', period);
    render();
  });
  $('#sugg').addEventListener('click', async (e) => {
    const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]');
    if (ok) await approve(ok.dataset.ok);
    if (no) await reject(no.dataset.no);
  });
  $('#log').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d && confirm('حذف هذه النقاط؟')) await remove(d.dataset.del);
  });
  $('#auto').addEventListener('change', (e) => setAuto(e.target.checked));
  $('#open-add').addEventListener('click', () => { sheet.hidden = false; renderSheet(); });
  $('#close-sheet').addEventListener('click', () => { sheet.hidden = true; });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; renderSheet(); }));

  off = () => pointsEvents.removeEventListener('change', render);
  pointsEvents.addEventListener('change', render);
  await render();
  scan().catch(() => {});
}

export function unmount() {
  alive = false;
  off?.();
  off = null;
}
