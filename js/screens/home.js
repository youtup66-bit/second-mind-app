// شاشة الرفيقة: الشخصية الطافية + المحادثة صوتاً أو كتابة
import { createCompanion } from '../companion.js';
import { addEntry, addMessage, getMessages, getSetting } from '../storage.js';
import { chat } from '../gemini.js';
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
    </section>
  `;

  const bubble = root.querySelector('#bubble');
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

  function append(role, text, extra = '') {
    const li = document.createElement('li');
    li.className = `msg msg--${role} ${extra}`;
    li.textContent = text;
    log.append(li);
    log.scrollTop = log.scrollHeight;
    return li;
  }

  (await getMessages(50)).forEach((m) => append(m.role, m.text));

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

    // نحفظ كلام المستخدم أولاً، والتصنيف يأتي في المرحلة ٤
    const entry = await addEntry({ text, source });
    await addMessage({ role: 'user', text, entryId: entry.id });
    append('user', text);

    companion.setState('thinking');
    say('<span class="dots"><i></i><i></i><i></i></span>');
    const pending = append('model', '…', 'msg--pending');

    try {
      const history = (await getMessages(HISTORY_LIMIT)).map(({ role, text }) => ({ role, text }));
      const reply = await chat(history);
      await addMessage({ role: 'model', text: reply });
      pending.textContent = reply;
      pending.classList.remove('msg--pending');
      say(escapeHtml(reply));
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
