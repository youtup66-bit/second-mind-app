// شاشة منشورات الأعمال: قائمة مجموعات مثل واتساب (العامة، ومجموعة لكل كرة أنت فيها)،
// وكل مجموعة محادثة مستقلة (نصوص وصور وكلام يتحول إلى نص). ‎#/group‎ القائمة · ‎#/group?room=…‎ المحادثة
import {
  startGroupSync, groupEvents, groupMe, groupMembers, groupOnline, groupRooms, sendGroup, resend, markSeen, compressImage, compressVideo, blobToDataUrl, chunkMax,
  GENERAL, roomOf, unreadByRoom, roomNameOf, groupBranch, isChatRoom, groupInvites, myContacts, saveChat, deleteChat, acceptInvite, declineInvite, leaveChat,
} from '../group.js';
import { PALETTE } from '../org-structure.js';
import { getGroupMessages, getSetting } from '../storage.js';
import { sendObjection, listObjections } from '../objections.js';
import { session, cloudConfig } from '../cloud.js';
import { attachHoldMic } from '../hold-mic.js';
import { pendingShare, takeShare } from '../share-inbox.js';
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

// mode: 'work' منشورات الأعمال (العامة ومجموعات الكرات) · 'chat' مجموعات المحادثة
// المحادثة تضم الآن الكروبات كلها: الأعمال صارت قسماً «الأقسام» فيها
export const mount = (root) => mountMode(root, 'chat');
export async function mountMode(root, mode) {
  const base = '#/chats';
  const tabParam = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  const tab = TABS.some((x) => x[0] === tabParam) ? tabParam : 'chats';
  const hashQ = new URLSearchParams(location.hash.split('?')[1] || '');
  if (hashQ.get('view') === 'groups' && !hashQ.get('room')) {
    // العناوين تظهر فوراً أثناء التحميل، فلا تختفي عند التنقل بين التبويبات
    root.innerHTML = `<section class="chat chat--wa chat--plain chat--group g-list">
      <nav class="chats-words" aria-label="أقسام المحادثات">${TABS.map(([id, label]) => (id === tab ? `<b aria-current="page">${label}</b>` : `<a href="#/chats?tab=${id}&view=groups">${label}</a>`)).join('')}</nav>
      <div class="g-pane"></div>
    </section>`;
  } else {
    root.innerHTML = '<p class="muted org-wait">لحظة…</p>';
  }
  const s = await session().catch(() => null);
  if (!root.isConnected) return;
  if (!s?.member) {
    root.innerHTML = `<div class="org"><div class="org-hero"><div class="org-hero__icon" aria-hidden="true">💬</div>
      <h2>منشورات الأعمال</h2><p class="muted">ادخل إلى المؤسسة أولاً.</p></div>
      <a class="btn org-wide" href="#/org">الدخول إلى المؤسسة</a></div>`;
    return;
  }

  const manager = s.member.role === 'manager';
  const room = new URLSearchParams(location.hash.split('?')[1] || '').get('room');
  // نبدأ المزامنة أولاً: هي التي تحدد أرشيف أي حساب يُعرض
  const syncErr = await startGroupSync().then(() => '', (err) => err.message);
  if (!root.isConnected) return;
  if (!room) return mountList(root, s, syncErr, mode, tab);
  const orgName = s.org?.name || 'المؤسسة';
  const roomInfo = () => (room === GENERAL ? { name: orgName, color: '#22c55e' } : groupRooms().get(room) || pastRoom(room));
  let pastName = '';
  const pastRoom = () => ({ name: pastName || roomNameOf(room) || 'مجموعة سابقة', color: '#6b7c85', past: true });
  // الموظف بلا ذكاء: الميكروفون بخدمة المتصفح فقط
  const micOk = manager ? canListen : canBrowserListen;
  root.innerHTML = `
    <section class="chat chat--wa chat--plain chat--group">
      <header class="wa-head">
        <a class="wa-head__back" href="${base}" aria-label="رجوع إلى المجموعات">→</a>
        <div class="wa-head__who">
          <span class="wa-avatar wa-avatar--group" id="g-avatar" aria-hidden="true"></span>
          <span class="wa-head__text"><b id="g-name"></b><small id="g-status"></small></span>
        </div>
        <button type="button" class="text-btn g-edit" id="g-edit" hidden></button>
      </header>
      <p class="wa-note" id="g-note" hidden role="status"></p>
      <ol class="chat__log" id="g-log" aria-label="رسائل المجموعة"></ol>
      <p class="g-past" id="g-past" hidden>لم تعد عضواً في هذه المجموعة؛ تبقى رسائلها عندك للقراءة.</p>
      <form class="composer" id="g-form" autocomplete="off">
        <button type="button" class="composer__mic" id="g-mic" aria-label="اضغط مطولاً للتسجيل" ${micOk ? '' : 'hidden'}>🎙</button>
        <textarea id="g-input" rows="1" placeholder="اكتب منشور عمل" aria-label="منشورك"></textarea>
        <button type="button" class="composer__attach" id="g-attach" aria-label="أرسل صورة">📎</button>
        <button type="submit" class="composer__send" id="g-send" aria-label="إرسال">➤</button>
      </form>
      <div class="img-view" id="g-view" hidden><img alt=""></div>
    </section>`;

  const log = root.querySelector('#g-log');
  const form = root.querySelector('#g-form');
  const input = root.querySelector('#g-input');
  const statusEl = root.querySelector('#g-status');
  const note = root.querySelector('#g-note');
  // قرارات اعتراضاتي (تصل من المدير): تظهر في أعلى القائمة
  async function showDecisions() {
    const el = root.querySelector('#g-decisions');
    if (!el) return;
    const decided = (await listObjections()).filter((o) => o.sentByMe && (o.status === 'accepted' || o.status === 'rejected')).slice(0, 3);
    el.innerHTML = decided.map((o) => `<p class="wa-note">${o.status === 'accepted' ? '✅ قُبل اعتراضك' : '❌ لم يُقبل اعتراضك'}${o.reply ? `: ${esc(o.reply)}` : ''}</p>`).join('');
  }
  showDecisions();
  window.addEventListener('sm:objections', showDecisions);
  const view = root.querySelector('#g-view');
  let noteTimer = 0;
  const say = (html) => {
    note.innerHTML = html;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; }, 6000);
  };

  const renderStatus = () => {
    const info = roomInfo();
    root.querySelector('#g-name').textContent = info.name;
    const av = root.querySelector('#g-avatar');
    av.textContent = initial(info.name);
    av.style.background = info.color;
    av.style.color = textOn(info.color);
    root.querySelector('#g-past').hidden = !info.past;
    // مجموعة المحادثة: صاحبها يعدّلها، وغيره يغادرها
    const edit = root.querySelector('#g-edit');
    edit.hidden = !isChatRoom(room) || !!info.past;
    edit.textContent = info.owner === groupMe()?.uid ? 'تعديل' : 'مغادرة';
    form.hidden = !!info.past;
    // المجموعة تُثري عقل المؤسسة: يعرف أعضاؤها ذلك دائماً (A32)
    statusEl.dataset.enrich = isChatRoom(room) && info.enrich ? '1' : '';
    const n = room === GENERAL ? groupMembers().size : info.past ? 0 : info.members.filter((u) => groupMembers().has(u)).length;
    statusEl.textContent = !groupOnline() ? 'بلا إنترنت · الرسائل تُرسل عند الاتصال'
      : info.past ? '' : n === 1 ? 'عضو واحد' : n === 2 ? 'عضوان' : n ? `${n} ${n <= 10 ? 'أعضاء' : 'عضواً'}` : 'متصل';
    if (statusEl.dataset.enrich && groupOnline()) statusEl.textContent += ' · تُثري عقل المؤسسة';
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
      m.image && m.image.startsWith('data:video/') ? `<video class="msg__video" src="${m.image}" controls playsinline preload="metadata"></video>` : m.image ? `<img class="msg__img" src="${m.image}" alt="صورة" loading="lazy">` : '',
      m.text ? `<span class="msg__text">${esc(m.text)}</span>` : '',
      `<span class="msg__time">${fmtTime.format(m.sentAt)}${m.mine ? ` <span class="tick tick--${m.status}">${TICKS[m.status] || ''}</span>` : ''}</span>`,
      m.mine && m.status === 'failed' ? '<button type="button" class="msg__retry">لم تُرسل · أعد المحاولة</button>' : '',
      m.mine && m.status !== 'failed' && (m.works?.length || m.work) ? '<button type="button" class="msg__object">اعتراض على النقطة</button>' : '',
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
    const all = (await getGroupMessages()).filter((m) => roomOf(m) === room);
    pastName = all.find((m) => m.roomName)?.roomName || '';
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
    try { await sendGroup({ text, room }); } catch (err) { say(esc(err.message)); input.value = text; syncComposer(); }
  });

  // إرسال صورة: كل ضغطة تنشئ حقل اختيار جديداً وتفتحه داخل حدث النقر نفسه (أضمن طريقة على أندرويد)
  // يفتح عند بداية اللمس (كما يفعل زر الميكروفون)، لأن حدث النقر قد لا يصل على بعض الهواتف
  root.querySelector('#g-attach').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    say('افتح الصور…');
    const pick = document.createElement('input');
    pick.type = 'file';
    pick.accept = 'image/*,video/*';
    // غير مرئي لكن موجود في الصفحة بحجم صغير: بعض الهواتف لا تفتح حقلاً مخفياً تماماً
    Object.assign(pick.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(pick);
    pick.addEventListener('change', async () => {
      const f = pick.files?.[0];
      pick.remove();
      if (!f) return;
      const isVideo = f.type.startsWith('video/');
      // خيار إضافي: الملف كاملاً بلا ضغط، يُقسَّم إلى أجزاء (أبطأ، لكنه يحفظ الجودة)
      const full = confirm('إرسال الملف كاملاً بدون ضغط؟\n\nموافق: كامل، ويُقسَّم إلى أجزاء (أبطأ، حتى نحو 25 ميجابايت)\nإلغاء: مضغوط كالمعتاد (أسرع، وجودة أقل)');
      say(full ? 'أجهّز الملف كاملاً…' : isVideo ? 'أجهّز الفيديو…' : 'أجهّز الصورة…');
      try {
        let image, chunked = false;
        if (full) {
          image = await blobToDataUrl(f);
          if (image.length > chunkMax) throw new Error('الملف أكبر من 25 ميجابايت، جرّب الوضع المضغوط.');
          chunked = true;
        } else if (isVideo) {
          image = await blobToDataUrl(await compressVideo(f));
          if (image.length > 890000) throw new Error('الفيديو طويل، جرّب مقطعاً أقصر.');
        } else {
          image = await compressImage(f);
        }
        if (log.querySelector('.wa-day') && !log.querySelector('.msg')) log.innerHTML = '';
        await sendGroup({ image, text: input.value.trim(), room, chunked });
        input.value = ''; autosize(); syncComposer();
        note.hidden = true;
      } catch (err) { say(`تعذّر إرسال الصورة: ${esc(err.message)}`); }
    });
    try { pick.click(); } catch (err) { say(`تعذّر فتح نافذة الصور: ${esc(err.message)}`); }
  });

  // صورة مشاركة من المعرض: تُرسل إلى هذه المحادثة مرة واحدة (اختارها المستخدم من القائمة)
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('share') === '1') {
    history.replaceState(null, '', location.href.replace(/[&?]share=1/, ''));
    takeShare().then(async (blob) => {
      if (!blob) return;
      say('أجهّز الصورة المشاركة…');
      try {
        const image = await compressImage(new File([blob], 'shared.jpg', { type: blob.type || 'image/jpeg' }));
        await sendGroup({ image, text: '', room });
        say('أُرسلت الصورة ✓');
      } catch (err) { say(`تعذّر إرسال الصورة: ${esc(err.message)}`); }
    });
  }

  const mic = root.querySelector('#g-mic');
  const holdMic = micOk ? attachHoldMic({
    mic, form, input, say, gemini: manager,
    onBusy: (on) => { if (on) say('أحوّل كلامك إلى نص…'); else note.hidden = true; },
    onText: async (text) => {
      if (log.querySelector('.wa-day') && !log.querySelector('.msg')) log.innerHTML = '';
      try { await sendGroup({ text, room }); } catch (err) { say(esc(err.message)); }
    },
  }) : null;

  log.addEventListener('click', async (e) => {
    const img = e.target.closest('.msg__img');
    if (img) { view.querySelector('img').src = img.src; view.hidden = false; return; }
    const obj = e.target.closest('.msg__object');
    if (obj) {
      const id = obj.closest('.msg').dataset.id;
      const m = (await getGroupMessages()).find((x) => x.id === id);
      const reason = m && window.prompt('اكتب سبب الاعتراض (يصل إلى المدير وحده):');
      if (m && reason && reason.trim()) {
        try { await sendObjection(m, reason.trim()); window.alert('أُرسل اعتراضك إلى المدير.'); }
        catch (err) { window.alert(err.message); }
      }
      return;
    }
    const retry = e.target.closest('.msg__retry');
    if (retry) {
      const id = retry.closest('.msg').dataset.id;
      const m = (await getGroupMessages()).find((x) => x.id === id);
      if (m) resend(m);
    }
  });
  view.addEventListener('click', () => { view.hidden = true; });

  // ---- الأحداث ----
  const onMsg = (e) => { if (roomOf(e.detail.msg) !== room) return; append(e.detail.msg); markSeen(room); };
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
  groupEvents.addEventListener('rooms', renderStatus);
  groupEvents.addEventListener('status', renderStatus);
  cleanup.push(() => {
    groupEvents.removeEventListener('message', onMsg);
    groupEvents.removeEventListener('update', onUpdate);
    groupEvents.removeEventListener('members', renderStatus);
    groupEvents.removeEventListener('rooms', renderStatus);
    groupEvents.removeEventListener('status', renderStatus);
    holdMic?.stop();
  });

  root.querySelector('#g-edit').addEventListener('click', async () => {
    const r = groupRooms().get(room);
    if (!r) return;
    if (r.owner === groupMe()?.uid) { openEditor(root, { id: room, ...r }); return; }
    if (!confirm(`مغادرة «${r.name}»؟ تبقى رسائلها السابقة عندك للقراءة.`)) return;
    try { await leaveChat(room); location.hash = base; } catch (err) { say(esc(err.message)); }
  });
  if (syncErr) say(esc(syncErr));
  await renderAll();
  renderStatus();
  markSeen(room);
}

// ---- قائمة المجموعات ----
const initial = (name) => String(name || 'م').trim().replace(/^(شعبة|وحدة|قسم|مشروع)\s+/, '').replace(/^ال(?=..)/, '').charAt(0) || 'م';
// نص أسود على الألوان الفاتحة (القسم الأبيض والأصفر)
const textOn = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.65 ? '#06140f' : '#fff';
};
const KIND = { division: 'شعبة', unit: 'وحدة', section: 'قسم وحدة', custom: 'كرة', chat: 'محادثة' };

// ---- إنشاء مجموعة محادثة أو تعديلها ----
// الأعضاء: من في وحدتك وما تحتها تختارهم مباشرة (والمدير يختار أي موظف)؛
// ومن هو أعلى منك تكتب اسمه فتصله دعوة ينضم بها بنفسه.
function openEditor(root, g = null) {
  root.querySelector('.g-sheet')?.remove();
  const me = groupMe();
  const all = groupMembers();
  const name = (u) => all.get(u)?.name || 'عضو';
  const byName = (a, b) => name(a).localeCompare(name(b), 'ar');
  const direct = new Set(myContacts());
  for (const u of g?.members || []) if (u !== me.uid) direct.add(u); // أعضاء حاليون يبقون في القائمة
  const listed = [...direct].filter((u) => all.has(u)).sort(byName);
  const chosen = new Set((g?.members || []).filter((u) => u !== me.uid));
  const invited = new Set(g?.invited || []);
  const canInvite = me.role !== 'manager';
  let color = g?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const el = document.createElement('div');
  el.className = 'sheet g-sheet';
  el.innerHTML = `
    <form class="sheet__panel sheet__panel--tall" role="dialog" aria-label="${g ? 'تعديل المجموعة' : 'مجموعة جديدة'}">
      <p class="sheet__title">${g ? 'تعديل المجموعة' : 'مجموعة محادثة جديدة'}</p>
      <input id="ge-name" maxlength="60" required placeholder="اسم المجموعة، مثل: فريق المناوبة" value="${esc(g?.name || '')}">
      <div class="g-colors" role="radiogroup" aria-label="اللون">${PALETTE.map((c) => `<button type="button" class="g-color" data-c="${c}" style="background:${c}" aria-label="لون" aria-checked="${c === color}" role="radio"></button>`).join('')}</div>
      <div class="g-scroll">
        <p class="g-sub">${me.role === 'manager' ? 'الأعضاء' : 'من وحدتك وما تحتها'} <small id="ge-count"></small></p>
        <ul class="g-pick">${listed.length ? listed.map((u) => `<li><label><input type="checkbox" value="${esc(u)}" ${chosen.has(u) ? 'checked' : ''}><span>${esc(name(u))}</span></label></li>`).join('') : '<li class="muted g-none">لا أحد في وحدتك بعد.</li>'}</ul>
        ${canInvite ? `<p class="g-sub">مسؤول أعلى منك <small>اكتب اسمه فتصله دعوة</small></p>
        <input id="ge-find" placeholder="اكتب الاسم" autocomplete="off">
        <ul class="g-found" id="ge-found"></ul>
        <ul class="g-invited" id="ge-invited"></ul>` : ''}
        <label class="switch g-enrich"><input type="checkbox" id="ge-enrich" ${g?.enrich ? 'checked' : ''}><span>تُثري عقل المؤسسة<small>يصنّف المساعد عند رئيس القسم منشوراتها (سؤال، فكرة، قرار…) إن كان عضواً فيها. يظهر ذلك لكل الأعضاء.</small></span></label>
      </div>
      <p class="wa-note" id="ge-msg" hidden></p>
      <div class="g-sheet__actions">
        <button class="btn" type="submit">${g ? 'حفظ' : 'إنشاء'}</button>
        <button class="btn btn--ghost" type="button" data-a="close">إلغاء</button>
        ${g ? '<button class="text-btn is-danger" type="button" data-a="delete">حذف المجموعة</button>' : ''}
      </div>
    </form>`;
  root.append(el);
  const $ = (q) => el.querySelector(q);
  const count = () => { $('#ge-count').textContent = `(${el.querySelectorAll('.g-pick input:checked').length})`; };
  count();
  $('.g-pick').addEventListener('change', count);
  const renderInvited = () => {
    if (!canInvite) return;
    $('#ge-invited').innerHTML = [...invited].map((u) => `<li>دعوة إلى <b>${esc(name(u))}</b> <button type="button" class="text-btn text-btn--muted" data-uninvite="${esc(u)}">إلغاء</button></li>`).join('');
  };
  renderInvited();
  // البحث بالاسم: لا تظهر الأسماء إلا لمن يكتب حرفين على الأقل
  $('#ge-find')?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    const found = q.length < 2 ? [] : [...all].filter(([u, m]) => u !== me.uid && !direct.has(u) && !invited.has(u) && m.name.includes(q)).slice(0, 6);
    $('#ge-found').innerHTML = found.map(([u, m]) => `<li><span>${esc(m.name)}${m.role === 'manager' ? ' <small>المدير</small>' : ''}</span><button type="button" class="text-btn" data-invite="${esc(u)}">ادعُ</button></li>`).join('')
      || (q.length >= 2 ? '<li class="muted">لا أحد بهذا الاسم.</li>' : '');
  });
  el.querySelector('.g-colors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    color = b.dataset.c;
    el.querySelectorAll('.g-color').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  const close = () => el.remove();
  el.addEventListener('click', async (e) => {
    const inv = e.target.closest('[data-invite]'), un = e.target.closest('[data-uninvite]');
    if (inv) { invited.add(inv.dataset.invite); $('#ge-find').value = ''; $('#ge-found').innerHTML = ''; renderInvited(); return; }
    if (un) { invited.delete(un.dataset.uninvite); renderInvited(); return; }
    if (e.target === el || e.target.closest('[data-a="close"]')) return close();
    if (e.target.closest('[data-a="delete"]')) {
      if (!confirm(`حذف «${g.name}»؟ تبقى رسائلها السابقة عند كل عضو للقراءة.`)) return;
      try { await deleteChat(g.id); close(); location.hash = '#/chats'; } catch (err) { $('#ge-msg').textContent = err.message; $('#ge-msg').hidden = false; }
    }
  });
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#ge-msg');
    const btn = el.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const saved = await saveChat({
        id: g?.id, name: $('#ge-name').value, color,
        members: [...el.querySelectorAll('.g-pick input:checked')].map((x) => x.value),
        invited: [...invited],
        enrich: $('#ge-enrich').checked,
      });
      close();
      if (!g) location.hash = `#/chats?room=${encodeURIComponent(saved.id)}`;
    } catch (err) {
      if (/permission/i.test(String(err?.code || err?.message))) {
        const project = (await cloudConfig().catch(() => null))?.projectId || '';
        msg.textContent = `تعذّر الحفظ: قواعد Firebase في المشروع «${project}» قديمة. من «المؤسسة» في هذه النسخة اضغط «نسخ قواعد الحماية» (الإصدار ١١)، والصقها في هذا المشروع، ثم Publish.`;
      } else msg.textContent = err.message;
      msg.hidden = false;
      btn.disabled = false;
    }
  });
  $('#ge-name').focus();
}

// المحادثات بثلاثة أقسام: المحادثات (التي ينشئها الأعضاء)، والأقسام (كروب العامة وكروبات الكرات)، والموظفون (للتواصل المباشر)
const TABS = [['chats', 'المحادثات'], ['sections', 'الأقسام'], ['people', 'المنتسبين']];
const SLIDE_MS = 220;
// اتجاه انزلاق الشاشة الجديدة عند تغيير التبويب (+1 من اليمين، -1 من اليسار، 0 بلا حركة)
let slideIn = 0;
// تغيير التبويب داخل نافذة المجموعات يستبدل الخطوة الحالية في التاريخ بدل أن يضيف خطوة جديدة،
// فزر الرجوع يعود إلى المحادثات الرئيسية ثم يخرج، ولا يمرّ على كل تبويب فتحته
function switchTab(id, dir) {
  slideIn = dir;
  history.replaceState(null, '', `#/chats?tab=${id}&view=groups`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
async function mountList(root, s, syncErr, mode, tab = 'chats') {
  const orgName = s.org?.name || 'المؤسسة';
  const chat = true;
  const base = '#/chats';
  const shareReady = await pendingShare().catch(() => false);
  // نافذة المجموعات: القائمة نفسها بلا كرة المساعد (المساعد يبقى في نافذته)
  const groupsView = new URLSearchParams(location.hash.split('?')[1] || '').get('view') === 'groups';
  // الكرة تظهر في الشاشة الرئيسية للمحادثات فقط، لا في نافذة المجموعات
  const showOrb = !groupsView && (s.member.role === 'manager' || !!groupBranch()?.perms?.assistant);
  // الشاشة الرئيسية للمحادثات: الكرة فقط، وكلمة «مجموعات» تفتح نافذة الكروبات بتبويباتها
  if (!groupsView) {
    // لون الأيقونات وشفافيتها من الإعدادات (افتراضي: أخضر، كامل الوضوح)
    const hex = await getSetting('iconColor', '#4ade80');
    const alpha = Math.min(100, Math.max(10, Number(await getSetting('iconAlpha', 100)) || 100));
    const iconStyle = `--icon-color:${/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#4ade80'};--icon-alpha:${alpha / 100}`;
    // لون الكرة الرئيسية وتوهجها (من الإعدادات)
    const orbHex = await getSetting('orbColor', '#4ade80');
    const glowRaw = Number(await getSetting('orbGlow', 100));
    const glow = Number.isFinite(glowRaw) ? Math.min(100, Math.max(0, glowRaw)) : 100;
    const orbStyle = `--orb:${/^#[0-9a-f]{6}$/i.test(orbHex) ? orbHex : '#4ade80'};--orb-glow:${glow / 100}`;
    const IC = {
      groups: '<circle cx="9" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M3.5 19c.6-3.2 2.7-5 5.5-5s4.9 1.8 5.5 5"/><path d="M14.5 14.2c2.4-.3 4.3 1.2 4.9 4.3"/>',
      data: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.3 3.6 3.6 0 0 0 7 18z"/><path d="M12 15v-5"/><path d="M9.8 12.2L12 10l2.2 2.2"/>',
      tasks: '<rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 4.5V3.5h6v1"/><path d="M8.5 12.5l2 2 3.5-4"/><path d="M8.5 17h7"/>',
      staff: '<circle cx="12" cy="8.5" r="3.8"/><path d="M5 20c.8-3.8 3.4-6 7-6s6.2 2.2 7 6"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      daily: '<rect x="3" y="13" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>',
    };
    const ico = (k) => `<svg class="side-ico" width="24" height="24" viewBox="0 0 24 24" ${k === 'daily' ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8"'} aria-hidden="true">${IC[k]}</svg>`;
    // الكرة الوسطى: حلقات من النقاط تتحرك من المركز داخل الدائرة، وكتابة AI
    const core = '<span class="ring-home__wave" aria-hidden="true"><i></i><i></i><i></i></span><b class="ring-home__ai">AI</b>';
    const manager = s.member.role === 'manager';
    const ringItems = [
      ['مجموعات', '#/chats?tab=chats&view=groups', 'groups', true, '0px', '-165px'],
      ['المهام', '#/tasks', 'tasks', true, '157px', '-51px'],
      ['المنتسبين', '#/staff', 'staff', manager, '97px', '134px'],
      ['الإعدادات', '#/settings', 'settings', true, '-97px', '134px'],
      ['البيانات المركزية', '#/mind', 'data', manager, '-157px', '-51px'],
    ];
    root.innerHTML = `
      <section class="chat chat--wa chat--plain chat--group g-list chats-main chats-main--home" style="${iconStyle};${orbStyle}">
        <div class="ring-home">
          <span class="ring-home__halo" aria-hidden="true"></span>
          <span class="ring-home__arc ring-home__arc--1" aria-hidden="true"></span>
          <span class="ring-home__arc ring-home__arc--2" aria-hidden="true"></span>
          <span class="ring-home__arc ring-home__arc--3" aria-hidden="true"></span>
          ${showOrb ? `<a class="ring-home__core" href="#/home" aria-label="المساعد">${core}</a>` : `<span class="ring-home__core">${core}</span>`}
          ${manager ? `<svg class="ring-daily" id="ring-daily" viewBox="0 0 400 400" aria-label="تقرير اليوم"></svg>
          <div class="ring-daily-info" id="ring-info" hidden></div>
          <button type="button" class="ring-daily-total" id="ring-total">نقاط اليوم <b id="ring-total-n">0</b></button>` : ""}
          <nav class="ring-menu" aria-label="الأقسام">
            ${ringItems.filter((m) => m[3]).map(([label, href, icon, , x, y]) => `<a class="ring-item" href="${href}" style="--x:${x};--y:${y}">${ico(icon)}<span>${label}</span></a>`).join('')}
          </nav>
        </div>
        ${manager ? `<div class="daily-side" id="daily-side"><button type="button" class="daily-close" aria-label="إخفاء التقرير اليومي"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="daily-title">${ico('daily')}<span>تقرير يومي</span></div><div class="daily-list" id="daily-list"><p class="muted">لحظة…</p></div></div>` : ''}
      </section>`;
    if (manager) {
      const { dailyBars } = await import('../daily-report.js');
      const bars = await dailyBars().catch(() => []);
      // أيقونة لكل نوع كرة
      const TYPE_ICO = {
        division: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
        unit: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>',
        section: '<circle cx="12" cy="12" r="3.5"/>',
      };
      const typeIco = (t) => `<svg class="side-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${TYPE_ICO[t] || TYPE_ICO.section}</svg>`;
      const dailyBox = root.querySelector('#daily-list');
      // نقرات التقرير اليومي لا تصل إلى الحلقة (وإلا فتحت قائمة العناوين مع كل لمسة)
      root.querySelector('#daily-side')?.addEventListener('click', (e) => e.stopPropagation());
      // السهم يُخفي التقرير بتأثير موجة صغيرة عند الضغط
      root.querySelector('.daily-close')?.addEventListener('click', () => root.querySelector('#daily-side')?.classList.remove('is-open'));
      const paintBars = () => {
        dailyBox.innerHTML = bars.length
          ? bars.map((b) => `<button type="button" class="daily-row daily-row--link" data-id="${esc(b.id)}"><div class="daily-name">${typeIco(b.type)}<span>${esc(b.name)}</span></div><div class="daily-line"><div class="daily-bar"><div class="daily-fill" style="width:${Math.round(b.ratio * 100)}%"></div></div><span class="daily-pts">${b.points}</span></div></button>`).join('')
          : '<p class="muted">لا نقاط اليوم بعد.</p>';
      };
      paintBars();
      // لمس كرة يفتح تقريرها التفصيلي، والرجوع يعيد القائمة
      dailyBox.addEventListener('click', async (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        const { nodeDetail } = await import('../daily-report.js');
        const d = await nodeDetail(row.dataset.id);
        if (!d) return;
        dailyBox.innerHTML = `<button type="button" class="daily-back" id="daily-back">→ التقرير اليومي</button>
          <div class="daily-detail"><div class="daily-detail__head">${typeIco(d.type)}<b>${esc(d.name)}</b></div>
          <p class="muted">نقاط اليوم: <b>${d.points}</b></p>
          ${d.people.length ? d.people.map((p) => `<div class="daily-row"><div class="daily-name">${esc(p.name)}</div><span class="daily-pts">${p.points}</span></div>`).join('') : '<p class="muted">لا نقاط لهذه الكرة اليوم.</p>'}
          </div>`;
        dailyBox.querySelector('#daily-back').addEventListener('click', paintBars);
      });
      // أقواس الحلقة: كل شعبة قوس طوله بقدر حصتها من نقاط اليوم
      const rd = root.querySelector('#ring-daily');
      const info = root.querySelector('#ring-info');
      const divs = bars.filter((b) => b.type === 'division' && b.points > 0);
      const sum = divs.reduce((a, b) => a + b.points, 0);
      root.querySelector('#ring-total-n').textContent = sum;
      const R = 175, C = 2 * Math.PI * R, GAP = 6;
      const avail = 360 - GAP * divs.length;
      let start = -90;
      rd.innerHTML = divs.map((b, i) => {
        const span = (b.points / sum) * avail;
        const len = (span / 360) * C;
        const rot = start; start += span + GAP;
        const pct = i === 0 ? 100 : Math.max(35, 75 - i * 20);
        return `<circle class="ring-daily__arc" data-i="${i}" cx="200" cy="200" r="${R}" fill="none" stroke="color-mix(in srgb, var(--accent) ${pct}%, transparent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" transform="rotate(${rot.toFixed(1)} 200 200)"></circle>`;
      }).join('');
      rd.addEventListener('click', (e) => {
        const c = e.target.closest('.ring-daily__arc');
        if (!c) return;
        const b = divs[Number(c.dataset.i)];
        info.textContent = `${b.name} · ${b.points} نقطة (${Math.round((b.points / sum) * 100)}٪)`;
        info.hidden = false;
      });
      root.querySelector('#ring-total').addEventListener('click', (e) => {
        e.stopPropagation();
        root.querySelector('#daily-side')?.classList.toggle('is-open');
      });
    }
    const main = root.querySelector('.chats-main');
    // النقر على الحلقة يفتح العناوين أو يغلقها، والكرة الوسطى تفتح المساعد مباشرة
    main?.addEventListener('click', (e) => {
      // لمس خارج التقرير اليومي وهو مفتوح يُنزله، ولا يفتح قائمة العناوين
      const daily = root.querySelector('#daily-side');
      if (daily?.classList.contains('is-open')) { daily.classList.remove('is-open'); return; }
      if (e.target.closest('a') || e.target.closest('.ring-daily, .ring-daily-total, .daily-side')) return;
      main.classList.toggle('is-menu-open');
    });
    // سحب من أسفل الشاشة للأعلى يفتح المساعد، ومن الحافة اليسرى يفتح التقرير اليومي
    let sx = 0, sy = 0, startMid = false, startEdge = false;
    main?.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
      startMid = t.clientY > window.innerHeight * 0.6;
      startEdge = t.clientX < 24;
    }, { passive: true });
    main?.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      const daily = root.querySelector('#daily-side');
      // سحب للأعلى: يظهر التقرير اليومي من الأسفل (للمدير)، وإلا يفتح المساعد
      if (daily && dy < -90 && Math.abs(dx) < 90) { daily.classList.add('is-open'); return; }
      if (daily && dy > 90 && Math.abs(dx) < 90) { daily.classList.remove('is-open'); return; }
      if (!daily && startMid && dy < -90 && Math.abs(dx) < 90) location.hash = '#/home';
    }, { passive: true });
    return;
  }
  root.innerHTML = `
    <section class="chat chat--wa chat--plain chat--group g-list">
      ${showOrb ? `<a class="chats-orb" href="#/home" aria-label="المساعد"><span class="chats-orb__ball" aria-hidden="true"></span></a>` : ''}
      <nav class="chats-words" aria-label="أقسام المحادثات">
        ${TABS.map(([id, label]) => (id === tab ? `<b aria-current="page">${label}</b>` : `<a href="#/chats?tab=${id}${groupsView ? '&view=groups' : ''}">${label}</a>`)).join('')}
      </nav>
      <div class="g-pane" id="g-pane">
      <small class="chats-status" id="g-status"></small>
      ${groupsView ? `<input type="search" class="g-search" id="g-search" placeholder="${tab === 'people' ? 'ابحث عن موظف بالاسم' : tab === 'sections' ? 'ابحث عن كرة بالاسم' : 'ابحث في المحادثات'}" aria-label="بحث">` : ''}
      <p class="wa-note" id="g-note" ${syncErr ? '' : 'hidden'} role="status">${esc(syncErr)}</p>
      <div id="g-decisions"></div>
      <ul class="g-rooms" id="g-rooms" aria-label="${TABS.find((x) => x[0] === tab)?.[1] || ''}"></ul>
      </div>
      ${tab === 'chats' ? '<button type="button" class="g-new" id="g-new">مجموعة جديدة</button>' : ''}
    </section>`;
  root.querySelector('#g-new')?.addEventListener('click', () => openEditor(root));
  // التنقل بين التبويبات: النقر على الكلمة، أو سحب أفقي تتبعه الشاشة بالإصبع ثم تنزلق للتبويب التالي
  const from = TABS.findIndex((x) => x[0] === tab);
  root.querySelector('.chats-words')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const to = new URLSearchParams(a.getAttribute('href').split('?')[1] || '').get('tab');
    const toI = TABS.findIndex((x) => x[0] === to);
    if (toI >= 0 && toI !== from) switchTab(to, toI > from ? -1 : 1);
  });
  // السحب يحرّك نافذة العمل فقط؛ العناوين (المحادثات، الأقسام، المنتسبين) تبقى ثابتة
  const swipeEl = root.querySelector('.g-list');
  const pane = root.querySelector('#g-pane');
  // بعد انتهاء الحركة نزيل التحويل، لأن التحويل يُغيّر مرجع تموضع العناصر الثابتة (مثل زر المجموعة الجديدة)
  const settle = () => setTimeout(() => { pane.style.transition = ''; pane.style.transform = ''; }, SLIDE_MS + 20);
  if (swipeEl && pane) {
    // الشاشة الجديدة تدخل من الجهة التي يقع فيها تبويبها، فتبدو الحركة منطقية مع موقع الكلمات
    if (slideIn) {
      pane.style.transition = 'none';
      pane.style.transform = `translateX(${slideIn * 100}%)`;
      pane.getBoundingClientRect();
      pane.style.transition = `transform ${SLIDE_MS}ms ease-out`;
      pane.style.transform = 'translateX(0)';
      settle();
      slideIn = 0;
    }
    let sx = 0, sy = 0, lock = null, dxNow = 0;
    swipeEl.addEventListener('touchstart', (e) => {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; lock = null; dxNow = 0;
      pane.style.transition = 'none';
    }, { passive: true });
    swipeEl.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      // اتجاه اللمس معكوس: السحب لليمين يُعامل كالسحب لليسار والعكس، والحركة كما هي
      const dx = -(t.clientX - sx), dy = t.clientY - sy;
      if (lock === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (lock !== 'h') return;
      e.preventDefault(); // لا نمرّر الصفحة عمودياً أثناء السحب الأفقي
      // مقاومة عند الحافة: لا يوجد تبويب في ذلك الاتجاه
      const next = dx < 0 ? from + 1 : from - 1;
      const edge = next < 0 || next >= TABS.length;
      dxNow = edge ? dx * 0.25 : dx;
      pane.style.transform = `translateX(${-dxNow}px)`; // عكس اتجاه الإصبع
    }, { passive: false });
    swipeEl.addEventListener('touchend', () => {
      if (lock !== 'h') return;
      const w = pane.offsetWidth || window.innerWidth;
      const dir = dxNow < 0 ? 1 : -1; // التبويب المقصود: التالي (dir=1) أو السابق
      const next = from + dir;
      const commit = next >= 0 && next < TABS.length && Math.abs(dxNow) > Math.min(120, w * 0.25);
      pane.style.transition = `transform ${SLIDE_MS}ms ease-out`;
      if (!commit) { pane.style.transform = 'translateX(0)'; settle(); return; }
      pane.style.transform = `translateX(${dir > 0 ? 100 : -100}%)`; // الحالية تخرج عكس الإصبع
      setTimeout(() => switchTab(TABS[next][0], -dir), SLIDE_MS); // والجديدة تدخل من الجهة المقابلة
    }, { passive: true });
  }
  const list = root.querySelector('#g-rooms');
  const statusEl = root.querySelector('#g-status');
  // بحث الأقسام: يبقى نصه عند إعادة الرسم، ويتجاهل الهمزات والتشكيل والتاء المربوطة
  let q = '';
  const normQ = (s) => String(s || '').toLowerCase().replace(/[ً-ٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
  root.querySelector('#g-search')?.addEventListener('input', (e) => { q = e.target.value; render(); });

  // مراسلة موظف مباشرة: محادثة من شخصين (تُعاد إن وُجدت)، والقواعد تمنع من ليس في جهاتك
  async function openDirect(uid) {
    const me = groupMe();
    const rooms = groupRooms();
    const found = [...rooms].find(([id, r]) => isChatRoom(id) && r.members.length === 2 && r.members.includes(me.uid) && r.members.includes(uid));
    if (found) { location.hash = `#/chats?room=${encodeURIComponent(found[0])}`; return; }
    const name = groupMembers().get(uid)?.name || 'موظف';
    try {
      const r = await saveChat({ name, members: [uid] });
      location.hash = `#/chats?room=${encodeURIComponent(r.id)}`;
    } catch (err) {
      root.querySelector('#g-note').textContent = /permission/i.test(String(err?.code || err?.message))
        ? 'لا تستطيع مراسلة هذا الشخص مباشرة (خارج وحدتك). اطلب من مسؤولك إضافته، أو ادعُه من مجموعة.'
        : err.message;
      root.querySelector('#g-note').hidden = false;
    }
  }

  async function render() {
    const [all, unread] = await Promise.all([getGroupMessages(), unreadByRoom()]);
    const last = new Map(), names = new Map();
    for (const m of all) {
      last.set(roomOf(m), m);
      if (m.roomName) names.set(roomOf(m), m.roomName);
    }
    const rooms = groupRooms();
    const members = groupMembers();
    const members0 = members;
    if (tab === 'people') {
      const me = groupMe();
      const ids = me?.role === 'manager'
        ? [...members0].filter(([u, m]) => u !== me.uid && m.role === 'employee').map(([u]) => u)
        : myContacts().filter((u) => members0.has(u));
      const people = ids.map((u) => ({ uid: u, name: members0.get(u)?.name || 'موظف' })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      // كرات الموظفين بلا حساب بعد (من الهيكل): تظهر هنا بأسمائها، ولا تُراسَل قبل أن يدخل صاحبها
      let pending = [];
      if (me?.role === 'manager') {
        const { loadStructure } = await import('../org-structure.js');
        const { ballInvites } = await import('../org-accounts.js');
        const st = await loadStructure();
        const sent = new Set(Object.values(await ballInvites()).map((x) => x.card).filter(Boolean));
        pending = st.nodes.filter((n) => n.person && !sent.has(n.id)).map((n) => ({ name: n.name, role: ({ member: 'موظف', assistant: 'معاون', personnel: 'ذاتية' })[n.person.title] || 'موظف' }));
      }
      // البحث بالاسم (من حقل البحث أعلى الشاشة)
      const qPeople = normQ(q);
      const peopleShown = people.filter((p) => !qPeople || normQ(p.name).includes(qPeople));
      pending = pending.filter((b) => !qPeople || normQ(b.name).includes(qPeople));
      list.innerHTML = peopleShown.map((p) => `<li><button type="button" class="g-room g-person" data-uid="${esc(p.uid)}">
        <span class="wa-avatar wa-avatar--group" aria-hidden="true">${esc(initial(p.name))}</span>
        <span class="g-room__body"><span class="g-room__top"><b>${esc(p.name)}</b></span><span class="g-room__bottom"><span class="g-room__last"><i>راسِل مباشرة</i></span></span></span></button></li>`).join('')
        + pending.map((b) => `<li class="g-room is-past"><span class="wa-avatar wa-avatar--group" aria-hidden="true">${esc(initial(b.name))}</span>
        <span class="g-room__body"><span class="g-room__top"><b>${esc(b.name)}</b></span><span class="g-room__bottom"><span class="g-room__last"><i>${esc(b.role)} · بلا حساب بعد</i></span></span></span></li>`).join('')
        || `<li class="wa-day">${me?.role === 'manager' ? 'لا موظفين بعد.' : 'لا أحد في وحدتك بعد للمراسلة المباشرة.'}</li>`;
      statusEl.textContent = (people.length + pending.length) ? `${people.length + pending.length} ${people.length + pending.length === 1 ? 'شخص' : 'أشخاص'}` : '';
      return;
    }
    const mineRoom = (id) => (tab === 'sections' ? !isChatRoom(id) : isChatRoom(id));
    const items = tab === 'sections' ? [{ id: GENERAL, name: orgName, color: '#22c55e', kind: 'عامة · الجميع' }] : [];
    for (const [id, r] of rooms) if (mineRoom(id)) items.push({ id, name: r.name, color: r.color, kind: KIND[r.kind] || '' });
    // مجموعات غادرها (أو حُذفت) وما زالت رسائلها عنده
    for (const id of last.keys()) if (id !== GENERAL && mineRoom(id) && !rooms.has(id)) items.push({ id, name: names.get(id) || roomNameOf(id) || 'مجموعة سابقة', color: '#6b7c85', kind: 'سابقة', past: true });
    // الأحدث نشاطاً أولاً، والعامة دائماً في الأعلى
    const t = (it) => last.get(it.id)?.sentAt || 0;
    const top = tab === 'sections' ? [items.shift()].filter(Boolean) : [];
    items.sort((a, b) => (a.past - b.past) || (t(b) - t(a)) || a.name.localeCompare(b.name, 'ar'));
    const inv = tab === 'chats' ? [...groupInvites()].map(([id, r]) => `<li class="g-invite" data-id="${esc(id)}">
        <span class="wa-avatar wa-avatar--group" style="background:${esc(r.color)};color:${textOn(r.color)}" aria-hidden="true">${esc(initial(r.name))}</span>
        <span class="g-room__body"><b>${esc(r.name)}</b><small>دعوة من ${esc(members.get(r.owner)?.name || 'عضو')}${r.enrich ? ' · تُثري عقل المؤسسة' : ''}</small></span>
        <button type="button" class="text-btn" data-join="${esc(id)}">انضم</button><button type="button" class="text-btn text-btn--muted" data-decline="${esc(id)}">رفض</button></li>`).join('') : '';
    const qn = normQ(q);
    const shown = [...top, ...items].filter((it) => !qn || normQ(it.name).includes(qn));
    const searching = tab === 'sections' && !!qn;
    const empty = !shown.length && !inv ? `<li class="wa-day">${searching ? 'لا كرة بهذا الاسم.' : tab === 'chats' ? 'لا مجموعات محادثة بعد. أنشئ واحدة من الزر بالأسفل.' : 'لا كروبات أقسام بعد.'}</li>` : '';
    const shareBanner = shareReady && !qn ? '<li class="wa-day">صورة جاهزة للإرسال: اختر المحادثة التي ترسلها إليها</li>' : '';
    list.innerHTML = shareBanner + inv + empty + shown.map((it) => {
      const m = last.get(it.id);
      const n = unread.get(it.id) || 0;
      const preview = m ? `${m.mine ? 'أنت' : esc(m.fromName)}: ${m.text ? esc(m.text.slice(0, 80)) : (m.image && m.image.startsWith('data:video/') ? '🎬 فيديو' : '📷 صورة')}` : `<i>${esc(it.kind)}</i>`;
      return `<li><a class="g-room${it.past ? ' is-past' : ''}" href="${base}?room=${encodeURIComponent(it.id)}${shareReady ? '&share=1' : ''}">
        <span class="wa-avatar wa-avatar--group" style="background:${esc(it.color)};color:${textOn(it.color)}" aria-hidden="true">${esc(initial(it.name))}</span>
        <span class="g-room__body">
          <span class="g-room__top"><b>${esc(it.name)}</b>${m ? `<small class="${n ? 'is-new' : ''}">${listTime(m.sentAt)}</small>` : ''}</span>
          <span class="g-room__bottom"><span class="g-room__last">${preview}</span>${n ? `<span class="g-room__badge">${n > 99 ? '99+' : n}</span>` : ''}</span>
        </span></a></li>`;
    }).join('');
    const n = shown.length;
    if (tab === 'chats' && groupOnline()) {
      // كلمة جانبية بدل عدد المجموعات: «مجموعات» تفتح نافذتها، وفيها «المساعد» للعودة
      // نافذة المجموعات بلا روابط للمساعد: هو خارجها
      statusEl.innerHTML = groupsView ? '' : '<a class="chats-groups-link" href="#/chats?tab=chats&view=groups">مجموعات</a>';
    } else {
      statusEl.textContent = !groupOnline() ? 'بلا إنترنت' : !n ? '' : `${n} ${n === 1 ? 'مجموعة' : n === 2 ? 'مجموعتان' : n <= 10 ? 'مجموعات' : 'مجموعة'}`;
    }
  }
  list.addEventListener('click', async (e) => {
    const person = e.target.closest('[data-uid]');
    if (person && person.classList.contains('g-person')) { openDirect(person.dataset.uid); return; }
    const j = e.target.closest('[data-join]'), d = e.target.closest('[data-decline]');
    if (!j && !d) return;
    (j || d).disabled = true;
    try {
      if (j) { await acceptInvite(j.dataset.join); location.hash = `#/chats?room=${encodeURIComponent(j.dataset.join)}`; }
      else await declineInvite(d.dataset.decline);
    } catch (err) { root.querySelector('#g-note').textContent = err.message; root.querySelector('#g-note').hidden = false; }
  });
  const onAny = () => { render().catch(() => {}); };
  const EVS = ['message', 'update', 'rooms', 'status', 'seen', 'members', 'contacts'];
  for (const ev of EVS) groupEvents.addEventListener(ev, onAny);
  cleanup.push(() => { for (const ev of EVS) groupEvents.removeEventListener(ev, onAny); });
  await render();
}
const listTime = (t) => {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime.format(t);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar', { day: 'numeric', month: 'numeric' });
};

export function unmount() {
  cleanup.forEach((f) => f());
  cleanup = [];
}
