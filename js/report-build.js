// تقرير Word من رسائل كروبات التطبيق: نطاق (قسم أو شعبة أو وحدة أو كرات محددة) وفترة.
// النص فقط يُرسل إلى Gemini للتلخيص (إن فعّله المدير)؛ الصور لا تُرسل إلى أي خدمة، تُضمّن في الملف فقط.
import { getGroupMessages, getSetting, setSetting } from './storage.js';
import { loadStructure, childrenOf } from './org-structure.js';
import { excludedNodes } from './org-insights.js';
import { GENERAL, roomIdOf, roomOf, roomNameOf } from './group.js';
import { reportSummary, reviseDocument } from './gemini.js';
import { buildDocx } from './docx.js';

const DAY = 86_400_000;
const MAX_TRANSCRIPT = 25_000; // حروف تُرسل كحد أقصى للتلخيص
const fmtDate = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('ar', { hour: 'numeric', minute: '2-digit' });
const isImg = (x) => typeof x === 'string' && /^data:image\//.test(x);

// كل كرة وما تحتها من الكرات والوحدات
function descendants(st, id) {
  const out = [id];
  for (const c of childrenOf(st, id)) out.push(...descendants(st, c.id));
  return out;
}

// الكروبات داخل النطاق: كروب كل كرة في النطاق، مع كروبات إضافية يختارها المدير.
// الأقسام المستثناة من التقارير تُستبعد دائماً (كما في تقرير الأسبوع)
export function scopeRooms(st, { nodeId = null, below = true, extra = [] }) {
  const ids = nodeId ? (below ? descendants(st, nodeId) : [nodeId]) : [];
  const excl = excludedNodes(st);
  const rooms = new Set([...ids.map((id) => roomIdOf(id)), ...extra]);
  return [...rooms].filter((r) => r === GENERAL || !excl.has(r.slice(2)));
}

// الرسائل داخل النطاق والفترة (نص أو صورة)، مرتبة زمنياً
export async function collect({ rooms, days }) {
  const from = Date.now() - days * DAY;
  const set = new Set(rooms);
  return (await getGroupMessages()).filter((m) => set.has(roomOf(m)) && m.sentAt >= from && (m.text || isImg(m.image)));
}

// عدّاد يعرض قبل الإنشاء: عدد الرسائل والصور
export async function preview(opts) {
  const msgs = await collect(opts);
  return { count: msgs.length, images: msgs.filter((m) => isImg(m.image)).length };
}

// نص للتلخيص: الرسائل النصية فقط، من الأحدث إلى الأقدم ضمن الحد
function transcript(msgs) {
  const lines = msgs.filter((m) => m.text).map((m) => {
    const room = m.room && m.room !== GENERAL ? roomNameOf(m.room) || 'مجموعة' : 'المجموعة العامة';
    return `${fmtDate.format(m.sentAt)} ${fmtTime.format(m.sentAt)} | ${m.fromName || ''} | ${room}: ${m.text}`;
  });
  let out = '';
  for (let i = lines.length - 1; i >= 0 && out.length < MAX_TRANSCRIPT; i--) out = `${lines[i]}\n${out}`;
  return out.trim();
}

// يبني ملف Word للنطاق والفترة. onStatus(نص) لعرض الحالة أثناء العمل
export async function buildReport({ scopeName, rooms, names, days, withAi, withImages, onStatus = () => {} }) {
  const from = Date.now() - days * DAY;
  const msgs = await collect({ rooms, days });
  const imgCount = msgs.filter((m) => isImg(m.image)).length;

  let summary = '';
  if (withAi && msgs.some((m) => m.text)) {
    onStatus('أكتب الملخص بالذكاء…');
    summary = await reportSummary(transcript(msgs));
  }

  const title = `تقرير ${scopeName}`;
  const blocks = [
    { t: 'title', text: title },
    { t: 'meta', text: `الفترة: من ${fmtDate.format(from)} إلى ${fmtDate.format(Date.now())}` },
    { t: 'meta', text: `النطاق: ${names.join('، ')}` },
    { t: 'meta', text: `عدد الرسائل: ${msgs.length}، الصور: ${imgCount}` },
  ];
  if (summary) {
    blocks.push({ t: 'h', text: 'الملخص' });
    blocks.push({ t: 'p', text: summary });
  }
  blocks.push({ t: 'h', text: 'الرسائل' });
  let lastDay = '';
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (i % 50 === 0) onStatus(`أجهّز الملف… ${i + 1} من ${msgs.length}`);
    const day = fmtDate.format(m.sentAt);
    if (day !== lastDay) { blocks.push({ t: 'h2', text: day }); lastDay = day; }
    if (m.text) {
      const where = m.room && m.room !== GENERAL ? ` (${roomNameOf(m.room) || 'مجموعة'})` : '';
      blocks.push({ t: 'p', text: `${fmtTime.format(m.sentAt)} ${m.fromName || ''}${where}: ${m.text}` });
    }
    if (withImages && isImg(m.image)) blocks.push({ t: 'img', dataUrl: m.image });
  }
  if (!withImages && imgCount) blocks.push({ t: 'meta', text: `الصور (${imgCount}) غير مضمّنة في هذا التقرير.` });

  const blob = await buildDocx(blocks);
  const iso = new Date().toISOString().slice(0, 10);
  const filename = `تقرير-${scopeName}-${iso}.docx`.replace(/[\\/:*?"<>|]/g, '_');
  // نحفظ محتوى آخر تقرير ليعدّله المساعد لاحقاً
  await setSetting('lastReportDoc', { title, filename, version: 1, blocks });
  return { blob, filename, count: msgs.length, images: imgCount, version: 1 };
}

const REVISE_SYSTEM = `أنت تعدّل تقريراً عربياً في ملف Word. ستصلك مسودة التقرير الحالية كمصفوفة blocks، وتعليمات التعديل.
أعد التقرير كاملاً بعد التعديل، بصيغة JSON فقط: مصفوفة، كل عنصر {"t":"title|h|h2|meta|p|img","text":"..."} أو {"t":"img","ref":رقم}.
- الصور: {"t":"img","ref":رقم} كما وردت تماماً، ولا تخترع صوراً ولا أرقاماً جديدة.
- لا تضف عناوين أو فقرات لم يطلبها المستخدم، ولا تخترع وقائع غير موجودة في المسودة.
- بلا أي نص خارج JSON ولا رموز تنسيق.`;

// يعدّل آخر تقرير حسب التعليمات، ويعيد ملفاً جديداً (نسخة أحدث)
export async function editLastReport(instruction) {
  const doc = await getSetting('lastReportDoc', null);
  if (!doc?.blocks?.length) throw new Error('لا يوجد تقرير سابق للتعديل. أنشئ تقريراً من نافذة التقارير أولاً.');
  const images = [];
  const outline = doc.blocks.map((b) => {
    if (b.t === 'img') { images.push(b.dataUrl); return { t: 'img', ref: images.length - 1 }; }
    return { t: b.t, text: b.text };
  });
  const current = JSON.stringify(outline);
  if (current.length > 60_000) throw new Error('التقرير طويل جداً للتعديل من المساعد. أنشئ تقريراً بفترة أقصر.');

  const raw = await reviseDocument(REVISE_SYSTEM, `التعليمات: ${instruction || 'حسّن التقرير'}\n\nالمسودة:\n${current}`);
  const start = raw.indexOf('['), end = raw.lastIndexOf(']');
  let parsed = null;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { /* يُعالج أدناه */ }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('لم أستطع قراءة التعديل. جرّب صياغة أوضح.');

  const allowed = new Set(['title', 'h', 'h2', 'meta', 'p', 'img']);
  const blocks = [];
  for (const b of parsed) {
    if (!b || !allowed.has(b.t)) continue;
    if (b.t === 'img') {
      const src = images[Number(b.ref)];
      if (src) blocks.push({ t: 'img', dataUrl: src });
    } else if (typeof b.text === 'string' && b.text.trim()) {
      blocks.push({ t: b.t, text: b.text.slice(0, 4000) });
    }
  }
  const version = (doc.version || 1) + 1;
  const base = (doc.filename || 'تقرير.docx').replace(/\.docx$/, '').replace(/-v\d+$/, '');
  const filename = `${base}-v${version}.docx`;
  const blob = await buildDocx(blocks);
  await setSetting('lastReportDoc', { title: doc.title, filename, version, blocks });
  return { blob, filename, version };
}

// الهيكل الحالي للنطاقات (تُستعمل في النافذة)
export async function structureFor(orgName) {
  return loadStructure(orgName);
}
