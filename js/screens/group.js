// شاشة منشورات الأعمال: قائمة مجموعات مثل واتساب (العامة، ومجموعة لكل كرة أنت فيها)،
// وكل مجموعة محادثة مستقلة (نصوص وصور وكلام يتحول إلى نص). ‎#/group‎ القائمة · ‎#/group?room=…‎ المحادثة
import {
  startGroupSync, groupEvents, groupMe, groupMembers, groupOnline, groupRooms, sendGroup, resend, markSeen, compressImage,
  GENERAL, roomOf, unreadByRoom, roomNameOf, groupBranch, isChatRoom, groupInvites, myContacts, saveChat, deleteChat, acceptInvite, declineInvite, leaveChat,
} from '../group.js';
import { PALETTE } from '../org-structure.js';
import { getGroupMessages } from '../storage.js';
import { session, cloudConfig } from '../cloud.js';
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

// mode: 'work' منشورات الأعمال (العامة ومجموعات الكرات) · 'chat' مجموعات المحادثة
// المحادثة تضم الآن الكروبات كلها: الأعمال صارت قسماً «الأقسام» فيها
export const mount = (root) => mountMode(root, 'chat');
export async function mountMode(root, mode) {
  const base = '#/chats';
  const tabParam = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  const tab = TABS.some((x) => x[0] === tabParam) ? tabParam : 'chats';
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
  const room = new URLSearchParams(location.hash.split('?')[1] || '').get('room');
  // نبدأ المزامنة أولاً: هي التي تحدد أرشيف أي حساب يُعرض
  const syncErr = await startGroupSync().then(() => '', (err) => err.message);
  if (!root.isConnected) return;
  if (!room) return mountList(root, s, syncErr, mode, tab);
  const orgName = s.org?.name || 'المؤسسة';
  const roomInfo = () => (room === GENERAL ? { name: orgName, color: '#00a884' } : groupRooms().get(room) || pastRoom(room));
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
      await sendGroup({ image, text: input.value.trim(), room });
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
      try { await sendGroup({ text, room }); } catch (err) { say(esc(err.message)); }
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
  return l > 0.65 ? '#111b21' : '#fff';
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
const TABS = [['chats', 'المحادثات'], ['sections', 'الأقسام'], ['people', 'الموظفون']];
async function mountList(root, s, syncErr, mode, tab = 'chats') {
  const orgName = s.org?.name || 'المؤسسة';
  const chat = true;
  const base = '#/chats';
  const showOrb = s.member.role === 'manager' || !!groupBranch()?.perms?.assistant;
  root.innerHTML = `
    <section class="chat chat--wa chat--plain chat--group g-list">
      ${showOrb ? `<a class="chats-orb" href="#/home" aria-label="المساعد">
          <span class="g-orb chats-orb__ball" aria-hidden="true"></span>
          <b>المساعد</b><small>مرتبط بعقل المؤسسة</small></a>` : ''}
      <nav class="chats-words" aria-label="أقسام المحادثات">
        ${TABS.map(([id, label]) => (id === tab ? `<b aria-current="page">${label}</b>` : `<a href="#/chats?tab=${id}">${label}</a>`)).join('')}
      </nav>
      <small class="chats-status" id="g-status"></small>
      ${tab === 'sections' ? '<input type="search" class="g-search" id="g-search" placeholder="ابحث عن كرة بالاسم" aria-label="ابحث عن كرة">' : ''}
      <p class="wa-note" id="g-note" ${syncErr ? '' : 'hidden'} role="status">${esc(syncErr)}</p>
      <ul class="g-rooms" id="g-rooms" aria-label="${TABS.find((x) => x[0] === tab)?.[1] || ''}"></ul>
      ${tab === 'chats' ? '<button type="button" class="g-new" id="g-new">مجموعة جديدة</button>' : ''}
    </section>`;
  root.querySelector('#g-new')?.addEventListener('click', () => openEditor(root));
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
      list.innerHTML = people.map((p) => `<li><button type="button" class="g-room g-person" data-uid="${esc(p.uid)}">
        <span class="wa-avatar wa-avatar--group" aria-hidden="true">${esc(initial(p.name))}</span>
        <span class="g-room__body"><span class="g-room__top"><b>${esc(p.name)}</b></span><span class="g-room__bottom"><span class="g-room__last"><i>راسِل مباشرة</i></span></span></span></button></li>`).join('')
        + pending.map((b) => `<li class="g-room is-past"><span class="wa-avatar wa-avatar--group" aria-hidden="true">${esc(initial(b.name))}</span>
        <span class="g-room__body"><span class="g-room__top"><b>${esc(b.name)}</b></span><span class="g-room__bottom"><span class="g-room__last"><i>${esc(b.role)} · بلا حساب بعد</i></span></span></span></li>`).join('')
        || `<li class="wa-day">${me?.role === 'manager' ? 'لا موظفين بعد.' : 'لا أحد في وحدتك بعد للمراسلة المباشرة.'}</li>`;
      statusEl.textContent = (people.length + pending.length) ? `${people.length + pending.length} ${people.length + pending.length === 1 ? 'شخص' : 'أشخاص'}` : '';
      return;
    }
    const mineRoom = (id) => (tab === 'sections' ? !isChatRoom(id) : isChatRoom(id));
    const items = tab === 'sections' ? [{ id: GENERAL, name: orgName, color: '#00a884', kind: 'عامة · الجميع' }] : [];
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
    list.innerHTML = inv + empty + shown.map((it) => {
      const m = last.get(it.id);
      const n = unread.get(it.id) || 0;
      const preview = m ? `${m.mine ? 'أنت' : esc(m.fromName)}: ${m.text ? esc(m.text.slice(0, 80)) : '📷 صورة'}` : `<i>${esc(it.kind)}</i>`;
      return `<li><a class="g-room${it.past ? ' is-past' : ''}" href="${base}?room=${encodeURIComponent(it.id)}">
        <span class="wa-avatar wa-avatar--group" style="background:${esc(it.color)};color:${textOn(it.color)}" aria-hidden="true">${esc(initial(it.name))}</span>
        <span class="g-room__body">
          <span class="g-room__top"><b>${esc(it.name)}</b>${m ? `<small class="${n ? 'is-new' : ''}">${listTime(m.sentAt)}</small>` : ''}</span>
          <span class="g-room__bottom"><span class="g-room__last">${preview}</span>${n ? `<span class="g-room__badge">${n > 99 ? '99+' : n}</span>` : ''}</span>
        </span></a></li>`;
    }).join('');
    const n = shown.length;
    statusEl.textContent = !groupOnline() ? 'بلا إنترنت' : !n ? '' : `${n} ${n === 1 ? 'مجموعة' : n === 2 ? 'مجموعتان' : n <= 10 ? 'مجموعات' : 'مجموعة'}`;
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
