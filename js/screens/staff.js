// شاشة "الموظفين" (للمدير فقط): أسماء الموظفين، وإضافة موظف بدعوة
import {
  session, listMembers, listInvites, createInvite, deleteInvite, inviteLink, removeMember,
} from '../cloud.js';
import { totals, PERIODS } from '../points.js';
import { getSetting, getGroupMessages } from '../storage.js';
import { staffTabs } from '../staff-nav.js';

export const title = 'الموظفين';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initial = (name) => esc(String(name || '؟').trim().charAt(0));

let alive = false;

export async function mount(root) {
  alive = true;
  root.innerHTML = '<p class="muted org-wait">لحظة…</p>';
  let s;
  try { s = await session(); } catch (e) {
    if (alive) root.innerHTML = `<p class="status status--err">${esc(e.message)}</p><a class="btn btn--ghost org-wide" href="#/org">المؤسسة</a>`;
    return;
  }
  if (!alive) return;
  if (s?.member?.role !== 'manager') {
    root.innerHTML = `<div class="org"><div class="org-hero"><div class="org-hero__icon" aria-hidden="true">🔐</div>
      <h2>للمدير فقط</h2><p class="muted">سجّل الدخول بحساب المدير لرؤية الموظفين.</p></div>
      <a class="btn org-wide" href="#/org">تسجيل الدخول</a></div>`;
    return;
  }

  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (params.get('id')) return renderEmployee(root, params.get('id'));

  root.innerHTML = `
    <div class="staff">
      ${staffTabs('staff')}
      <p class="muted staff__org">${esc(s.org?.name)}</p>
      <ul class="staff-list" id="list" aria-label="الموظفون"></ul>
      <button type="button" class="text-row text-row--accent" id="add-btn">إضافة موظف</button>
      <form class="org-form staff-form" id="add-form" hidden>
        <label class="org-field"><span>اسم الموظف</span><input id="ad-name" type="text" required maxlength="60" placeholder="مثال: أحمد علي"></label>
        <label class="org-field"><span>اسم المستخدم (بالإنجليزية، للدخول)</span><input id="ad-user" type="text" dir="ltr" autocapitalize="none" spellcheck="false" required placeholder="ahmed"></label>
        <div class="text-btns">
          <button class="text-btn" id="ad-go" type="submit">إنشاء دعوة</button>
          <button class="text-btn text-btn--muted" id="ad-cancel" type="button">إلغاء</button>
        </div>
        <p class="status" id="ad-msg" role="status"></p>
      </form>
      <div class="invite-out" id="invite-out" hidden></div>
    </div>`;

  const list = root.querySelector('#list');
  const form = root.querySelector('#add-form');
  const out = root.querySelector('#invite-out');

  async function render() {
    let members = [], invites = [];
    try { [members, invites] = await Promise.all([listMembers(), listInvites()]); } catch (e) {
      list.innerHTML = `<li class="status status--err">${esc(e.message)}</li>`;
      return;
    }
    if (!alive) return;
    const staff = members.filter((m) => m.role === 'employee');
    // النقاط أمام الأسماء (حسب الفترة المختارة في شاشة النقاط)
    const period = await getSetting('pointsPeriod', 'month');
    const t = await totals(period).catch(() => new Map());
    list.innerHTML = [
      ...staff.map((m) => `
        <li><a class="staff-row" href="#/staff?id=${encodeURIComponent(m.user_id)}">
          <span class="staff-row__avatar" aria-hidden="true">${initial(m.display_name)}</span>
          <span class="staff-row__name">${esc(m.display_name)}</span>
          <span class="pts-total" title="${PERIODS[period]}">${t.get(m.user_id)?.points || 0}</span>
        </a></li>`),
      ...invites.map((i) => `
        <li><button type="button" class="staff-row staff-row--pending" data-code="${esc(i.code)}" data-name="${esc(i.display_name)}">
          <span class="staff-row__avatar" aria-hidden="true">${initial(i.display_name)}</span>
          <span class="staff-row__name">${esc(i.display_name)}<small>لم ينضم بعد · المس لإعادة إرسال الدعوة</small></span>
        </button></li>`),
    ].join('') || '<li class="muted staff-empty">لا يوجد موظفون بعد. أضف أول موظف من الزر أدناه.</li>';
  }

  // يعرض رابط الدعوة مع المشاركة والنسخ
  async function showInvite(code, name) {
    const link = await inviteLink(code);
    out.hidden = false;
    out.innerHTML = `
      <p><b>دعوة ${esc(name)}</b></p>
      <p class="muted">أرسل هذا الرابط إلى ${esc(name)} (واتساب مثلاً). يفتحه، ويختار كلمة مروره، فيصبح حسابه جاهزاً. الرابط يُستخدم مرة واحدة.</p>
      <input class="invite-out__link" dir="ltr" readonly value="${esc(link)}">
      <div class="text-btns">
        ${navigator.share ? '<button class="text-btn" type="button" id="inv-share">مشاركة</button>' : ''}
        <button class="text-btn" type="button" id="inv-copy">نسخ الرابط</button>
        <button class="text-btn text-btn--danger" type="button" id="inv-del">إلغاء الدعوة</button>
      </div>
      <p class="status" id="inv-msg" role="status"></p>`;
    const msg = out.querySelector('#inv-msg');
    out.querySelector('#inv-share')?.addEventListener('click', () => {
      navigator.share({ title: 'دعوة إلى عقل المؤسسة', text: `${name}، هذه دعوتك للانضمام:`, url: link }).catch(() => {});
    });
    out.querySelector('#inv-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); msg.textContent = 'نُسخ الرابط ✓'; msg.className = 'status status--ok'; } catch {
        out.querySelector('.invite-out__link').select();
        msg.textContent = 'حدّد الرابط وانسخه يدوياً.';
      }
    });
    out.querySelector('#inv-del').addEventListener('click', async () => {
      if (!confirm(`إلغاء دعوة ${name}؟ لن يعمل الرابط بعد ذلك.`)) return;
      await deleteInvite(code).catch((e) => { msg.textContent = e.message; });
      out.hidden = true;
      render();
    });
    out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  list.addEventListener('click', (e) => {
    const b = e.target.closest('.staff-row--pending');
    if (b) showInvite(b.dataset.code, b.dataset.name);
  });
  root.querySelector('#add-btn').addEventListener('click', () => {
    form.hidden = false;
    out.hidden = true;
    root.querySelector('#ad-name').focus();
  });
  root.querySelector('#ad-cancel').addEventListener('click', () => { form.hidden = true; });
  const goBtn = root.querySelector('#ad-go');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (goBtn.disabled) return;
    goBtn.disabled = true;
    const msg = root.querySelector('#ad-msg');
    const name = root.querySelector('#ad-name').value;
    try {
      const code = await createInvite({ name, username: root.querySelector('#ad-user').value });
      form.reset();
      form.hidden = true;
      msg.textContent = '';
      await render();
      showInvite(code, name.trim());
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'status status--err';
    } finally { goBtn.disabled = false; }
  });

  render();
}

// ملف الموظف: الكرات والمهارات والملخص تأتي في مرحلة لاحقة؛ ملاحظاته لا تظهر أبداً
async function renderEmployee(root, id) {
  let m;
  try { m = (await listMembers()).find((x) => x.user_id === id); } catch (e) {
    root.innerHTML = `<p class="status status--err">${esc(e.message)}</p>`;
    return;
  }
  if (!alive) return;
  if (!m) { location.hash = '#/staff'; return; }
  root.innerHTML = `
    <div class="org">
      <a class="link-btn staff-back" href="#/staff">→ الموظفين</a>
      <div class="org-hero">
        <div class="staff-row__avatar staff-row__avatar--big" aria-hidden="true">${initial(m.display_name)}</div>
        <h2>${esc(m.display_name)}</h2>
        <p class="muted"><span dir="ltr">@${esc(m.username)}</span> · انضم ${new Date(m.created_at).toLocaleDateString('ar')}</p>
      </div>
      <section class="emp-sec" id="emp-points"></section>
      <section class="emp-sec" id="emp-posts"></section>
      <button type="button" class="text-row text-row--danger" id="remove">إزالة ${esc(m.display_name)} من المؤسسة</button>
      <p class="status" id="rm-msg" role="status"></p>
    </div>`;
  // نقاطه (للمدير فقط)
  const [w, mo, all] = await Promise.all(['week', 'month', 'all'].map((p) => totals(p).then((t) => t.get(id))));
  const recent = (all?.items || []).slice(0, 8);
  const fmt = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' });
  const box = root.querySelector('#emp-points');
  if (box) {
    box.innerHTML = `
      <h3>النقاط <small class="muted">لا يراها الموظف</small></h3>
      <div class="pts-stats">
        <div><b>${w?.points || 0}</b><small>هذا الأسبوع</small></div>
        <div><b>${mo?.points || 0}</b><small>هذا الشهر</small></div>
        <div><b>${all?.points || 0}</b><small>الكل</small></div>
      </div>
      ${recent.length ? `<ul class="pts-log">${recent.map((p) => `<li><span>${esc(p.workName)}${p.count > 1 ? ` ×${p.count}` : ''} <span class="pts-plus">+${p.points}</span><small>${fmt.format(p.at)}</small></span></li>`).join('')}</ul>` : '<p class="muted">لا نقاط بعد.</p>'}
      <a class="text-btn" href="#/points">كل النقاط</a>`;
  }
  // آخر منشوراته (من أرشيف جهازك)
  const posts = (await getGroupMessages()).filter((x) => x.from === id).slice(-10).reverse();
  const pbox = root.querySelector('#emp-posts');
  if (pbox) {
    pbox.innerHTML = `<h3>آخر منشوراته</h3>${posts.length
      ? `<ul class="pts-log">${posts.map((x) => `<li><span>${x.image ? '📷 ' : ''}${esc((x.text || 'صورة').slice(0, 160))}<small>${fmt.format(x.sentAt)}</small></span></li>`).join('')}</ul>`
      : '<p class="muted">لا منشورات بعد.</p>'}`;
  }
  root.querySelector('#remove').addEventListener('click', async () => {
    if (!confirm(`إزالة ${m.display_name} من المؤسسة؟ لن يستطيع الدخول إليها بعد ذلك.`)) return;
    try { await removeMember(id); location.hash = '#/staff'; } catch (e) { root.querySelector('#rm-msg').textContent = e.message; }
  });
}

export function unmount() { alive = false; }
