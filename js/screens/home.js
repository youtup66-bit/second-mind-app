// شاشة الرفيقة: الشخصية الطافية + المحادثة صوتاً أو كتابة + تصنيف كل ملاحظة
import { createCompanion } from '../companion.js';
import {
  addEntry, addMessage, getEntries, getEntry, getMessage, getMessages, getSetting, getSummaries,
  setSetting, updateEntry, updateMessage, deleteMessage, deleteEntry,
} from '../storage.js';
import { chat, transcribe } from '../gemini.js';
import { CATEGORIES, NONE, categoryById } from '../categories.js';
import { classifyEntry, classifyPending, setCategory } from '../classifier.js';
import { recall } from '../recall.js';
import { canListen, canRecord, canBrowserListen, listen, record, speak, stopSpeaking, unlockAudio } from '../voice.js';

export const title = 'الرفيقة';

const TAP_LINES = ['أنا هنا معك 💜', 'بماذا تفكر الآن؟', 'احكِ لي، سأحفظ كل شيء.', 'هيهي، هذا يدغدغ!'];
const HISTORY_LIMIT = 20; // عدد الرسائل الأخيرة التي تُرسل كسياق

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'سهران؟ أنا معك.';
  if (h < 12) return 'صباح الخير! كيف تشعر اليوم؟';
  if (h < 18) return 'أهلاً! ماذا يدور في بالك؟';
  return 'مساء الخير، كيف كان يومك؟';
}

// الفقاعة فوق الرفيقة تعرض بداية الرد فقط؛ الرد كاملاً في المحادثة
function bubbleText(reply) {
  const first = reply.split(/\n/)[0];
  const cut = first.length > 140 ? `${first.slice(0, 140).replace(/\s+\S*$/, '')}…` : first;
  return cut + (cut.length < reply.length && !cut.endsWith('…') ? ' …' : '');
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let companion = null;
let stopListening = null;
let busy = false;

export async function mount(root) {
  const textOnly = await getSetting('textOnly', false);
  let speakOn = !textOnly && await getSetting('speakReplies', true);
  const showMic = canListen && !textOnly;

  root.innerHTML = `
    <section class="chat">
      <div class="chat__hero">
        <div class="chat__tools">
          <button type="button" class="tool" id="voice-toggle" ${textOnly ? 'hidden' : ''}></button>
          <button type="button" class="tool tool--stop" id="stop-voice" hidden aria-label="أوقف الصوت">⏹ أوقف الصوت</button>
          ${textOnly ? '<a class="tool" href="#/settings?talk" title="غيّره من الإعدادات">⌨️ كتابة فقط</a>' : ''}
        </div>
        <p class="bubble" id="bubble" role="status">${greeting()}</p>
        <div class="chat__stage" id="stage"></div>
      </div>
      <ol class="chat__log" id="log" aria-label="المحادثة"></ol>
      <form class="composer" id="composer" autocomplete="off">
        <button type="button" class="composer__mic" id="mic" aria-label="تحدّث" ${showMic ? '' : 'hidden'}>🎙</button>
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
  const input = root.querySelector('#input');
  const mic = root.querySelector('#mic');
  const clearBtn = root.querySelector('#clear');
  const voiceToggle = root.querySelector('#voice-toggle');
  const stopVoiceBtn = root.querySelector('#stop-voice');
  let tapIdx = 0;

  // مساءً، إن كتبت أشياء كثيرة اليوم ولم تلخصه بعد، تقترح الرفيقة ملخصاً
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
  companion = createCompanion(root.querySelector('#stage'), {
    skin,
    onTap: () => {
      // لمس الرفيقة وهي تتكلم يوقف صوتها
      if (companion?.state === 'talking') return stopVoice();
      if (!busy) say(TAP_LINES[tapIdx++ % TAP_LINES.length]);
    },
  });

  function say(text) {
    bubble.classList.remove('is-shown');
    void bubble.offsetWidth;
    bubble.innerHTML = text;
    bubble.classList.add('is-shown');
  }

  // ---- التحكم في الصوت ----
  const renderVoiceToggle = () => {
    voiceToggle.textContent = speakOn ? '🔊 الصوت يعمل' : '🔇 بلا صوت';
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
  function append(msg, { entry = null, used = [], pending = false } = {}) {
    const li = document.createElement('li');
    li.className = `msg msg--${msg.role}${pending ? ' msg--pending' : ''}`;
    if (msg.id) li.dataset.id = msg.id;
    li.dataset.role = msg.role;
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
    log.append(li);
    log.closest('.chat').classList.add('chat--active');
    log.scrollTop = log.scrollHeight;
    return li;
  }

  // "استعنتُ بملاحظاتك": يوضح أي ملاحظات قرأتها الرفيقة قبل ردها
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
    chip.style.setProperty('--c', c ? c.color : 'var(--muted)');
    chip.textContent = c ? c.label : 'يُصنَّف…';
    chip.title = entry?.meta?.title || '';
  }

  function refreshChip(entry) {
    if (!entry) return;
    const chip = log.querySelector(`.chip[data-entry="${entry.id}"]`);
    if (chip) renderChip(chip, entry);
  }

  const entriesById = Object.fromEntries((await getEntries()).map((e) => [e.id, e]));
  (await getMessages(50)).forEach((m) => append(m, {
    entry: m.role === 'user' && m.entryId ? entriesById[m.entryId] || null : null,
    used: (m.used || []).map((id) => entriesById[id]).filter(Boolean),
  }));

  // ما فات تصنيفه سابقاً (بلا مفتاح أو اتصال) نصنّفه الآن بهدوء
  classifyPending(refreshChip);

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
      if (!confirm('حذف هذه الرسالة وملاحظتها من عقلك؟')) return;
      await deleteEntry(msg.entryId);
    } else if (!confirm('حذف هذا الرد؟')) return;
    await deleteMessage(msg.id);
    li.remove();
  }

  // ---- كتابة الرسالة ----
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    clearBtn.hidden = !input.value;
  };
  input.addEventListener('input', autosize);
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
    if (err.code === 'NO_KEY' || err.code === 'BAD_KEY') {
      say(`${err.message} <a href="#/settings">افتح الإعدادات</a> لإضافته. كلامك محفوظ على أي حال 💜`);
    } else {
      say(`${escapeHtml(err.message)} كلامك محفوظ.`);
    }
  }

  async function send(raw, source = 'text') {
    const text = raw.trim();
    if (!text) return;
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

    // نحفظ كلام المستخدم أولاً حتى لا يضيع شيء
    const entry = await addEntry({ text, source });
    const userMsg = await addMessage({ role: 'user', text, entryId: entry.id });
    append(userMsg, { entry });

    companion.setState('thinking');
    say('<span class="dots"><i></i><i></i><i></i></span>');
    const pending = append({ role: 'model', text: '…' }, { pending: true });

    try {
      const recent = await getMessages(HISTORY_LIMIT);
      const { used, memories } = await memoriesFor(text, recent);
      // طلب واحد يعيد الرد وتصنيف رسالتك معاً (توفيراً للحصة)
      const result = await chat(recent.map(({ role, text: t }) => ({ role, text: t })), { memories });
      const reply = result.reply;
      applyClassification(entry.id, result);
      const modelMsg = await addMessage({ role: 'model', text: reply, used: used.map((e) => e.id) });
      pending.dataset.id = modelMsg.id;
      pending.querySelector('.msg__text').textContent = reply;
      pending.classList.remove('msg--pending');
      renderUsed(pending, used);
      say(escapeHtml(bubbleText(reply)));
      log.scrollTop = log.scrollHeight;
      talk(reply);
    } catch (err) {
      pending.remove();
      companion.setState('idle');
      showError(err);
    } finally {
      busy = false;
      if (companion?.state === 'thinking') companion.setState('idle');
    }
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
      const { reply } = await chat(before.map(({ role, text }) => ({ role, text })), { memories, classify: false });
      msg.text = reply;
      msg.used = used.map((e) => e.id);
      await updateMessage(msg);
      li.querySelector('.msg__text').textContent = reply;
      renderUsed(li, used);
      say(escapeHtml(bubbleText(reply)));
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
    if (await getSetting('voiceReview', true)) {
      input.value = (input.value ? `${input.value} ` : '') + text;
      autosize();
      input.focus();
      say('هذا ما سمعته ✍️ عدّله إن شئت، ثم اضغط ➤');
    } else {
      input.value = ''; autosize();
      send(text, 'voice');
    }
  }

  // الطريقة الافتراضية: نسجّل الصوت ونفرّغه عبر Gemini (تعمل حتى لو كانت خدمة المتصفح معطلة)
  async function listenWithGemini() {
    let rec = null;
    stopListening = () => rec?.stop();
    rec = await record({
      onStart: () => say('أسمعك… تكلّم، وسأتوقف حين تسكت (أو المس 🎙).'),
      onLevel: (l) => mic.style.setProperty('--lvl', l.toFixed(2)),
      onError: (code) => { micOff(); micError(code); },
      onDone: async (blob, wasHeard) => {
        micOff();
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
  }

  function listenWithBrowser() {
    const before = input.value;
    stopListening = listen({
      onStart: () => say('أسمعك… تكلّم، ثم المس 🎙 لتنهي.'),
      onInterim: (t) => { input.value = (before ? `${before} ` : '') + t; autosize(); },
      onText: (t) => { input.value = before; heard(t); },
      onError: micError,
      onEnd: () => { if (stopListening) micOff(); },
    });
  }

  mic.addEventListener('click', async () => {
    // ضغطة ثانية: إيقاف فوري
    if (stopListening) {
      const stop = stopListening;
      micOff();
      stop();
      return;
    }
    if (busy) { say('لحظة، ما زلت أفكر… 💭'); return; }
    const hasKey = !!(await getSetting('geminiApiKey', ''));
    let engine = await getSetting('sttEngine', canRecord ? 'gemini' : 'browser');
    if (engine === 'gemini' && (!canRecord || !hasKey)) engine = canBrowserListen ? 'browser' : 'none';
    if (engine === 'browser' && !canBrowserListen) engine = canRecord && hasKey ? 'gemini' : 'none';
    if (engine === 'none') {
      say(hasKey ? 'الإدخال الصوتي غير متاح هنا. استخدم مايك لوحة المفاتيح 🎤.' : 'أضف مفتاح Gemini في <a href="#/settings">الإعدادات</a> لأفهم كلامك الصوتي.');
      return;
    }
    stopVoice();
    companion.setState('listening');
    mic.classList.add('is-on');
    mic.setAttribute('aria-label', 'أوقف الاستماع');
    say('أجهّز الميكروفون…');
    try {
      if (engine === 'gemini') await listenWithGemini();
      else listenWithBrowser();
    } catch {
      micOff();
      say('الإدخال الصوتي غير متاح في هذا المتصفح. استخدم مايك لوحة المفاتيح 🎤.');
    }
  });
}

export function unmount() {
  stopListening?.();
  stopListening = null;
  stopSpeaking();
  companion?.destroy();
  companion = null;
  busy = false;
}
