// شاشة الإعدادات: مفتاح Gemini يُحفظ على الجهاز فقط
import { getSetting, setSetting, deleteSetting, clearAll, clearMessages } from '../storage.js';
import { DEFAULT_MODEL, DEFAULT_LITE_MODEL, testKey, getUsage, ttsCooldownUntil, clearTtsCooldown, economyMode } from '../gemini.js';
import { canSpeak, canRecord, canBrowserListen, speak, stopSpeaking, unlockAudio, voicesReady } from '../voice.js';
import { SKINS, DEFAULT_SKIN, skinSVG } from '../skins.js';
import { loadCategories } from '../categories.js';
import { canPip, pipAction, isFloating } from '../pip.js';
import { canPiper, isPiperReady, downloadPiper, removePiper, piperVoice } from '../piper.js';
import { LOCAL_MODELS, webgpuSupported, isModelReady, prepareModel, removeModel, localChat } from '../local-ai.js';
import { aiMode } from '../ai.js';

// يحفظ إعداداً ويُعلم بقية التطبيق (مثل الرفيقة الطافية)
async function saveAndAnnounce(key, value) {
  await setSetting(key, value);
  window.dispatchEvent(new CustomEvent('sm:setting', { detail: { key, value } }));
}
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
  const liteModel = await getSetting('geminiLiteModel', DEFAULT_LITE_MODEL);
  const economy = await economyMode();
  const speakOn = await getSetting('speakReplies', true);
  const memoryOn = await getSetting('useMemory', true);
  const stt = await getSetting('sttEngine', canRecord ? 'gemini' : 'browser');
  const textOnly = await getSetting('textOnly', false);
  const voiceReview = await getSetting('voiceReview', true);
  let skin = await getSetting('companionSkin', DEFAULT_SKIN);
  const floaterOn = await getSetting('floaterOn', true);
  const floaterSize = await getSetting('floaterSize', 'medium');
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

    <section class="card" id="floating">
      <h2>الرفيقة الطافية</h2>
      <label class="switch">
        <input type="checkbox" id="floater-on" ${floaterOn ? 'checked' : ''}>
        <span>تطفو صغيرة في كل شاشات التطبيق (اسحبها لأي مكان، والمسها لتفتح المحادثة)</span>
      </label>
      <h3 class="subhead">حجمها</h3>
      <div class="radio-row" role="radiogroup" aria-label="حجم الرفيقة الطافية">
        <label class="switch"><input type="radio" name="fsize" value="small" ${floaterSize === 'small' ? 'checked' : ''}><span>صغيرة جداً</span></label>
        <label class="switch"><input type="radio" name="fsize" value="medium" ${floaterSize === 'medium' ? 'checked' : ''}><span>صغيرة (~١ سم)</span></label>
        <label class="switch"><input type="radio" name="fsize" value="large" ${floaterSize === 'large' ? 'checked' : ''}><span>متوسطة</span></label>
      </div>
      <h3 class="subhead">فوق التطبيقات الأخرى 🪟 (تجريبي)</h3>
      <p class="muted">تفتح الرفيقة في نافذة عائمة صغيرة تبقى فوق أي تطبيق، مثل فيديو YouTube العائم. للعرض فقط، ولمسها يعيدك إلى التطبيق. حجم النافذة يحدده الجوال، ويمكنك تصغيرها بإصبعين.</p>
      <div class="row">
        <button class="btn" id="pip-btn" ${canPip ? '' : 'disabled'}>🪟 اجعلها تطفو فوق التطبيقات</button>
      </div>
      <p class="status" id="pip-status" role="status">${canPip ? '' : 'متصفحك لا يدعم النوافذ العائمة. جرّب Chrome على أندرويد.'}</p>
    </section>

    <section class="card" id="voice">
      <h2>صوت الرفيقة</h2>
      <p class="muted">لكل شخصية صوت يناسبها تلقائياً. البنات أعلى وأسرع قليلاً، ولهب صوت ولد شاب.</p>
      <div class="radio-col" role="radiogroup" aria-label="محرك الصوت">
        <label class="switch"><input type="radio" name="engine" value="device" ${engine === 'device' ? 'checked' : ''}><span>صوت الجهاز</span></label>
        <label class="switch"><input type="radio" name="engine" value="piper" ${engine === 'piper' ? 'checked' : ''} ${canPiper ? '' : 'disabled'}><span>صوت Piper العربي (داخل التطبيق، دون إنترنت)</span></label>
        <label class="switch"><input type="radio" name="engine" value="gemini" ${engine === 'gemini' ? 'checked' : ''}><span>صوت Gemini الطبيعي</span></label>
      </div>
      <p class="muted" id="engine-note"></p>
      <p class="status" id="tts-cooldown" hidden></p>

      <div id="piper-opts" hidden>
        <p class="muted" id="piper-state"></p>
        <div class="progress" id="piper-progress" hidden><span></span></div>
        <div class="row">
          <button class="btn" id="piper-download">⬇️ نزّل الصوت (~${piperVoice.approxMB} م.ب)</button>
          <button class="btn btn--ghost" id="piper-remove" hidden>حذف الصوت من الجهاز</button>
        </div>
      </div>
      <div id="device-opts">
        <div id="device-voice-wrap">
        <label for="device-voice">صوت الجهاز</label>
        <select id="device-voice"><option value="">تلقائي (حسب الشخصية)</option></select>
        </div>
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

    <section class="card" id="usage">
      <h2>استهلاك Gemini اليوم</h2>
      <div id="usage-table"></div>
      <p class="muted">الحدود المجانية تختلف لكل نوع وتتغير من Google. نماذج الصوت حصتها أصغر بكثير.
      للتوفير: صوت الجهاز بدل صوت Gemini، ومايك لوحة المفاتيح 🎤 بدل 🎙.</p>
    </section>

    <section class="card" id="local">
      <h2>الذكاء على الجهاز 📱</h2>
      <p class="muted">نماذج ذكاء صغيرة تُنزَّل مرة واحدة ثم تحاورك دون إنترنت ودون أي حصة، ولا يغادر كلامك جوالك إطلاقاً. أبسط من Gemini، لكنها معك دائماً.</p>
      <h3 class="subhead">من يرد عليك؟</h3>
      <div class="radio-col" role="radiogroup" aria-label="محرك الذكاء">
        <label class="switch"><input type="radio" name="ai-mode" value="auto"><span>تلقائي: Gemini، وعند انقطاع الإنترنت أو نفاد الحصة النموذج على الجهاز</span></label>
        <label class="switch"><input type="radio" name="ai-mode" value="local"><span>على الجهاز دائماً (أقصى خصوصية، دون إنترنت)</span></label>
        <label class="switch"><input type="radio" name="ai-mode" value="gemini"><span>Gemini فقط</span></label>
      </div>
      <p class="muted" id="gpu-state">أفحص دعم جوالك…</p>
      <h3 class="subhead">النماذج</h3>
      <ul class="models" id="models"></ul>
      <div class="row">
        <button class="btn btn--ghost" id="local-test">💬 جرّب النموذج المختار</button>
      </div>
      <p class="status" id="local-status" role="status"></p>
      <p class="muted">على الجهاز يعمل: المحادثة والتصنيف. وتبقى من Gemini: الملخصات، وأسماء المجموعات، وتحويل 🎙 إلى نص (استخدم مايك لوحة المفاتيح دون إنترنت)، وصوت Gemini (صوت Piper يعمل دون إنترنت).</p>
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

      <h3 class="subhead">وضع التوفير 🌿</h3>
      <div class="radio-col" role="radiogroup" aria-label="وضع التوفير">
        <label class="switch"><input type="radio" name="economy" value="off" ${economy === 'off' ? 'checked' : ''}>
          <span>إيقاف: كل شيء بالنموذج الرئيسي</span></label>
        <label class="switch"><input type="radio" name="economy" value="saver" ${economy === 'saver' ? 'checked' : ''}>
          <span>توفير (موصى به): التصنيف وتحويل الكلام والملخصات بنموذج خفيف، والمحادثة بالرئيسي</span></label>
        <label class="switch"><input type="radio" name="economy" value="max" ${economy === 'max' ? 'checked' : ''}>
          <span>توفير أقصى: كل شيء بالنموذج الخفيف، والردود أبسط قليلاً</span></label>
      </div>
      <label for="lite-model">النموذج الخفيف</label>
      <input id="lite-model" type="text" dir="ltr" spellcheck="false" value="${liteModel.replace(/"/g, '&quot;')}">
      <p class="muted">نماذج Flash-Lite حصتها المجانية أكبر عادة. إن نفدت حصتها أو لم تتوفر، يُستخدم النموذج الرئيسي تلقائياً.</p>
    </section>

    <section class="card" id="talk">
      <h2>المحادثة</h2>
      <h3 class="subhead">طريقة التواصل</h3>
      <div class="radio-row" role="radiogroup" aria-label="طريقة التواصل">
        <label class="switch"><input type="radio" name="mode-talk" value="both" ${textOnly ? '' : 'checked'}><span>كتابة وصوت</span></label>
        <label class="switch"><input type="radio" name="mode-talk" value="text" ${textOnly ? 'checked' : ''}><span>كتابة فقط ⌨️</span></label>
      </div>
      <p class="muted">"كتابة فقط" يُخفي الميكروفون ويوقف نطق الردود تماماً.</p>
      <label class="switch">
        <input type="checkbox" id="speak" ${speakOn ? 'checked' : ''} ${canSpeak ? '' : 'disabled'}>
        <span>الرفيقة تنطق ردودها بصوت (اضبطه من "صوت الرفيقة")</span>
      </label>
      <label class="switch">
        <input type="checkbox" id="memory" ${memoryOn ? 'checked' : ''}>
        <span>الرفيقة تستعين بملاحظاتي في ردودها</span>
      </label>
      <p class="muted">يبحث التطبيق في ملاحظاتك على جهازك، ويرفق مع رسالتك أقرب ٥ ملاحظات صلة بها فقط، لتقترح الرفيقة حلولاً مبنية على ما دوّنته.</p>
      <h3 class="subhead">التعرف على كلامك 🎙</h3>
      <label class="switch">
        <input type="checkbox" id="voice-review" ${voiceReview ? 'checked' : ''}>
        <span>أراجع النص المسموع وأعدّله قبل إرساله</span>
      </label>
      <div class="radio-row" role="radiogroup" aria-label="التعرف على الكلام">
        <label class="switch"><input type="radio" name="stt" value="gemini" ${stt === 'gemini' ? 'checked' : ''} ${canRecord ? '' : 'disabled'}><span>Gemini (أدق ويفهم العامية)</span></label>
        <label class="switch"><input type="radio" name="stt" value="browser" ${stt === 'browser' ? 'checked' : ''} ${canBrowserListen ? '' : 'disabled'}><span>خدمة المتصفح</span></label>
      </div>
      <p class="muted">Gemini: يسجّل التطبيق صوتك ويرسل التسجيل إلى Gemini ليحوّله إلى نص، ثم يُحذف التسجيل ولا يُحفظ. يعمل حتى لو كانت خدمة المتصفح معطّلة.
      خدمة المتصفح: تظهر الكلمات أثناء كلامك، لكنها لا تعمل على بعض الجوالات، والمتصفح نفسه يرسل الصوت إلى خوادمه.</p>
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
      <p class="muted">كل ملاحظاتك محفوظة على هذا الجهاز. لا يُرسل شيء للخارج إلا إلى Gemini: نص المحادثة الأخيرة، وتسجيلك الصوتي لتحويله إلى نص (إن استخدمت 🎙)، والملاحظات القليلة ذات الصلة بها (إن فعّلت ذلك)، وما تطلب تلخيصه.</p>
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

  root.querySelectorAll('input[name="economy"]').forEach((r) => r.addEventListener('change', async () => {
    await setSetting('economyMode', r.value);
    show(keyStatus, 'تم حفظ وضع التوفير.');
  }));
  root.querySelector('#lite-model').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (v) await setSetting('geminiLiteModel', v); else { await deleteSetting('geminiLiteModel'); e.target.value = DEFAULT_LITE_MODEL; }
    show(keyStatus, 'تم حفظ النموذج الخفيف.');
  });

  root.querySelector('#model').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (v) await setSetting('geminiModel', v); else { await deleteSetting('geminiModel'); e.target.value = DEFAULT_MODEL; }
    show(keyStatus, 'تم حفظ النموذج.');
  });

  // ---- الذكاء على الجهاز ----
  const modelsEl = root.querySelector('#models');
  const localStatus = root.querySelector('#local-status');
  const curMode = await aiMode();
  root.querySelector(`input[name="ai-mode"][value="${curMode}"]`).checked = true;
  root.querySelectorAll('input[name="ai-mode"]').forEach((r) => r.addEventListener('change', () => setSetting('aiMode', r.value)));
  let chosen = await getSetting('localModel', '');
  const hasGpu = await webgpuSupported();
  root.querySelector('#gpu-state').textContent = hasGpu
    ? 'جوالك يدعم WebGPU ✓ فتعمل النماذج بسرعة على كرت الشاشة.'
    : 'متصفحك لا يدعم WebGPU، فتتاح نماذج "للمعالج" فقط (أبطأ). جرّب أحدث Chrome إن أمكن.';
  const busyModels = new Set();

  async function renderModels() {
    const rows = await Promise.all(LOCAL_MODELS.map(async (m) => ({ m, ready: await isModelReady(m) })));
    modelsEl.innerHTML = rows.map(({ m, ready }) => {
      const blocked = m.engine === 'webllm' && !hasGpu;
      const busy = busyModels.has(m.id);
      return `
      <li class="model ${m.id === chosen ? 'is-chosen' : ''} ${blocked ? 'is-blocked' : ''}" data-model="${m.id}">
        <label class="switch">
          <input type="radio" name="local-model" value="${m.id}" ${m.id === chosen ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
          <span><b>${m.label}</b>${m.recommended ? ' <span class="tag">موصى به</span>' : ''}<br>
            <span class="muted">${m.note} التنزيل ~${m.sizeMB >= 1000 ? `${(m.sizeMB / 1000).toFixed(1)} جيجا` : `${m.sizeMB} ميغا`}${m.gpuMB ? ` · يحتاج نحو ${(m.gpuMB / 1000).toFixed(1)} جيجا من ذاكرة كرت الشاشة` : ' · يعمل على المعالج'}.</span></span>
        </label>
        <div class="progress" ${busy ? '' : 'hidden'}><span></span></div>
        <p class="muted model__state">${blocked ? 'غير مدعوم على هذا الجهاز.' : ready ? 'مُنزَّل ✓' : busy ? 'جارٍ التنزيل…' : ''}</p>
        <div class="row">
          ${!ready && !blocked ? `<button class="btn btn--ghost" data-act="dl" ${busy ? 'disabled' : ''}>⬇️ نزّل</button>` : ''}
          ${ready ? '<button class="btn btn--ghost" data-act="rm">حذف</button>' : ''}
        </div>
      </li>`;
    }).join('');
  }
  await renderModels();

  modelsEl.addEventListener('change', async (e) => {
    if (e.target.name !== 'local-model') return;
    chosen = e.target.value;
    await setSetting('localModel', chosen);
    renderModels();
  });
  modelsEl.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const li = e.target.closest('[data-model]');
    const m = LOCAL_MODELS.find((x) => x.id === li.dataset.model);
    if (act === 'rm') {
      if (!confirm(`حذف ${m.label} من الجهاز؟`)) return;
      await removeModel(m);
      renderModels();
      return;
    }
    // تنزيل: نختاره تلقائياً إن لم يكن هناك اختيار
    if (!confirm(`سيُنزَّل ${m.label} (~${m.sizeMB} ميغا). يُفضَّل Wi-Fi. متابعة؟`)) return;
    busyModels.add(m.id);
    await renderModels();
    const row = () => modelsEl.querySelector(`[data-model="${m.id}"]`);
    try {
      await prepareModel(m, (f, text) => {
        const r = row(); if (!r) return;
        r.querySelector('.progress').hidden = false;
        r.querySelector('.progress span').style.width = `${Math.round(f * 100)}%`;
        r.querySelector('.model__state').textContent = `جارٍ التنزيل والتجهيز… ${Math.round(f * 100)}%`;
      });
      if (!chosen) { chosen = m.id; await setSetting('localModel', chosen); }
      localStatus.className = 'status status--ok';
      localStatus.textContent = `${m.label} جاهز على جهازك ✓`;
    } catch (err) {
      localStatus.className = 'status status--err';
      localStatus.textContent = `تعذّر تجهيز ${m.label}: ${err.message || err}`;
    } finally {
      busyModels.delete(m.id);
      renderModels();
    }
  });

  root.querySelector('#local-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    localStatus.className = 'status';
    localStatus.textContent = 'أحمّل النموذج وأسأله…';
    const t0 = performance.now();
    try {
      const reply = await localChat([
        { role: 'system', content: 'أنتِ رفيقة لطيفة. أجيبي بالعربية بجملة واحدة.' },
        { role: 'user', content: 'عرّفي نفسك باختصار.' },
      ], { maxTokens: 80, onToken: (t) => { localStatus.textContent = t; } });
      localStatus.className = 'status status--ok';
      localStatus.textContent = `${reply} (${((performance.now() - t0) / 1000).toFixed(1)} ث)`;
    } catch (err) {
      localStatus.className = 'status status--err';
      localStatus.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---- الاستهلاك ----
  const KINDS = {
    chat: 'الردود (مع التصنيف)', classify: 'تصنيف منفصل', summary: 'الملخصات',
    transcribe: 'تحويل كلامك إلى نص 🎙', tts: 'صوت Gemini 🔊', other: 'أخرى (فحص المفتاح والنماذج)',
  };
  async function renderUsage() {
    const { today, days } = await getUsage();
    const week = {};
    Object.values(days).forEach((d) => Object.entries(d).forEach(([k, r]) => {
      week[k] = (week[k] || 0) + r.ok;
    }));
    const rows = Object.keys(KINDS).filter((k) => today[k] || week[k]);
    const total = rows.reduce((n, k) => n + (today[k]?.ok || 0), 0);
    root.querySelector('#usage-table').innerHTML = rows.length ? `
      <table class="usage">
        <thead><tr><th>النوع</th><th>اليوم</th><th>رُفض (حد)</th><th>٧ أيام</th></tr></thead>
        <tbody>${rows.map((k) => `<tr>
          <td>${KINDS[k]}</td><td>${today[k]?.ok || 0}</td>
          <td class="${today[k]?.limited ? 'usage__bad' : ''}">${today[k]?.limited || 0}</td><td>${week[k] || 0}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td>المجموع اليوم</td><td>${total}</td><td></td><td></td></tr></tfoot>
      </table>` : '<p class="muted">لم تُستخدم أي طلبات بعد.</p>';
  }
  renderUsage();

  // ---- الصوت ----
  const voiceStatus = root.querySelector('#voice-status');
  const engineNote = root.querySelector('#engine-note');
  const deviceOpts = root.querySelector('#device-opts');
  const NOTES = {
    device: 'فوري ومجاني ويعمل دون إنترنت، وجودته تعتمد على الأصوات المثبتة في جوالك.',
    piper: 'صوت عربي ("كريم"، فصحى بلكنة أردنية) يعمل داخل التطبيق: يُنزَّل مرة واحدة ثم يعمل دون إنترنت ودون أي حصة، ولا يُرسل أي نص. صوت رجل، يرفع التطبيق حدّته لكل شخصية. أول جملة بعد فتح التطبيق تتأخر ثوانيَ ريثما يُحمَّل.',
    gemini: 'صوت طبيعي أجمل بكثير يناسب الشخصية. يُرسل نص الرد فقط إلى Gemini، ويستهلك من حصة مفتاحك، ويتأخر ثوانيَ قليلة. إن تعذّر يُستخدم صوت الجهاز تلقائياً.',
  };
  const cooldownEl = root.querySelector('#tts-cooldown');
  const fmtTime = new Intl.DateTimeFormat('ar', { timeStyle: 'short' });
  async function renderCooldown() {
    const until = await ttsCooldownUntil();
    const isGemini = root.querySelector('input[name="engine"]:checked').value === 'gemini';
    cooldownEl.hidden = !(until && isGemini);
    if (until) {
      cooldownEl.className = 'status status--err';
      cooldownEl.innerHTML = `نفدت حصة صوت Gemini مؤقتاً، فأستخدم صوت الجهاز حتى ${fmtTime.format(until)}. <button class="link-btn" id="retry-tts">جرّب الآن</button>`;
      cooldownEl.querySelector('#retry-tts').onclick = async () => { await clearTtsCooldown(); renderCooldown(); };
    }
  }
  const syncEngine = () => {
    const v = root.querySelector('input[name="engine"]:checked').value;
    engineNote.textContent = NOTES[v];
    deviceOpts.hidden = v === 'gemini';
    root.querySelector('#device-voice-wrap').hidden = v !== 'device';
    root.querySelector('#piper-opts').hidden = v !== 'piper';
    renderCooldown();
    if (v === 'piper') renderPiper();
  };

  // ---- صوت Piper ----
  const piperState = root.querySelector('#piper-state');
  const piperDl = root.querySelector('#piper-download');
  const piperRm = root.querySelector('#piper-remove');
  const piperBar = root.querySelector('#piper-progress');
  async function renderPiper() {
    const ready = await isPiperReady();
    piperState.textContent = ready
      ? 'الصوت مُنزَّل على جهازك ✓ ويعمل دون إنترنت.'
      : `لم يُنزَّل بعد. الحجم نحو ${piperVoice.approxMB} ميغابايت؛ يُفضَّل التنزيل عبر Wi-Fi. حتى تنزيله يُستخدم صوت الجهاز.`;
    piperDl.hidden = ready;
    piperRm.hidden = !ready;
  }
  piperDl.addEventListener('click', async () => {
    piperDl.disabled = true;
    piperBar.hidden = false;
    try {
      await downloadPiper((f) => {
        piperBar.firstElementChild.style.width = `${Math.round(f * 100)}%`;
        piperState.textContent = `جارٍ التنزيل… ${Math.round(f * 100)}%`;
      });
      await renderPiper();
    } catch (err) {
      piperState.textContent = `${err.message} تحقق من الإنترنت ثم حاول مرة أخرى.`;
    } finally {
      piperDl.disabled = false;
      piperBar.hidden = true;
    }
  });
  piperRm.addEventListener('click', async () => {
    if (!confirm('حذف صوت Piper من الجهاز؟ يمكنك تنزيله مرة أخرى لاحقاً.')) return;
    await removePiper();
    renderPiper();
  });
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
      force: true,
      onStart: () => { if (!fellBack) voiceStatus.textContent = ''; },
      onEnd: () => { btn.disabled = false; renderCooldown(); renderUsage(); },
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

  // ---- الرفيقة الطافية ----
  root.querySelector('#floater-on').addEventListener('change', (e) => saveAndAnnounce('floaterOn', e.target.checked));
  root.querySelectorAll('input[name="fsize"]').forEach((r) => r.addEventListener('change', () => saveAndAnnounce('floaterSize', r.value)));
  const pipStatus = root.querySelector('#pip-status');
  const pipBtn = root.querySelector('#pip-btn');
  const pipLabel = () => { pipBtn.textContent = isFloating() ? '↩️ أعِدها إلى التطبيق' : '🪟 اجعلها تطفو فوق التطبيقات'; };
  pipBtn.addEventListener('click', async () => {
    pipBtn.disabled = true;
    await pipAction(skin, (t) => { pipStatus.className = 'status'; pipStatus.textContent = t; });
    pipBtn.disabled = false;
    pipLabel();
  });

  root.querySelector('.skins').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-skin]');
    if (!b) return;
    skin = b.dataset.skin;
    await saveAndAnnounce('companionSkin', b.dataset.skin);
    root.querySelectorAll('.skin').forEach((x) => {
      x.classList.toggle('is-active', x === b);
      x.setAttribute('aria-checked', x === b);
    });
  });

  root.querySelector('#speak').addEventListener('change', (e) => setSetting('speakReplies', e.target.checked));
  root.querySelector('#memory').addEventListener('change', (e) => setSetting('useMemory', e.target.checked));
  root.querySelectorAll('input[name="mode-talk"]').forEach((r) => r.addEventListener('change', async () => {
    const only = r.value === 'text';
    await setSetting('textOnly', only);
    if (only) stopSpeaking();
    root.querySelector('#speak').disabled = only;
  }));
  root.querySelector('#speak').disabled = textOnly;
  root.querySelector('#voice-review').addEventListener('change', (e) => setSetting('voiceReview', e.target.checked));
  root.querySelectorAll('input[name="stt"]').forEach((r) => r.addEventListener('change', () => setSetting('sttEngine', r.value)));

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
      await loadCategories();
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
      await loadCategories();
      show(backupMsg, `تمت الاستعادة: ${r.entries} ملاحظة.`);
      renderSnaps();
    } catch (err) {
      show(backupMsg, err.message, false);
    }
  });

  if (location.hash.includes('backup')) root.querySelector('#backup').scrollIntoView({ block: 'start' });
  if (location.hash.includes('talk')) root.querySelector('#talk').scrollIntoView({ block: 'start' });
  if (location.hash.includes('floating')) root.querySelector('#floating').scrollIntoView({ block: 'start' });
  if (location.hash.includes('local')) root.querySelector('#local').scrollIntoView({ block: 'start' });

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
