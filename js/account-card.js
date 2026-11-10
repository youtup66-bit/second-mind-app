// بطاقة «الحساب» في الإعدادات (لكل أعضاء المؤسسة): الاسم، واسم الدخول، والصفة، وتغيير كلمة المرور، والتلميح.
// ربط البريد للدخول والاستعادة لرئيس القسم وحده (في كرته)، وفق قرار البريد.
import { session, changePassword, currentEmail } from './cloud.js';
import { getHint, setHint } from './pw-hint.js';
import { groupBranch, startGroupSync, waitBranch } from './group.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function renderAccountCard(root) {
  const body = root.querySelector('#acc-body');
  if (!body) return;
  const s = await session().catch(() => null);
  if (!s?.member) { body.innerHTML = '<p class="muted">ادخل إلى المؤسسة لترى حسابك.</p>'; return; }
  await startGroupSync().catch(() => {});
  if (s.member.role !== 'manager') await waitBranch();
  const m = s.member;
  const branch = groupBranch();
  const title = m.role === 'manager' ? 'رئيس القسم' : branch?.heads?.length ? 'مسؤول' : 'موظف';
  const email = m.role === 'manager' ? await currentEmail().catch(() => '') : '';
  const hint = await getHint(m.username);
  body.innerHTML = `
    <p class="acc-id"><b>${esc(m.display_name)}</b><small>${title}${m.role === 'manager' ? '' : ''}</small></p>
    <p class="muted">اسم الدخول: <b dir="ltr">${esc(m.username)}</b>${email ? ` · البريد: <b dir="ltr">${esc(email)}</b>` : ''}</p>
    ${m.role === 'manager' && !email ? '<p class="status status--err">لم تربط بريداً بعد. بدونه لا استعادة لك. اربطه من «حسابك» في كرة القسم.</p>' : ''}

    <form class="acc-form" id="acc-pw">
      <b>تغيير كلمة المرور</b>
      <input type="password" id="acc-cur" required placeholder="الحالية" autocomplete="current-password">
      <input type="password" id="acc-new" required minlength="8" placeholder="الجديدة (٨ أحرف على الأقل)" autocomplete="new-password">
      <button class="btn" type="submit">تغيير</button>
      <p class="status" id="acc-pw-msg" role="status"></p>
    </form>

    <form class="acc-form" id="acc-hint">
      <b>تلميح كلمة المرور</b>
      <small class="muted">يُحفظ على هذا الجهاز فقط، ولا يكتب فيه كلمة المرور نفسها.</small>
      <input type="text" id="acc-hint-in" maxlength="120" value="${esc(hint)}" placeholder="مثل: اسم مدينتي والسنة">
      <button class="btn btn--ghost" type="submit">حفظ التلميح</button>
      <p class="status" id="acc-hint-msg" role="status"></p>
    </form>`;

  body.querySelector('#acc-pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = body.querySelector('#acc-pw-msg');
    try {
      await changePassword(body.querySelector('#acc-cur').value, body.querySelector('#acc-new').value);
      e.target.reset();
      msg.textContent = 'غُيّرت كلمة المرور ✓'; msg.className = 'status status--ok';
    } catch (err) { msg.textContent = err.message; msg.className = 'status status--err'; }
  });
  body.querySelector('#acc-hint').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = body.querySelector('#acc-hint-msg');
    await setHint(m.username, body.querySelector('#acc-hint-in').value);
    msg.textContent = 'حُفظ التلميح ✓'; msg.className = 'status status--ok';
  });
}
