// خدمة التخزين المحلي (IndexedDB). لا شيء هنا يغادر الجهاز.
import { DB_NAME } from './env.js';
const DB_VERSION = 6;

let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('category', 'category');
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('summaries')) {
        db.createObjectStore('summaries', { keyPath: 'id' });
      }
      // رسائل مجموعة المؤسسة: الأرشيف على هذا الجهاز (السحابة تنقلها فقط)
      if (!db.objectStoreNames.contains('group')) {
        db.createObjectStore('group', { keyPath: 'id' }).createIndex('sentAt', 'sentAt');
      }
      // نقاط الموظفين (للمدير فقط، على جهازه)
      if (!db.objectStoreNames.contains('points')) {
        db.createObjectStore('points', { keyPath: 'id' }).createIndex('at', 'at');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // إن فُتحت نسخة أحدث من التطبيق في نافذة أخرى، نغلق اتصالنا ونعيد التحميل حتى لا نعطّلها
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn('IndexedDB: بانتظار إغلاق نافذة قديمة من التطبيق');
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---- الإعدادات ----
// ---- نطاق الحساب للإعدادات ----
// خانات بيانات المؤسسة والحساب تُحفظ بمفتاح يخص الحساب المسجّل: "المفتاح|معرّف الحساب".
// الحساب الأول الذي استخدم الجهاز يبقى مفتاحه كما هو (فلا يضيع شيء)، وكل حساب آخر له نسخته.
const ACCOUNT_KEYS = new Set([
  'orgStructure', 'branchesPublished', 'placedMembers', 'ballInvites', 'removedStaff',
  'orgWorks', 'pointsSince', 'pointsAuto', 'orgReports', 'orgTasks', 'reminders', 'pwHints',
  'orgRole', 'lastStructureBackupAt', 'groupSeenAt', 'groupSeenRooms', 'roomsPublished', 'roomNames',
]);
let scope = null; // { acct, owner }
const rawGet = (key) => run('settings', 'readonly', (s) => s.get(key));
const rawSet = (key, value) => run('settings', 'readwrite', (s) => s.put(value, key));
async function loadScope() {
  if (!scope) {
    const [acct, owner] = await Promise.all([rawGet('settingsAcct'), rawGet('settingsOwner')]);
    scope = { acct: acct || null, owner: owner || null };
  }
  return scope;
}
// يُستدعى عند معرفة الحساب المسجّل ودوره، ويُمرَّر null عند الخروج أو عند غياب المؤسسة.
// البيانات غير المفصولة على الجهاز تخص المدير وحده: هيكل المؤسسة الكامل لا يُحفظ إلا على جهازه،
// فكل مدير يدخل الجهاز يصبح صاحبها. غير المدير لا يملكها أبداً، فيبقى له مفتاحه الخاص.
export async function setSettingsAccount(uid, role = null) {
  const sc = await loadScope();
  if (uid && role === 'manager' && sc.owner !== uid) { sc.owner = uid; await rawSet('settingsOwner', uid); }
  if (sc.acct === (uid || null)) return;
  sc.acct = uid || null;
  await rawSet('settingsAcct', sc.acct);
}
async function scopedKey(key) {
  if (!ACCOUNT_KEYS.has(key)) return key;
  const { acct, owner } = await loadScope();
  return !acct || acct === owner ? key : `${key}|${acct}`;
}

export async function getSetting(key, fallback = null) {
  const k = await scopedKey(key);
  const v = await run('settings', 'readonly', (s) => s.get(k));
  return v === undefined ? fallback : v;
}
export async function setSetting(key, value) {
  const k = await scopedKey(key);
  return run('settings', 'readwrite', (s) => s.put(value, k));
}
export async function deleteSetting(key) {
  const k = await scopedKey(key);
  return run('settings', 'readwrite', (s) => s.delete(k));
}

// ---- الملاحظات ----
export async function addEntry({ text, category = null, source = 'text', meta = {} }) {
  const entry = {
    id: crypto.randomUUID(),
    text,
    category,
    source,
    meta,
    createdAt: Date.now(),
  };
  await run('entries', 'readwrite', (s) => s.add(entry));
  return entry;
}

export const updateEntry = (entry) =>
  run('entries', 'readwrite', (s) => s.put(entry));

export const getEntry = (id) =>
  run('entries', 'readonly', (s) => s.get(id));

export async function getEntries({ category } = {}) {
  const all = await run('entries', 'readonly', (s) =>
    category ? s.index('category').getAll(category) : s.getAll()
  );
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const deleteEntry = (id) =>
  run('entries', 'readwrite', (s) => s.delete(id));

// ---- سجل المحادثة ----
// role: 'user' | 'model'
// used: معرّفات الملاحظات التي استعانت بها الرفيقة في ردها
// engine: 'local' إن جاء الرد من النموذج على الجهاز
export async function addMessage({ role, text, entryId = null, used = [], engine }) {
  const msg = { id: crypto.randomUUID(), role, text, entryId, used, createdAt: Date.now(), ...(engine && { engine }) };
  await run('messages', 'readwrite', (s) => s.add(msg));
  return msg;
}

export async function getMessages(limit = 100) {
  const all = await run('messages', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt).slice(-limit);
}

export const getMessage = (id) => run('messages', 'readonly', (s) => s.get(id));
export const updateMessage = (msg) => run('messages', 'readwrite', (s) => s.put(msg));
export const deleteMessage = (id) => run('messages', 'readwrite', (s) => s.delete(id));

export const clearMessages = () =>
  run('messages', 'readwrite', (s) => s.clear());

// ---- مجموعة المؤسسة ----
// { id, from, fromName, text?, image?, sentAt, mine, status: 'queued'|'sent'|'received' }
// الأرشيف منفصل لكل حساب على الجهاز نفسه (مثلاً عند تبديل الحسابات في نسخة التجربة):
// أول حساب استخدم الجهاز يبقى أرشيفه كما هو، ولكل حساب غيره سجلات بمفتاح يبدأ بمعرّفه.
let groupAcct = null, groupOwner = null;
export async function setGroupAccount(uid) {
  groupOwner = await getSetting('groupOwner', null);
  if (!groupOwner && uid) { groupOwner = uid; await setSetting('groupOwner', uid); }
  groupAcct = uid || null;
}
const isOwner = () => !groupAcct || groupAcct === groupOwner;
const gKey = (mid) => (isOwner() ? mid : `${groupAcct}|${mid}`);
const fromRec = (r) => r && ({ ...r, id: r.mid || r.id });
const mineRec = (r) => (isOwner() ? !r.acct || r.acct === groupOwner : r.acct === groupAcct);
export const putGroupMessage = (m) =>
  run('group', 'readwrite', (s) => s.put({ ...m, id: gKey(m.id), mid: m.id, ...(groupAcct ? { acct: groupAcct } : {}) }));
export const getGroupMessage = (id) => run('group', 'readonly', (s) => s.get(gKey(id))).then(fromRec);
// تعديل حقول رسالة دون الكتابة فوق ما غيّرته عملية أخرى (النقاط والإثراء يعملان معاً)
export async function patchGroupMessage(id, fields) {
  const m = await getGroupMessage(id);
  if (m) await putGroupMessage({ ...m, ...fields });
}
export async function getGroupMessages() {
  const all = await run('group', 'readonly', (s) => s.getAll());
  return all.filter(mineRec).map(fromRec).sort((a, b) => a.sentAt - b.sentAt);
}
export const clearGroup = () => run('group', 'readwrite', (s) => s.clear());

// ---- نقاط الموظفين ----
// { id, user, workId, workName, points, count, at, msgId?, quote?, status: 'suggested'|'approved'|'rejected', source: 'ai'|'manual' }
// نطاق الحساب: سجلات النقاط لحساب غير حساب الجهاز الأول تحمل معرّفه، ولا تُقرأ إلا به
const pointAcct = async () => { const { acct, owner } = await loadScope(); return acct && acct !== owner ? acct : null; };
export async function putPoint(p) {
  const a = await pointAcct();
  const rec = a ? { ...p, acct: a } : p;
  return run('points', 'readwrite', (s) => s.put(rec));
}
export const deletePoint = (id) => run('points', 'readwrite', (s) => s.delete(id));
// حذف رسالة مجموعة بمعرّفها (يستعمله الحذف النهائي لموظف محذوف)
export const deleteGroupMessage = (id) => run('group', 'readwrite', (s) => s.delete(gKey(id)));
export async function getPoints() {
  const a = await pointAcct();
  const all = (await run('points', 'readonly', (s) => s.getAll())) || [];
  const { owner } = await loadScope();
  return all.filter((p) => (a ? p.acct === a : !p.acct || p.acct === owner));
}

// ---- التصدير والاستيراد ----
// المفتاح لا يُصدَّر أبداً حتى لا يتسرب مع ملف النسخة، وتاريخ آخر نسخة خاص بهذا الجهاز
const PRIVATE_SETTINGS = new Set(['geminiApiKey', 'lastExportAt', 'usage', 'ttsCooldownUntil', 'liteCooldownUntil', 'cloud', 'orgRole', 'groupSeenAt', 'groupSeenRooms', 'roomsPublished', 'roomNames', 'pwHints']);
export const BACKUP_FORMAT = 1;

async function getAllSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = {};
    const req = db.transaction('settings').objectStore('settings').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      // المفاتيح ذات "|" تخص حساباً غير حساب الجهاز الأول: لا تدخل نسخة الجهاز
      if (!PRIVATE_SETTINGS.has(c.key) && !String(c.key).includes('|')) out[c.key] = c.value;
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// withGroup: أرشيف المجموعة (قد يكون كبيراً بالصور)؛ النسخ التلقائية الداخلية تتركه لتوفير المساحة
export async function exportData({ withGroup = true } = {}) {
  return {
    app: 'second-mind',
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    entries: await run('entries', 'readonly', (s) => s.getAll()),
    messages: await run('messages', 'readonly', (s) => s.getAll()),
    summaries: await run('summaries', 'readonly', (s) => s.getAll()),
    points: (await run('points', 'readonly', (s) => s.getAll()) || []).filter((p) => !p.acct),
    ...(withGroup ? { group: await run('group', 'readonly', (s) => s.getAll()) } : {}),
    settings: await getAllSettings(),
  };
}

// mode: 'merge' (يضيف الجديد ويحدّث الموجود) أو 'replace' (يستبدل الملاحظات والمحادثة)
export async function importData(data, mode = 'merge') {
  if (data?.app !== 'second-mind' || !Array.isArray(data.entries)) {
    throw new Error('الملف ليس نسخة من عقلي الثاني.');
  }
  if (data.format > BACKUP_FORMAT) throw new Error('هذه النسخة من إصدار أحدث من التطبيق.');
  const valid = (x) => x && typeof x.id === 'string' && typeof x.text === 'string' && Number.isFinite(x.createdAt);
  const entries = data.entries.filter(valid);
  const messages = (data.messages || []).filter((m) => valid(m) && (m.role === 'user' || m.role === 'model'));
  const summaries = (data.summaries || []).filter((x) => x && typeof x.id === 'string' && x.result && Number.isFinite(x.createdAt));
  const settings = Object.entries(data.settings || {}).filter(([k]) => !PRIVATE_SETTINGS.has(k));
  const group = (data.group || []).filter((m) => m && typeof m.id === 'string' && Number.isFinite(m.sentAt));
  const points = (data.points || []).filter((p) => p && typeof p.id === 'string' && typeof p.user === 'string' && Number.isFinite(p.at));

  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'messages', 'summaries', 'settings', 'group', 'points'], 'readwrite');
    const es = tx.objectStore('entries'), ms = tx.objectStore('messages'), ss = tx.objectStore('settings');
    const sums = tx.objectStore('summaries');
    if (mode === 'replace') { es.clear(); ms.clear(); sums.clear(); }
    summaries.forEach((x) => sums.put(x));
    entries.forEach((e) => es.put({ category: null, source: 'text', meta: {}, ...e }));
    messages.forEach((m) => ms.put({ entryId: null, ...m }));
    settings.forEach(([k, v]) => ss.put(v, k));
    // أرشيف المجموعة والنقاط يُدمجان دائماً (لا يُمسحان)
    group.forEach((m) => tx.objectStore('group').put(m));
    points.forEach((p) => tx.objectStore('points').put(p));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return { entries: entries.length, messages: messages.length };
}

// ---- الملخصات ----
export async function addSummary(summary) {
  const item = { id: crypto.randomUUID(), createdAt: Date.now(), ...summary };
  await run('summaries', 'readwrite', (s) => s.put(item));
  return item;
}

export async function getSummaries() {
  const all = await run('summaries', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const deleteSummary = (id) => run('summaries', 'readwrite', (s) => s.delete(id));

// ---- لقطات داخلية (نسخ احتياطية تلقائية على الجهاز نفسه) ----
export async function saveSnapshot(reason = 'auto') {
  const data = await exportData({ withGroup: false });
  const snap = { id: crypto.randomUUID(), createdAt: Date.now(), reason, count: data.entries.length, data };
  await run('snapshots', 'readwrite', (s) => s.put(snap));
  return snap;
}

export async function listSnapshots() {
  const all = await run('snapshots', 'readonly', (s) => s.getAll());
  return all.map(({ data, ...meta }) => meta).sort((a, b) => b.createdAt - a.createdAt);
}

export const getSnapshot = (id) => run('snapshots', 'readonly', (s) => s.get(id));
export const deleteSnapshot = (id) => run('snapshots', 'readwrite', (s) => s.delete(id));

export async function clearAll() {
  await run('summaries', 'readwrite', (s) => s.clear());
  await run('group', 'readwrite', (s) => s.clear());
  await run('points', 'readwrite', (s) => s.clear());
  await run('snapshots', 'readwrite', (s) => s.clear());
  await run('messages', 'readwrite', (s) => s.clear());
  await run('entries', 'readwrite', (s) => s.clear());
  await run('settings', 'readwrite', (s) => s.clear());
}
