// شاشة الإعدادات: مفتاح Gemini يُحفظ على الجهاز فقط
import { getSetting, setSetting, deleteSetting, clearAll, clearMessages } from '../storage.js';
import { DEFAULT_MODEL, testKey } from '../gemini.js';
import { canSpeak } from '../voice.js';
import {
  downloadBackup, shareBackup, canShareFiles, importFile,
  listSnapshots, restoreSnapshot, backupStatus, requestPersistence,
} from '../backup.js';

const fmt = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });
const REASONS = { auto: 'تلقائية', 'before-import': 'قبل الاستيراد', 'before-restore': 'قبل الاستعادة' };

export const title = 'الإعدادات';

export async function mount(root) {
  const key = await getSetting('geminiApiKey', '');
  const model = await getSetting('geminiModel', DEFAULT_MODEL);
  const speakOn = await getSetting('speakReplies', true);

  root.innerHTML = `
    <section class="card">
      <h2>مفتاح Gemini API</h2>
      <p class="muted">يُحفظ المفتاح على جهازك فقط، ويُستخدم للمحادثة والتصنيف.</p>
      <label for="api-key">المفتاح</label>
      <input id="api-key" type="password" dir="ltr" autocomplete="off" spellcheck="false"
             placeholder="AIza..." value="${key.replace(/"/g, '&quot;')}">
      <div class="row">
        <button class="btn" id="save-key">حفظ</button>
        <button class="btn btn--ghost" id="toggle-key">إظهار</button>
        <button class="btn btn--ghost" id="test-key">اختبار</button>
        <button class="btn btn--ghost" id="remove-key">حذف المفتاح</button>
      </div>
      <p class="status" id="key-status" role="status"></p>
      <p class="muted">احصل على مفتاح مجاني من <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>.</p>
      <label for="model">النموذج</label>
      <input id="model" type="text" dir="ltr" spellcheck="false" value="${model.replace(/"/g, '&quot;')}">
      <p class="muted">إن لم يكن النموذج متاحاً لمفتاحك، يختار التطبيق نموذجاً مناسباً تلقائياً.</p>
    </section>

    <section class="card">
      <h2>المحادثة</h2>
      <label class="switch">
        <input type="checkbox" id="speak" ${speakOn ? 'checked' : ''} ${canSpeak ? '' : 'disabled'}>
        <span>الرفيقة تنطق ردودها بصوت</span>
      </label>
      <p class="muted">الإدخال الصوتي يعتمد على خدمة التعرف على الكلام في متصفحك، وقد يرسل المتصفح الصوت إلى خوادمه لتحويله إلى نص.</p>
      <div class="row">
        <button class="btn btn--ghost" id="clear-chat">مسح سجل المحادثة</button>
      </div>
      <p class="status" id="chat-status" role="status"></p>
    </section>

    <section class="card" id="backup">
      <h2>النسخ الاحتياطي</h2>
      <p class="muted" id="backup-info"></p>
      <div class="row">
        <button class="btn" id="export">حفظ نسخة ZIP</button>
        ${canShareFiles() ? '<button class="btn btn--ghost" id="share">مشاركة النسخة</button>' : ''}
      </div>
      <p class="muted">الملف يحوي ملاحظاتك ومحادثتك، ونسخة مقروءة مقسّمة حسب الأقسام. لا يحوي مفتاح Gemini.</p>

      <h3 class="subhead">استيراد نسخة</h3>
      <div class="radio-row" role="radiogroup" aria-label="طريقة الاستيراد">
        <label class="switch"><input type="radio" name="mode" value="merge" checked><span>دمج مع الموجود</span></label>
        <label class="switch"><input type="radio" name="mode" value="replace"><span>استبدال الكل</span></label>
      </div>
      <div class="row">
        <label class="btn btn--ghost file-btn">اختيار ملف…
          <input type="file" id="import" accept=".zip,application/zip,.json,application/json" hidden>
        </label>
      </div>
      <p class="status" id="backup-status" role="status"></p>

      <h3 class="subhead">لقطات على الجهاز</h3>
      <p class="muted">يحفظ التطبيق لقطة يومية تلقائياً (آخر ٧)، لتستعيد ما حذفته بالخطأ. هذه اللقطات لا تحميك إن مُسح المتصفح، فاحفظ ملف ZIP بين حين وآخر.</p>
      <ul class="snaps" id="snaps"></ul>
    </section>

    <section class="card">
      <h2>الخصوصية</h2>
      <p class="muted">كل ملاحظاتك محفوظة على هذا الجهاز. لا يُرسل شيء للخارج إلا نص المحادثة الأخيرة إلى Gemini لتردّ الرفيقة.</p>
      <div class="row">
        <button class="btn btn--danger" id="wipe">مسح كل البيانات</button>
      </div>
      <p class="status" id="wipe-status" role="status"></p>
    </section>
  `;

  const input = root.querySelector('#api-key');
  const keyStatus = root.querySelector('#key-status');
  const show = (el, msg, ok = true) => {
    el.textContent = msg;
    el.className = `status ${ok ? 'status--ok' : 'status--err'}`;
  };

  root.querySelector('#save-key').addEventListener('click', async () => {
    const v = input.value.trim();
    if (!v) return show(keyStatus, 'أدخل المفتاح أولاً.', false);
    await setSetting('geminiApiKey', v);
    show(keyStatus, 'تم حفظ المفتاح على جهازك.');
  });

  root.querySelector('#toggle-key').addEventListener('click', (e) => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    e.currentTarget.textContent = hidden ? 'إخفاء' : 'إظهار';
  });

  root.querySelector('#test-key').addEventListener('click', async (e) => {
    const v = input.value.trim();
    if (!v) return show(keyStatus, 'أدخل المفتاح أولاً.', false);
    e.currentTarget.disabled = true;
    show(keyStatus, 'جارٍ الاختبار…');
    try {
      const m = await testKey(v);
      await setSetting('geminiApiKey', v);
      show(keyStatus, `المفتاح يعمل ✓ (مثلاً: ${m})`);
    } catch (err) {
      show(keyStatus, err.message, false);
    } finally {
      e.currentTarget.disabled = false;
    }
  });

  root.querySelector('#model').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (v) await setSetting('geminiModel', v); else { await deleteSetting('geminiModel'); e.target.value = DEFAULT_MODEL; }
    show(keyStatus, 'تم حفظ النموذج.');
  });

  root.querySelector('#speak').addEventListener('change', (e) => setSetting('speakReplies', e.target.checked));

  root.querySelector('#clear-chat').addEventListener('click', async () => {
    if (!confirm('سيُمسح سجل المحادثة فقط، وتبقى ملاحظاتك. متابعة؟')) return;
    await clearMessages();
    show(root.querySelector('#chat-status'), 'تم مسح سجل المحادثة.');
  });

  // ---- النسخ الاحتياطي ----
  const backupMsg = root.querySelector('#backup-status');

  async function renderBackupInfo() {
    const st = await backupStatus();
    const parts = [st.lastExportAt ? `آخر نسخة محفوظة: ${fmt.format(st.lastExportAt)}.` : 'لم تحفظ نسخة بعد.'];
    parts.push(st.persisted ? 'المتصفح لن يحذف بياناتك تلقائياً ✓' : 'قد يحذف المتصفح البيانات عند امتلاء التخزين؛ ثبّت التطبيق على الشاشة الرئيسية لتقليل ذلك.');
    root.querySelector('#backup-info').textContent = parts.join(' ');
  }

  async function renderSnaps() {
    const snaps = await listSnapshots();
    root.querySelector('#snaps').innerHTML = snaps.length
      ? snaps.map((s) => `
        <li class="snap">
          <span>${fmt.format(s.createdAt)} <span class="muted">· ${REASONS[s.reason] || s.reason} · ${s.count} ملاحظة</span></span>
          <button class="link-btn" data-restore="${s.id}">استعادة</button>
        </li>`).join('')
      : '<li class="muted">لا لقطات بعد. تُنشأ أول لقطة بعد أن تكتب ملاحظات.</li>';
  }

  await Promise.all([renderBackupInfo(), renderSnaps()]);

  async function withBusy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (err) {
      if (err?.name !== 'AbortError') show(backupMsg, err.message || 'حدث خطأ.', false);
    } finally { btn.disabled = false; }
  }

  root.querySelector('#export').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const { filename, count } = await downloadBackup();
    requestPersistence();
    show(backupMsg, `تم حفظ ${filename} (${count} ملاحظة).`);
    renderBackupInfo();
  }));

  root.querySelector('#share')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const { count } = await shareBackup();
    show(backupMsg, `تمت مشاركة النسخة (${count} ملاحظة).`);
    renderBackupInfo();
  }));

  root.querySelector('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const mode = root.querySelector('input[name="mode"]:checked').value;
    if (mode === 'replace' && !confirm('سيُستبدل كل ما في التطبيق بمحتوى الملف (مع حفظ لقطة قبلها). متابعة؟')) return;
    show(backupMsg, 'جارٍ الاستيراد…');
    try {
      const r = await importFile(file, mode);
      show(backupMsg, `تم استيراد ${r.entries} ملاحظة و${r.messages} رسالة.`);
      renderSnaps();
    } catch (err) {
      show(backupMsg, err instanceof SyntaxError ? 'الملف تالف أو غير مقروء.' : err.message, false);
    }
  });

  root.querySelector('#snaps').addEventListener('click', async (e) => {
    const id = e.target.closest('[data-restore]')?.dataset.restore;
    if (!id) return;
    if (!confirm('ستعود ملاحظاتك ومحادثتك إلى حالها في هذه اللقطة (مع حفظ لقطة للحال الحالي). متابعة؟')) return;
    try {
      const r = await restoreSnapshot(id);
      show(backupMsg, `تمت الاستعادة: ${r.entries} ملاحظة.`);
      renderSnaps();
    } catch (err) {
      show(backupMsg, err.message, false);
    }
  });

  if (location.hash.includes('backup')) root.querySelector('#backup').scrollIntoView({ block: 'start' });

  root.querySelector('#remove-key').addEventListener('click', async () => {
    await deleteSetting('geminiApiKey');
    input.value = '';
    show(keyStatus, 'تم حذف المفتاح.');
  });

  root.querySelector('#wipe').addEventListener('click', async () => {
    if (!confirm('سيُحذف كل شيء نهائياً من هذا الجهاز. هل أنت متأكد؟')) return;
    await clearAll();
    input.value = '';
    show(root.querySelector('#wipe-status'), 'تم مسح كل البيانات.');
  });
}
