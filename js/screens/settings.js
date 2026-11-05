// شاشة الإعدادات: الحساب، والتثبيت، ومفتاح Gemini والنسخ الاحتياطي (للمدير)، والخصوصية
import { getSetting, setSetting, deleteSetting, clearAll } from '../storage.js';
import { testKey, economyMode } from '../gemini.js';
import {
  downloadBackup, shareBackup, canShareFiles, importFile,
  listSnapshots, restoreSnapshot, backupStatus, requestPersistence,
} from '../backup.js';
import { session } from '../cloud.js';

export const title = 'الإعدادات';

const fmt = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });
const REASONS = { auto: 'تلقائية', 'before-import': 'قبل الاستيراد', 'before-restore': 'قبل الاستعادة' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// وصف مختصر تحت اسم كل قسم (مثل إعدادات واتساب)
const GROUP_HINTS = {
  'الحساب': 'الدخول إلى المؤسسة وتسجيل الخروج',
  'تثبيت التطبيق': 'أضفه إلى الشاشة الرئيسية ليعمل كتطبيق',
  'مفتاح Gemini': 'لاحتساب النقاط من المنشورات وتحويل كلامك إلى نص',
  'النسخ الاحتياطي': 'أرشيف المنشورات والهيكل والنقاط',
  'الخصوصية': 'ما يُرسل خارج جهازك، ومسح البيانات',
};

// يحوّل كل بطاقة إلى سطر باسمها، تنسدل خياراتها عند لمسه (واحد مفتوح في كل مرة)
function groupSettings(root) {
  const groups = [...root.querySelectorAll(':scope > section.card')];
  const setOpen = (sec, on) => {
    sec.classList.toggle('is-open', on);
    sec.querySelector('.set-head').setAttribute('aria-expanded', String(on));
    sec.querySelector('.set-body').hidden = !on;
  };
  const open = (sec) => {
    if (!sec) return;
    groups.forEach((g) => g !== sec && setOpen(g, false));
    setOpen(sec, true);
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  for (const sec of groups) {
    const h = sec.querySelector(':scope > h2');
    if (!h) continue;
    const name = h.textContent.trim();
    const body = document.createElement('div');
    body.className = 'set-body';
    while (h.nextSibling) body.append(h.nextSibling);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'set-head';
    head.innerHTML = '<span class="set-head__text"><b></b><small></small></span><span class="set-head__chev" aria-hidden="true">⌄</span>';
    head.querySelector('b').textContent = name;
    head.querySelector('small').textContent = GROUP_HINTS[name] || '';
    h.replaceWith(head);
    sec.append(body);
    sec.classList.add('set-group');
    setOpen(sec, false);
    head.addEventListener('click', () => (sec.classList.contains('is-open') ? setOpen(sec, false) : open(sec)));
  }
  return open;
}

let cleanup = [];

export async function mount(root) {
  const s = await session().catch(() => null);
  const role = s?.member?.role || null;
  const manager = role === 'manager';
  const key = await getSetting('geminiApiKey', '');
  const economy = await economyMode();

  root.innerHTML = `
    <section class="card" id="account">
      <h2>الحساب</h2>
      ${s?.member
        ? `<p><b>${esc(s.member.display_name)}</b> · ${manager ? 'مدير' : 'موظف'} في <b>${esc(s.org?.name)}</b></p>`
        : '<p class="muted">لم تدخل إلى المؤسسة بعد.</p>'}
      <div class="row"><a class="btn" href="#/org">${s?.member ? 'حسابي في المؤسسة' : 'الدخول إلى المؤسسة'}</a></div>
    </section>

    <section class="card" id="install">
      <h2>تثبيت التطبيق</h2>
      <p class="muted" id="install-state"></p>
      <div class="row"><button class="btn" id="install-btn" hidden>📲 ثبّت التطبيق على الشاشة الرئيسية</button></div>
      <div class="install-help" id="install-help" hidden>
        <p><b>أندرويد (Chrome):</b> القائمة ⋮ أعلى المتصفح ← <b>"تثبيت التطبيق"</b> أو <b>"إضافة إلى الشاشة الرئيسية"</b>.</p>
        <p><b>آيفون (Safari):</b> زر المشاركة ⬆️ أسفل الشاشة ← <b>"إضافة إلى الشاشة الرئيسية"</b>.</p>
      </div>
    </section>

    ${manager ? `
    <section class="card" id="key">
      <h2>مفتاح Gemini</h2>
      <p class="muted">للمدير فقط: يقرأ الذكاء منشورات الأعمال ويقترح النقاط، ويحوّل كلامك إلى نص. يُحفظ المفتاح على جهازك فقط.</p>
      <label for="api-key">المفتاح</label>
      <input id="api-key" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="AIza..." value="${esc(key)}">
      <div class="row">
        <button class="btn" id="save-key">حفظ</button>
        <button class="btn btn--ghost" id="test-key">اختبار</button>
        <button class="btn btn--ghost" id="remove-key">حذف المفتاح</button>
      </div>
      <p class="status" id="key-status" role="status"></p>
      <p class="muted">احصل على مفتاح مجاني من <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>.</p>
      <label class="switch"><input type="checkbox" id="economy" ${economy !== 'off' ? 'checked' : ''}>
        <span>وضع التوفير: نموذج خفيف حصته المجانية أكبر (موصى به)</span></label>
    </section>

    <section class="card" id="backup">
      <h2>النسخ الاحتياطي</h2>
      <p class="muted" id="backup-info"></p>
      <div class="row">
        <button class="btn" id="export">حفظ نسخة ZIP</button>
        ${canShareFiles() ? '<button class="btn btn--ghost" id="share">مشاركة النسخة</button>' : ''}
      </div>
      <p class="muted">أرشيف المنشورات على جوالك فقط. احفظ نسخة بين حين وآخر، وانقلها إن غيّرت جوالك. الملف يحوي المنشورات والصور والهيكل والنقاط، ولا يحوي كلمات المرور ولا مفتاح Gemini.</p>
      <h3 class="subhead">استيراد نسخة</h3>
      <div class="row">
        <label class="btn btn--ghost file-btn">اختيار ملف…
          <input type="file" id="import" accept=".zip,application/zip,.json,application/json" hidden>
        </label>
      </div>
      <p class="status" id="backup-status" role="status"></p>
      <h3 class="subhead">لقطات على الجهاز</h3>
      <p class="muted">لقطة يومية تلقائية للهيكل والنقاط (آخر ٧).</p>
      <ul class="snaps" id="snaps"></ul>
    </section>` : ''}

    <section class="card">
      <h2>الخصوصية</h2>
      <p class="muted">${manager
        ? 'أرشيف المنشورات والهيكل والنقاط على جوالك فقط. السحابة (Firebase) تنقل المنشورات ثم تحذفها بعد استلامها. لا يُرسل إلى Gemini إلا نص المنشور لاحتساب نقاطه، وتسجيلك الصوتي لتحويله إلى نص.'
        : 'منشوراتك تُرسل إلى مجموعة المؤسسة فقط، والسحابة تحذفها بعد أن تصل. لا شيء آخر يغادر جوالك.'}</p>
      <div class="row"><button class="btn btn--danger" id="wipe">مسح كل البيانات من هذا الجهاز</button></div>
      <p class="status" id="wipe-status" role="status"></p>
    </section>`;
  groupSettings(root);

  const show = (el, msg, ok = true) => { el.textContent = msg; el.className = `status ${ok ? 'status--ok' : 'status--err'}`; };

  // ---- تثبيت التطبيق ----
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const installBtn = root.querySelector('#install-btn');
  const renderInstall = () => {
    const can = !!window.__installPrompt;
    root.querySelector('#install-state').textContent = installed
      ? 'التطبيق مثبّت على جوالك ✓'
      : can ? 'ثبّته ليفتح كتطبيق مستقل بأيقونة على الشاشة الرئيسية.' : 'اتبع الخطوات لتثبيته على الشاشة الرئيسية:';
    installBtn.hidden = installed || !can;
    root.querySelector('#install-help').hidden = installed || can;
  };
  renderInstall();
  const onInstallable = () => renderInstall();
  window.addEventListener('sm:installable', onInstallable);
  cleanup.push(() => window.removeEventListener('sm:installable', onInstallable));
  installBtn.addEventListener('click', async () => {
    const ev = window.__installPrompt;
    if (!ev) return renderInstall();
    ev.prompt();
    const { outcome } = await ev.userChoice;
    window.__installPrompt = null;
    root.querySelector('#install-state').textContent = outcome === 'accepted' ? 'جارٍ التثبيت… ستجد أيقونته على الشاشة الرئيسية ✓' : 'لم يُثبَّت. يمكنك تثبيته لاحقاً من قائمة المتصفح.';
    installBtn.hidden = true;
  });

  // ---- مفتاح Gemini (المدير) ----
  if (manager) {
    const input = root.querySelector('#api-key');
    const keyStatus = root.querySelector('#key-status');
    root.querySelector('#save-key').addEventListener('click', async () => {
      const v = input.value.trim();
      if (!v) return show(keyStatus, 'أدخل المفتاح أولاً.', false);
      await setSetting('geminiApiKey', v);
      show(keyStatus, 'تم حفظ المفتاح على جهازك.');
    });
    root.querySelector('#test-key').addEventListener('click', async (e) => {
      const v = input.value.trim();
      if (!v) return show(keyStatus, 'أدخل المفتاح أولاً.', false);
      const btn = e.currentTarget;
      btn.disabled = true;
      show(keyStatus, 'جارٍ الاختبار…');
      try {
        const m = await testKey(v);
        await setSetting('geminiApiKey', v);
        show(keyStatus, `المفتاح يعمل ✓ (${m})`);
      } catch (err) { show(keyStatus, err.message, false); } finally { btn.disabled = false; }
    });
    root.querySelector('#remove-key').addEventListener('click', async () => {
      await deleteSetting('geminiApiKey');
      input.value = '';
      show(keyStatus, 'تم حذف المفتاح.');
    });
    root.querySelector('#economy').addEventListener('change', (e) => setSetting('economyMode', e.target.checked ? 'saver' : 'off'));

    // ---- النسخ الاحتياطي ----
    const backupMsg = root.querySelector('#backup-status');
    const renderBackupInfo = async () => {
      const st = await backupStatus();
      root.querySelector('#backup-info').textContent = [
        st.lastExportAt ? `آخر نسخة محفوظة: ${fmt.format(st.lastExportAt)}.` : 'لم تحفظ نسخة بعد.',
        st.persisted ? 'المتصفح لن يحذف بياناتك تلقائياً ✓' : 'ثبّت التطبيق على الشاشة الرئيسية ليقلّ احتمال حذف المتصفح لبياناته.',
      ].join(' ');
    };
    const renderSnaps = async () => {
      const snaps = await listSnapshots();
      root.querySelector('#snaps').innerHTML = snaps.length
        ? snaps.map((x) => `<li class="snap"><span>${fmt.format(x.createdAt)} <span class="muted">· ${REASONS[x.reason] || x.reason}</span></span>
            <button class="link-btn" data-restore="${x.id}">استعادة</button></li>`).join('')
        : '<li class="muted">لا لقطات بعد.</li>';
    };
    await Promise.all([renderBackupInfo(), renderSnaps()]);
    const withBusy = async (btn, fn) => {
      btn.disabled = true;
      try { await fn(); } catch (err) { if (err?.name !== 'AbortError') show(backupMsg, err.message || 'حدث خطأ.', false); } finally { btn.disabled = false; }
    };
    root.querySelector('#export').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const { filename, count } = await downloadBackup();
      requestPersistence();
      show(backupMsg, `تم حفظ ${filename} (${count} منشور).`);
      renderBackupInfo();
    }));
    root.querySelector('#share')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const { count } = await shareBackup();
      show(backupMsg, `تمت مشاركة النسخة (${count} منشور).`);
      renderBackupInfo();
    }));
    root.querySelector('#import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      show(backupMsg, 'جارٍ الاستيراد…');
      try {
        const r = await importFile(file, 'merge');
        show(backupMsg, `تم الاستيراد: ${r.posts} منشور و${r.points} احتساب نقاط.`);
        renderSnaps();
      } catch (err) { show(backupMsg, err instanceof SyntaxError ? 'الملف تالف أو غير مقروء.' : err.message, false); }
    });
    root.querySelector('#snaps').addEventListener('click', async (e) => {
      const id = e.target.closest('[data-restore]')?.dataset.restore;
      if (!id || !confirm('يعود الهيكل والنقاط إلى حالهما في هذه اللقطة (مع حفظ لقطة للحال الحالي). متابعة؟')) return;
      try { await restoreSnapshot(id); show(backupMsg, 'تمت الاستعادة ✓'); renderSnaps(); } catch (err) { show(backupMsg, err.message, false); }
    });
  }

  root.querySelector('#wipe').addEventListener('click', async () => {
    if (!confirm('سيُحذف كل شيء من هذا الجهاز نهائياً (الأرشيف والهيكل والنقاط وربط المؤسسة)، وستحتاج للدخول من جديد. حسابك نفسه يبقى. متابعة؟')) return;
    await clearAll();
    show(root.querySelector('#wipe-status'), 'تم مسح كل البيانات من هذا الجهاز.');
    setTimeout(() => location.reload(), 800);
  });
}

export function unmount() {
  cleanup.splice(0).forEach((fn) => fn());
}
