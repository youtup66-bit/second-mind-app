// خدمة التخزين المحلي (IndexedDB). لا شيء هنا يغادر الجهاز.
const DB_NAME = 'second-mind';
const DB_VERSION = 2;

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

export async function clearAll() {
  await run('messages', 'readwrite', (s) => s.clear());
  await run('entries', 'readwrite', (s) => s.clear());
  await run('settings', 'readwrite', (s) => s.clear());
}
