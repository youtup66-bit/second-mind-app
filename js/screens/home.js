// شاشة المساعد: الشخصية الطافية + المحادثة صوتاً أو كتابة + تصنيف كل ملاحظة
import {
  addEntry, addMessage, getEntries, getEntry, getMessage, getMessages, getSetting, getSummaries,
  setSetting, updateEntry, updateMessage, deleteMessage, deleteEntry,
} from '../storage.js';
import { transcribe } from '../gemini.js';
import { smartChat } from '../ai.js';
import { exportChatFile } from '../backup.js';
import { editLastReport, reportFile, textReportFile, reportsContext } from '../report-build.js';
import { initConvs, activeConvId, listConvs, createConv, openConv, renameConv, deleteConv, touchConv, activeConvIsEmpty, pruneEmptyConvs } from '../storage.js';
import { chatTitle } from '../gemini.js';
import { saveFile, shareFile } from '../native-files.js';
import { executeActions } from '../actions.js';
import { setActionContext, setReportsContext } from '../actions-spec.js';
import { orgContext } from '../org-actions.js';
import { CATEGORIES, NONE, categoryById } from '../categories.js';
import { classifyEntry, classifyPending, setCategory } from '../classifier.js';
import { recall } from '../recall.js';
import { canListen, canRecord, canBrowserListen, listen, record, speak, stopSpeaking, unlockAudio } from '../voice.js';

export const title = 'المساعد';

const TAP_LINES = ['أنا هنا معك 💜', 'بماذا تفكر الآن؟', 'احكِ لي، سأحفظ كل شيء.', 'هيهي، هذا يدغدغ!'];
const HISTORY_LIMIT = 20; // عدد الرسائل الأخيرة التي تُرسل كسياق

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'سهران؟ أنا معك.';
  if (h < 12) return 'صباح الخير! كيف تشعر اليوم؟';
  if (h < 18) return 'أهلاً! ماذا يدور في بالك؟';
  return 'مساء الخير، كيف كان يومك؟';
}

// الفقاعة فوق المساعد تعرض بداية الرد فقط؛ الرد كاملاً في المحادثة
function bubbleText(reply) {
  const first = reply.split(/\n/)[0];
  const cut = first.length > 140 ? `${first.slice(0, 140).replace(/\s+\S*$/, '')}…` : first;
  return cut + (cut.length < reply.length && !cut.endsWith('…') ? ' …' : '');
}

// مسودة خانة الكتابة (على هذا الجهاز فقط)
const DRAFT_KEY = 'sm-draft';
function saveDraft(text) {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* التخزين غير متاح */ }
}
function loadDraft() {
  try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
}

// أمر حفظ التقرير: كلمات الحفظ مع «تقرير» أو مع «بالتنزيلات»، ولا يُعدّ أمر تعديل
const SAVE_VERB = /(احفظ|صدّر|صدر|نزّل|نزل|حمّل|شارك)/;
const EDIT_WORDS = /(عدّل|عدل|غيّر|اجعل|أضف|احذف|اختصر|وسّع)/;
const isSaveReportCommand = (t) => t.length <= 120 && !EDIT_WORDS.test(t)
  && ((SAVE_VERB.test(t) && (/تقرير/.test(t) || /التنزيلات|جهازي/.test(t)))
    || (/تقرير/.test(t) && /التنزيلات|جهازي/.test(t)));

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let companion = null;
let stopListening = null;
let busy = false;

export async function mount(root) {
  const textOnly = await getSetting('textOnly', false);
  let speakOn = !textOnly && await getSetting('speakReplies', true);
  // الميكروفون مستقل عن "نص فقط" (الذي يوقف نطق الردود فقط)
  const showMic = canListen && await getSetting('micOn', true);
  // بلا مساعد: محادثة عادية مثل واتساب، دون شخصية ولا انسدال
  // تطبيق مؤسسة: محادثة عادية مثل واتساب دائماً، بلا شخصية مرسومة (الذكاء كما هو)
  const plain = true;

  await initConvs();
  root.innerHTML = `
    <section class="chat${plain ? ' chat--wa chat--plain' : ''}">
      <div class="conv-bar" id="conv-bar">
        <button type="button" class="conv-bar__btn" id="conv-new" aria-label="محادثة جديدة"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <span class="conv-bar__title" id="conv-title"></span>
        <button type="button" class="conv-bar__btn" id="conv-menu" aria-label="المحادثات السابقة"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
      <div class="conv-sheet" id="conv-sheet" hidden><ul class="conv-list" id="conv-list"></ul><a class="conv-settings" href="#/settings">⚙ الإعدادات والدخول إلى المؤسسة</a></div>
      <header class="wa-head" id="wa-head" hidden>
        <button type="button" class="wa-head__who" id="wa-who" aria-label="أظهر المساعد">
          <span class="wa-avatar" id="wa-avatar" aria-hidden="true"></span>
          <span class="wa-head__text"><b id="wa-name"></b><small id="wa-status">${plain ? 'متصل' : 'متصلة'}</small></span>
        </button>
        ${plain ? '<span class="wa-head__tools" id="wa-tools"></span>' : '<button type="button" class="wa-head__btn" id="wa-expand" aria-label="أظهر المساعد" title="أظهر المساعد">⌄</button>'}
      </header>
      <p class="wa-note" id="wa-note" hidden role="status"></p>
      <div class="chat__hero">
        <div class="chat__tools">
          <button type="button" class="tool" id="wa-on" title="واجهة محادثة بلا مساعد">💬 واجهة المحادثة</button>
          <button type="button" class="tool" id="voice-toggle" ${textOnly ? 'hidden' : ''}></button>
          <button type="button" class="tool tool--stop" id="stop-voice" hidden aria-label="أوقف الصوت">⏹ أوقف الصوت</button>
          ${textOnly ? '<a class="tool" href="#/settings?talk" title="غيّره من الإعدادات">🔇 ردود بلا صوت</a>' : ''}
        </div>
        <p class="bubble" id="bubble" role="status">${greeting()}</p>
        <div class="chat__stage" id="stage"></div>
      </div>
      <button type="button" class="chat__handle" id="handle" aria-label="اسحب لتطوي المساعد أو تنسدلها"><span></span></button>
      <ol class="chat__log" id="log" aria-label="المحادثة"></ol>
      <div class="composer__pending" id="ai-pending" hidden></div>
      <form class="composer" id="composer" autocomplete="off">
        <button type="button" class="composer__mic" id="mic" aria-label="تحدّث" ${showMic ? '' : 'hidden'}>🎙</button>
        <button type="button" class="composer__attach" id="ai-attach" aria-label="أرفق صورة">📎</button>
        <textarea id="input" rows="1" placeholder="اكتب ما في بالك..." aria-label="رسالتك"></textarea>
        <button type="button" class="composer__clear" id="clear" aria-label="مسح النص" hidden>✕</button>
        <button type="submit" class="composer__send" id="send" aria-label="إرسال">➤</button>
      </form>
      <div class="sheet" id="sheet" hidden>
        <div class="sheet__panel" role="dialog" aria-label="اختر القسم">
          <p class="sheet__title">إلى أي قسم تنتمي هذه الملاحظة؟</p>
          <div class="sheet__chips">
            ${[...CATEGORIES, NONE].map((c) => `
              <button type="button" class="chip" data-cat="${c.id}" style="--c:${c.color}">${c.label}</button>`).join('')}
          </div>
        </div>
      </div>
    </section>
  `;

  const bubble = root.querySelector('#bubble');
  const log = root.querySelector('#log');
  const form = root.querySelector('#composer');
  // صورة مرفقة مع الرسالة التالية (تُرسل إلى Gemini فقط)
  let pendingImage = null;
  const pendingEl = root.querySelector('#ai-pending');
  function showPending() {
    pendingEl.hidden = !pendingImage;
    pendingEl.innerHTML = pendingImage
      ? `<img src="${pendingImage}" alt="الصورة المرفقة"><button type="button" class="link-btn" id="ai-pending-x" aria-label="أزل الصورة">✕ أزل</button>`
      : '';
    pendingEl.querySelector('#ai-pending-x')?.addEventListener('click', () => { pendingImage = null; showPending(); });
  }
  root.querySelector('#ai-attach').addEventListener('click', () => {
    const pick = document.createElement('input');
    pick.type = 'file';
    pick.accept = 'image/*';
    Object.assign(pick.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(pick);
    pick.addEventListener('change', async () => {
      const f = pick.files?.[0];
      pick.remove();
      if (!f) return;
      try {
        const { compressImage } = await import('../group.js');
        pendingImage = await compressImage(f, 1024, 400_000);
        showPending();
      } catch (err) { say(`تعذّر تجهيز الصورة: ${err.message || err}`); }
    });
    try { pick.click(); } catch (err) { say(`تعذّر فتح نافذة الصور: ${err.message || err}`); }
  });
  const input = root.querySelector('#input');
  const mic = root.querySelector('#mic');
  const clearBtn = root.querySelector('#clear');
  const voiceToggle = root.querySelector('#voice-toggle');
  const stopVoiceBtn = root.querySelector('#stop-voice');
  let tapIdx = 0;

  // مساءً، إن كتبت أشياء كثيرة اليوم ولم تلخصه بعد، تقترح المساعد ملخصاً
  (async () => {
    if (new Date().getHours() < 19) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const today = (await getEntries()).filter((e) => e.createdAt >= start && e.category !== 'none').length;
    const done = (await getSummaries()).some((x) => x.kind === 'day' && x.createdAt >= start);
    if (today >= 3 && !done && bubble.isConnected) {
      bubble.innerHTML = `${greeting()} قلتَ لي أشياء كثيرة اليوم، <a href="#/folder?summaries">أجهّز لك ملخص يومك؟</a>`;
    }
  })();

  const skin = await getSetting('companionSkin', 'star');
  if (!root.isConnected) return;
  // حالة المحادثة فقط (تكتب، تستمع، تتكلم) تظهر في رأس المحادثة؛ لا شخصية مرسومة
  companion = { state: 'idle', destroy() {} };
  companion.setState = (st) => { companion.state = st; };

  let noteTimer = 0;
  function say(text) {
    bubble.classList.remove('is-shown');
    void bubble.offsetWidth;
    bubble.innerHTML = text;
    bubble.classList.add('is-shown');
    // في واجهة المحادثة الفقاعة مخفية؛ نعرض التنبيهات (لا الردود) كشريط صغير تحت الرأس
    if (waMode && !/class="dots"/.test(text) && text !== lastReplyBubble) {
      waNote.innerHTML = text;
      waNote.hidden = false;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { waNote.hidden = true; }, 7000);
    }
  }

  // ---- واجهة المحادثة (شبيهة بواتساب): المساعد تنسدل وتختفي، وتبقى المحادثة ----
  const chatEl = root.querySelector('.chat');
  const waNote = root.querySelector('#wa-note');
  let waMode = plain || (await getSetting('chatStyle', 'companion')) === 'whatsapp';
  let lastReplyBubble = '';
  // التطبيق للمؤسسة: المحادثة دائماً مع "المساعد"؛ ورئيس القسم يرجع منها إلى المحادثات
  const orgRole = await getSetting('orgRole', null);
  const orgHead = orgRole === 'manager' || orgRole === 'employee'; // المسؤول المسموح له بالمساعد يرجع إلى المحادثات أيضاً
  if (plain) {
    // أعلى المحادثة: أيقونة الصوت فقط (المساعد وكرته تظهران خارج هذه الشاشة)
    root.querySelector('#wa-who').style.display = 'none';
    root.querySelector('#wa-tools').append(root.querySelector('#stop-voice'), root.querySelector('#voice-toggle'));
  }
  function setWaMode(on) {
    if (plain) on = true; // المساعد مخفية نهائياً من الإعدادات
    waMode = on;
    chatEl.classList.toggle('chat--wa', on);
    root.querySelector('#wa-head').hidden = !on;
    if (!on) waNote.hidden = true;
    if (!plain) setSetting('chatStyle', on ? 'whatsapp' : 'companion');
    log.scrollTop = log.scrollHeight;
  }
  if (waMode) setWaMode(true);
  root.querySelector('#wa-on').addEventListener('click', () => setWaMode(true));
  // ---- الانسدال بالسحب ----
  // في وضع المساعد: اسحب المقبض للأعلى فتنطوي مع إصبعك. في واجهة المحادثة: اسحب الرأس أو المقبض للأسفل فتنسدل.
  const hero = root.querySelector('.chat__hero');
  const handle = root.querySelector('#handle');
  let pull = null;
  const fullHeight = () => {
    const prev = hero.style.maxHeight;
    hero.style.maxHeight = 'none';
    const h = hero.scrollHeight;
    hero.style.maxHeight = prev;
    return h || 320;
  };
  function startPull(e) {
    if (plain) return;
    pull = { y0: e.clientY, full: fullHeight(), from: waMode ? 'wa' : 'companion', moved: false, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    hero.style.transition = 'none';
    // في واجهة المحادثة نُظهر المساعد مطويّة لتنسدل من تحت الرأس
    if (waMode) { hero.style.maxHeight = '0px'; hero.style.opacity = '0'; chatEl.classList.add('is-pulling'); }
  }
  function movePull(e) {
    if (!pull || e.pointerId !== pull.id) return;
    const dy = e.clientY - pull.y0;
    if (Math.abs(dy) > 6) pull.moved = true;
    if (!pull.moved) return;
    // ارتفاع المساعد يتبع الإصبع
    const h = pull.from === 'companion' ? Math.max(0, pull.full + Math.min(0, dy)) : Math.min(pull.full, Math.max(0, dy));
    hero.style.maxHeight = `${h}px`;
    hero.style.opacity = String(Math.min(1, h / (pull.full * 0.6)));
    pull.ratio = h / pull.full;
  }
  function endPull(e) {
    if (!pull || e.pointerId !== pull.id) return;
    const { from, moved, ratio = from === 'wa' ? 0 : 1 } = pull;
    pull = null;
    hero.style.transition = '';
    chatEl.classList.remove('is-pulling');
    // لمسة دون سحب: تبديل مباشر. سحب: نكمل إن تجاوز الثلث، وإلا نعود
    const collapse = !moved ? from === 'companion' : (from === 'companion' ? ratio < 0.66 : ratio < 0.34);
    requestAnimationFrame(() => {
      hero.style.maxHeight = '';
      hero.style.opacity = '';
      setWaMode(collapse);
    });
  }
  for (const el of [handle, root.querySelector('#wa-who'), root.querySelector('#wa-expand')].filter(Boolean)) {
    el.addEventListener('pointerdown', startPull);
    el.addEventListener('pointermove', movePull);
    el.addEventListener('pointerup', endPull);
    el.addEventListener('pointercancel', endPull);
  }
  // الحالة في الرأس تتبع حالة المساعد
  const STATUS = plain
    ? { thinking: 'يكتب…', listening: 'يستمع…', talking: 'يتكلم…' }
    : { thinking: 'تكتب…', listening: 'تستمع…', talking: 'تتكلم…' };
  const waStatus = root.querySelector('#wa-status');
  const origSetState = companion.setState;
  companion.setState = (st) => {
    origSetState(st);
    // "تتكلم…" فقط حين يُسمع صوت فعلاً (زر الإيقاف ظاهر)، لا في حركة الفم الصامتة
    const label = st === 'talking' && stopVoiceBtn.hidden ? null : STATUS[st];
    waStatus.textContent = label || (plain ? 'متصل' : 'متصلة');
    waStatus.classList.toggle('is-active', !!label);
  };

  // ---- التحكم في الصوت ----
  const renderVoiceToggle = () => {
    voiceToggle.textContent = plain ? (speakOn ? '🔊' : '🔇') : (speakOn ? '🔊 الصوت يعمل' : '🔇 بلا صوت');
    voiceToggle.title = speakOn ? 'الصوت يعمل' : 'بلا صوت';
    voiceToggle.setAttribute('aria-pressed', String(speakOn));
  };
  renderVoiceToggle();
  voiceToggle.addEventListener('click', async () => {
    speakOn = !speakOn;
    await setSetting('speakReplies', speakOn);
    if (!speakOn) stopVoice();
    renderVoiceToggle();
  });

  const setTalking = (on) => {
    stopVoiceBtn.hidden = !on;
    if (on) companion?.setState('talking');
    else if (companion?.state === 'talking') companion.setState('idle');
  };
  function stopVoice() {
    stopSpeaking();
    setTalking(false);
  }
  stopVoiceBtn.addEventListener('click', stopVoice);


  // ---- عرض الرسائل ----
  const fmtTime = new Intl.DateTimeFormat('ar', { hour: 'numeric', minute: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long' });
  let lastDay = '';
  function dayLabel(t) {
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86_400_000);
    return diff === 0 ? 'اليوم' : diff === 1 ? 'أمس' : fmtDay.format(t);
  }
  function append(msg, { entry = null, used = [], pending = false } = {}) {
    const t = msg.createdAt || Date.now();
    const dk = new Date(t).toDateString();
    if (dk !== lastDay) {
      lastDay = dk;
      const sep = document.createElement('li');
      sep.className = 'wa-day';
      sep.textContent = dayLabel(t);
      log.append(sep);
    }
    const li = document.createElement('li');
    li.className = `msg msg--${msg.role}${pending ? ' msg--pending' : ''}`;
    if (msg.id) li.dataset.id = msg.id;
    li.dataset.role = msg.role;
    if (msg.image && /^data:image\//.test(msg.image)) {
      const im = document.createElement('img');
      im.className = 'msg__img';
      im.src = msg.image;
      im.alt = 'صورة مرفقة';
      li.append(im);
    }
    const body = document.createElement('span');
    body.className = 'msg__text';
    body.textContent = msg.text;
    li.append(body);
    if (used.length) renderUsed(li, used);
    if (entry) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip chip--small';
      chip.dataset.entry = entry.id;
      li.append(chip);
      renderChip(chip, entry);
    }
    const time = document.createElement('span');
    time.className = 'msg__time';
    time.textContent = fmtTime.format(t) + (msg.role === 'user' ? ' ✓✓' : '');
    li.append(time);
    log.append(li);
    log.closest('.chat').classList.add('chat--active');
    log.scrollTop = log.scrollHeight;
    return li;
  }

  // "استعنتُ بملاحظاتك": يوضح أي ملاحظات قرأتها المساعد قبل ردها
  function renderUsed(li, used) {
    li.querySelector('.used')?.remove();
    if (!used.length) return;
    const box = document.createElement('details');
    box.className = 'used';
    box.innerHTML = `<summary>📎 استعنتُ بـ${used.length === 1 ? 'ملاحظة واحدة' : ` ${used.length} من ملاحظاتك`}</summary>
      <ul>${used.map((e) => {
        const c = categoryById(e.category);
        return `<li><span class="used__dot" style="background:${c ? c.color : 'var(--muted)'}"></span>${escapeHtml(e.meta?.title || e.text.slice(0, 50))}</li>`;
      }).join('')}</ul>`;
    li.querySelector('.msg__text').after(box);
  }

  function renderChip(chip, entry) {
    const c = categoryById(entry?.category);
    chip.classList.toggle('is-pending', !c);
    chip.classList.remove('is-waiting');
    chip.style.setProperty('--c', c ? c.color : 'var(--muted)');
    chip.textContent = c ? c.label : 'يُصنَّف…';
    chip.title = entry?.meta?.title || '';
  }

  // لم يُصنَّف الآن (لا ذكاء متاح)؛ يُصنَّف تلقائياً حين يتوفر
  function waitChip(id) {
    const chip = log.querySelector(`.chip[data-entry="${id}"]`);
    if (!chip || !chip.classList.contains('is-pending')) return;
    chip.classList.replace('is-pending', 'is-waiting');
    chip.textContent = 'يُصنَّف لاحقاً';
  }

  function refreshChip(entry) {
    if (!entry) return;
    const chip = log.querySelector(`.chip[data-entry="${entry.id}"]`);
    if (chip) renderChip(chip, entry);
  }

  // رسائل المحادثة المفتوحة (تُعاد كتابتها عند فتح محادثة أخرى)
  async function renderHistory() {
    const entriesById = Object.fromEntries((await getEntries()).map((e) => [e.id, e]));
    (await getMessages(50)).forEach((m) => {
      const li = append(m, {
        entry: m.role === 'user' && m.entryId ? entriesById[m.entryId] || null : null,
        used: (m.used || []).map((id) => entriesById[id]).filter(Boolean),
      });
      markEngine(li, m.engine);
      if (m.actions) renderActions(li, m.actions);
    });
  }
  await renderHistory();

  // ---- المحادثات المتعددة: شريط بعلامة + وقائمة ----
  const convBar = root.querySelector('#conv-bar');
  const convTitle = root.querySelector('#conv-title');
  const convSheet = root.querySelector('#conv-sheet');
  const convList = root.querySelector('#conv-list');
  const DEFAULT_TITLE = 'محادثة جديدة';
  async function updateBarTitle() {
    const cur = (await listConvs()).find((c) => c.id === activeConvId());
    convTitle.textContent = cur?.title || DEFAULT_TITLE;
  }
  async function reloadConversation() {
    log.innerHTML = '';
    await renderHistory();
    await updateBarTitle();
    if (!convSheet.hidden) await renderConvList();
  }
  async function renderConvList() {
    await pruneEmptyConvs();
    const list = (await listConvs()).slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const active = activeConvId();
    convList.innerHTML = list.map((c) => `<li class="conv-item${c.id === active ? ' is-active' : ''}" data-id="${escapeHtml(c.id)}">
        <span class="conv-item__title">${escapeHtml(c.title)}</span>
        <span class="conv-item__actions" hidden>
          <button type="button" class="conv-item__btn" data-act="edit" aria-label="تعديل الاسم">✏️</button>
          <button type="button" class="conv-item__btn" data-act="del" aria-label="حذف">🗑</button>
        </span>
      </li>`).join('') || '<li class="muted conv-empty">لا محادثات بعد.</li>';
  }
  async function toggleConvList(force) {
    const show = typeof force === 'boolean' ? force : convSheet.hidden;
    convSheet.hidden = !show;
    if (show) await renderConvList();
  }
  root.querySelector('#conv-menu').addEventListener('click', () => toggleConvList());
  root.querySelector('#conv-new').addEventListener('click', async () => {
    if (busy) { say('لحظة، ما زلت أفكر في رسالتك السابقة…'); return; }
    // المحادثة المفتوحة فارغة؟ نبقى عليها بدل إنشاء محادثة أخرى فارغة
    if (!(await activeConvIsEmpty())) {
      await createConv();
      await reloadConversation();
    }
    await toggleConvList(false);
  });

  // ضغطة واحدة: تظهر أيقونتا التعديل والحذف. ضغطتان سريعتان: تُفتح المحادثة
  let tap = { id: '', at: 0 };
  let tapTimer = null;
  function selectConvItem(li) {
    convList.querySelectorAll('.conv-item.is-selected').forEach((x) => {
      if (x !== li) { x.classList.remove('is-selected'); x.querySelector('.conv-item__actions').hidden = true; }
    });
    const on = li.classList.toggle('is-selected');
    li.querySelector('.conv-item__actions').hidden = !on;
  }
  async function openFromList(id) {
    await openConv(id);
    await reloadConversation();
    await toggleConvList(false);
  }
  async function renameFromList(li) {
    const id = li.dataset.id;
    const title = li.querySelector('.conv-item__title');
    const input = Object.assign(document.createElement('input'), { className: 'conv-item__input', value: title.textContent, maxLength: 60 });
    title.replaceWith(input);
    input.focus();
    let done = false;
    const save = async (keep) => {
      if (done) return;
      done = true;
      if (keep && input.value.trim()) await renameConv(id, input.value.trim());
      await renderConvList();
      await updateBarTitle();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(true); if (e.key === 'Escape') save(false); });
    input.addEventListener('blur', () => save(true));
  }
  async function removeFromList(id) {
    const list = await listConvs();
    const name = list.find((c) => c.id === id)?.title || DEFAULT_TITLE;
    if (!confirm(`حذف «${name}» مع كل رسائلها نهائياً؟`)) return;
    const wasActive = id === activeConvId();
    await deleteConv(id);
    if (wasActive) await reloadConversation();
    else { await updateBarTitle(); await renderConvList(); }
  }
  convList.addEventListener('click', async (e) => {
    const li = e.target.closest('.conv-item');
    if (!li) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') return renameFromList(li);
    if (act === 'del') return removeFromList(li.dataset.id);
    if (e.target.closest('.conv-item__input')) return;
    const id = li.dataset.id;
    const now = Date.now();
    if (tap.id === id && now - tap.at < 350) {
      clearTimeout(tapTimer);
      tap = { id: '', at: 0 };
      return openFromList(id);
    }
    tap = { id, at: now };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => selectConvItem(li), 350);
  });

  // بعد أول رد في المحادثة: عنوان قصير يكتبه الذكاء
  async function autoTitle() {
    const id = activeConvId();
    await touchConv(id);
    const cur = (await listConvs()).find((c) => c.id === id);
    if (!cur || cur.title !== DEFAULT_TITLE) { await updateBarTitle(); return; }
    const msgs = await getMessages(4);
    const firstUser = msgs.find((m) => m.role === 'user');
    const lastModel = [...msgs].reverse().find((m) => m.role === 'model' && m.text && !m.text.startsWith('⚠️'));
    if (!firstUser || !lastModel) return;
    let title = '';
    try {
      title = String(await chatTitle(`${firstUser.text}\n${lastModel.text}`)).replace(/["'«»؟?!.:،]/g, '').trim();
    } catch { /* يُستعمل الاحتياطي أدناه */ }
    if (!title) title = firstUser.text.split(/\s+/).slice(0, 4).join(' ');
    await renameConv(id, title.slice(0, 60));
    await updateBarTitle();
    if (!convSheet.hidden) await renderConvList();
  }
  await updateBarTitle();

  // ما فات تصنيفه سابقاً (بلا مفتاح أو اتصال) نصنّفه الآن بهدوء
  classifyPending(refreshChip).then(() => {
    log.querySelectorAll('.chip.is-pending').forEach((c) => waitChip(c.dataset.entry));
  });

  // ---- تصحيح التصنيف يدوياً ----
  const sheet = root.querySelector('#sheet');
  let editingCat = null;
  sheet.addEventListener('click', async (e) => {
    const pick = e.target.closest('.chip[data-cat]');
    if (pick && editingCat) refreshChip(await setCategory(editingCat, pick.dataset.cat));
    if (pick || e.target === sheet) { sheet.hidden = true; editingCat = null; }
  });

  // ---- خيارات الرسالة: نسخ، تعديل، حذف، استماع، رد جديد ----
  function closeActions() {
    log.querySelectorAll('.msg__actions').forEach((a) => a.remove());
  }

  function openActions(li) {
    const had = li.querySelector('.msg__actions');
    closeActions();
    if (had || li.classList.contains('msg--pending') || li.classList.contains('is-editing')) return;
    const isUser = li.dataset.role === 'user';
    const bar = document.createElement('div');
    bar.className = 'msg__actions';
    bar.innerHTML = `
      <button type="button" data-act="copy">📋 نسخ</button>
      ${isUser ? '<button type="button" data-act="edit">✏️ تعديل</button>' : ''}
      ${!isUser && !textOnly ? '<button type="button" data-act="listen">🔊 استمع</button>' : ''}
      ${!isUser ? '<button type="button" data-act="regen">🔄 رد جديد</button>' : ''}
      <button type="button" data-act="delete" class="is-danger">🗑 حذف</button>`;
    li.append(bar);
  }

  log.addEventListener('click', async (e) => {
    const chip = e.target.closest('.chip[data-entry]');
    if (chip) { editingCat = chip.dataset.entry; sheet.hidden = false; return; }
    const li = e.target.closest('.msg');
    if (!li || e.target.closest('details, .msg__edit')) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return openActions(li);
    closeActions();
    const id = li.dataset.id;
    const text = li.querySelector('.msg__text').textContent;
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(text); say('نسختُ الرسالة ✓'); }
      catch { say('تعذّر النسخ في هذا المتصفح.'); }
    } else if (act === 'edit') {
      startEdit(li);
    } else if (act === 'listen') {
      talk(text, true);
    } else if (act === 'regen') {
      regenerate(li);
    } else if (act === 'delete') {
      await removeMessage(li);
    }
  });

  // تعديل رسالة المستخدم في مكانها، مع تحديث ملاحظتها وإعادة تصنيفها
  async function startEdit(li) {
    const msg = await getMessage(li.dataset.id);
    if (!msg) return;
    const next = li.nextElementSibling;
    const hasReply = next?.dataset.role === 'model';
    li.classList.add('is-editing');
    const box = document.createElement('div');
    box.className = 'msg__edit';
    box.innerHTML = `
      <textarea rows="3" aria-label="تعديل الرسالة"></textarea>
      <div class="msg__edit-row">
        <button type="button" data-edit="save">حفظ</button>
        ${hasReply ? '<button type="button" data-edit="save-regen">حفظ وأعد الرد</button>' : ''}
        <button type="button" data-edit="cancel">إلغاء</button>
      </div>`;
    const ta = box.querySelector('textarea');
    ta.value = msg.text;
    li.querySelector('.msg__text').hidden = true;
    li.querySelector('.msg__text').after(box);
    ta.focus();

    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-edit]');
      if (!b) return;
      const done = () => { box.remove(); li.classList.remove('is-editing'); li.querySelector('.msg__text').hidden = false; };
      if (b.dataset.edit === 'cancel') return done();
      const val = ta.value.trim();
      if (!val) return;
      msg.text = val;
      await updateMessage(msg);
      li.querySelector('.msg__text').textContent = val;
      if (msg.entryId) {
        const entry = await getEntry(msg.entryId);
        if (entry) {
          entry.text = val;
          // إن لم يختر المستخدم القسم بنفسه نعيد التصنيف للنص الجديد
          if (entry.meta?.classifiedBy !== 'user') { entry.category = null; entry.meta = { ...entry.meta, title: '' }; }
          await updateEntry(entry);
          refreshChip(entry);
          if (!entry.category) classifyEntry(entry.id).then(refreshChip).catch(() => {});
        }
      }
      done();
      say('عدّلتُ الرسالة ✓');
      if (b.dataset.edit === 'save-regen' && hasReply) regenerate(next);
    });
  }

  async function removeMessage(li) {
    const msg = await getMessage(li.dataset.id);
    if (!msg) { li.remove(); return; }
    if (msg.role === 'user' && msg.entryId) {
      if (!confirm('حذف هذه الرسالة وملاحظتها من عقل المؤسسة؟')) return;
      await deleteEntry(msg.entryId);
    } else if (!confirm('حذف هذا الرد؟')) return;
    await deleteMessage(msg.id);
    li.remove();
  }

  // ---- كتابة الرسالة ----
  // المسودة تُحفظ على الجهاز مع كل تغيير، فلا يضيع ما كتبته إن خرجت فجأة قبل الإرسال
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    clearBtn.hidden = !input.value;
    form.classList.toggle('has-text', !!input.value.trim());
    saveDraft(input.value);
  };
  input.addEventListener('input', autosize);
  const draft = loadDraft();
  if (draft) {
    input.value = draft;
    autosize();
    say('رجعتُ لك ما كنت تكتبه ✍️ أكمله ثم اضغط ➤');
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault(); form.requestSubmit();
    }
  });
  clearBtn.addEventListener('click', () => { input.value = ''; autosize(); input.focus(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    unlockAudio();
    send(input.value);
  });

  // يجمع ملاحظات العقل الثاني ذات الصلة لرسالة معيّنة
  async function memoriesFor(text, recent) {
    if (!(await getSetting('useMemory', true))) return { used: [], memories: [] };
    const inChat = recent.map((m) => m.entryId).filter(Boolean);
    const prevUser = recent.filter((m) => m.role === 'user').at(-2)?.text || '';
    const used = recall(await getEntries(), text, { previous: prevUser, exclude: inChat });
    return {
      used,
      memories: used.map((e) => ({
        createdAt: e.createdAt, text: e.text, done: !!e.meta?.done,
        categoryLabel: categoryById(e.category)?.label || '',
      })),
    };
  }

  function showError(err) {
    if (err.code === 'NO_LOCAL') {
      say(`${escapeHtml(err.message)} <a href="#/settings?local">افتح الإعدادات</a>. كلامك محفوظ 💜`);
    } else if (err.code === 'NO_KEY' || err.code === 'BAD_KEY') {
      say(`${err.message} <a href="#/settings">افتح الإعدادات</a> لإضافته، أو نزّل <a href="#/settings?local">ذكاءً على الجهاز</a>. كلامك محفوظ على أي حال 💜`);
    } else {
      say(`${escapeHtml(err.message)} كلامك محفوظ.`);
    }
  }

  async function send(raw, source = 'text') {
    const text0 = raw.trim();
    if (!text0 && !pendingImage) return;
    const text = text0 || '📷 صورة';
    if (busy) {
      // نُبقي النص في الخانة ونخبره بدل التجاهل الصامت
      input.value = text; autosize();
      say('لحظة، ما زلت أفكر في رسالتك السابقة… أرسلها بعد قليل 💭');
      return;
    }
    busy = true;
    stopVoice();
    closeActions();
    input.value = ''; autosize();
    const image = pendingImage;
    pendingImage = null;
    showPending();

    // «احفظ التقرير»: آخر تقرير Word كبطاقة ملف في المحادثة، بلا رسالة إلى الذكاء
    if (!image && isSaveReportCommand(text0)) {
      try {
        append(await addMessage({ role: 'user', text }));
        let doc;
        try {
          doc = await reportFile(text0);
        } catch (err) {
          // لا تقرير Word محفوظ: نحوّل أحدث تقرير نصي إلى Word ونحفظه
          if (!/لا توجد تقارير محفوظة/.test(err.message || '')) throw err;
          doc = await textReportFile(text0);
        }
        const note = /جديد/.test(text0) ? ' (لإنشاء تقرير جديد اختر النطاق من نافذة التقارير)' : '';
        append(await addMessage({ role: 'model', text: `هذا التقرير «${doc.title}» (النسخة ${doc.version})${note}:` }));
        appendFileCard(doc);
      } catch (err) {
        append(await addMessage({ role: 'model', text: `⚠️ ${err.message || err}` }));
      } finally { busy = false; }
      return;
    }

    // «صدّر المحادثة»: ملف جاهز داخل المحادثة نفسها، بلا رسالة إلى الذكاء
    if (!image && /^(صدّر|صدر|احفظ)\s+المحادثة$/.test(text0)) {
      try {
        append(await addMessage({ role: 'user', text }));
        append(await addMessage({ role: 'model', text: 'جهّزتُ ملف المحادثة. احفظه أو شاركه:' }));
        appendFileCard(await exportChatFile());
      } finally { busy = false; }
      return;
    }

    // نحفظ كلام المستخدم أولاً حتى لا يضيع شيء
    const entry = await addEntry({ text, source });
    const userMsg = await addMessage({ role: 'user', text, entryId: entry.id, ...(image ? { image } : {}) });
    append(userMsg, { entry });

    companion.setState('thinking');
    say('<span class="dots"><i></i><i></i><i></i></span>');
    const pending = append({ role: 'model', text: '…' }, { pending: true });

    try {
      const recent = await getMessages(HISTORY_LIMIT);
      const { used, memories } = await memoriesFor(text, recent);
      // طلب واحد يعيد الرد وتصنيف رسالتك معاً (توفيراً للحصة)، من Gemini أو من النموذج على الجهاز
      // المدير: نُطلع الذكاء على عقل المؤسسة الحالي ليديره بالأسماء الصحيحة
      setActionContext(await orgContext().catch(() => ''));
      setReportsContext(await reportsContext().catch(() => ''));
      // الصورة تُرسل مع رسالتك الحالية فقط، لا مع كل السجل
      const result = await smartChat(recent.map(({ role, text: t, image: img, id }) => ({ role, text: t, image: img && id === userMsg.id ? img : undefined })), {
        memories,
        onToken: (t) => streamInto(pending, t),
      });
      const reply = result.reply;
      applyClassification(entry.id, result);
      const modelMsg = await addMessage({ role: 'model', text: reply, used: used.map((e) => e.id), engine: result.engine === 'local' ? 'local' : undefined });
      markEngine(pending, result.engine);
      // تعديل تقرير Word: ينفّذه التطبيق ويعرض النسخة الجديدة كبطاقة ملف
      const editReq = result.actions?.find((a) => a?.action === 'edit_report');
      if (editReq) {
        result.actions = result.actions.filter((a) => a !== editReq);
        try {
          const doc = await editLastReport(editReq.name || '', editReq.target || '');
          appendFileCard(doc, { autoSave: true });
        } catch (err) {
          append(await addMessage({ role: 'model', text: `⚠️ ${err.message || err}` }));
        }
      }
      // أوامر طلبتها المساعد (إنشاء قسم، تغيير إعداد...): ننفذها ونعرض نتيجتها تحت الرد
      if (result.actions?.length) {
        const done = await executeActions(result.actions, {
          entryId: entry.id,
          onCategory: refreshChip,
          setWaMode,
          setVoice: (on) => { speakOn = on; renderVoiceToggle(); if (!on) stopVoice(); },
          remount: () => window.dispatchEvent(new HashChangeEvent('hashchange')),
        });
        renderActions(pending, done, done.undo);
        await updateMessage({ ...modelMsg, actions: [...done] }); // اللقطة لا تُحفظ مع الرسالة
      }
      pending.dataset.id = modelMsg.id;
      pending.querySelector('.msg__text').textContent = reply;
      pending.classList.remove('msg--pending');
      renderUsed(pending, used);
      autoTitle().catch(() => {});
      lastReplyBubble = escapeHtml(bubbleText(reply));
      say(lastReplyBubble);
      log.scrollTop = log.scrollHeight;
      talk(reply);
    } catch (err) {
      // نُبقي سبب الفشل ظاهراً في المحادثة نفسها (لا يُحفظ)، بدل رد يختفي بصمت
      pending.classList.remove('msg--pending');
      pending.classList.add('msg--error');
      pending.querySelector('.msg__text').textContent = `⚠️ ${err.message || err}`;
      waitChip(entry.id);
      companion.setState('idle');
      showError(err);
    } finally {
      busy = false;
      if (companion?.state === 'thinking') companion.setState('idle');
    }
  }

  // بطاقة ملف في المحادثة: حفظ في التنزيلات، أو مشاركة
  function appendFileCard({ blob, filename }, { autoSave = false } = {}) {
    const li = document.createElement('li');
    li.className = 'msg msg--model';
    const card = document.createElement('div');
    card.className = 'file-card';
    card.innerHTML = `<b></b><small>${autoSave ? 'جارٍ الحفظ في التنزيلات…' : `${Math.max(1, Math.round(blob.size / 1024))} ك.ب`}</small>
      <div class="file-card__actions">
        <button type="button" class="btn btn--ghost" data-act="save">حفظ</button>
        <button type="button" class="btn btn--ghost" data-act="share">مشاركة</button>
      </div>`;
    card.querySelector('b').textContent = filename;
    card.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      // النتيجة تظهر داخل البطاقة نفسها (التنبيهات العامة لا تظهر في كل واجهات المحادثة)
      const status = card.querySelector('small');
      try {
        if (act === 'save') status.textContent = `حُفظ في ${await saveFile(blob, filename)} ✓`;
        else await shareFile(blob, filename);
      } catch (err) { status.textContent = `تعذّر: ${err.message || String(err)}`; }
    });
    li.append(card);
    log.append(li);
    log.scrollTop = log.scrollHeight;
    if (autoSave) {
      const status = card.querySelector('small');
      saveFile(blob, filename)
        .then((where) => { status.textContent = `حُفظ في ${where} ✓`; })
        .catch((err) => { status.textContent = `تعذّر الحفظ التلقائي: ${err.message || err}. استخدم حفظ.`; });
    }
  }

  // يعرض رد النموذج المحلي وهو يُكتب
  function streamInto(li, text) {
    li.classList.remove('msg--pending');
    li.querySelector('.msg__text').textContent = text;
    log.scrollTop = log.scrollHeight;
  }

  // نتائج أوامر المساعد: سطر لكل أمر، مع رابط "عرض" إن وُجد
  function renderActions(li, done, undo) {
    li.querySelector('.msg__acts')?.remove();
    if (!done?.length) return;
    const box = document.createElement('div');
    box.className = 'msg__acts';
    const plain = done.filter((d) => !d.draft);
    box.innerHTML = plain.map((d) => `<span class="act ${d.ok ? '' : 'act--fail'}">${d.ok ? '⚙️' : '⚠️'} ${escapeHtml(d.text)}${d.link ? ` <a href="${d.link}">عرض</a>` : ''}</span>`).join('')
      + (undo && plain.some((d) => d.ok) ? '<button type="button" class="act-undo">تراجع عن كل ما سبق</button>' : '');
    // مهام حوّلها المساعد من الكلام: بطاقة لكل مهمة يؤكدها المسؤول بلمسة (A38)
    done.filter((d) => d.draft).forEach((d) => box.append(taskCard(d.draft)));
    li.querySelector('.msg__text').after(box);
    // التراجع: يعيد الهيكل والأعمال والنقاط والأقسام والملاحظات إلى ما قبل الأوامر
    box.querySelector('.act-undo')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { restoreUndoSnapshot } = await import('../org-insights.js');
        await restoreUndoSnapshot(undo);
        const { loadCategories } = await import('../categories.js');
        await loadCategories();
        btn.replaceWith(Object.assign(document.createElement('span'), { className: 'act', textContent: '↩️ تراجعتُ عن هذه الأوامر' }));
      } catch (err) { btn.disabled = false; say(`تعذّر التراجع: ${escapeHtml(err.message)}`); }
    });
  }

  // ---- بطاقة مهمة جاهزة: إرسال، أو تعديل الشخص والنص والموعد، أو إلغاء ----
  // (دالة لا ثابت: قد تُرسم البطاقة قبل الوصول إلى هذا السطر)
  function fmtDue(d) { return d ? new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${d}T00:00`)) : 'بلا موعد'; }
  function taskCard(draft) {
    const el = document.createElement('div');
    el.className = 'task-draft';
    const view = () => {
      el.innerHTML = `<p class="task-draft__head">📌 مهمة إلى <b>${escapeHtml(draft.toName)}</b></p>
        <p class="task-draft__title">${escapeHtml(draft.title)}</p>
        <p class="task-draft__due">الموعد: ${escapeHtml(fmtDue(draft.due))}</p>
        <div class="task-draft__acts"><button type="button" class="btn" data-t="send">إرسال</button><button type="button" class="text-btn" data-t="edit">تعديل</button><button type="button" class="text-btn text-btn--muted" data-t="cancel">إلغاء</button></div>
        <p class="status" data-t="msg"></p>`;
    };
    const edit = async () => {
      const { assignable } = await import('../tasks.js');
      const people = assignable();
      el.innerHTML = `<label class="struct-field">إلى<select data-f="to">${people.map((p) => `<option value="${escapeHtml(p.uid)}" ${p.uid === draft.to ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>
        <input data-f="title" maxlength="120" value="${escapeHtml(draft.title)}">
        <label class="struct-field">الموعد<input type="date" data-f="due" value="${escapeHtml(draft.due)}"></label>
        <div class="task-draft__acts"><button type="button" class="btn" data-t="save">تم</button></div>`;
    };
    view();
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      const t = b.dataset.t;
      if (t === 'cancel') { el.innerHTML = '<span class="act">ألغيتَ المهمة.</span>'; return; }
      if (t === 'edit') { await edit(); return; }
      if (t === 'save') {
        const sel = el.querySelector('[data-f=to]');
        draft = { to: sel.value, toName: sel.selectedOptions[0]?.textContent || draft.toName, title: el.querySelector('[data-f=title]').value.trim() || draft.title, due: el.querySelector('[data-f=due]').value };
        view();
        return;
      }
      if (t === 'send') {
        b.disabled = true;
        try {
          const { sendTask } = await import('../tasks.js');
          await sendTask(draft);
          el.innerHTML = `<span class="act">📌 أُرسلت المهمة إلى ${escapeHtml(draft.toName)} ✓ <a href="#/tasks">المهام</a></span>`;
        } catch (err) { b.disabled = false; el.querySelector('[data-t=msg]').textContent = err.message; }
      }
    });
    return el;
  }

  // شارة صغيرة على الردود التي جاءت من النموذج على الجهاز
  function markEngine(li, engine) {
    li.querySelector('.msg__engine')?.remove();
    if (engine !== 'local') return;
    const tag = document.createElement('span');
    tag.className = 'msg__engine';
    tag.textContent = '📱 من الجهاز';
    li.querySelector('.msg__text').after(tag);
  }

  // يحفظ التصنيف الذي جاء مع الرد، أو يطلب تصنيفاً منفصلاً إن لم يصل
  async function applyClassification(entryId, { category, title }) {
    const fresh = await getEntry(entryId);
    if (!fresh || fresh.category) return; // صنّفه المستخدم يدوياً أثناء الانتظار
    if (!category) {
      classifyEntry(entryId).then(refreshChip).catch(() => {});
      return;
    }
    fresh.category = category;
    fresh.meta = { ...fresh.meta, title, classifiedBy: 'ai', classifiedAt: Date.now() };
    await updateEntry(fresh);
    refreshChip(fresh);
  }

  // رد جديد بدل رد سابق: نعيد السؤال بنفس السياق الذي سبقه
  async function regenerate(li) {
    if (busy || !li?.dataset.id) return;
    const msg = await getMessage(li.dataset.id);
    if (!msg) return;
    busy = true;
    stopVoice();
    const all = await getMessages(500);
    const before = all.filter((m) => m.createdAt < msg.createdAt).slice(-HISTORY_LIMIT);
    const lastUser = before.filter((m) => m.role === 'user').at(-1);
    if (!lastUser) { busy = false; return; }
    li.classList.add('msg--pending');
    companion.setState('thinking');
    say('<span class="dots"><i></i><i></i><i></i></span>');
    try {
      const { used, memories } = await memoriesFor(lastUser.text, before);
      const { reply, engine } = await smartChat(before.map(({ role, text }) => ({ role, text })), {
        memories, classify: false, onToken: (t) => streamInto(li, t),
      });
      msg.text = reply;
      msg.engine = engine === 'local' ? 'local' : undefined;
      markEngine(li, engine);
      msg.used = used.map((e) => e.id);
      await updateMessage(msg);
      li.querySelector('.msg__text').textContent = reply;
      renderUsed(li, used);
      lastReplyBubble = escapeHtml(bubbleText(reply));
      say(lastReplyBubble);
      talk(reply);
    } catch (err) {
      showError(err);
    } finally {
      li.classList.remove('msg--pending');
      busy = false;
      if (companion?.state === 'thinking') companion.setState('idle');
    }
  }

  // force: "استمع" لرسالة معيّنة حتى لو كان النطق التلقائي مطفأً
  function talk(text, force = false) {
    if (textOnly || (!speakOn && !force)) {
      companion.setState('talking');
      setTimeout(() => companion?.state === 'talking' && companion.setState('idle'), Math.min(4000, 600 + text.length * 45));
      return;
    }
    const shown = bubble.innerHTML;
    let note = '';
    speak(text, {
      skin,
      onWaiting: () => { bubble.innerHTML = `${shown} <span class="voice-note">🔊 أجهّز صوتي…</span>`; },
      onStart: () => {
        setTalking(true);
        bubble.innerHTML = note ? `${shown} <span class="voice-note">${note}</span>` : shown;
      },
      onEnd: () => setTalking(false),
      onFallback: (err) => { note = `(تعذّر صوت Gemini: ${escapeHtml(err.message)})`; bubble.innerHTML = `${shown} <span class="voice-note">${note}</span>`; },
      onSilent: () => {
        bubble.innerHTML = `${shown} <span class="voice-note">${note ? note + ' ' : ''}(لا يوجد صوت عربي يعمل على جهازك. جرّب "🔊 جرّب الصوت" في الإعدادات)</span>`;
      },
    });
  }

  // ---- الإدخال الصوتي ----
  const micOff = () => {
    stopListening = null;
    mic.classList.remove('is-on');
    mic.style.removeProperty('--lvl');
    mic.setAttribute('aria-label', 'تحدّث');
    if (companion?.state === 'listening') companion.setState('idle');
  };

  const micError = (code) => {
    if (code === 'not-allowed' || code === 'service-not-allowed') say('أحتاج إذن الميكروفون لأسمعك. فعّله من إعدادات المتصفح للموقع.');
    else if (code === 'no-speech') say('لم أسمع شيئاً، جرّب مرة أخرى.');
    else if (code === 'network') say('التعرف على الكلام يحتاج إنترنت، تحقق من الاتصال.');
    else if (code === 'audio-capture') say('لا أستطيع الوصول إلى الميكروفون. ربما يستخدمه تطبيق آخر.');
    else if (code === 'no-start') say('لم يبدأ الميكروفون. جرّب مرة أخرى، أو اختر "Gemini" للتعرف على الكلام من الإعدادات.');
    else if (code === 'language-not-supported') say('خدمة الكلام في المتصفح لا تدعم العربية. اختر "Gemini" من الإعدادات.');
    else if (code !== 'aborted') say(`تعذّر الاستماع (${code}). جرّب الكتابة.`);
  };

  // النص المسموع: إما يُرسل مباشرة، أو يوضع في الخانة لتراجعه وتعدّله أولاً
  async function heard(text) {
    // افتراضياً يُرسل فور الإفلات (مثل واتساب)، إلا إن اختار المراجعة من الإعدادات
    if (await getSetting('reviewVoice', false)) {
      input.value = (input.value ? `${input.value} ` : '') + text;
      autosize();
      input.focus();
      say('هذا ما سمعته ✍️ عدّله إن شئت، ثم اضغط ➤');
    } else {
      // ما كتبته في الخانة يبقى كما هو؛ الرسالة الصوتية تُرسل وحدها
      const draft = input.value;
      send(text, 'voice');
      input.value = draft; autosize();
    }
  }

  // ---- تسجيل بالضغط المطوّل (مثل واتساب) ----
  // اضغط مطولاً وتكلّم، ثم أفلت للإرسال. اسحب جانباً للإلغاء، أو للأعلى لتثبيت التسجيل دون إمساك.
  const recBar = document.createElement('div');
  recBar.className = 'rec-bar';
  recBar.hidden = true;
  recBar.innerHTML = `
    <button type="button" class="rec-bar__trash" aria-label="ألغِ التسجيل">🗑</button>
    <span class="rec-bar__dot" aria-hidden="true"></span>
    <span class="rec-bar__time">0:00</span>
    <span class="rec-bar__hint">→ اسحب للإلغاء</span>
    <span class="rec-bar__lock" aria-hidden="true">🔒<small>⌃</small></span>`;
  input.before(recBar);
  const recTime = recBar.querySelector('.rec-bar__time');
  const recHint = recBar.querySelector('.rec-bar__hint');
  const fmtDur = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const MIN_HOLD = 600; // أقصر من هذا = لمسة عادية، لا تسجيل
  let cap = null; // التسجيل الجاري

  function recUi(on, c) {
    form.classList.toggle('is-recording', on);
    form.classList.toggle('is-locked', !!c?.locked);
    recBar.hidden = !on;
    mic.textContent = c?.locked ? '➤' : '🎙';
    mic.style.removeProperty('--dx');
    if (!on) { recHint.style.transform = ''; recHint.style.opacity = ''; }
    recHint.textContent = c?.locked ? 'اضغط ➤ للإرسال' : '→ اسحب للإلغاء';
  }
  function finishUi(c) {
    clearInterval(c.timer);
    if (cap === c) cap = null;
    recUi(false);
  }
  // send=false: إلغاء (لا يُرسل شيء)
  function endCapture(send, why) {
    const c = cap;
    if (!c) return;
    c.cancelled = !send;
    finishUi(c);
    if (c.stop) c.stop(); else c.pendingStop = true;
    if (!send) {
      micOff();
      if (why === 'short') say('اضغط مطولاً على 🎙 وتكلّم، ثم أفلت للإرسال.');
      else if (why === 'cancel') say('أُلغي التسجيل 🗑');
    }
  }

  async function pickEngine() {
    const hasKey = !!(await getSetting('geminiApiKey', ''));
    let engine = await getSetting('sttEngine', canRecord ? 'gemini' : 'browser');
    if (engine === 'gemini' && (!canRecord || !hasKey)) engine = canBrowserListen ? 'browser' : 'none';
    if (engine === 'browser' && !canBrowserListen) engine = canRecord && hasKey ? 'gemini' : 'none';
    if (engine === 'none') {
      say(hasKey ? 'الإدخال الصوتي غير متاح هنا. استخدم مايك لوحة المفاتيح 🎤.' : 'أضف مفتاح Gemini في <a href="#/settings">الإعدادات</a> لأفهم كلامك الصوتي.');
      return null;
    }
    return engine;
  }

  async function startEngine(engine, c) {
    if (engine === 'gemini') {
      // التسجيل يستمر ما دمت تضغط (لا يتوقف عند السكوت)، ثم نفرّغه عبر Gemini
      const rec = await record({
        silenceStop: false,
        maxMs: 120_000,
        onLevel: (l) => mic.style.setProperty('--lvl', l.toFixed(2)),
        onError: (code) => { finishUi(c); micOff(); if (!c.cancelled) micError(code); },
        onDone: async (blob, wasHeard) => {
          finishUi(c); // قد ينتهي وحده عند بلوغ الحد الأقصى
          micOff();
          if (c.cancelled) return;
          if (!wasHeard || blob.size < 2000) { say('لم أسمع شيئاً، جرّب مرة أخرى وتكلّم قريباً من الجوال.'); return; }
          companion.setState('thinking');
          say('<span class="dots"><i></i><i></i><i></i></span> أحوّل كلامك إلى نص…');
          try {
            const text = await transcribe(blob);
            companion.setState('idle');
            if (!text) { say('لم أفهم الكلام جيداً، جرّب مرة أخرى.'); return; }
            heard(text);
          } catch (err) {
            companion.setState('idle');
            say(`${escapeHtml(err.message)} جرّب مرة أخرى أو اكتب.`);
          }
        },
      });
      c.stop = () => rec.stop();
    } else {
      const before = input.value;
      c.stop = listen({
        onInterim: (t) => { if (!c.cancelled) { input.value = (before ? `${before} ` : '') + t; autosize(); } },
        onText: (t) => { input.value = before; autosize(); if (!c.cancelled) heard(t); },
        onError: (code) => { if (!c.cancelled) micError(code); },
        onEnd: () => { finishUi(c); micOff(); },
      });
    }
    // أُفلت الزر قبل أن يجهز الميكروفون (مثلاً أثناء طلب الإذن)
    if (c.pendingStop) c.stop();
  }

  mic.addEventListener('contextmenu', (e) => e.preventDefault());
  mic.addEventListener('pointerdown', async (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    if (cap?.locked) { endCapture(true); return; } // مثبّت: ➤ يرسل
    if (cap) return;
    if (busy) { say('لحظة، ما زلت أفكر… 💭'); return; }
    try { mic.setPointerCapture(e.pointerId); } catch { /* لا شيء */ }
    const c = cap = { x0: e.clientX, y0: e.clientY, t0: Date.now(), pointer: e.pointerId, cancelled: false, locked: false };
    const engine = await pickEngine();
    if (!engine) { cap = null; return; }
    if (cap !== c) return; // أُفلت أثناء الانتظار
    stopVoice();
    companion.setState('listening');
    mic.classList.add('is-on');
    mic.setAttribute('aria-label', 'أفلت للإرسال');
    stopListening = () => endCapture(false);
    recTime.textContent = '0:00';
    recUi(true, c);
    c.timer = setInterval(() => { recTime.textContent = fmtDur(Date.now() - c.t0); }, 250);
    navigator.vibrate?.(30);
    try {
      await startEngine(engine, c);
    } catch {
      finishUi(c);
      micOff();
      say('الإدخال الصوتي غير متاح في هذا المتصفح. استخدم مايك لوحة المفاتيح 🎤.');
    }
  });
  mic.addEventListener('pointermove', (e) => {
    const c = cap;
    if (!c || c.locked || e.pointerId !== c.pointer) return;
    const dx = e.clientX - c.x0, dy = e.clientY - c.y0;
    // اسحب نحو خانة الكتابة للإلغاء
    recHint.style.transform = `translateX(${Math.max(-60, Math.min(60, dx / 2))}px)`;
    recHint.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / 140));
    if (Math.abs(dx) > 110) { navigator.vibrate?.(20); endCapture(false, 'cancel'); return; }
    if (dy < -70) { c.locked = true; navigator.vibrate?.(20); recUi(true, c); } // اسحب للأعلى: تثبيت
  });
  const release = (e) => {
    const c = cap;
    if (!c || c.locked || e.pointerId !== c.pointer) return;
    if (Date.now() - c.t0 < MIN_HOLD) endCapture(false, 'short');
    else endCapture(true);
  };
  mic.addEventListener('pointerup', release);
  mic.addEventListener('pointercancel', (e) => {
    const c = cap;
    if (!c || c.locked || e.pointerId !== c.pointer) return;
    // نافذة إذن الميكروفون تقطع اللمسة: نلغي ونطلب المحاولة
    endCapture(false);
    say('الميكروفون جاهز. اضغط مطولاً على 🎙 وتكلّم، ثم أفلت للإرسال.');
  });
  recBar.querySelector('.rec-bar__trash').addEventListener('click', () => endCapture(false, 'cancel'));
}

export function unmount() {
  stopListening?.();
  stopListening = null;
  stopSpeaking();
  companion?.destroy();
  companion = null;
  busy = false;
}
