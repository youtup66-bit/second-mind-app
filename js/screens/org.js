// شاشة المؤسسة: الدخول، وإنشاء المؤسسة (المدير)، والانضمام بدعوة (الموظف)
import {
  cloudConfig, setCloudConfig, clearCloudConfig, session, signIn, signOut, createOrg,
  readInvite, joinWithInvite, orgExists,
} from '../cloud.js';

export const title = 'المؤسسة';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let alive = false;

export async function mount(root) {
  alive = true;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (location.hash.startsWith('#/join')) return renderJoin(root, params);
  root.innerHTML = '<p class="muted org-wait">لحظة…</p>';
  let cfg = null, s = null, err = null;
  try {
    cfg = await cloudConfig();
    s = cfg ? await session() : null;
  } catch (e) { err = e; }
  if (!alive) return;
  if (!cfg) return renderSetup(root);
  if (s?.member) return renderAccount(root, s);
  if (s?.user) return renderStranger(root);
  return renderLogin(root, err);
}

export function unmount() { alive = false; }

// ---- عناصر مشتركة ----
const field = (id, label, attrs = '') => `
  <label class="org-field"><span>${label}</span><input id="${id}" ${attrs}></label>`;
const pwField = (id, label) => field(id, label, 'type="password" autocomplete="new-password" minlength="8" dir="ltr"');
const userField = (id, label = 'اسم المستخدم (بالإنجليزية)', value = '', readonly = false) =>
  field(id, label, `type="text" dir="ltr" autocapitalize="none" autocomplete="username" spellcheck="false" value="${esc(value)}" ${readonly ? 'readonly' : ''}`);

function busyButton(btn, fn) {
  return async (e) => {
    e?.preventDefault?.();
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'لحظة…';
    try { await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
  };
}
const setMsg = (el, text, ok = false) => { el.textContent = text; el.className = `status ${ok ? 'status--ok' : 'status--err'}`; };
const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

// ---- أول مرة: لا مؤسسة على هذا الجهاز ----
function renderSetup(root) {
  root.innerHTML = `
    <div class="org">
      <div class="org-hero">
        <div class="org-hero__icon" aria-hidden="true">🏢</div>
        <h2>عقل المؤسسة</h2>
        <p class="muted">حساب للمدير يضيف منه الموظفين، ومحادثة مشتركة، ونقاط وتقارير. ملاحظاتك الشخصية تبقى على جهازك ولا يراها أحد.</p>
      </div>
      <section class="card">
        <h3>أنا موظف</h3>
        <p class="muted">افتح رابط الدعوة الذي أرسله لك المدير، وسيُجهَّز حسابك تلقائياً.</p>
      </section>
      <section class="card">
        <h3>أنا المدير</h3>
        <p class="muted">اربط مشروع Supabase الخاص بمؤسستك. تجد الرابط والمفتاح في موقع Supabase من صفحة <bdi dir="ltr">Project Settings → API</bdi>. الخطوات كاملة في ملف <bdi dir="ltr">supabase/SETUP.md</bdi>.</p>
        <form id="cfg-form" class="org-form">
          ${field('cfg-url', 'Project URL', 'type="url" dir="ltr" placeholder="https://xxxx.supabase.co" autocomplete="off" required')}
          ${field('cfg-key', 'المفتاح العام (anon أو publishable)', 'type="text" dir="ltr" autocomplete="off" spellcheck="false" required')}
          <button class="btn" id="cfg-save" type="submit">ربط المؤسسة</button>
          <p class="status" id="cfg-msg" role="status"></p>
        </form>
      </section>
    </div>`;
  const btn = root.querySelector('#cfg-save');
  root.querySelector('#cfg-form').addEventListener('submit', busyButton(btn, async () => {
    const msg = root.querySelector('#cfg-msg');
    try {
      await setCloudConfig({ url: root.querySelector('#cfg-url').value, key: root.querySelector('#cfg-key').value });
      await orgExists(); // يتحقق من الاتصال ومن تجهيز قاعدة البيانات
      reload();
    } catch (e) { setMsg(msg, e.message); }
  }));
}

// ---- الدخول (أو إنشاء المؤسسة إن لم تُنشأ بعد) ----
async function renderLogin(root, err) {
  let exists = true;
  try { exists = await orgExists(); } catch (e) { err ||= e; }
  if (!alive) return;
  root.innerHTML = `
    <div class="org">
      <div class="org-hero">
        <div class="org-hero__icon" aria-hidden="true">🔐</div>
        <h2>${exists ? 'تسجيل الدخول' : 'إنشاء المؤسسة'}</h2>
        <p class="muted">${exists ? 'ادخل بحسابك في المؤسسة.' : 'أنت أول من يدخل: ستصبح مدير المؤسسة، ولا يمكن لغيرك إنشاء مؤسسة أخرى هنا.'}</p>
      </div>
      ${err ? `<p class="status status--err">${esc(err.message)}</p>` : ''}
      <form class="card org-form" id="login-form" ${exists ? '' : 'hidden'}>
        ${userField('li-user')}
        ${field('li-pass', 'كلمة المرور', 'type="password" autocomplete="current-password" dir="ltr" required')}
        <button class="btn" id="li-go" type="submit">دخول</button>
        <p class="status" id="li-msg" role="status"></p>
      </form>
      <form class="card org-form" id="new-form" ${exists ? 'hidden' : ''}>
        ${field('no-org', 'اسم المؤسسة', 'type="text" required maxlength="80"')}
        ${field('no-name', 'اسمك (يظهر للموظفين)', 'type="text" required maxlength="60"')}
        ${userField('no-user')}
        ${pwField('no-pass', 'كلمة المرور (٨ أحرف على الأقل)')}
        ${pwField('no-pass2', 'أعد كتابة كلمة المرور')}
        <button class="btn" id="no-go" type="submit">إنشاء المؤسسة وحساب المدير</button>
        <p class="status" id="no-msg" role="status"></p>
      </form>
      <p class="org-foot"><button type="button" class="link-btn" id="unlink">فصل هذا الجهاز عن المؤسسة</button></p>
    </div>`;

  const liBtn = root.querySelector('#li-go');
  root.querySelector('#login-form').addEventListener('submit', busyButton(liBtn, async () => {
    try {
      const s = await signIn(root.querySelector('#li-user').value, root.querySelector('#li-pass').value);
      if (s?.member?.role === 'manager') location.hash = '#/staff'; else reload();
    } catch (e) { setMsg(root.querySelector('#li-msg'), e.message); }
  }));

  const noBtn = root.querySelector('#no-go');
  root.querySelector('#new-form').addEventListener('submit', busyButton(noBtn, async () => {
    const msg = root.querySelector('#no-msg');
    const pass = root.querySelector('#no-pass').value;
    if (pass !== root.querySelector('#no-pass2').value) { setMsg(msg, 'كلمتا المرور غير متطابقتين.'); return; }
    try {
      await createOrg({
        orgName: root.querySelector('#no-org').value,
        name: root.querySelector('#no-name').value,
        username: root.querySelector('#no-user').value,
        password: pass,
      });
      location.hash = '#/staff';
    } catch (e) { setMsg(msg, e.message); }
  }));

  root.querySelector('#unlink').addEventListener('click', async () => {
    if (!confirm('يُفصل هذا الجهاز عن مشروع المؤسسة (لا يُحذف شيء من المؤسسة نفسها). متابعة؟')) return;
    await clearCloudConfig();
    reload();
  });
}

// ---- مسجّل الدخول ----
function renderAccount(root, s) {
  const manager = s.member.role === 'manager';
  root.innerHTML = `
    <div class="org">
      <div class="org-hero">
        <div class="org-hero__icon" aria-hidden="true">${manager ? '👑' : '👤'}</div>
        <h2>${esc(s.member.display_name)}</h2>
        <p class="muted">${manager ? 'مدير' : 'موظف'} في <b>${esc(s.org?.name)}</b> · <span dir="ltr">@${esc(s.member.username)}</span></p>
      </div>
      ${manager ? '<a class="btn org-wide" href="#/staff">الموظفين</a>' : '<p class="muted org-center">المحادثة المشتركة ونقاطك تظهر هنا في المراحل القادمة.</p>'}
      <button type="button" class="btn btn--ghost org-wide" id="logout">تسجيل الخروج</button>
    </div>`;
  root.querySelector('#logout').addEventListener('click', async () => {
    await signOut();
    reload();
  });
}

// حساب بلا عضوية (سجّل دون دعوة)
function renderStranger(root) {
  root.innerHTML = `
    <div class="org">
      <div class="org-hero">
        <div class="org-hero__icon" aria-hidden="true">⛔</div>
        <h2>الحساب غير منضم</h2>
        <p class="muted">هذا الحساب ليس عضواً في المؤسسة. اطلب من المدير رابط دعوة.</p>
      </div>
      <button type="button" class="btn btn--ghost org-wide" id="logout">تسجيل الخروج</button>
    </div>`;
  root.querySelector('#logout').addEventListener('click', async () => { await signOut(); reload(); });
}

// ---- الانضمام برابط دعوة ----
async function renderJoin(root, params) {
  root.innerHTML = '<p class="muted org-wait">أفتح الدعوة…</p>';
  let inv;
  try {
    // جهاز عليه حساب آخر: نخرج منه أولاً
    if (await cloudConfig() && (await session().catch(() => null))?.user) await signOut();
    inv = await readInvite(params);
  } catch (e) {
    if (!alive) return;
    root.innerHTML = `<div class="org"><div class="org-hero"><div class="org-hero__icon" aria-hidden="true">✉️</div><h2>الدعوة</h2></div>
      <p class="status status--err">${esc(e.message)}</p>
      <a class="btn btn--ghost org-wide" href="#/org">تسجيل الدخول</a></div>`;
    return;
  }
  if (!alive) return;
  root.innerHTML = `
    <div class="org">
      <div class="org-hero">
        <div class="org-hero__icon" aria-hidden="true">✉️</div>
        <h2>أهلاً ${esc(inv.display_name)}</h2>
        <p class="muted">دعاك المدير للانضمام إلى <b>${esc(inv.org_name)}</b>. اختر كلمة مرور لحسابك.</p>
      </div>
      <form class="card org-form" id="join-form">
        ${userField('jn-user', 'اسم المستخدم (للدخول لاحقاً)', inv.username, true)}
        ${pwField('jn-pass', 'كلمة المرور (٨ أحرف على الأقل)')}
        ${pwField('jn-pass2', 'أعد كتابة كلمة المرور')}
        <button class="btn" id="jn-go" type="submit">انضمام</button>
        <p class="status" id="jn-msg" role="status"></p>
      </form>
      <p class="muted org-center">ملاحظاتك الشخصية تبقى على جوالك. المدير يرى اسمك فقط.</p>
    </div>`;
  const btn = root.querySelector('#jn-go');
  root.querySelector('#join-form').addEventListener('submit', busyButton(btn, async () => {
    const msg = root.querySelector('#jn-msg');
    const pass = root.querySelector('#jn-pass').value;
    if (pass !== root.querySelector('#jn-pass2').value) { setMsg(msg, 'كلمتا المرور غير متطابقتين.'); return; }
    try {
      await joinWithInvite({ code: inv.code, username: inv.username, password: pass });
      location.hash = '#/org';
    } catch (e) { setMsg(msg, e.message); }
  }));
}
