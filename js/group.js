// مجموعة المؤسسة: الإرسال والاستلام عبر Firebase، والأرشيف على الجهاز.
// السحابة تنقل فقط: كل جهاز يحذف نفسه من قائمة المنتظرين عند الاستلام، وآخر مستلم يحذف الرسالة.
// المدير يحتفظ بالأرشيف كاملاً، ويرسله لكل موظف جديد مرة واحدة.
// المجموعات: «العامة» للجميع، ولكل كرة في عقل المؤسسة مجموعة (rooms/n_<كرة>) أعضاؤها ينشرهم المدير من هيكله.
import { api, session } from './cloud.js';
import { putGroupMessage, getGroupMessage, getGroupMessages, getSetting, setSetting, setGroupAccount } from './storage.js';

export const groupEvents = new EventTarget(); // message {msg} · update {msg} · members · rooms · status · seen
const emit = (type, detail) => groupEvents.dispatchEvent(new CustomEvent(type, { detail }));

let me = null; // { uid, name, role }
let members = new Map(); // uid ← { name, role, joinedAt }
let unsubs = [];
let starting = null;
let online = false;
// أول قائمة أعضاء: لا نرسل قبلها حتى لا تُرسل رسالة "لا أحد"
let membersReady = null, resolveMembers = null, roomsReady = null, resolveRooms = null;
const resetMembersReady = () => {
  membersReady = new Promise((r) => { resolveMembers = r; });
  roomsReady = new Promise((r) => { resolveRooms = r; });
};
resetMembersReady();

export const GENERAL = 'general';
let rooms = new Map(); // id ← { name, color, members[], kind }
export const groupMe = () => me;
export const groupRooms = () => rooms;
export const roomOf = (m) => m?.room || GENERAL;
export const groupMembers = () => members;
export const groupOnline = () => online;

export async function startGroupSync() {
  if (me || starting) return starting;
  starting = (async () => {
    const s = await session().catch(() => null);
    if (!s?.member) return false;
    me = { uid: s.user.id, name: s.member.display_name, role: s.member.role };
    await setGroupAccount(me.uid); // أرشيف هذا الحساب وحده
    const { db, F } = await api();

    unsubs.push(F.onSnapshot(F.collection(db, 'members'), (snap) => {
      members = new Map(snap.docs.map((d) => [d.id, {
        name: d.data().displayName, role: d.data().role, joinedAt: d.data().createdAt?.toMillis?.() || 0,
      }]));
      resolveMembers();
      emit('members');
      if (me?.role === 'manager') {
        managerChores().catch((e) => console.warn('group chores', e));
        publishRoomsSoon();
      }
    }, (err) => emit('status', { error: err })));

    // مجموعات الكرات: المدير يرى كلها، والموظف ما هو عضو فيه فقط
    const roomsQuery = me.role === 'manager' ? F.collection(db, 'rooms')
      : F.query(F.collection(db, 'rooms'), F.where('members', 'array-contains', me.uid));
    unsubs.push(F.onSnapshot(roomsQuery, (snap) => {
      rooms = new Map(snap.docs.map((d) => [d.id, {
        name: d.data().name, color: d.data().color || '#c084fc', members: d.data().members || [], kind: d.data().kind || 'custom',
      }]));
      resolveRooms();
      emit('rooms');
    }, () => { resolveRooms(); }));

    unsubs.push(F.onSnapshot(
      F.query(F.collection(db, 'relay'), F.where('pending', 'array-contains', me.uid)),
      { includeMetadataChanges: true },
      async (snap) => {
        const was = online;
        online = !snap.metadata.fromCache;
        if (was !== online) emit('status', { online });
        for (const ch of snap.docChanges()) if (ch.type === 'added') await receive(ch.doc, F);
      },
      (err) => emit('status', { error: err }),
    ));
    retryFailed().catch(() => {});
    return true;
  })();
  try { return await starting; } finally { starting = null; }
}

export function stopGroupSync() {
  unsubs.forEach((u) => { try { u(); } catch { /* لا شيء */ } });
  unsubs = [];
  me = null;
  rooms = new Map();
  published = null;
  members = new Map();
  resetMembersReady();
}
window.addEventListener('sm:signout', stopGroupSync);

// ---- الاستلام ----
async function receive(d, F) {
  const x = d.data();
  const id = x.mid || d.id;
  if (!(await getGroupMessage(id))) {
    const m = {
      id, from: x.from, fromName: x.fromName, text: x.text || '', image: x.image || null, ...(x.tag ? { tag: x.tag } : {}),
      room: x.room || GENERAL, ...(x.roomName ? { roomName: x.roomName } : {}),
      sentAt: x.sentAt, mine: x.from === me.uid, status: 'received', receivedAt: Date.now(),
    };
    await putGroupMessage(m);
    emit('message', { msg: m });
  }
  // إشعار الاستلام: لا ننتظره (دون إنترنت يُرسل لاحقاً)
  const rest = (x.pending || []).filter((u) => u !== me.uid);
  (rest.length ? F.updateDoc(d.ref, { pending: F.arrayRemove(me.uid) }) : F.deleteDoc(d.ref)).catch(() => {});
}

// ---- الإرسال ----
export async function sendGroup({ text = '', image = null, tag = '', room = GENERAL }) {
  if (!me) throw new Error('لم تدخل إلى المؤسسة بعد.');
  text = String(text).trim().slice(0, 4000);
  if (!text && !image) return null;
  const { db, F } = await api();
  const ref = F.doc(F.collection(db, 'relay'));
  tag = String(tag || '').trim().slice(0, 60);
  room = String(room || GENERAL);
  if (room !== GENERAL) {
    await roomsReady;
    if (!rooms.has(room)) throw new Error('لست عضواً في هذه المجموعة.');
  }
  const roomName = room === GENERAL ? '' : rooms.get(room).name;
  const m = {
    id: ref.id, from: me.uid, fromName: me.name, text, image, sentAt: Date.now(), mine: true, status: 'queued', room,
    ...(roomName ? { roomName } : {}), ...(tag ? { tag } : {}),
  };
  await putGroupMessage(m);
  emit('message', { msg: m });
  deliver(m).catch(() => {});
  return m;
}

async function deliver(m) {
  const { db, F } = await api();
  await membersReady;
  const room = roomOf(m);
  if (room !== GENERAL) await roomsReady;
  const r = room === GENERAL ? null : rooms.get(room);
  // مجموعة كرة: لأعضائها الحاليين فقط (ومن غادر الشركة لا يُرسل له)
  const pending = (r ? r.members : [...members.keys()]).filter((u) => u !== me.uid && members.has(u));
  const done = async (status, error) => {
    const fresh = { ...m, status, ...(error ? { error } : {}) };
    if (!error) delete fresh.error;
    await putGroupMessage(fresh);
    emit('update', { msg: fresh });
  };
  if (room !== GENERAL && !r) return done('failed', 'لم تعد عضواً في هذه المجموعة.');
  if (!pending.length) return done('sent'); // لا أحد غيرك في المجموعة بعد
  try {
    await F.setDoc(F.doc(db, 'relay', m.id), {
      mid: m.id, from: me.uid, fromName: me.name, sentAt: m.sentAt, createdAt: F.serverTimestamp(), pending,
      ...(room !== GENERAL ? { room } : {}),
      ...(m.text ? { text: m.text } : {}), ...(m.image ? { image: m.image } : {}), ...(m.tag ? { tag: m.tag } : {}),
    });
    await done('sent');
  } catch (err) {
    await done('failed', String(err?.code || err?.message || err));
  }
}

// ما فشل إرساله (مثلاً قبل ضبط القواعد) نعيد محاولته عند كل تشغيل
async function retryFailed() {
  for (const m of await getGroupMessages()) if (m.mine && m.status === 'failed') await deliver(m);
}
export const resend = (m) => deliver(m);

// ---- مهام المدير ----
// ١) تنظيف رسائل تنتظر من أُزيل من المؤسسة
// ٢) إرسال أرشيف المجموعة لكل موظف جديد مرة واحدة
let choresRunning = false;
async function managerChores() {
  if (choresRunning || !members.size) return;
  choresRunning = true;
  try {
    const { db, F } = await api();
    const relay = await F.getDocs(F.collection(db, 'relay'));
    for (const d of relay.docs) {
      const p = d.data().pending || [];
      const keep = p.filter((u) => members.has(u));
      if (!keep.length) await F.deleteDoc(d.ref).catch(() => {});
      else if (keep.length < p.length) await F.updateDoc(d.ref, { pending: keep }).catch(() => {});
    }

    const done = new Set((await F.getDocs(F.collection(db, 'handoffs'))).docs.map((d) => d.id));
    const fresh = [...members].filter(([uid, m]) => uid !== me.uid && m.role === 'employee' && !done.has(uid));
    if (!fresh.length) return;
    const archive = await getGroupMessages();
    for (const [uid, m] of fresh) {
      // المجموعة العامة: كل ما سبق انضمامه (مع هامش)؛ ما بعده يصله مباشرة، والتكرار يُتجاهل عنده.
      // مجموعات الكرات يصله أرشيفها حين يضعه المدير فيها (sendRoomHistory)
      const old = archive.filter((x) => roomOf(x) === GENERAL && x.sentAt < (m.joinedAt || Date.now()) + 10 * 60_000 && x.from !== uid);
      await sendHistory(uid, old);
      await F.setDoc(F.doc(db, 'handoffs', uid), { count: old.length, at: F.serverTimestamp() });
    }
  } finally { choresRunning = false; }
}

// يرسل رسائل قديمة من أرشيف المدير لعضو واحد (يحفظ اسم المرسل الأصلي ومجموعتها)
async function sendHistory(uid, old) {
  if (!old.length) return;
  const { db, F } = await api();
  let batch = F.writeBatch(db), ops = 0, bytes = 0;
  for (const x of old) {
    const size = (x.text?.length || 0) * 2 + (x.image?.length || 0) + 500;
    if (ops >= 400 || bytes + size > 8_000_000) { await batch.commit(); batch = F.writeBatch(db); ops = 0; bytes = 0; }
    batch.set(F.doc(db, 'relay', `h_${uid}_${x.id}`.slice(0, 1400)), {
      mid: x.id, from: x.from, fromName: x.fromName, sentAt: x.sentAt, createdAt: F.serverTimestamp(),
      pending: [uid], history: true, ...(roomOf(x) !== GENERAL ? { room: x.room } : {}),
      ...(x.text ? { text: x.text } : {}), ...(x.image ? { image: x.image } : {}), ...(x.tag ? { tag: x.tag } : {}),
    });
    ops++; bytes += size;
  }
  if (ops) await batch.commit();
}

// ---- المدير: نشر مجموعات الكرات من هيكله ----
// كل كرة (عدا القسم نفسه، فهو المجموعة العامة) مجموعة. الأعضاء: المدير، ومن في الكرة وما تحتها؛
// والكرة المخصصة (مشروع مثلاً) لمن وُضعوا فيها فقط. من يُضاف لمجموعة يصله أرشيفها.
export const roomIdOf = (nodeId) => (nodeId === 'root' ? GENERAL : `n_${nodeId}`);
const ROOMS_KEY = 'roomsPublished'; // id ← توقيع ما نُشر (أعضاء، اسم، لون)
let published = null;
let roomsTimer = 0, roomsRun = Promise.resolve();
function publishRoomsSoon() { clearTimeout(roomsTimer); roomsTimer = setTimeout(() => publishRooms().catch((e) => console.warn('rooms', e)), 1500); }
window.addEventListener('sm:structure', () => { if (me?.role === 'manager') publishRoomsSoon(); });

export function roomsFromStructure(st, managerUid, isMember = () => true) {
  const under = (id) => {
    const ids = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const n of st.nodes) if (!ids.has(n.id) && ids.has(n.parent)) { ids.add(n.id); grew = true; } }
    return ids;
  };
  const out = new Map();
  for (const n of st.nodes) {
    if (n.id === 'root') continue;
    const ids = n.type === 'custom' ? new Set([n.id]) : under(n.id);
    const people = Object.entries(st.people || {})
      .filter(([u, p]) => isMember(u) && (p.places || []).some((pl) => ids.has(pl.node))).map(([u]) => u);
    out.set(roomIdOf(n.id), {
      name: String(n.name).slice(0, 60), color: (n.type === 'custom' && n.color) || COLORS[n.type] || '#c084fc',
      kind: n.type, members: [...new Set([managerUid, ...people])].slice(0, 500),
    });
  }
  return out;
}
const COLORS = { division: '#5aa7ff', unit: '#ff9a3d', section: '#ffd23f', custom: '#c084fc' };

// تُنتظر (مثلاً قبل منشورات تجريبية في مجموعة)
export function publishRooms() {
  roomsRun = roomsRun.catch(() => {}).then(doPublishRooms);
  return roomsRun;
}
async function doPublishRooms() {
  if (me?.role !== 'manager') return;
  await membersReady;
  const { loadStructure } = await import('./org-structure.js');
  const st = await loadStructure();
  const want = roomsFromStructure(st, me.uid, (u) => members.has(u));
  const { db, F } = await api();
  published ||= await getSetting(ROOMS_KEY, {}) || {};
  let msgs = null;
  for (const [id, r] of want) {
    const sig = JSON.stringify([r.name, r.color, [...r.members].sort()]);
    const before = published[id] ? JSON.parse(published[id])[2] : [];
    if (published[id] === sig) continue;
    await F.setDoc(F.doc(db, 'rooms', id), { ...r, at: F.serverTimestamp() });
    published[id] = sig;
    await setSetting(ROOMS_KEY, published);
    // من أُضيف للمجموعة الآن يصله أرشيفها
    const added = r.members.filter((u) => u !== me.uid && !before.includes(u));
    if (added.length) {
      msgs ||= await getGroupMessages();
      const old = msgs.filter((x) => roomOf(x) === id);
      for (const u of added) await sendHistory(u, old.filter((x) => x.from !== u)).catch((e) => console.warn('room history', e));
    }
  }
  // كرات حُذفت من الهيكل
  for (const d of (await F.getDocs(F.collection(db, 'rooms'))).docs) {
    if (!want.has(d.id)) await F.deleteDoc(d.ref).catch(() => {});
  }
  for (const id of Object.keys(published)) if (!want.has(id)) delete published[id];
  await setSetting(ROOMS_KEY, published);
}

// ---- غير المقروء (لكل مجموعة) ----
const SEEN_KEY = 'groupSeenRooms'; // مجموعة ← آخر مشاهدة
async function seenMap() {
  const m = await getSetting(SEEN_KEY, null);
  if (m) return m;
  const old = await getSetting('groupSeenAt', 0); // قبل المجموعات: مشاهدة واحدة للكل
  return { [GENERAL]: old, '*': old };
}
const isUnread = (m, seen) => !m.mine && (m.receivedAt || m.sentAt) > (seen[roomOf(m)] ?? seen['*'] ?? 0);
export async function unreadCount(room = null) {
  const seen = await seenMap();
  return (await getGroupMessages()).filter((m) => (room == null || roomOf(m) === room) && isUnread(m, seen)).length;
}
export async function unreadByRoom() {
  const seen = await seenMap();
  const out = new Map();
  for (const m of await getGroupMessages()) if (isUnread(m, seen)) out.set(roomOf(m), (out.get(roomOf(m)) || 0) + 1);
  return out;
}
export async function markSeen(room = GENERAL) {
  const seen = await seenMap();
  seen[room] = Date.now();
  await setSetting(SEEN_KEY, seen);
  emit('seen');
}

// ---- الصور: تصغير قبل الإرسال (السحابة تقبل حتى ~٩٠٠ ألف حرف للرسالة) ----
export async function compressImage(file, maxSide = 1280, limit = 600_000) {
  const bmp = await createImageBitmap(file);
  let side = maxSide;
  for (let i = 0; i < 6; i++) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.65, 0.5]) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.length <= limit) { bmp.close?.(); return url; }
    }
    side = Math.round(side * 0.75);
  }
  bmp.close?.();
  throw new Error('الصورة كبيرة جداً.');
}
