// البحث في الملاحظات القديمة عمّا يناسب قسماً أضافه المستخدم.
// يجرّب Gemini أولاً (أدق، طلب واحد)، وإن تعذّر (بلا مفتاح أو نفدت الحصة) يبحث محلياً بكلمات القسم.
import { getEntries } from './storage.js';
import { matchNotes } from './gemini.js';
import { recall } from './recall.js';

const MAX_NOTES = 150;   // أحدث ملاحظة تُرسل في الطلب
const MAX_CHARS = 220;   // من نص كل ملاحظة

// يعيد { entries: [...], mode: 'gemini' | 'local', reason? }
export async function findOldNotesFor(category) {
  const pool = (await getEntries())
    .filter((e) => e.category && e.category !== 'none' && e.category !== category.id)
    .slice(0, MAX_NOTES);
  if (!pool.length) return { entries: [], mode: 'local' };

  try {
    const notes = pool.map((e, i) => ({
      key: `n${i}`,
      text: `${e.meta?.title ? `${e.meta.title}: ` : ''}${e.text}`.replace(/\s+/g, ' ').slice(0, MAX_CHARS),
    }));
    const keys = new Set(await matchNotes(category, notes));
    return { entries: pool.filter((_, i) => keys.has(`n${i}`)), mode: 'gemini' };
  } catch (err) {
    if (!['NO_KEY', 'BAD_KEY', 'RATE', 'NETWORK', 'TIMEOUT'].includes(err.code)) throw err;
    // بحث محلي: كلمات اسم القسم ووصفه، بلا إرسال أي شيء
    const query = `${category.label} ${category.desc || ''}`;
    return { entries: recall(pool, query, { limit: 30 }), mode: 'local', reason: err.message };
  }
}
