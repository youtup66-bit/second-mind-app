// شاشة المؤسسة: الدخول، وإنشاء المؤسسة (المدير)، والانضمام بدعوة (الموظف)
import {
  cloudConfig, setCloudConfig, clearCloudConfig, session, signIn, signOut, createOrg,
  readInvite, joinWithInvite, orgExists, sendReset,
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

// ---- قواعد الحماية: نسخها من التطبيق نفسه (أسهل من GitHub على الجوال) ----
const rulesBox = (lead = '') => `
  <div class="org-rules">
    <p>${lead}<b>قواعد الحماية:</b> انسخها والصقها في Firebase ← Firestore Database ← Rules، ثم اضغط Publish.</p>
    <button type="button" class="btn btn--ghost" id="copy-rules">📋 نسخ قواعد الحماية</button>
    <p class="status" id="rules-msg" role="status"></p>
    <textarea id="rules-text" class="org-rules__text" dir="ltr" readonly hidden></textarea>
  </div>`;
function bindRulesBox(root) {
  root.querySelector('#copy-rules').addEventListener('click', async () => {
    const msg = root.querySelector('#rules-msg');
    const box = root.querySelector('#rules-text');
    try {
      const text = await (await fetch('firebase/firestore.rules', { cache: 'no-cache' })).text();
      if (!/service cloud\.firestore/.test(text)) throw new Error();
      box.value = text;
      // رقم الإصدار والمشروع: حتى لا تُلصق قواعد قديمة أو في مشروع آخر (مثل مشروع النسخة الأساسية)
      const ver = text.match(/إصدار القواعد:\s*(\d+)/)?.[1] || '؟';
      const project = (await cloudConfig())?.projectId || 'المربوط بهذه النسخة';
      try {
        await navigator.clipboard.writeText(text);
        setMsg(msg, `نُسخت قواعد الإصدار ${ver} ✓ الصقها في Firebase في المشروع «${project}» تحديداً، ثم Publish.`, true);
      } catch {
        // النسخ التلقائي غير مسموح: نعرض النص محدداً لينسخه يدوياً
        box.hidden = false;
        box.focus(); box.select();
        setMsg(msg, `حدّد النص أدناه كله وانسخه (الإصدار ${ver})، والصقه في المشروع «${project}».`, true);
      }
    } catch { setMsg(msg, 'تعذّر جلب القواعد. تحقق من الإنترنت.'); }
  });
}

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
        <p class="muted">اربط مشروع Firebase الخاص بمؤسستك: من إعدادات المشروع في Firebase انسخ لصقة <bdi dir="ltr">firebaseConfig</bdi> كاملة والصقها هنا. الخطوات كاملة في ملف <bdi dir="ltr">firebase/SETUP.md</bdi>.</p>
        ${rulesBox()}
        <form id="cfg-form" class="org-form">
          <label class="org-field"><span>لصقة firebaseConfig</span>
            <textarea id="cfg-text" dir="ltr" rows="7" spellcheck="false" autocomplete="off" required placeholder="const firebaseConfig = {&#10;  apiKey: &quot;AIza...&quot;,&#10;  authDomain: &quot;...&quot;,&#10;  projectId: &quot;...&quot;,&#10;  appId: &quot;...&quot;&#10;};"></textarea>
          </label>
          <button class="btn" id="cfg-save" type="submit">ربط المؤسسة</button>
          <p class="status" id="cfg-msg" role="status"></p>
        </form>
      </section>
    </div>`;
  const btn = root.querySelector('#cfg-save');
  bindRulesBox(root);
  root.querySelector('#cfg-form').addEventListener('submit', busyButton(btn, async () => {
    const msg = root.querySelector('#cfg-msg');
    try {
      await setCloudConfig(root.querySelector('#cfg-text').value);
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
        ${userField('li-user', 'اسم المستخدم (أو البريد إن ربطته)')}
        ${field('li-pass', 'كلمة المرور', 'type="password" autocomplete="current-password" dir="ltr" required')}
        <button class="btn" id="li-go" type="submit">دخول</button>
        <p class="status" id="li-msg" role="status"></p>
        <button type="button" class="link-btn" id="li-forgot">نسيت كلمة المرور؟</button>
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
      location.hash = s?.member?.role === 'manager' ? '#/structure' : '#/group';
    } catch (e) { setMsg(root.querySelector('#li-msg'), e.message); }
  }));

  // الاستعادة: بالبريد لمن ربطه (رئيس القسم)، وغيره يطلب من مسؤوله رابطاً جديداً
  root.querySelector('#li-forgot').addEventListener('click', async () => {
    const msg = root.querySelector('#li-msg');
    const typed = root.querySelector('#li-user').value.trim();
    if (!typed.includes('@')) { setMsg(msg, 'إن ربطت بريدك فاكتبه في الخانة الأولى ثم اضغط «نسيت كلمة المرور» مرة أخرى. غير ذلك: اطلب من مسؤولك رابط استعادة.'); return; }
    try { await sendReset(typed); setMsg(msg, `أرسلنا رابط تغيير كلمة المرور إلى ${typed}.`, true); } catch (e) { setMsg(msg, e.message); }
  });

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
      location.hash = '#/structure';
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
      <a class="btn org-wide" href="#/group">💬 مجموعة المؤسسة</a>
      ${manager ? `<a class="btn btn--ghost org-wide" href="#/staff">الموظفين</a>${rulesBox('عند كل تحديث للتطبيق يذكر قواعد جديدة: ')}` : ''}
      <button type="button" class="btn btn--ghost org-wide" id="logout">تسجيل الخروج</button>
    </div>`;
  if (manager) bindRulesBox(root);
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
    inv = await readInvite(params);
    // دعوة صالحة وعلى الجهاز حساب آخر: نخرج منه لينضم المدعو بحسابه
    if ((await session().catch(() => null))?.user) await signOut();
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
