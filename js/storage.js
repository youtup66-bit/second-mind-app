// خدمة التخزين المحلي (IndexedDB). لا شيء هنا يغادر الجهاز.
const DB_NAME = 'second-mind';
const DB_VERSION = 3;

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
export const getSetting = (key, fallback = null) =>
  run('settings', 'readonly', (s) => s.get(key)).then((v) => (v === undefined ? fallback : v));

export const setSetting = (key, value) =>
  run('settings', 'readwrite', (s) => s.put(value, key));

export const deleteSetting = (key) =>
  run('settings', 'readwrite', (s) => s.delete(key));

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
export async function addMessage({ role, text, entryId = null }) {
  const msg = { id: crypto.randomUUID(), role, text, entryId, createdAt: Date.now() };
  await run('messages', 'readwrite', (s) => s.add(msg));
  return msg;
}

export async function getMessages(limit = 100) {
  const all = await run('messages', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt).slice(-limit);
}

export const clearMessages = () =>
  run('messages', 'readwrite', (s) => s.clear());

// ---- التصدير والاستيراد ----
// المفتاح لا يُصدَّر أبداً حتى لا يتسرب مع ملف النسخة، وتاريخ آخر نسخة خاص بهذا الجهاز
const PRIVATE_SETTINGS = new Set(['geminiApiKey', 'lastExportAt']);
export const BACKUP_FORMAT = 1;

async function getAllSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = {};
    const req = db.transaction('settings').objectStore('settings').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      if (!PRIVATE_SETTINGS.has(c.key)) out[c.key] = c.value;
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function exportData() {
  return {
    app: 'second-mind',
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    entries: await run('entries', 'readonly', (s) => s.getAll()),
    messages: await run('messages', 'readonly', (s) => s.getAll()),
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
  const settings = Object.entries(data.settings || {}).filter(([k]) => !PRIVATE_SETTINGS.has(k));

  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'messages', 'settings'], 'readwrite');
    const es = tx.objectStore('entries'), ms = tx.objectStore('messages'), ss = tx.objectStore('settings');
    if (mode === 'replace') { es.clear(); ms.clear(); }
    entries.forEach((e) => es.put({ category: null, source: 'text', meta: {}, ...e }));
    messages.forEach((m) => ms.put({ entryId: null, ...m }));
    settings.forEach(([k, v]) => ss.put(v, k));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return { entries: entries.length, messages: messages.length };
}

// ---- لقطات داخلية (نسخ احتياطية تلقائية على الجهاز نفسه) ----
export async function saveSnapshot(reason = 'auto') {
  const data = await exportData();
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
  await run('snapshots', 'readwrite', (s) => s.clear());
  await run('messages', 'readwrite', (s) => s.clear());
  await run('entries', 'readwrite', (s) => s.clear());
  await run('settings', 'readwrite', (s) => s.clear());
}
