// شاشة الرفيقة: الشخصية الطافية + المحادثة صوتاً أو كتابة + تصنيف كل ملاحظة
import { createCompanion } from '../companion.js';
import { addEntry, addMessage, getEntries, getMessages, getSetting, getSummaries } from '../storage.js';
import { chat } from '../gemini.js';
import { CATEGORIES, NONE, categoryById } from '../categories.js';
import { classifyEntry, classifyPending, setCategory } from '../classifier.js';
import { recall } from '../recall.js';
import { canListen, listen, speak, stopSpeaking } from '../voice.js';

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

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let companion = null;
let stopListening = null;
let busy = false;

export async function mount(root) {
  root.innerHTML = `
    <section class="chat">
      <div class="chat__hero">
        <p class="bubble" id="bubble" role="status">${greeting()}</p>
        <div class="chat__stage" id="stage"></div>
      </div>
      <ol class="chat__log" id="log" aria-label="المحادثة"></ol>
      <form class="composer" id="composer" autocomplete="off">
        <button type="button" class="composer__mic" id="mic" aria-label="تحدّث" ${canListen ? '' : 'hidden'}>🎙</button>
        <textarea id="input" rows="1" placeholder="اكتب ما في بالك..." aria-label="رسالتك"></textarea>
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
  const log = root.querySelector('#log');
  const form = root.querySelector('#composer');
  const input = root.querySelector('#input');
  const mic = root.querySelector('#mic');
  let tapIdx = 0;

  companion = createCompanion(root.querySelector('#stage'), {
    onTap: () => !busy && say(TAP_LINES[tapIdx++ % TAP_LINES.length]),
  });

  function say(text) {
    bubble.classList.remove('is-shown');
    void bubble.offsetWidth;
    bubble.innerHTML = text;
    bubble.classList.add('is-shown');
  }

  function append(role, text, extra = '', entry = null, used = []) {
    const li = document.createElement('li');
    li.className = `msg msg--${role} ${extra}`;
    const body = document.createElement('span');
    body.className = 'msg__text';
    body.textContent = text;
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
    const box = document.createElement('details');
    box.className = 'used';
    box.innerHTML = `<summary>📎 استعنتُ بـ${used.length === 1 ? 'ملاحظة واحدة' : ` ${used.length} من ملاحظاتك`}</summary>
      <ul>${used.map((e) => {
        const c = categoryById(e.category);
        return `<li><span class="used__dot" style="background:${c ? c.color : 'var(--muted)'}"></span>${escapeHtml(e.meta?.title || e.text.slice(0, 50))}</li>`;
      }).join('')}</ul>`;
    li.append(box);
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
  (await getMessages(50)).forEach((m) =>
    append(m.role, m.text, '',
      m.role === 'user' && m.entryId ? entriesById[m.entryId] || null : null,
      (m.used || []).map((id) => entriesById[id]).filter(Boolean)));

  // ما فات تصنيفه سابقاً (بلا مفتاح أو اتصال) نصنّفه الآن بهدوء
  classifyPending(refreshChip);

  // ---- تصحيح التصنيف يدوياً ----
  const sheet = root.querySelector('#sheet');
  let editing = null;
  log.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-entry]');
    if (!chip) return;
    editing = chip.dataset.entry;
    sheet.hidden = false;
  });
  sheet.addEventListener('click', async (e) => {
    const pick = e.target.closest('.chip[data-cat]');
    if (pick && editing) refreshChip(await setCategory(editing, pick.dataset.cat));
    if (pick || e.target === sheet) { sheet.hidden = true; editing = null; }
  });

  // تكبير خانة الكتابة مع النص
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault(); form.requestSubmit();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });

  async function send(raw, source = 'text') {
    const text = raw.trim();
    if (!text || busy) return;
    busy = true;
    stopSpeaking();
    input.value = ''; autosize();

    // نحفظ كلام المستخدم أولاً حتى لا يضيع شيء
    const entry = await addEntry({ text, source });
    await addMessage({ role: 'user', text, entryId: entry.id });
    append('user', text, '', entry);

    // التصنيف يعمل بالتوازي مع رد الرفيقة
    classifyEntry(entry).then(refreshChip).catch(() => {});

    companion.setState('thinking');
    say('<span class="dots"><i></i><i></i><i></i></span>');
    const pending = append('model', '…', 'msg--pending');

    try {
      const recent = await getMessages(HISTORY_LIMIT);
      const history = recent.map(({ role, text }) => ({ role, text }));

      // نبحث محلياً في العقل الثاني عمّا له صلة، ونستبعد ما هو موجود أصلاً في المحادثة الحالية
      let used = [];
      if (await getSetting('useMemory', true)) {
        const inChat = recent.map((m) => m.entryId).filter(Boolean);
        const prevUser = recent.filter((m) => m.role === 'user').at(-2)?.text || '';
        used = recall(await getEntries(), text, { previous: prevUser, exclude: inChat });
      }
      const memories = used.map((e) => ({
        createdAt: e.createdAt, text: e.text, done: !!e.meta?.done,
        categoryLabel: categoryById(e.category)?.label || '',
      }));

      const reply = await chat(history, { memories });
      await addMessage({ role: 'model', text: reply, used: used.map((e) => e.id) });
      pending.querySelector('.msg__text').textContent = reply;
      pending.classList.remove('msg--pending');
      if (used.length) renderUsed(pending, used);
      say(escapeHtml(bubbleText(reply)));
      log.scrollTop = log.scrollHeight;
      await talk(reply);
    } catch (err) {
      pending.remove();
      companion.setState('idle');
      if (err.code === 'NO_KEY' || err.code === 'BAD_KEY') {
        say(`${err.message} <a href="#/settings">افتح الإعدادات</a> لإضافته. كلامك محفوظ على أي حال 💜`);
      } else {
        say(`${escapeHtml(err.message)} كلامك محفوظ.`);
      }
    } finally {
      busy = false;
      if (companion?.state === 'thinking') companion.setState('idle');
    }
  }

  async function talk(text) {
    const voiceOn = await getSetting('speakReplies', true);
    if (!voiceOn) {
      companion.setState('talking');
      setTimeout(() => companion?.state === 'talking' && companion.setState('idle'), Math.min(4000, 600 + text.length * 45));
      return;
    }
    speak(text, {
      onStart: () => companion?.setState('talking'),
      onEnd: () => companion?.state === 'talking' && companion.setState('idle'),
    });
  }

  mic?.addEventListener('click', () => {
    if (stopListening) { stopListening(); return; }
    if (busy) return;
    stopSpeaking();
    companion.setState('listening');
    mic.classList.add('is-on');
    say('أسمعك…');
    try {
      stopListening = listen({
        onInterim: (t) => { input.value = t; autosize(); },
        onText: (t) => send(t, 'voice'),
        onError: (code) => {
          if (code === 'not-allowed') say('أحتاج إذن الميكروفون لأسمعك.');
          else if (code === 'no-speech') say('لم أسمع شيئاً، جرّب مرة أخرى.');
        },
        onEnd: () => {
          stopListening = null;
          mic.classList.remove('is-on');
          if (companion?.state === 'listening') companion.setState('idle');
        },
      });
    } catch {
      stopListening = null;
      mic.classList.remove('is-on');
      companion.setState('idle');
      say('الإدخال الصوتي غير متاح في هذا المتصفح.');
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
