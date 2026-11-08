// شاشة "التقارير" (للمدير فقط): التنبيهات، وتقارير الأسبوع والشهر، والمهام المكلّفة، والتذكيرات
import { session, listMembers } from '../cloud.js';
import {
  alerts, makeReport, listReports, deleteReport, reportText, REPORT_PERIODS,
  listTasks, assignTask, completeTask, deleteTask, listReminders, addReminder, deleteReminder, insightsEvents,
} from '../org-insights.js';
import { getWorks } from '../points.js';
import { getSetting } from '../storage.js';
import { staffTabs } from '../staff-nav.js';

export const title = 'التقارير';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = new Intl.DateTimeFormat('ar', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long' });
const list = (title, items) => (items?.length ? `<h4>${title}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

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
    root.innerHTML = '<div class="org"><div class="org-hero"><h2>للمدير فقط</h2></div><a class="text-row text-row--accent" href="#/org">تسجيل الدخول</a></div>';
    return;
  }

  root.innerHTML = `
    <div class="rep">
      ${staffTabs('reports')}
      <section class="rep-sec" id="alerts"></section>
      <section class="rep-sec">
        <h3>التقارير</h3>
        <div class="text-btns">
          <button type="button" class="text-btn" data-make="week">تقرير هذا الأسبوع</button>
          <button type="button" class="text-btn" data-make="month">تقرير هذا الشهر</button>
        </div>
        <p class="status" id="rep-msg" role="status"></p>
        <div id="reports"></div>
      </section>
      <section class="rep-sec">
        <h3>المهام المكلّفة</h3>
        <ul class="rep-list" id="tasks"></ul>
        <button type="button" class="text-row text-row--accent" id="task-open">تكليف موظف بمهمة</button>
        <form class="org-form rep-form" id="task-form" hidden>
          <label class="org-field"><span>الموظف</span><select id="tk-user">${members.map((m) => `<option value="${esc(m.user_id)}">${esc(m.display_name)}</option>`).join('')}</select></label>
          <label class="org-field"><span>المهمة</span><input id="tk-text" maxlength="400" required placeholder="مثل: تركيب كاميرا المدخل الشرقي"></label>
          <label class="org-field"><span>نقاطها عند الإنجاز (اختياري)</span><select id="tk-work"><option value="">بلا نقاط</option></select></label>
          <div class="text-btns"><button class="text-btn" type="submit">تكليف ونشر في المجموعة</button><button class="text-btn text-btn--muted" type="button" id="task-cancel">إلغاء</button></div>
          <p class="status" id="tk-msg" role="status"></p>
        </form>
      </section>
      <section class="rep-sec">
        <h3>التذكيرات</h3>
        <ul class="rep-list" id="reminders"></ul>
        <button type="button" class="text-row text-row--accent" id="rem-open">إضافة تذكير</button>
        <form class="org-form rep-form" id="rem-form" hidden>
          <label class="org-field"><span>الموعد</span><input id="rm-at" type="datetime-local" required></label>
          <label class="org-field"><span>ذكّرني بـ</span><input id="rm-text" maxlength="200" required placeholder="مثل: مراجعة نقاط الشهر"></label>
          <div class="text-btns"><button class="text-btn" type="submit">حفظ</button><button class="text-btn text-btn--muted" type="button" id="rem-cancel">إلغاء</button></div>
        </form>
        <p class="muted rep-note">يظهر التذكير إشعاراً على جوالك إن كان التطبيق مفتوحاً أو في الخلفية، وإلا فعند فتحه.</p>
      </section>
    </div>`;

  const $ = (q) => root.querySelector(q);
  const nameOf = (u) => members.find((m) => m.user_id === u)?.display_name || 'موظف سابق';

  async function render() {
    if (!alive) return;
    const [al, reps, tasks, rems, works] = await Promise.all([alerts(), listReports(), listTasks(), listReminders(), getWorks()]);
    $('#alerts').innerHTML = `<h3>التنبيهات</h3>${al.length
      ? `<ul class="rep-list">${al.map((a) => `<li><a href="${a.link}">${esc(a.text)}</a></li>`).join('')}</ul>`
      : '<p class="muted">لا تنبيهات. كل شيء على ما يرام.</p>'}`;

    $('#reports').innerHTML = reps.map((r) => `
      <details class="rep-item">
        <summary><b>${esc(r.headline)}</b><small>${esc(r.label || REPORT_PERIODS[r.period] || '')} · ${fmtDay.format(r.createdAt)}</small></summary>
        <p>${esc(r.overview)}</p>
        ${list('أبرز الأعمال', r.highlights)}
        ${r.people?.length ? `<h4>الموظفون</h4><ul>${r.people.map((p) => `<li><b>${esc(p.name)}:</b> ${esc(p.summary)}</li>`).join('')}</ul>` : ''}
        ${list('مشاكل ومتابعات', r.problems)}
        ${list('مقترحات', r.suggestions)}
        <div class="text-btns">
          ${navigator.share ? `<button type="button" class="text-btn" data-share="${r.id}">مشاركة</button>` : ''}
          <button type="button" class="text-btn" data-copy="${r.id}">نسخ</button>
          <button type="button" class="text-btn text-btn--danger" data-del-rep="${r.id}">حذف</button>
        </div>
      </details>`).join('') || '<p class="muted">لا تقارير بعد.</p>';

    const open = tasks.filter((t) => !t.done), done = tasks.filter((t) => t.done).slice(0, 10);
    $('#tasks').innerHTML = [
      ...open.map((t) => `<li><span><b>${esc(t.name)}</b> · ${esc(t.text)}<small>${fmt.format(t.at)}${t.workId ? ` · ${esc(works.find((w) => w.id === t.workId)?.name || '')}` : ''}</small></span>
        <button type="button" class="text-btn" data-done="${t.id}">أُنجزت</button><button type="button" class="text-btn text-btn--muted" data-del-task="${t.id}">حذف</button></li>`),
      ...done.map((t) => `<li class="is-done"><span>✓ <b>${esc(t.name)}</b> · ${esc(t.text)}<small>أُنجزت ${fmt.format(t.doneAt || t.at)}</small></span></li>`),
    ].join('') || '<li class="muted">لا مهام بعد.</li>';
    $('#tk-work').innerHTML = `<option value="">بلا نقاط</option>${works.map((w) => `<option value="${esc(w.id)}">${esc(w.name)} (+${w.points})</option>`).join('')}`;

    const upcoming = rems.filter((r) => !r.fired);
    $('#reminders').innerHTML = upcoming.map((r) => `<li><span>${esc(r.text)}<small>${fmt.format(r.at)}</small></span>
      <button type="button" class="text-btn text-btn--muted" data-del-rem="${r.id}">حذف</button></li>`).join('') || '<li class="muted">لا تذكيرات.</li>';
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.make) {
      const msg = $('#rep-msg');
      if (!(await getSetting('geminiApiKey', ''))) { msg.textContent = 'أضف مفتاح Gemini في الإعدادات لكتابة التقارير.'; msg.className = 'status status--err'; return; }
      t.disabled = true;
      msg.textContent = 'أكتب التقرير…'; msg.className = 'status';
      try { await makeReport(d.make); msg.textContent = ''; root.querySelector('.rep-item')?.setAttribute('open', ''); } catch (err) { msg.textContent = err.message; msg.className = 'status status--err'; } finally { t.disabled = false; }
    }
    const rep = async (id) => (await listReports()).find((r) => r.id === id);
    if (d.share) { const r = await rep(d.share); navigator.share({ title: r.headline, text: reportText(r) }).catch(() => {}); }
    if (d.copy) { const r = await rep(d.copy); try { await navigator.clipboard.writeText(reportText(r)); t.textContent = 'نُسخ ✓'; } catch { /* لا شيء */ } }
    if (d.delRep && confirm('حذف هذا التقرير؟')) await deleteReport(d.delRep);
    if (d.done) await completeTask(d.done);
    if (d.delTask && confirm('حذف هذه المهمة من المتابعة؟')) await deleteTask(d.delTask);
    if (d.delRem) await deleteReminder(d.delRem);
  });

  const toggle = (form, on) => { $(form).hidden = !on; };
  $('#task-open').addEventListener('click', () => toggle('#task-form', true));
  $('#task-cancel').addEventListener('click', () => toggle('#task-form', false));
  $('#task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = $('#tk-user').value;
    try {
      await assignTask({ user, name: nameOf(user), text: $('#tk-text').value, workId: $('#tk-work').value || null });
      e.target.reset();
      toggle('#task-form', false);
    } catch (err) { $('#tk-msg').textContent = err.message; $('#tk-msg').className = 'status status--err'; }
  });
  $('#rem-open').addEventListener('click', () => toggle('#rem-form', true));
  $('#rem-cancel').addEventListener('click', () => toggle('#rem-form', false));
  $('#rem-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await addReminder({ at: $('#rm-at').value, text: $('#rm-text').value });
    e.target.reset();
    toggle('#rem-form', false);
  });

  off = () => insightsEvents.removeEventListener('change', render);
  insightsEvents.addEventListener('change', render);
  await render();
}

export function unmount() {
  alive = false;
  off?.();
  off = null;
}
