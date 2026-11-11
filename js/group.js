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
let rooms = new Map(); // id ← { name, color, members[], invited[], kind, owner? }
let invites = new Map(); // مجموعات محادثة دُعيت إليها ولم تنضم بعد
let contacts = []; // من يستطيع إضافتهم مباشرة لمجموعة محادثة (من في وحدته وما تحتها)
let myBranch = null; // المسؤول: فرعه كما نشره هاتف رئيس القسم (آخر نسخة تبقى على الجهاز)
export const groupBranch = () => myBranch;
// أول نسخة من الفرع (من الذاكرة أو السحابة)؛ لا تنتظر أكثر من ٤ ثوانٍ
let branchReady = null, resolveBranch = () => {};
const resetBranchReady = () => { branchReady = new Promise((r) => { resolveBranch = r; }); };
resetBranchReady();
export const waitBranch = () => Promise.race([branchReady, new Promise((r) => setTimeout(r, 4000))]).then(() => myBranch);
export const groupMe = () => me;
export const groupRooms = () => rooms;
// أسماء المجموعات تُحفظ على الجهاز: تبقى ظاهرة بعد مغادرتها أو إغلاقها
let knownNames = {};
getSetting('roomNames', {}).then((x) => { knownNames = { ...(x || {}), ...knownNames }; }).catch(() => {});
function rememberNames(map) {
  let changed = false;
  for (const [id, r] of map) if (r.name && knownNames[id] !== r.name) { knownNames[id] = r.name; changed = true; }
  if (changed) setSetting('roomNames', knownNames).catch(() => {});
}
export const roomNameOf = (id) => rooms.get(id)?.name || knownNames[id] || '';
export const groupInvites = () => invites;
export const roomOf = (m) => m?.room || GENERAL;
export const isChatRoom = (id) => String(id || '').startsWith('c_');
// المدير يضيف أي موظف؛ والموظف من جهاته فقط
export const myContacts = () => (me?.role === 'manager' ? [...members.keys()].filter((u) => u !== me.uid) : contacts.filter((u) => members.has(u)));
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
        name: d.data().displayName, username: d.data().username, role: d.data().role, joinedAt: d.data().createdAt?.toMillis?.() || 0, invite: d.data().invite || null,
        node: d.data().node || null, title: d.data().title || null, replaces: d.data().replaces || null,
      }]));
      resolveMembers();
      emit('members');
      if (me?.role === 'manager') {
        // من انضم بدعوة كرة: يوضع فيها بمنصبه (قبل نشر المجموعات)
        import('./org-accounts.js').then((x) => x.placeJoined(members)).catch((e) => console.warn('place joined', e));
        managerChores().catch((e) => console.warn('group chores', e));
        publishRoomsSoon();
      }
    }, (err) => emit('status', { error: err })));

    // المجموعات: ما أنا عضو فيه (كرات ومحادثات)، والمدير يرى كل الكرات، وما دُعيت إليه
    const asRoom = (d) => ({
      name: d.data().name, color: d.data().color || '#c084fc', members: d.data().members || [],
      invited: d.data().invited || [], kind: d.data().kind || 'custom', owner: d.data().owner || null,
      enrich: d.data().enrich === true,
    });
    const parts = { mine: new Map(), balls: new Map() };
    let waiting = me.role === 'manager' ? 2 : 1;
    const merge = (key) => (snap) => {
      parts[key] = new Map(snap.docs.map((d) => [d.id, asRoom(d)]));
      rooms = new Map([...parts.balls, ...parts.mine]);
      rememberNames(rooms);
      if (--waiting <= 0) resolveRooms();
      emit('rooms');
    };
    const fail = () => { if (--waiting <= 0) resolveRooms(); };
    const rq = (...w) => F.query(F.collection(db, 'rooms'), F.where(...w));
    unsubs.push(F.onSnapshot(rq('members', 'array-contains', me.uid), merge('mine'), fail));
    if (me.role === 'manager') unsubs.push(F.onSnapshot(rq('kind', 'in', BALL_KINDS), merge('balls'), fail));
    unsubs.push(F.onSnapshot(rq('invited', 'array-contains', me.uid), (snap) => {
      invites = new Map(snap.docs.map((d) => [d.id, asRoom(d)]));
      emit('rooms');
    }, () => {}));
    // الموظف: من يستطيع إضافتهم مباشرة (ينشرها المدير من هيكله)، وفرعه إن كان مسؤولاً
    if (me.role !== 'manager') {
      unsubs.push(F.onSnapshot(F.doc(db, 'places', me.uid), (d) => {
        contacts = d.exists() ? (d.data().contacts || []).map(String) : [];
        emit('contacts');
      }, () => {}));
      unsubs.push(F.onSnapshot(F.doc(db, 'branches', me.uid), (d) => {
        myBranch = d.exists() ? { ...d.data(), at: d.data().at?.toMillis?.() || Date.now(), fromCache: d.metadata.fromCache } : null;
        resolveBranch();
        emit('branch');
      }, () => resolveBranch()));
    } else {
      migrateOldChats().catch((e) => console.warn('chats migrate', e));
      // طلبات المسؤولين: يطبّقها هذا الهاتف بعد التحقق
      unsubs.push(F.onSnapshot(F.collection(db, 'requests'), async (snap) => {
        if (!snap.size) return;
        await membersReady;
        const { handleRequests } = await import('./org-branches.js');
        handleRequests(snap.docs.map((d) => ({ id: d.id, data: d.data() })), members).catch((e) => console.warn('requests', e));
      }, () => {}));
    }

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
  invites = new Map();
  contacts = [];
  myBranch = null;
  resetBranchReady();
  published = null;
  members = new Map();
  resetMembersReady();
}
window.addEventListener('sm:signout', stopGroupSync);

// ---- الاستلام ----
async function receive(d, F) {
  const x = d.data();
  // المهام لا تظهر في المجموعات: لها شاشتها
  if (x.task) {
    try { await (await import('./tasks.js')).onTaskMessage(x); } catch (e) { console.warn('task', e); }
    const rest = (x.pending || []).filter((u) => u !== me.uid);
    (rest.length ? F.updateDoc(d.ref, { pending: F.arrayRemove(me.uid) }) : F.deleteDoc(d.ref)).catch(() => {});
    return;
  }
  if (x.room && x.room !== GENERAL) await roomsReady;
  const id = x.mid || d.id;
  if (!(await getGroupMessage(id))) {
    const m = {
      id, from: x.from, fromName: x.fromName, text: x.text || '', image: x.image || null, ...(x.tag ? { tag: x.tag } : {}),
      // اسم المجموعة يُحفظ مع الرسالة (يبقى ظاهراً لو غادرها أو حُذفت)
      room: x.room || GENERAL, ...(x.room && rooms.get(x.room)?.name ? { roomName: rooms.get(x.room).name } : {}),
      ...(x.work ? { work: x.work } : {}), ...(Array.isArray(x.works) ? { works: x.works } : {}), ...(Array.isArray(x.helpers) ? { helpers: x.helpers } : {}),
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
// works: أعمال مؤشَّرة [{ id, name, count }] وhelpers: معاونون (من رد المهمة) تُحسب في النقاط مباشرة
export async function sendGroup({ text = '', image = null, tag = '', room = GENERAL, work = null, works = null, helpers = null }) {
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
    ...(roomName ? { roomName } : {}), ...(tag ? { tag } : {}), ...(work ? { work } : {}),
    ...(works?.length ? { works } : {}), ...(helpers?.length ? { helpers } : {}),
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
      ...(room !== GENERAL ? { room } : {}), ...(m.work ? { work: m.work } : {}),
      ...(m.works ? { works: m.works } : {}), ...(m.helpers ? { helpers: m.helpers } : {}),
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
// صُنّفت منشورات أو تغيّرت النقاط: تتحدث عقول الفروع وتقييماتها
window.addEventListener('sm:orgmind', () => { if (me?.role === 'manager') publishRoomsSoon(); });
window.addEventListener('sm:points', () => { if (me?.role === 'manager') publishRoomsSoon(); });
window.addEventListener('sm:works', () => { if (me?.role === 'manager') publishRoomsSoon(); });

// أنواع الكرات التي تُنشر كمجموعات (كرات الموظفين والذاتية ليست مجموعات عمل؛ نُظّف ما نُشر منها سابقاً)
const BALL_KINDS = ['division', 'unit', 'section', 'custom', 'employee', 'personnel'];
// من يضيفه الموظف مباشرة: من في كراته وما تحتها (الكرة المخصصة: من فيها)
export function contactsFromStructure(st, uid) {
  const out = new Set();
  for (const pl of st.people?.[uid]?.places || []) {
    const n = st.nodes.find((x) => x.id === pl.node);
    if (!n) continue;
    const ids = new Set([n.id]);
    if (n.type !== 'custom') {
      let grew = true;
      while (grew) { grew = false; for (const x of st.nodes) if (!ids.has(x.id) && ids.has(x.parent)) { ids.add(x.id); grew = true; } }
    }
    for (const [u, p] of Object.entries(st.people)) if (u !== uid && p.places.some((q) => ids.has(q.node))) out.add(u);
  }
  return [...out];
}

export function roomsFromStructure(st, managerUid, isMember = () => true) {
  const under = (id) => {
    const ids = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const n of st.nodes) if (!ids.has(n.id) && ids.has(n.parent)) { ids.add(n.id); grew = true; } }
    return ids;
  };
  // الكرة وما فوقها: من يُوضع في كرة يرى محادثتها ومحادثات كل ما تحتها (رئيس القسم يرى أقسامه)
  const parentOf = new Map(st.nodes.map((x) => [x.id, x.parent]));
  const chainOf = (id) => {
    const set = new Set();
    for (let c = id, g = 0; c && !set.has(c) && g < 500; c = parentOf.get(c), g++) set.add(c);
    return set;
  };
  const out = new Map();
  for (const n of st.nodes) {
    if (n.id === 'root') continue;
    // كرة الموظف (بلا حساب أو بحساب) تظهر في قائمة الموظفين لا في محادثات الأقسام
    if (n.type === 'employee' || n.type === 'personnel') continue;
    // المشروع المغلق: تُحذف مجموعته، فتبقى رسائلها عند أعضائها للقراءة فقط
    if (n.type === 'custom' && n.project?.status === 'closed') continue;
    const ids = n.type === 'custom' ? new Set([n.id]) : under(n.id);
    const above = chainOf(n.id); // الكرة نفسها وما فوقها
    const people = Object.entries(st.people || {})
      .filter(([u, p]) => isMember(u) && (p.places || []).some((pl) => ids.has(pl.node) || above.has(pl.node))).map(([u]) => u);
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
  for (const d of (await F.getDocs(F.query(F.collection(db, 'rooms'), F.where('kind', 'in', BALL_KINDS)))).docs) {
    if (!want.has(d.id)) await F.deleteDoc(d.ref).catch(() => {});
  }
  for (const id of Object.keys(published)) if (id.startsWith('n_') && !want.has(id)) delete published[id];
  // لكل موظف: أسماء كراته، ومن يضيفه مباشرة لمجموعة محادثة
  const { placesOf, nodeById } = await import('./org-structure.js');
  for (const [uid, m] of members) {
    if (m.role !== 'employee') continue;
    const names = [...new Set(placesOf(st, uid).map((x) => nodeById(st, x.node)?.name).filter(Boolean))].slice(0, 30);
    const cs = contactsFromStructure(st, uid).filter((u) => members.has(u)).slice(0, 1000);
    const sig = JSON.stringify([names, cs.sort()]);
    if (published[`p_${uid}`] === sig) continue;
    await F.setDoc(F.doc(db, 'places', uid), { places: names, contacts: cs, at: F.serverTimestamp() });
    published[`p_${uid}`] = sig;
  }
  await setSetting(ROOMS_KEY, published);
  // تأشيرات العمل (أسماء الأعمال) للرد على المهام
  const { getWorks } = await import('./points.js');
  const works = await getWorks();
  const wsig = JSON.stringify(works.map((w) => [w.id, w.name]));
  if (published.catalog !== wsig) {
    await (await import('./tasks.js')).publishCatalog(works).then(() => { published.catalog = wsig; }).catch((e) => console.warn('catalog', e));
    await setSetting(ROOMS_KEY, published);
  }
  // فرع كل مسؤول
  const { publishBranches } = await import('./org-branches.js');
  await publishBranches(st, members).catch((e) => console.warn('branches', e));
}

// ---- مجموعات المحادثة: ينشئها أي عضو (لا نقاط منها، ولا تصل للمدير إن لم يكن فيها) ----
// يضيف مباشرة من في وحدته وما تحتها، ومن هو أعلى منه يدعوه فينضم بنفسه.
// enrich: صاحبها يسمح بأن تُثري منشوراتها عقل المؤسسة (A32)، ويُعلَم أعضاؤها بذلك
export async function saveChat({ id, name, color, members: who = [], invited = [], enrich = false }) {
  if (!me) throw new Error('لم تدخل إلى المؤسسة بعد.');
  name = String(name || '').trim().slice(0, 60);
  if (!name) throw new Error('اكتب اسم المجموعة.');
  const { db, F } = await api();
  id ||= `c_${Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, '').padEnd(8, '0')}`;
  const ok = new Set(myContacts());
  const old = rooms.get(id);
  const was = new Set(old?.members || []);
  // من يُضاف مباشرة: من جهاتي أو كان عضواً قبلاً؛ وغيرهم يُدعون
  const direct = [...new Set(who)].filter((u) => u !== me.uid && (ok.has(u) || was.has(u)));
  const inv = [...new Set([...invited, ...who.filter((u) => u !== me.uid && !direct.includes(u))])].filter((u) => !direct.includes(u) && members.has(u)).slice(0, 50);
  const data = { name, color: color || '#c084fc', members: [me.uid, ...direct], invited: inv, kind: 'chat', owner: me.uid, enrich: !!enrich, at: F.serverTimestamp() };
  await F.setDoc(F.doc(db, 'rooms', id), data);
  rooms.set(id, { ...data, at: undefined });
  emit('rooms');
  return { id, ...data };
}
export async function deleteChat(id) {
  const { db, F } = await api();
  await F.deleteDoc(F.doc(db, 'rooms', id));
}
// الانضمام أو الرفض أو المغادرة: كلٌ يغيّر نفسه فقط
async function selfChange(id, join) {
  const { db, F } = await api();
  const ref = F.doc(db, 'rooms', id);
  const d = await F.getDoc(ref);
  if (!d.exists()) throw new Error('حُذفت هذه المجموعة.');
  const x = d.data();
  const membersNext = (x.members || []).filter((u) => u !== me.uid);
  if (join) membersNext.push(me.uid);
  await F.updateDoc(ref, { members: membersNext, invited: (x.invited || []).filter((u) => u !== me.uid) });
}
export const acceptInvite = (id) => selfChange(id, true);
export const declineInvite = (id) => selfChange(id, false);
export const leaveChat = (id) => selfChange(id, false);

// هل تُثري منشورات هذه المجموعة عقل المؤسسة؟ العامة والمشاريع نعم؛ المحادثة بإذن صاحبها فقط
export function enrichesMind(roomId) {
  if (roomId === GENERAL) return true;
  const r = rooms.get(roomId);
  return !!r && (r.kind === 'custom' || (r.kind === 'chat' && r.enrich));
}

// منشورات مجموعات المحادثة لا تُحسب منها النقاط
export const countsForPoints = (m) => !isChatRoom(roomOf(m));

// مجموعات المحادثة القديمة (كانت على جهاز المدير): تُنقل إلى الصيغة الجديدة مرة واحدة
async function migrateOldChats() {
  const old = (await getSetting('chatGroups', [])) || [];
  if (!old.length) return;
  await roomsReady;
  const { db, F } = await api();
  for (const g of old) {
    await F.deleteDoc(F.doc(db, 'rooms', g.id)).catch(() => {});
    await saveChat({ id: g.id, name: g.name, color: g.color, members: g.members || [] }).catch((e) => console.warn('migrate chat', e));
  }
  await setSetting('chatGroups', []);
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
// kind: 'chat' مجموعات المحادثة، 'work' العامة والكرات، أو بلا تحديد للكل
export async function unreadCount(kind = null) {
  const seen = await seenMap();
  const pick = (m) => !kind || (kind === 'chat') === isChatRoom(roomOf(m));
  return (await getGroupMessages()).filter((m) => pick(m) && isUnread(m, seen)).length;
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
