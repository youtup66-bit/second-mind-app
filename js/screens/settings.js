// شاشة الإعدادات: مفتاح Gemini يُحفظ على الجهاز فقط
import { IS_DEV, IS_BUNDLED } from '../env.js';
import { canUpdateApp, appVersion, startAppUpdate } from '../app-update.js';
import { getSetting, setSetting, deleteSetting, clearAll, clearMessages } from '../storage.js';
import { ROLES, roleOf, applyRole, clearRole, isHex } from '../appearance.js';
import { DEFAULT_MODEL, DEFAULT_LITE_MODEL, testKey, getUsage, ttsCooldownUntil, clearTtsCooldown, economyMode } from '../gemini.js';
import { canSpeak, canListen, canRecord, canBrowserListen, speak, stopSpeaking, unlockAudio, voicesReady } from '../voice.js';
import { DEFAULT_SKIN } from '../skins.js';
import { loadCategories } from '../categories.js';
import {
  LOCAL_MODELS, webgpuSupported, shaderF16Supported, blockedReason, isModelReady, removeModel, localChat, retryGpu, explainError,
  canBackgroundFetch, startBackgroundDownload, backgroundDownload, cancelBackgroundDownload, interruptedDownload,
  missingFiles, backgroundReport,
  downloadInPage, inPageDownload, downloads,
} from '../local-ai.js';
import { aiMode } from '../ai.js';

// يحفظ إعداداً ويُعلم بقية التطبيق (مثل المساعد الطافي)
// وصف مختصر تحت اسم كل قسم (مثل إعدادات واتساب)
const GROUP_HINTS = {
  'المطوّر': 'المؤسسة التجريبية، والدخول بأي حساب (نسخة التجربة فقط)',
  'المؤسسة': 'الدخول، وحساب المدير، والموظفون',
  'الشبكة': 'الإنترنت أو الشبكة الداخلية، وعنوان الخادم',
  'المظهر': 'ألوان التطبيق: أخضر واتساب',
  'تثبيت التطبيق': 'التثبيت، والإصدار، والتحقق من التحديثات',
  'صوت الردود': 'نوع الصوت وطبقته وسرعته',
  'استهلاك Gemini اليوم': 'عدد الطلبات والحصة',
  'الذكاء على الجهاز': 'نماذج تعمل دون إنترنت',
  'مفتاح Gemini API': 'المفتاح ووضع التوفير',
  'المحادثة': 'الكتابة والصوت والتعرف على الكلام',
  'النسخ الاحتياطي': 'تصدير واستيراد ونسخ تلقائية',
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
    const title = h.textContent.trim();
    const body = document.createElement('div');
    body.className = 'set-body';
    while (h.nextSibling) body.append(h.nextSibling);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'set-head';
    head.innerHTML = `<span class="set-head__text"><b></b><small></small></span><span class="set-head__chev" aria-hidden="true">⌄</span>`;
    head.querySelector('b').textContent = title;
    head.querySelector('small').textContent = GROUP_HINTS[title] || '';
    h.replaceWith(head);
    sec.append(body);
    sec.classList.add('set-group');
    setOpen(sec, false);
    head.addEventListener('click', () => {
      // المؤسسة تفتح شاشتها مباشرة (بلا قسم وسيط)
      if (sec.id === 'org') { location.hash = '#/org'; return; }
      sec.classList.contains('is-open') ? setOpen(sec, false) : open(sec);
    });
  }
  return open;
}

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

const cleanup = [];

export async function mount(root) {
  const key = await getSetting('geminiApiKey', '');
  const model = await getSetting('geminiModel', DEFAULT_MODEL);
  const liteModel = await getSetting('geminiLiteModel', DEFAULT_LITE_MODEL);
  const economy = await economyMode();
  const speakOn = await getSetting('speakReplies', true);
  const memoryOn = await getSetting('useMemory', true);
  const stt = await getSetting('sttEngine', canRecord ? 'gemini' : 'browser');
  const textOnly = await getSetting('textOnly', false);
  const micOn = await getSetting('micOn', true);
  const appTheme = await getSetting('appTheme', 'auto');
  const voiceReview = await getSetting('reviewVoice', false);
  let skin = await getSetting('companionSkin', DEFAULT_SKIN);
  const engine = (await getSetting('voiceEngine', 'device')) === 'gemini' ? 'gemini' : 'device';
  const deviceVoice = await getSetting('deviceVoice', '');
  const pitchShift = Number(await getSetting('voicePitchShift', 0));
  const rateScale = Number(await getSetting('voiceRateScale', 1));

  root.innerHTML = `
    ${IS_DEV ? `<section class="card" id="dev">
      <h2>المطوّر</h2>
      <div id="dev-body"><p class="muted">لحظة…</p></div>
    </section>` : ''}

    <section class="card" id="account">
      <h2>الحساب</h2>
      <div id="acc-body"><p class="muted">لحظة…</p></div>
    </section>

    <section class="card" id="org">
      <h2>المؤسسة</h2>
      <p class="muted">حساب للمدير والموظفين، ومحادثة مشتركة ونقاط وتقارير. ملاحظاتك الشخصية تبقى على جهازك.</p>
      <div class="row"><a class="btn" href="#/org" id="org-open">الدخول إلى المؤسسة</a></div>
    </section>

    <section class="card" id="network">
      <h2>الشبكة</h2>
      <p class="muted">اختر طريقة الاتصال. «الإنترنت» كما هو الآن، و«شبكة داخلية» يتصل بالخادم في المؤسسة عند تفعيله.</p>
      <label class="look-row"><span>طريقة الاتصال</span>
        <select id="net-mode"><option value="internet">الإنترنت</option><option value="lan">شبكة داخلية (خادم المؤسسة)</option></select></label>
      <label class="look-row"><span>نوع عنوان الخادم</span>
        <select id="net-addr-type"><option value="static">ثابت (Static): رقم IP لا يتغير</option><option value="dhcp">ديناميكي (DHCP): اسم الخادم</option></select></label>
      <label class="org-field"><span id="net-server-label">عنوان الخادم الأساسي</span>
        <input id="net-server" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://192.168.1.10"></label>
      <p class="muted" id="net-dhcp-note" hidden>الخادم بعنوان ديناميكي قد يتغير رقمه، لذلك يُستعمل اسمه الداخلي (مثل https://aqli.local) ويبقى ثابتاً.</p>
      <label class="org-field"><span>عنوان بديل (اختياري، مثل اسم النطاق الداخلي)</span>
        <input id="net-server2" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://aqli.local"></label>
      <label class="org-field"><span>بصمة الشهادة SHA-256 (اختياري، للتأكد من هوية الخادم)</span>
        <input id="net-ident" dir="ltr" autocomplete="off" spellcheck="false" placeholder="AB:CD:…"></label>
      <div class="text-btns">
        <button class="text-btn" type="button" id="net-save">حفظ</button>
        <button class="text-btn" type="button" id="net-test">اختبار الاتصال</button>
      </div>
      <p class="status" id="net-msg" role="status"></p>
      <p class="muted">ملاحظة: الخادم الداخلي لم يُفعَّل بعد، فلن يتغيّر مصدر البيانات حتى يُربط.</p>
    </section>
    <section class="card" id="look">
      <h2>المظهر</h2>
      <p class="muted">كل لون قابل للتعديل على حدة. اجمع ألوانك في مجموعة باسم، واستعدها بنقرة.</p>
      <h3 class="subhead">الأدوار اللونية</h3>
      <div class="pal-roles" id="palette-roles"></div>
      <div class="text-btns"><button class="text-btn text-btn--muted" type="button" id="pal-reset">إعادة كل الألوان للافتراضي</button></div>
      <h3 class="subhead">مجموعاتي</h3>
      <div class="pal-saved" id="palette-saved"></div>
      <label class="look-row"><span>اسم المجموعة</span><input type="text" id="pal-name" maxlength="24" placeholder="مثال: الصيفية"></label>
      <div class="text-btns"><button class="text-btn" type="button" id="pal-save">حفظ الألوان الحالية</button></div>
      <h3 class="subhead">الشفافية والتوهج</h3>
      <label class="look-row"><span>شفافية الأيقونات <b id="ic-alpha-out">100%</b></span><input type="range" id="ic-alpha" min="10" max="100" step="5" value="100"></label>
      <label class="look-row"><span>توهج الكرة <b id="orb-glow-out">100%</b></span><input type="range" id="orb-glow" min="0" max="100" step="5" value="100"></label>
      <div class="text-btns"><button class="text-btn text-btn--muted" type="button" id="ic-reset">إعادة الشفافية والتوهج</button></div>
    </section>

    <section class="card" id="voice">
      <h2>صوت الردود</h2>
      <p class="muted">صوت قراءة ردود الذكاء.</p>
      <div class="radio-col" role="radiogroup" aria-label="محرك الصوت">
        <label class="switch"><input type="radio" name="engine" value="device" ${engine === 'device' ? 'checked' : ''}><span>صوت الجهاز</span></label>
        <label class="switch"><input type="radio" name="engine" value="gemini" ${engine === 'gemini' ? 'checked' : ''}><span>صوت Gemini الطبيعي</span></label>
      </div>
      <p class="muted" id="engine-note"></p>
      <p class="status" id="tts-cooldown" hidden></p>

      <div id="device-opts">
        <div id="device-voice-wrap">
        <label for="device-voice">صوت الجهاز</label>
        <select id="device-voice"><option value="">تلقائي</option></select>
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

    ${IS_BUNDLED && canUpdateApp() ? `<section class="card" id="app-update">
      <h2>تحديث التطبيق</h2>
      <p class="muted">الإصدار المثبّت: <b id="app-ver">${appVersion() || '؟'}</b>. التحديث ينزّل التغييرات في الواجهة فقط، دون تنزيل APK جديد.</p>
      <div class="row"><button class="btn" id="app-update-btn">⬇️ تحديث التطبيق الآن</button></div>
      <p class="status" id="app-update-msg" role="status"></p>
    </section>` : ''}
    <section class="card" id="usage">
      <h2>استهلاك Gemini اليوم</h2>
      <div id="usage-table"></div>
      <p class="muted">الحدود المجانية تختلف لكل نوع وتتغير من Google. نماذج الصوت حصتها أصغر بكثير.
      للتوفير: صوت الجهاز بدل صوت Gemini، ومايك لوحة المفاتيح 🎤 بدل 🎙.</p>
    </section>

    <section class="card" id="local">
      <h2>الذكاء على الجهاز</h2>
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
        <button class="btn btn--ghost" id="ai-check-btn">🔍 فحص الذكاء (دون إنترنت)</button>
      </div>
      <pre class="ai-check" id="ai-check" dir="ltr" hidden></pre>
      <p class="status" id="local-status" role="status"></p>
      <p class="muted">على الجهاز يعمل: المحادثة والتصنيف. وتبقى من Gemini: الملخصات، وأسماء المجموعات، وتحويل 🎙 إلى نص (استخدم مايك لوحة المفاتيح دون إنترنت)، وصوت Gemini الافتراضي.</p>
    </section>

    <section class="card" id="gemini">
      <h2>مفتاح Gemini API</h2>
      <p class="muted">يُحفظ المفتاح على جهازك فقط، ويُستخدم للمحادثة والتصنيف.</p>
      <div class="key-official" id="key-official" hidden>
        <p><b>للمسؤول:</b> سمح لك رئيس القسم بالمساعد. ضع هنا <b>مفتاحك الخاص</b> من حساب Google الخاص بك (لا مفتاح المؤسسة)، فيعمل المساعد على جوالك مباشرة:</p>
        <ol>
          <li>افتح <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> وادخل بحساب Google.</li>
          <li>اضغط <b>Create API key</b> ثم انسخ المفتاح (يبدأ بـ AIza).</li>
          <li>الصقه في الخانة أدناه واضغط <b>اختبار</b>.</li>
        </ol>
        <p class="muted">مجاني ضمن حد يومي. إن فقدت جوالك فألغِ المفتاح من الصفحة نفسها بلمسة. لاحقاً يمكن أن يعطيك خادم المؤسسة مفتاحاً بدله.</p>
      </div>
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
      <h3 class="subhead">الإدخال الصوتي</h3>
      <label class="switch">
        <input type="checkbox" id="mic-on" ${micOn ? 'checked' : ''} ${canListen ? '' : 'disabled'}>
        <span>زر الميكروفون في المحادثة (تكلّم بدل الكتابة)</span>
      </label>
      ${canListen ? '' : '<p class="muted">متصفحك لا يسمح بتسجيل الصوت.</p>'}
      <h3 class="subhead">الردود</h3>
      <div class="radio-row" role="radiogroup" aria-label="الردود">
        <label class="switch"><input type="radio" name="mode-talk" value="both" ${textOnly ? '' : 'checked'}><span>نص وصوت</span></label>
        <label class="switch"><input type="radio" name="mode-talk" value="text" ${textOnly ? 'checked' : ''}><span>نص فقط 🔇</span></label>
      </div>
      <p class="muted">"نص فقط" يوقف نطق الردود تماماً ويُخفي زر الصوت. الميكروفون يبقى حسب الخيار أعلاه.</p>
      <label class="switch">
        <input type="checkbox" id="speak" ${speakOn ? 'checked' : ''} ${canSpeak ? '' : 'disabled'}>
        <span>المساعد ينطق ردوده بصوت (اضبطه من "صوت المساعد")</span>
      </label>
      <label class="switch">
        <input type="checkbox" id="memory" ${memoryOn ? 'checked' : ''}>
        <span>المساعد يستعين بملاحظاتي في ردوده</span>
      </label>
      <p class="muted">يبحث التطبيق في ملاحظاتك على جهازك، ويرفق مع رسالتك أقرب ٥ ملاحظات صلة بها فقط، لتقترح المساعد حلولاً مبنية على ما دوّنته.</p>
      <h3 class="subhead">التعرف على كلامك 🎙</h3>
      <label class="switch">
        <input type="checkbox" id="voice-review" ${voiceReview ? 'checked' : ''}>
        <span>أراجع النص المسموع قبل إرساله (بدل الإرسال فور الإفلات)</span>
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
      <div id="struct-backup" hidden>
        <h3 class="subhead">نسخة احتياطية للهيكل</h3>
        <p class="muted" id="sb-info"></p>
        <p class="muted">الهيكل (الكرات والأشخاص والمناصب) على جوالك وحده. تُحفظ نسخته في ملف مشفّر بكلمة سر تختارها.</p>
        <label for="sb-pass">كلمة سر النسخة (٨ أحرف على الأقل)</label>
        <input id="sb-pass" type="password" dir="ltr" autocomplete="new-password">
        <div class="row">
          <button class="btn" id="sb-save" type="button">حفظ في التنزيلات</button>
          <button class="btn btn--ghost" id="sb-share" type="button" hidden>مشاركة (اختر المكان)</button>
          <label class="btn btn--ghost file-btn">📄 استعادة الهيكل…<input type="file" id="sb-file" accept=".smorg,application/json" hidden></label>
        </div>
        <p class="status" id="sb-msg" role="status"></p>
      </div>

      <h3 class="subhead">استيراد نسخة</h3>
      <div class="radio-row" role="radiogroup" aria-label="طريقة الاستيراد">
        <label class="switch"><input type="radio" name="mode" value="merge" checked><span>دمج مع الموجود</span></label>
        <label class="switch"><input type="radio" name="mode" value="replace"><span>استبدال الكل</span></label>
      </div>
      <div class="row">
        <label class="btn btn--ghost file-btn">📄 اختيار ملف…
          <input type="file" id="import" accept=".zip,application/zip,.json,application/json" hidden>
        </label>
      </div>
      <p class="status" id="backup-status" role="status"></p>

      <h3 class="subhead">لقطات على الجهاز</h3>
      <p class="muted">يحفظ التطبيق لقطة يومية تلقائياً (آخر ٧)، لتستعيد ما حذفته بالخطأ. هذه اللقطات لا تحميك إن مُسح المتصفح، فاحفظ ملف ZIP بين حين وآخر.</p>
      <ul class="snaps" id="snaps"></ul>
    </section>

    <section class="card" id="privacy">
      <h2>الخصوصية</h2>
      <p class="muted">كل ملاحظاتك محفوظة على هذا الجهاز. لا يُرسل شيء للخارج إلا إلى Gemini: نص المحادثة الأخيرة، وتسجيلك الصوتي لتحويله إلى نص (إن استخدمت 🎙)، والملاحظات القليلة ذات الصلة بها (إن فعّلت ذلك)، وما تطلب تلخيصه.</p>
      <div class="row">
        <button class="btn btn--danger" id="wipe">مسح كل البيانات</button>
      </div>
      <p class="status" id="wipe-status" role="status"></p>
    </section>
  `;
  // الموظف: لا مساعد ولا عقل ولا ذكاء؛ نُبقي الحساب والمظهر والتثبيت والخصوصية فقط
  if (await getSetting('orgRole', null) === 'employee') {
    const keep = new Set(['account', 'org', 'look', 'install', 'privacy', 'dev', 'network']); // dev: أدوات المطوّر في نسخة التجربة
    // المسؤول المسموح له بالمساعد: يضع مفتاحه الخاص (الموظف العادي لا مفتاح على جواله)
    const { startGroupSync, waitBranch } = await import('../group.js');
    await startGroupSync().catch(() => {});
    if ((await waitBranch())?.perms?.assistant) { keep.add('gemini'); root.querySelector('#key-official').hidden = false; }
    root.querySelectorAll(':scope > section.card').forEach((sec) => { if (!keep.has(sec.id)) sec.hidden = true; });
  }
  // بطاقة الحساب: لكل أعضاء المؤسسة
  if (await getSetting('orgRole', null)) { const { renderAccountCard } = await import('../account-card.js'); renderAccountCard(root); }
  // نسخة الهيكل: لرئيس القسم فقط
  if (await getSetting('orgRole', null) === 'manager') {
    root.querySelector('#struct-backup').hidden = false;
    const { bindStructureBackup, canShareStructure } = await import('../org-backup.js');
    bindStructureBackup(root);
    if (canShareStructure()) root.querySelector('#sb-share').hidden = false;
  }
  const openGroup = groupSettings(root);
  if (IS_DEV) renderDevTools(root.querySelector('#dev-body')).catch((e) => { root.querySelector('#dev-body').textContent = e.message; });
  // رابط مباشر إلى قسم (مثل #/settings?local) يفتحه
  const target = ['backup', 'talk', 'floating', 'local', 'voice', 'install'].find((id) => location.hash.includes(id));
  if (target) openGroup(root.querySelector(`#${target}`));

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


  bindAppUpdate(root);
  bindLook(root);
  bindNetwork(root);
  root.querySelector('#ai-check-btn').addEventListener('click', async () => {
    const { aiCheck } = await import('../ai-check.js');
    const out = root.querySelector('#ai-check');
    out.hidden = false;
    out.textContent = 'أفحص…';
    out.textContent = await aiCheck();
  });

  // ---- الذكاء على الجهاز ----
  const modelsEl = root.querySelector('#models');
  const localStatus = root.querySelector('#local-status');
  const curMode = await aiMode();
  root.querySelector(`input[name="ai-mode"][value="${curMode}"]`).checked = true;
  root.querySelectorAll('input[name="ai-mode"]').forEach((r) => r.addEventListener('change', () => setSetting('aiMode', r.value)));
  let chosen = await getSetting('localModel', '');
  const hasGpu = await webgpuSupported();
  const hasF16 = hasGpu && await shaderF16Supported();
  root.querySelector('#gpu-state').textContent = !hasGpu
    ? 'متصفحك لا يدعم WebGPU، فتتاح نماذج "للمعالج" فقط (أبطأ). جرّب أحدث Chrome إن أمكن.'
    : hasF16
      ? 'جوالك يدعم WebGPU ✓ فتعمل النماذج بسرعة على كرت الشاشة.'
      : 'جوالك يدعم WebGPU ✓ لكن كرت شاشته لا يدعم ميزة shader-f16، فتُستخدم تلقائياً نسخ متوافقة من Qwen (Gemma 3 غير متاح).';
  // حالة كل تنزيل: من الخلفية (Background Fetch) أو داخل الصفحة؛ تبقى حتى لو خرجت من هذه الشاشة
  const bgWatch = new Map(); // id ← تسجيل التنزيل في الخلفية
  const pct = (f) => `${Math.round(f * 100)}%`;

  function showProgress(id, f, label) {
    const r = modelsEl.querySelector(`[data-model="${id}"]`);
    if (!r) return;
    r.querySelector('.progress').hidden = false;
    r.querySelector('.progress span').style.width = pct(f);
    r.querySelector('.model__state').textContent = `${label} ${pct(f)}`;
  }

  function watchBackground(m, bg) {
    if (bgWatch.has(m.id)) return;
    bgWatch.set(m.id, bg);
    const onProgress = () => {
      const f = bg.downloadTotal ? bg.downloaded / bg.downloadTotal : 0;
      if (bg.result === 'failure') {
        bgWatch.delete(m.id);
        localStatus.className = 'status status--err';
        const REASONS = {
          aborted: 'أُلغي التنزيل',
          'bad-status': 'الخادم رفض أحد الملفات',
          'fetch-error': 'انقطع الاتصال',
          'quota-exceeded': 'لا توجد مساحة كافية في الجوال',
          'download-total-exceeded': 'حجم الملفات أكبر من المتوقع',
        };
        localStatus.textContent = `توقف تنزيل ${m.label}: ${REASONS[bg.failureReason] || bg.failureReason || 'خطأ'}. اضغط "استئناف" ليكمل من حيث توقف.`;
        renderModels();
        return;
      }
      showProgress(m.id, Math.min(0.99, f), 'يُنزَّل في الخلفية… يمكنك الخروج من التطبيق.');
    };
    bg.addEventListener('progress', onProgress);
    onProgress();
  }

  const blockedFor = Object.fromEntries(await Promise.all(LOCAL_MODELS.map(async (m) => [m.id, await blockedReason(m)])));
  async function renderModels() {
    const rows = await Promise.all(LOCAL_MODELS.map(async (m) => ({
      m, ready: await isModelReady(m), bg: await backgroundDownload(m), page: inPageDownload(m.id),
    })));
    modelsEl.innerHTML = rows.map(({ m, ready, bg, page }) => {
      const blocked = blockedFor[m.id];
      const busy = !ready && (!!bg || !!page);
      return `
      <li class="model ${m.id === chosen ? 'is-chosen' : ''} ${blocked ? 'is-blocked' : ''}" data-model="${m.id}">
        <label class="switch">
          <input type="radio" name="local-model" value="${m.id}" ${m.id === chosen ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
          <span><b>${m.label}</b>${m.recommended ? ' <span class="tag">موصى به</span>' : ''}<br>
            <span class="muted">${m.note} التنزيل ~${m.sizeMB >= 1000 ? `${(m.sizeMB / 1000).toFixed(1)} جيجا` : `${m.sizeMB} ميغا`}${m.gpuMB ? ` · يحتاج نحو ${(m.gpuMB / 1000).toFixed(1)} جيجا من ذاكرة كرت الشاشة` : ' · يعمل على المعالج'}.</span></span>
        </label>
        <div class="progress" ${busy ? '' : 'hidden'}><span style="width:${page ? pct(page.f) : '0%'}"></span></div>
        <p class="muted model__state">${blocked ? blocked : ready ? 'مُنزَّل ✓' : busy ? 'جارٍ التنزيل…' : ''}</p>
        <div class="row">
          ${!ready && !blocked && !busy ? '<button class="btn btn--ghost" data-act="dl">⬇️ نزّل</button>' : ''}
          ${bg && !ready ? '<button class="btn btn--ghost" data-act="cancel">إلغاء التنزيل</button>' : ''}
          ${ready ? '<button class="btn btn--ghost" data-act="rm">حذف</button>' : ''}
        </div>
      </li>`;
    }).join('');
    rows.forEach(({ m, bg, ready }) => { if (bg && !ready) { bgWatch.delete(m.id); watchBackground(m, bg); } });
  }
  await renderModels();

  // تنزيل لم يكتمل تثبيته (انقطع، أو اكتمل في الخلفية لكن بعض ملفاته لم تُحفظ)؟ نشخّصه ونعرض إكماله
  async function diagnose(model) {
    if (!model || inPageDownload(model.id) || await isModelReady(model)) return;
    const [check, report] = await Promise.all([missingFiles(model), backgroundReport(model)]);
    const why = report?.failed?.length
      ? ` (رفض الحفظ ${report.failed.length} ملف${report.failed[0].type === 'opaque' ? '، الخادم لم يسمح بقراءتها في الخلفية' : report.failed[0].status ? `، رمز ${report.failed[0].status}` : ''})`
      : '';
    const count = check ? `${check.missing.length} من ${check.total} ملفات ناقصة` : 'بعض الملفات ناقصة';
    localStatus.className = 'status status--err';
    localStatus.innerHTML = `${model.label} لم يكتمل تثبيته: ${count}${why}. <button class="link-btn" id="fix-dl">أكمل الملفات الناقصة</button>`;
    localStatus.querySelector('#fix-dl').onclick = () => {
      localStatus.className = 'status';
      localStatus.textContent = 'أكمل الملفات الناقصة داخل التطبيق، أبقِه مفتوحاً قليلاً (ما حُفظ سابقاً لن يُنزَّل مرة أخرى)…';
      downloadInPage(model).catch(() => {});
      renderModels();
    };
  }
  const stalled = await interruptedDownload();
  if (stalled) diagnose(stalled);

  // تقدّم التنزيل داخل الصفحة يصل إلى هذه الشاشة حتى لو بدأ قبل فتحها
  const onPageProgress = (e) => showProgress(e.detail.id, e.detail.f, 'جارٍ التنزيل والتجهيز…');
  const onPageDone = async (e) => {
    const m = LOCAL_MODELS.find((x) => x.id === e.detail.id);
    localStatus.className = e.detail.error ? 'status status--err' : 'status status--ok';
    localStatus.textContent = e.detail.error ? `تعذّر تجهيز ${m.label}: ${e.detail.error.message || e.detail.error}` : `${m.label} جاهز على جهازك ✓`;
    renderModels();
  };
  // عامل الخدمة يخبرنا حين يكتمل التنزيل في الخلفية
  const onSwMessage = (e) => {
    if (!/^bgfetch-/.test(e.data?.type || '')) return;
    const m = LOCAL_MODELS.find((x) => `model:${x.id}` === e.data.id);
    if (!m) return;
    bgWatch.delete(m.id);
    // نتحقق فعلاً أن المكتبة تجد النموذج، لا نكتفي بقول "اكتمل"
    (async () => {
      await renderModels();
      if (await isModelReady(m)) {
        localStatus.className = 'status status--ok';
        localStatus.textContent = `اكتمل تنزيل ${m.label} ✓ سيُجهَّز عند أول استخدام.`;
      } else {
        diagnose(m);
      }
    })();
  };
  downloads.addEventListener('progress', onPageProgress);
  downloads.addEventListener('done', onPageDone);
  navigator.serviceWorker?.addEventListener('message', onSwMessage);
  cleanup.push(() => {
    downloads.removeEventListener('progress', onPageProgress);
    downloads.removeEventListener('done', onPageDone);
    navigator.serviceWorker?.removeEventListener('message', onSwMessage);
  });

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
    if (act === 'cancel') {
      await cancelBackgroundDownload(m);
      bgWatch.delete(m.id);
      renderModels();
      return;
    }
    const resuming = (await interruptedDownload())?.id === m.id;
    if (!resuming && !confirm(`سيُنزَّل ${m.label} (~${m.sizeMB} ميغا). يُفضَّل Wi-Fi. متابعة؟`)) return;
    if (!chosen) { chosen = m.id; await setSetting('localModel', chosen); }
    localStatus.className = 'status';
    // الطريقة الأفضل: تنزيل يتولاه المتصفح في الخلفية ويستمر بعد الخروج من التطبيق
    if (canBackgroundFetch) {
      try {
        localStatus.textContent = 'أجهّز قائمة الملفات…';
        const bg = await startBackgroundDownload(m);
        localStatus.textContent = 'بدأ التنزيل في الخلفية ✓ ستجد إشعاره في شريط الجوال، ويستمر حتى لو أغلقت التطبيق.';
        await renderModels();
        watchBackground(m, bg);
        return;
      } catch (err) {
        if (err.code === 'ALREADY') { localStatus.textContent = err.message; renderModels(); return; }
        localStatus.textContent = `تعذّر التنزيل في الخلفية (${err.message || err})، أنزّله داخل التطبيق بدلاً من ذلك.`;
      }
    } else {
      localStatus.textContent = 'متصفحك لا يدعم التنزيل في الخلفية: أبقِ التطبيق مفتوحاً (يمكنك التنقل بين شاشاته، وسأبقي الشاشة مضاءة).';
    }
    downloadInPage(m).catch(() => {});
    renderModels();
  });

  root.querySelector('#local-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    localStatus.className = 'status';
    localStatus.textContent = 'أحمّل النموذج وأسأله…';
    const t0 = performance.now();
    retryGpu(); // تجربة صريحة: نمنح كرت الشاشة فرصة جديدة
    try {
      const reply = await localChat([
        { role: 'system', content: 'أنت مساعد ذكي. أجب بالعربية بجملة واحدة.' },
        { role: 'user', content: 'عرّفي نفسك باختصار.' },
      ], { maxTokens: 80, onToken: (t) => { localStatus.textContent = t; } });
      localStatus.className = 'status status--ok';
      localStatus.textContent = `${reply} (${((performance.now() - t0) / 1000).toFixed(1)} ث)`;
    } catch (err) {
      localStatus.className = 'status status--err';
      localStatus.textContent = explainError(err);
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
    renderCooldown();
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

  root.querySelector('#mic-on').addEventListener('change', (e) => setSetting('micOn', e.target.checked));
  root.querySelector('#speak').addEventListener('change', (e) => setSetting('speakReplies', e.target.checked));
  root.querySelector('#memory').addEventListener('change', (e) => setSetting('useMemory', e.target.checked));
  root.querySelectorAll('input[name="mode-talk"]').forEach((r) => r.addEventListener('change', async () => {
    const only = r.value === 'text';
    await setSetting('textOnly', only);
    if (only) stopSpeaking();
    root.querySelector('#speak').disabled = only;
  }));
  root.querySelector('#speak').disabled = textOnly;
  root.querySelector('#voice-review').addEventListener('change', (e) => setSetting('reviewVoice', e.target.checked));
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
    // ملف الهيكل (.smorg) يُستعاد من زر «استعادة الهيكل» في قسم نسخة الهيكل، لا من هنا
    if (/\.smorg$/i.test(file.name)) { show(backupMsg, 'هذا ملف نسخة الهيكل. استعده من زر «استعادة الهيكل…» أعلاه (في قسم نسخة الهيكل).', false); return; }
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
  cleanup.splice(0).forEach((fn) => fn());
}

// ---- أدوات المطوّر (نسخة التجربة فقط) ----
async function renderDevTools(box) {
  const { devAccounts, seedDemoOrg, switchTo } = await import('../dev-tools.js');
  const { session } = await import('../cloud.js');
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const s = await session().catch(() => null);
  const acc = await devAccounts();
  const me = s?.member?.username;
  const all = acc ? [{ ...acc.manager, role: 'المدير' }, ...acc.people.map((p) => ({ ...p, role: p.label || 'موظف' }))] : [];
  box.innerHTML = `
    <p class="muted">هذه الأدوات في نسخة التجربة وحدها، وحساباتها وهمية في مشروع Firebase التجريبي.</p>
    <h3 class="subhead">الدخول كـ</h3>
    ${all.length ? `<ul class="rep-list">${all.map((a, i) => `<li><span><b>${esc(a.name)}</b><small>${a.role} · ${esc(a.username)}</small></span>
      ${a.username === me ? '<span class="muted">الحالي</span>' : `<button type="button" class="text-btn" data-as="${i}">ادخل</button>`}</li>`).join('')}</ul>`
      : '<p class="muted">أنشئ المؤسسة التجريبية أولاً لتظهر الحسابات هنا.</p>'}
    <p class="muted">قريباً مع الصلاحيات المتدرجة (A13): مسؤول شعبة، مسؤول وحدة، معاون، الذاتية.</p>
    <h3 class="subhead">المؤسسة التجريبية</h3>
    ${s?.member?.role === 'manager' ? `
      <p class="muted">تُنشئ ٥ موظفين وهميين، وهيكلاً بشعبتين ووحداتهما ومشروعاً، وأعمالاً ونقاطاً ومنشورات. يمكن تشغيلها مرة أخرى بأمان.</p>
      <label class="org-field"><span>كلمة مرور حسابك (المدير) للعودة إليه من "الدخول كـ"</span>
        <input type="password" id="dev-pass" autocomplete="current-password" dir="ltr"></label>
      <button type="button" class="text-btn" id="dev-seed">إنشاء المؤسسة التجريبية</button>
      <p class="status" id="dev-msg" role="status"></p>`
      : '<p class="muted">ادخل بحساب المدير في نسخة التجربة لإنشائها.</p>'}`;
  box.querySelectorAll('[data-as]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    b.textContent = 'لحظة…';
    try { await switchTo(all[Number(b.dataset.as)]); } catch (err) { b.textContent = err.message; }
  }));
  box.querySelector('#dev-seed')?.addEventListener('click', async (e) => {
    const msg = box.querySelector('#dev-msg');
    const pass = box.querySelector('#dev-pass').value;
    if (!pass) { msg.textContent = 'اكتب كلمة مرور حسابك أولاً.'; msg.className = 'status status--err'; return; }
    e.currentTarget.disabled = true;
    try {
      const n = await seedDemoOrg({ managerPassword: pass }, (t) => { msg.className = 'status'; msg.textContent = t; });
      msg.className = 'status status--ok';
      msg.textContent = `جاهزة ✓ ${n} موظفين وهيكل وأعمال ومنشورات. افتح عقل المؤسسة والمجموعة لتراها.`;
      setTimeout(() => renderDevTools(box), 1500);
    } catch (err) {
      msg.className = 'status status--err';
      msg.textContent = err.message;
      e.currentTarget.disabled = false;
    }
  });
}

// المظهر: كل دور لونه، والمجموعات المحفوظة، والشفافية والتوهج
async function bindLook(root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wrap = root.querySelector('#palette-roles');
  const saved = root.querySelector('#palette-saved');
  if (!wrap || !saved) return;
  const colorOf = async (r) => { const s = await getSetting(r.setting, ''); return isHex(s) ? s : r.def; };
  const paintRoles = async () => {
    const rows = await Promise.all(ROLES.map(async (r) => {
      const v = await colorOf(r);
      return `<label class="pal-row"><span class="pal-row__sw" style="background:${v}"></span><span class="pal-row__txt"><b>${r.label}</b><small>${r.hint}</small></span><span class="pal-row__hex" dir="ltr">${v.toUpperCase()}</span><input type="color" dir="ltr" data-role="${r.key}" value="${v}" aria-label="لون ${r.label}"></label>`;
    }));
    wrap.innerHTML = rows.join('');
  };
  const paintSaved = async () => {
    const list = (await getSetting('palettes', [])) || [];
    saved.innerHTML = list.length
      ? list.map((p, i) => `<span class="pal-chip"><button type="button" class="pal-chip__go" data-apply="${i}">${esc(p.name)}</button><button type="button" class="pal-chip__del" data-del="${i}" aria-label="حذف ${esc(p.name)}">×</button></span>`).join('')
      : '<p class="muted">لا مجموعات محفوظة بعد.</p>';
  };
  await paintRoles();
  await paintSaved();

  // لون واحد: يُحفظ ويُطبَّق فوراً على التطبيق كله
  wrap.addEventListener('input', async (e) => {
    const inp = e.target.closest('input[data-role]');
    if (!inp) return;
    const r = roleOf(inp.dataset.role);
    const v = inp.value;
    await setSetting(r.setting, v);
    applyRole(r, v);
    const row = inp.closest('.pal-row');
    row.querySelector('.pal-row__sw').style.background = v;
    row.querySelector('.pal-row__hex').textContent = v.toUpperCase();
  });
  root.querySelector('#pal-reset').addEventListener('click', async () => {
    for (const r of ROLES) { await deleteSetting(r.setting); clearRole(r); }
    await paintRoles();
  });
  root.querySelector('#pal-save').addEventListener('click', async () => {
    const name = root.querySelector('#pal-name').value.trim();
    if (!name) return;
    const colors = {};
    for (const r of ROLES) colors[r.setting] = await colorOf(r);
    const list = (await getSetting('palettes', [])) || [];
    await setSetting('palettes', [...list.filter((p) => p.name !== name), { name, colors }]);
    root.querySelector('#pal-name').value = '';
    await paintSaved();
  });
  saved.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    const go = e.target.closest('[data-apply]');
    const list = (await getSetting('palettes', [])) || [];
    if (del) {
      await setSetting('palettes', list.filter((_, i) => i !== Number(del.dataset.del)));
      return paintSaved();
    }
    if (go) {
      const p = list[Number(go.dataset.apply)];
      if (!p) return;
      for (const r of ROLES) {
        const v = p.colors?.[r.setting];
        if (isHex(v)) { await setSetting(r.setting, v); applyRole(r, v); }
      }
      await paintRoles();
    }
  });

  // الشفافية والتوهج
  const a = root.querySelector('#ic-alpha');
  const ao = root.querySelector('#ic-alpha-out');
  const g = root.querySelector('#orb-glow');
  const go2 = root.querySelector('#orb-glow-out');
  const alpha = Number(await getSetting('iconAlpha', 100)) || 100;
  const glow = Number(await getSetting('orbGlow', 100));
  a.value = alpha; ao.textContent = `${alpha}%`;
  g.value = Number.isFinite(glow) ? glow : 100; go2.textContent = `${g.value}%`;
  a.addEventListener('input', () => { ao.textContent = `${a.value}%`; setSetting('iconAlpha', Number(a.value)); });
  g.addEventListener('input', () => { go2.textContent = `${g.value}%`; setSetting('orbGlow', Number(g.value)); });
  root.querySelector('#ic-reset').addEventListener('click', async () => {
    await deleteSetting('iconAlpha'); await deleteSetting('orbGlow');
    a.value = 100; ao.textContent = '100%'; g.value = 100; go2.textContent = '100%';
  });
}

// الشبكة: عناوين الخادم وطريقة الاتصال تُحفظ على الجهاز، ويُختبر الأساسي ثم البديل
async function bindNetwork(root) {
  const $ = (q) => root.querySelector(q);
  const mode = $('#net-mode'), s1 = $('#net-server'), s2 = $('#net-server2'), ident = $('#net-ident'), out = $('#net-msg');
  const addrType = $('#net-addr-type'), label = $('#net-server-label'), dhcpNote = $('#net-dhcp-note');
  if (!mode) return;
  mode.value = await getSetting('netMode', 'internet');
  addrType.value = await getSetting('netAddrType', 'static');
  const syncType = () => {
    const dhcp = addrType.value === 'dhcp';
    label.textContent = dhcp ? 'اسم الخادم الداخلي' : 'عنوان الخادم الأساسي (IP ثابت)';
    s1.placeholder = dhcp ? 'https://aqli.local' : 'https://192.168.1.10';
    dhcpNote.hidden = !dhcp;
  };
  syncType();
  addrType.addEventListener('change', syncType);
  s1.value = await getSetting('netServer', '');
  s2.value = await getSetting('netServer2', '');
  ident.value = await getSetting('netIdentity', '');
  const show = (t, ok = true) => { out.textContent = t; out.className = `status ${ok ? 'status--ok' : 'status--err'}`; };
  const clean = (v) => String(v || '').trim().replace(/\/+$/, '');
  $('#net-save').addEventListener('click', async () => {
    const a = clean(s1.value), b = clean(s2.value);
    if (mode.value === 'lan' && !/^https?:\/\//.test(a)) return show('اكتب عنوان الخادم الأساسي بصيغة https://…', false);
    if ((a && !/^https?:\/\//.test(a)) || (b && !/^https?:\/\//.test(b))) return show('العناوين تبدأ بـ https://', false);
    await setSetting('netMode', mode.value);
    await setSetting('netAddrType', addrType.value);
    await setSetting('netServer', a);
    await setSetting('netServer2', b);
    await setSetting('netIdentity', ident.value.trim().toUpperCase());
    show('تم الحفظ على هذا الجهاز ✓');
  });
  const probe = async (addr) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    try { const r = await fetch(`${addr}/health`, { signal: ctl.signal, cache: 'no-store' }); return r.ok; }
    catch { return false; }
    finally { clearTimeout(t); }
  };
  $('#net-test').addEventListener('click', async () => {
    const list = [clean(s1.value), clean(s2.value)].filter((x) => /^https?:\/\//.test(x));
    if (!list.length) return show('اكتب عنواناً أولاً.', false);
    show('أختبر الاتصال…');
    for (const addr of list) {
      if (await probe(addr)) return show(`الخادم يستجيب عبر ${addr} ✓`);
    }
    show('لا يستجيب أي عنوان. تحقق من الشبكة أو العنوان.', false);
  });
}

// زر تحديث التطبيق (داخل الـ APK فقط)
function bindAppUpdate(root) {
  const btn = root.querySelector('#app-update-btn');
  if (!btn) return;
  const msg = root.querySelector('#app-update-msg');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    msg.className = 'status';
    msg.textContent = 'أتحقق من التحديثات…';
    const off = startAppUpdate((ev) => {
      if (ev.type === 'uptodate') { msg.textContent = `التطبيق محدّث (الإصدار ${ev.version}) ✓`; btn.disabled = false; off(); }
      else if (ev.type === 'start') msg.textContent = `جارٍ تنزيل التحديث ${ev.version} (${ev.total} ملف)…`;
      else if (ev.type === 'progress') msg.textContent = `جارٍ التنزيل… ${ev.done} من ${ev.total}`;
      else if (ev.type === 'done') { msg.textContent = `تم التحديث إلى ${ev.version}. يُعاد تحميل التطبيق…`; off(); }
      else if (ev.type === 'error') { msg.className = 'status status--err'; msg.textContent = `تعذّر التحديث: ${ev.message}`; btn.disabled = false; off(); }
    });
  });
}
