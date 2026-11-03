// شاشة الإعدادات: مفتاح Gemini يُحفظ على الجهاز فقط
import { getSetting, setSetting, deleteSetting, clearAll, clearMessages } from '../storage.js';
import { DEFAULT_MODEL, testKey } from '../gemini.js';
import { canSpeak, speak, stopSpeaking, unlockAudio, voicesReady } from '../voice.js';
import { SKINS, DEFAULT_SKIN, skinSVG } from '../skins.js';
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
  const memoryOn = await getSetting('useMemory', true);
  let skin = await getSetting('companionSkin', DEFAULT_SKIN);
  const engine = await getSetting('voiceEngine', 'device');
  const deviceVoice = await getSetting('deviceVoice', '');
  const pitchShift = Number(await getSetting('voicePitchShift', 0));
  const rateScale = Number(await getSetting('voiceRateScale', 1));

  root.innerHTML = `
    <section class="card">
      <h2>شكل الرفيقة</h2>
      <div class="skins" role="radiogroup" aria-label="شكل الرفيقة">
        ${Object.entries(SKINS).map(([id, k]) => `
          <button class="skin ${id === skin ? 'is-active' : ''}" role="radio" aria-checked="${id === skin}" data-skin="${id}">
            <div class="companion is-idle">${skinSVG(id)}</div>
            <span class="skin__name">${k.label}</span>
            <span class="skin__note">${k.note}</span>
          </button>`).join('')}
      </div>
    </section>

    <section class="card" id="voice">
      <h2>صوت الرفيقة</h2>
      <p class="muted">لكل شخصية صوت يناسبها تلقائياً. البنات أعلى وأسرع قليلاً، ولهب صوت ولد شاب.</p>
      <div class="radio-row" role="radiogroup" aria-label="محرك الصوت">
        <label class="switch"><input type="radio" name="engine" value="device" ${engine === 'device' ? 'checked' : ''}><span>صوت الجهاز</span></label>
        <label class="switch"><input type="radio" name="engine" value="gemini" ${engine === 'gemini' ? 'checked' : ''}><span>صوت Gemini الطبيعي</span></label>
      </div>
      <p class="muted" id="engine-note"></p>

      <div id="device-opts">
        <label for="device-voice">صوت الجهاز</label>
        <select id="device-voice"><option value="">تلقائي (حسب الشخصية)</option></select>
        <label for="pitch">حدّة الصوت <span class="muted" id="pitch-val"></span></label>
        <input type="range" id="pitch" min="-0.6" max="0.4" step="0.05" value="${pitchShift}">
        <label for="rate">السرعة <span class="muted" id="rate-val"></span></label>
        <input type="range" id="rate" min="0.7" max="1.4" step="0.05" value="${rateScale}">
      </div>
      <div class="row">
        <button class="btn" id="test-voice">🔊 جرّب الصوت</button>
      </div>
      <p class="status" id="voice-status" role="status"></p>
    </section>

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
        <span>الرفيقة تنطق ردودها بصوت (اضبطه من "صوت الرفيقة")</span>
      </label>
      <label class="switch">
        <input type="checkbox" id="memory" ${memoryOn ? 'checked' : ''}>
        <span>الرفيقة تستعين بملاحظاتي في ردودها</span>
      </label>
      <p class="muted">يبحث التطبيق في ملاحظاتك على جهازك، ويرفق مع رسالتك أقرب ٥ ملاحظات صلة بها فقط، لتقترح الرفيقة حلولاً مبنية على ما دوّنته.</p>
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
      <p class="muted">كل ملاحظاتك محفوظة على هذا الجهاز. لا يُرسل شيء للخارج إلا إلى Gemini: نص المحادثة الأخيرة، والملاحظات القليلة ذات الصلة بها (إن فعّلت ذلك)، وما تطلب تلخيصه.</p>
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
    const btn = e.currentTarget; // currentTarget يصبح null بعد أي انتظار
    btn.disabled = true;
    show(keyStatus, 'جارٍ الاختبار…');
    try {
      const m = await testKey(v);
      await setSetting('geminiApiKey', v);
      show(keyStatus, `المفتاح يعمل ✓ (مثلاً: ${m})`);
    } catch (err) {
      show(keyStatus, err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('#model').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (v) await setSetting('geminiModel', v); else { await deleteSetting('geminiModel'); e.target.value = DEFAULT_MODEL; }
    show(keyStatus, 'تم حفظ النموذج.');
  });

  // ---- الصوت ----
  const voiceStatus = root.querySelector('#voice-status');
  const engineNote = root.querySelector('#engine-note');
  const deviceOpts = root.querySelector('#device-opts');
  const NOTES = {
    device: 'فوري ومجاني ويعمل دون إنترنت، وجودته تعتمد على الأصوات المثبتة في جوالك.',
    gemini: 'صوت طبيعي أجمل بكثير يناسب الشخصية. يُرسل نص الرد فقط إلى Gemini، ويستهلك من حصة مفتاحك، ويتأخر ثوانيَ قليلة. إن تعذّر يُستخدم صوت الجهاز تلقائياً.',
  };
  const syncEngine = () => {
    const v = root.querySelector('input[name="engine"]:checked').value;
    engineNote.textContent = NOTES[v];
    deviceOpts.hidden = v !== 'device';
  };
  syncEngine();
  root.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener('change', async () => {
    await setSetting('voiceEngine', r.value);
    syncEngine();
  }));

  const sel = root.querySelector('#device-voice');
  voicesReady().then((list) => {
    if (!list.length) {
      sel.innerHTML = '<option value="">لا توجد أصوات عربية مثبتة في هذا الجهاز</option>';
      return;
    }
    sel.innerHTML += list.map((v) =>
      `<option value="${v.voiceURI.replace(/"/g, '&quot;')}" ${v.voiceURI === deviceVoice ? 'selected' : ''}>${v.name.replace(/</g, '&lt;')}</option>`).join('');
  });
  sel.addEventListener('change', () => setSetting('deviceVoice', sel.value));

  const pitch = root.querySelector('#pitch'), rate = root.querySelector('#rate');
  const label = () => {
    const p = Number(pitch.value);
    root.querySelector('#pitch-val').textContent = p === 0 ? '(حسب الشخصية)' : p > 0 ? '(أعلى)' : '(أخفض)';
    root.querySelector('#rate-val').textContent = `×${Number(rate.value).toFixed(2)}`;
  };
  label();
  pitch.addEventListener('input', label);
  rate.addEventListener('input', label);
  pitch.addEventListener('change', () => setSetting('voicePitchShift', Number(pitch.value)));
  rate.addEventListener('change', () => setSetting('voiceRateScale', Number(rate.value)));

  const SAMPLES = {
    star: 'مرحباً! أنا نجمة، أنا هنا أسمعك دائماً.',
    neko: 'مياو! أنا نيكو، احكِ لي ما يدور في بالك.',
    mage: 'أهلاً! أنا لهب، هيا نجد حلاً سحرياً معاً!',
    bunny: 'هاي هاي! أنا لولو، يومك سيكون جميلاً!',
  };
  root.querySelector('#test-voice').addEventListener('click', (e) => {
    unlockAudio();
    const btn = e.currentTarget;
    btn.disabled = true;
    voiceStatus.className = 'status';
    voiceStatus.textContent = root.querySelector('input[name="engine"]:checked').value === 'gemini' ? 'أجهّز الصوت…' : '';
    let fellBack = false;
    speak(SAMPLES[skin] || SAMPLES.star, {
      skin,
      onStart: () => { if (!fellBack) voiceStatus.textContent = ''; },
      onEnd: () => { btn.disabled = false; },
      onSilent: () => {
        voiceStatus.className = 'status status--err';
        voiceStatus.textContent = (fellBack ? voiceStatus.textContent + ' ' : '') +
          'ولم يعمل صوت الجهاز أيضاً: ثبّت أو فعّل محرك نطق يدعم العربية (مثل Google Text-to-Speech) من إعدادات الجوال.';
      },
      onFallback: (err) => {
        fellBack = true;
        voiceStatus.className = 'status status--err';
        voiceStatus.textContent = `تعذّر صوت Gemini (${err.message}) فاستخدمت صوت الجهاز.`;
      },
    });
    setTimeout(() => { btn.disabled = false; }, 15000);
  });

  root.querySelector('.skins').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-skin]');
    if (!b) return;
    skin = b.dataset.skin;
    await setSetting('companionSkin', b.dataset.skin);
    root.querySelectorAll('.skin').forEach((x) => {
      x.classList.toggle('is-active', x === b);
      x.setAttribute('aria-checked', x === b);
    });
  });

  root.querySelector('#speak').addEventListener('change', (e) => setSetting('speakReplies', e.target.checked));
  root.querySelector('#memory').addEventListener('change', (e) => setSetting('useMemory', e.target.checked));

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

export function unmount() {
  stopSpeaking();
}
