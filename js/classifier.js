// يصنّف الملاحظات عبر Gemini ويحفظ النتيجة محلياً.
// الملاحظات غير المصنفة (بلا مفتاح أو بلا إنترنت) تُصنّف لاحقاً تلقائياً.
import { classify } from './gemini.js';
import { getEntries, getEntry, getMessages, updateEntry } from './storage.js';

const STOP_CODES = new Set(['NO_KEY', 'BAD_KEY', 'RATE', 'NETWORK']);
const inFlight = new Map();

// يعيد آخر رسالتين قبل الملاحظة كسياق
async function contextFor(entry) {
  const msgs = await getMessages(60);
  const i = msgs.findIndex((m) => m.entryId === entry.id);
  const before = i === -1 ? msgs.filter((m) => m.createdAt < entry.createdAt) : msgs.slice(0, i);
  return before.slice(-2).map(({ role, text }) => ({ role, text }));
}

export function classifyEntry(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;
  if (inFlight.has(id)) return inFlight.get(id);
  const job = (async () => {
    const entry = await getEntry(id);
    if (!entry || entry.category) return entry;
    const { category, title } = await classify(entry.text, await contextFor(entry));
    const fresh = await getEntry(id); // ربما عدّله المستخدم يدوياً أثناء الانتظار
    if (!fresh || fresh.category) return fresh;
    fresh.category = category;
    fresh.meta = { ...fresh.meta, title, classifiedBy: 'ai', classifiedAt: Date.now() };
    await updateEntry(fresh);
    return fresh;
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  return job;
}

// يصنّف المتأخر واحداً تلو الآخر، ويتوقف عند غياب المفتاح أو الاتصال
let running = null;
export function classifyPending(onDone) {
  if (running) return running;
  running = (async () => {
    const pending = (await getEntries()).filter((e) => !e.category).reverse();
    for (const e of pending) {
      try {
        onDone?.(await classifyEntry(e));
      } catch (err) {
        if (STOP_CODES.has(err.code)) break;
      }
    }
  })().finally(() => { running = null; });
  return running;
}

// تصحيح يدوي من المستخدم
export async function setCategory(id, category) {
  const entry = await getEntry(id);
  if (!entry) return null;
  entry.category = category;
  entry.meta = { ...entry.meta, classifiedBy: 'user', classifiedAt: Date.now() };
  await updateEntry(entry);
  return entry;
}
