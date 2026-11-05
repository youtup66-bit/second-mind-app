// شاشة مجموعة المؤسسة: محادثة مشتركة مثل مجموعة واتساب (نصوص وصور وكلام يتحول إلى نص)
import {
  startGroupSync, groupEvents, groupMe, groupMembers, groupOnline, sendGroup, resend, markSeen, compressImage,
} from '../group.js';
import { getGroupMessages } from '../storage.js';
import { session } from '../cloud.js';
import { attachHoldMic } from '../hold-mic.js';
import { canListen, canBrowserListen } from '../voice.js';

export const title = 'منشورات الأعمال';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = new Intl.DateTimeFormat('ar', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (t) => {
  const d = new Date(t), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'اليوم';
  if (d.toDateString() === y.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });
};
// لون ثابت لكل مرسل (مثل أسماء مجموعات واتساب)
const NAME_COLORS = ['#53bdeb', '#ffd279', '#a5b337', '#fc9775', '#d88deb', '#71eb85', '#ff8aa5', '#f7b955', '#35cd96', '#7f66ff'];
const colorFor = (uid) => NAME_COLORS[[...String(uid)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % NAME_COLORS.length];
const TICKS = { queued: '🕓', sent: '✓', failed: '⚠️' };

let cleanup = [];

export async function mount(root) {
  root.innerHTML = '<p class="muted org-wait">لحظة…</p>';
  const s = await session().catch(() => null);
  if (!root.isConnected) return;
  if (!s?.member) {
    root.innerHTML = `<div class="org"><div class="org-hero"><div class="org-hero__icon" aria-hidden="true">💬</div>
      <h2>منشورات الأعمال</h2><p class="muted">ادخل إلى المؤسسة أولاً.</p></div>
      <a class="btn org-wide" href="#/org">الدخول إلى المؤسسة</a></div>`;
    return;
  }

  const manager = s.member.role === 'manager';
  // الموظف بلا ذكاء: الميكروفون بخدمة المتصفح فقط
  const micOk = manager ? canListen : canBrowserListen;
  root.innerHTML = `
    <section class="chat chat--wa chat--plain chat--group">
      <header class="wa-head">
        <div class="wa-head__who">
          <span class="wa-avatar wa-avatar--group" aria-hidden="true">${esc((s.org?.name || 'م').trim().charAt(0))}</span>
          <span class="wa-head__text"><b>${esc(s.org?.name || 'المؤسسة')}</b><small id="g-status"></small></span>
        </div>
      </header>
      <p class="wa-note" id="g-note" hidden role="status"></p>
      <ol class="chat__log" id="g-log" aria-label="رسائل المجموعة"></ol>
      <form class="composer" id="g-form" autocomplete="off">
        <button type="button" class="composer__mic" id="g-mic" aria-label="اضغط مطولاً للتسجيل" ${micOk ? '' : 'hidden'}>🎙</button>
        <textarea id="g-input" rows="1" placeholder="اكتب منشور عمل" aria-label="منشورك"></textarea>
        <button type="button" class="composer__attach" id="g-attach" aria-label="أرسل صورة">📷</button>
        <input type="file" id="g-file" accept="image/*" hidden>
        <button type="submit" class="composer__send" id="g-send" aria-label="إرسال">➤</button>
      </form>
      <div class="img-view" id="g-view" hidden><img alt=""></div>
    </section>`;

  const log = root.querySelector('#g-log');
  const form = root.querySelector('#g-form');
  const input = root.querySelector('#g-input');
  const statusEl = root.querySelector('#g-status');
  const note = root.querySelector('#g-note');
  const view = root.querySelector('#g-view');
  let noteTimer = 0;
  const say = (html) => {
    note.innerHTML = html;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; }, 6000);
  };

  const renderStatus = () => {
    const n = groupMembers().size;
    statusEl.textContent = !groupOnline() ? 'بلا إنترنت · الرسائل تُرسل عند الاتصال'
      : n === 1 ? 'عضو واحد' : n === 2 ? 'عضوان' : n ? `${n} ${n <= 10 ? 'أعضاء' : 'عضواً'}` : 'متصل';
  };

  // ---- عرض الرسائل ----
  let lastDay = '';
  function bubble(m) {
    const li = document.createElement('li');
    li.className = `msg ${m.mine ? 'msg--user' : 'msg--model'}`;
    li.dataset.id = m.id;
    fill(li, m);
    return li;
  }
  function fill(li, m) {
    // بلا مسافات بين العناصر (الفقاعة تحفظ الأسطر كما كُتبت)
    li.innerHTML = [
      m.mine ? '' : `<span class="msg__from" style="color:${colorFor(m.from)}">${esc(m.fromName)}</span>`,
      m.image ? `<img class="msg__img" src="${m.image}" alt="صورة" loading="lazy">` : '',
      m.text ? `<span class="msg__text">${esc(m.text)}</span>` : '',
      `<span class="msg__time">${fmtTime.format(m.sentAt)}${m.mine ? ` <span class="tick tick--${m.status}">${TICKS[m.status] || ''}</span>` : ''}</span>`,
      m.mine && m.status === 'failed' ? '<button type="button" class="msg__retry">لم تُرسل · أعد المحاولة</button>' : '',
    ].join('');
  }
  function addDay(t) {
    const dk = new Date(t).toDateString();
    if (dk === lastDay) return;
    lastDay = dk;
    const sep = document.createElement('li');
    sep.className = 'wa-day';
    sep.textContent = dayLabel(t);
    log.append(sep);
  }
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  function append(m, scroll = true) {
    if (log.querySelector(`[data-id="${CSS.escape(m.id)}"]`)) return;
    const last = [...log.querySelectorAll('.msg')].pop();
    // رسالة أقدم (أرشيف وصل متأخراً): نعيد الرسم بالترتيب
    if (last && Number(last.dataset.t) > m.sentAt) { renderAll(); return; }
    const stick = atBottom();
    addDay(m.sentAt);
    const li = bubble(m);
    li.dataset.t = m.sentAt;
    log.append(li);
    if (scroll && (stick || m.mine)) log.scrollTop = log.scrollHeight;
  }
  async function renderAll() {
    const all = await getGroupMessages();
    log.innerHTML = '';
    lastDay = '';
    if (!all.length) log.innerHTML = '<li class="wa-day">لا منشورات بعد. اكتب ما أنجزته من أعمال 👋</li>';
    for (const m of all) {
      addDay(m.sentAt);
      const li = bubble(m);
      li.dataset.t = m.sentAt;
      log.append(li);
    }
    log.scrollTop = log.scrollHeight;
  }

  // ---- الإرسال ----
  const syncComposer = () => form.classList.toggle('has-text', !!input.value.trim());
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
  input.addEventListener('input', () => { autosize(); syncComposer(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = ''; autosize(); syncComposer();
    if (log.querySelector('.wa-day') && !log.querySelector('.msg')) log.innerHTML = '';
    try { await sendGroup({ text }); } catch (err) { say(esc(err.message)); input.value = text; syncComposer(); }
  });

  const file = root.querySelector('#g-file');
  root.querySelector('#g-attach').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    say('أجهّز الصورة…');
    try {
      const image = await compressImage(f);
      if (log.querySelector('.wa-day') && !log.querySelector('.msg')) log.innerHTML = '';
      await sendGroup({ image, text: input.value.trim() });
      input.value = ''; autosize(); syncComposer();
      note.hidden = true;
    } catch (err) { say(`تعذّر إرسال الصورة: ${esc(err.message)}`); }
  });

  const mic = root.querySelector('#g-mic');
  const holdMic = micOk ? attachHoldMic({
    mic, form, input, say, gemini: manager,
    onBusy: (on) => { if (on) say('أحوّل كلامك إلى نص…'); else note.hidden = true; },
    onText: async (text) => {
      if (log.querySelector('.wa-day') && !log.querySelector('.msg')) log.innerHTML = '';
      try { await sendGroup({ text }); } catch (err) { say(esc(err.message)); }
    },
  }) : null;

  log.addEventListener('click', async (e) => {
    const img = e.target.closest('.msg__img');
    if (img) { view.querySelector('img').src = img.src; view.hidden = false; return; }
    const retry = e.target.closest('.msg__retry');
    if (retry) {
      const id = retry.closest('.msg').dataset.id;
      const m = (await getGroupMessages()).find((x) => x.id === id);
      if (m) resend(m);
    }
  });
  view.addEventListener('click', () => { view.hidden = true; });

  // ---- الأحداث ----
  const onMsg = (e) => { append(e.detail.msg); markSeen(); };
  const onUpdate = (e) => {
    const li = log.querySelector(`[data-id="${CSS.escape(e.detail.msg.id)}"]`);
    if (li) fill(li, e.detail.msg);
    if (e.detail.msg.status === 'failed' && /permission/i.test(e.detail.msg.error || '')) {
      say('لم تُرسل: القواعد في Firebase قديمة. انسخ قواعد الحماية الجديدة والصقها في Firestore ← Rules ← Publish.');
    }
  };
  groupEvents.addEventListener('message', onMsg);
  groupEvents.addEventListener('update', onUpdate);
  groupEvents.addEventListener('members', renderStatus);
  groupEvents.addEventListener('status', renderStatus);
  cleanup.push(() => {
    groupEvents.removeEventListener('message', onMsg);
    groupEvents.removeEventListener('update', onUpdate);
    groupEvents.removeEventListener('members', renderStatus);
    groupEvents.removeEventListener('status', renderStatus);
    holdMic?.stop();
  });

  await renderAll();
  renderStatus();
  markSeen();
  startGroupSync().then(renderStatus).catch((err) => say(esc(err.message)));
  if (!groupMe()) renderStatus();
}

export function unmount() {
  cleanup.forEach((f) => f());
  cleanup = [];
}
