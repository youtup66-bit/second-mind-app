// مجموعة المؤسسة: الإرسال والاستلام عبر Firebase، والأرشيف على الجهاز.
// السحابة تنقل فقط: كل جهاز يحذف نفسه من قائمة المنتظرين عند الاستلام، وآخر مستلم يحذف الرسالة.
// المدير يحتفظ بالأرشيف كاملاً، ويرسله لكل موظف جديد مرة واحدة.
import { api, session } from './cloud.js';
import { putGroupMessage, getGroupMessage, getGroupMessages, getSetting, setSetting } from './storage.js';

export const groupEvents = new EventTarget(); // message {msg} · update {msg} · members · status
const emit = (type, detail) => groupEvents.dispatchEvent(new CustomEvent(type, { detail }));

let me = null; // { uid, name, role }
let members = new Map(); // uid ← { name, role, joinedAt }
let unsubs = [];
let starting = null;
let online = false;
// أول قائمة أعضاء: لا نرسل قبلها حتى لا تُرسل رسالة "لا أحد"
let membersReady = null, resolveMembers = null;
const resetMembersReady = () => { membersReady = new Promise((r) => { resolveMembers = r; }); };
resetMembersReady();

let myPlaces = [];
export const groupMe = () => me;
export const groupPlaces = () => myPlaces;
export const groupMembers = () => members;
export const groupOnline = () => online;

export async function startGroupSync() {
  if (me || starting) return starting;
  starting = (async () => {
    const s = await session().catch(() => null);
    if (!s?.member) return false;
    me = { uid: s.user.id, name: s.member.display_name, role: s.member.role };
    const { db, F } = await api();

    unsubs.push(F.onSnapshot(F.collection(db, 'members'), (snap) => {
      members = new Map(snap.docs.map((d) => [d.id, {
        name: d.data().displayName, role: d.data().role, joinedAt: d.data().createdAt?.toMillis?.() || 0,
      }]));
      resolveMembers();
      emit('members');
      if (me?.role === 'manager') {
        managerChores().catch((e) => console.warn('group chores', e));
        publishPlacesSoon();
      }
    }, (err) => emit('status', { error: err })));

    // الموظف: أسماء كراته في عقل المؤسسة (يختار منها عند النشر)
    if (me.role === 'employee') {
      unsubs.push(F.onSnapshot(F.doc(db, 'places', me.uid), (d) => {
        myPlaces = d.exists() ? (d.data().places || []).map(String) : [];
        emit('places');
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
  myPlaces = [];
  published.clear();
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
export async function sendGroup({ text = '', image = null, tag = '' }) {
  if (!me) throw new Error('لم تدخل إلى المؤسسة بعد.');
  text = String(text).trim().slice(0, 4000);
  if (!text && !image) return null;
  const { db, F } = await api();
  const ref = F.doc(F.collection(db, 'relay'));
  tag = String(tag || '').trim().slice(0, 60);
  const m = { id: ref.id, from: me.uid, fromName: me.name, text, image, sentAt: Date.now(), mine: true, status: 'queued', ...(tag ? { tag } : {}) };
  await putGroupMessage(m);
  emit('message', { msg: m });
  deliver(m).catch(() => {});
  return m;
}

async function deliver(m) {
  const { db, F } = await api();
  await membersReady;
  const pending = [...members.keys()].filter((u) => u !== me.uid);
  const done = async (status, error) => {
    const fresh = { ...m, status, ...(error ? { error } : {}) };
    if (!error) delete fresh.error;
    await putGroupMessage(fresh);
    emit('update', { msg: fresh });
  };
  if (!pending.length) return done('sent'); // لا أحد غيرك في المؤسسة بعد
  try {
    await F.setDoc(F.doc(db, 'relay', m.id), {
      mid: m.id, from: me.uid, fromName: me.name, sentAt: m.sentAt, createdAt: F.serverTimestamp(), pending,
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
      // كل ما سبق انضمامه (مع هامش)؛ ما بعده يصله مباشرة، والتكرار يُتجاهل عنده
      const old = archive.filter((x) => x.sentAt < (m.joinedAt || Date.now()) + 10 * 60_000 && x.from !== uid);
      let batch = F.writeBatch(db), ops = 0, bytes = 0;
      for (const x of old) {
        const size = (x.text?.length || 0) * 2 + (x.image?.length || 0) + 500;
        if (ops >= 400 || bytes + size > 8_000_000) { await batch.commit(); batch = F.writeBatch(db); ops = 0; bytes = 0; }
        batch.set(F.doc(db, 'relay', `h_${uid}_${x.id}`.slice(0, 1400)), {
          mid: x.id, from: x.from, fromName: x.fromName, sentAt: x.sentAt, createdAt: F.serverTimestamp(),
          pending: [uid], history: true, ...(x.text ? { text: x.text } : {}), ...(x.image ? { image: x.image } : {}), ...(x.tag ? { tag: x.tag } : {}),
        });
        ops++; bytes += size;
      }
      if (ops) await batch.commit();
      await F.setDoc(F.doc(db, 'handoffs', uid), { count: old.length, at: F.serverTimestamp() });
    }
  } finally { choresRunning = false; }
}

// ---- المدير: نشر أسماء كرات كل موظف له ----
let placesTimer = 0;
const published = new Map(); // موظف ← آخر ما نُشر
function publishPlacesSoon() { clearTimeout(placesTimer); placesTimer = setTimeout(() => publishPlaces().catch((e) => console.warn('places', e)), 1500); }
window.addEventListener('sm:structure', () => { if (me?.role === 'manager') publishPlacesSoon(); });
async function publishPlaces() {
  if (me?.role !== 'manager') return;
  const { loadStructure, placesOf, nodeById } = await import('./org-structure.js');
  const st = await loadStructure();
  const { db, F } = await api();
  for (const [uid, m] of members) {
    if (m.role !== 'employee') continue;
    const names = [...new Set(placesOf(st, uid).map((x) => nodeById(st, x.node)?.name).filter(Boolean))].slice(0, 30);
    const sig = JSON.stringify(names);
    if (published.get(uid) === sig) continue;
    await F.setDoc(F.doc(db, 'places', uid), { places: names, at: F.serverTimestamp() });
    published.set(uid, sig);
  }
}

// ---- غير المقروء ----
export async function unreadCount() {
  const seen = await getSetting('groupSeenAt', 0);
  return (await getGroupMessages()).filter((m) => !m.mine && (m.receivedAt || m.sentAt) > seen).length;
}
export async function markSeen() {
  await setSetting('groupSeenAt', Date.now());
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
