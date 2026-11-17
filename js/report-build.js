// تقرير Word من رسائل كروبات التطبيق: نطاق (قسم أو شعبة أو وحدة أو كرات محددة) وفترة.
// النص فقط يُرسل إلى Gemini للتلخيص (إن فعّله المدير)؛ الصور لا تُرسل إلى أي خدمة، تُضمّن في الملف فقط.
// كل تقرير يُحفظ في الجهاز مع نسخه (v1، v2...)، ويرى المساعد قائمة تقاريره فيعدّل أيّاً منها.
import { getGroupMessages, getSetting, setSetting } from './storage.js';
import { loadStructure, childrenOf } from './org-structure.js';
import { excludedNodes, listReports } from './org-insights.js';
import { GENERAL, roomIdOf, roomOf, roomNameOf } from './group.js';
import { reportSummary, reviseDocument } from './gemini.js';
import { buildDocx } from './docx.js';

const DAY = 86_400_000;
const MAX_TRANSCRIPT = 25_000; // حروف تُرسل كحد أقصى للتلخيص
const MAX_STORED = 30;         // عدد التقارير المحفوظة في الجهاز
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

// ---- مخزن التقارير في الجهاز ----
// الفهرس: بيانات خفيفة لكل تقرير (الأحدث أولاً)؛ محتوى كل نسخة في مفتاح مستقل
const INDEX_KEY = 'wordReportIndex';
const docKey = (id) => `wordReport_${id}`;

export async function listWordReports() {
  return getSetting(INDEX_KEY, []);
}

// يحفظ نسخة جديدة. family: معرّف السلسلة (يبقى نفسه بين النسخ)
export async function saveWordReport({ title, filename, version, blocks, family = null }) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const meta = { id, family: family || id, title, filename, version, createdAt: Date.now() };
  await setSetting(docKey(id), { ...meta, blocks });
  const index = await listWordReports();
  const keep = [meta, ...index].slice(0, MAX_STORED);
  for (const old of index.filter((m) => !keep.some((k) => k.id === m.id))) await setSetting(docKey(old.id), null);
  await setSetting(INDEX_KEY, keep);
  return meta;
}

async function getWordReport(id) {
  return getSetting(docKey(id), null);
}

const STOP = /^(تقرير|التقرير|احفظ|احفظه|صدّر|صدر|صدرلياه|عدّل|عدل|نسخة|النسخة|جديد|آخر|اخر|بالتنزيلات|التنزيلات|في|من|على|ال)$/;

// أقرب تقرير لعبارة البحث (عنوان أو اسم ملف أو تاريخ)، وإلا الأحدث
export async function findWordReport(query = '') {
  const index = await listWordReports();
  if (!index.length) return null;
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !STOP.test(w));
  if (words.length) {
    const scored = index.map((m) => {
      const hay = `${m.title} ${m.filename} ${fmtDate.format(m.createdAt)}`.toLowerCase();
      return { m, s: words.filter((w) => hay.includes(w)).length };
    }).sort((a, b) => b.s - a.s);
    if (scored[0].s > 0) return scored[0].m;
  }
  return index[0];
}

// ما يراه المساعد من التقارير: تقارير Word المحفوظة، والتقارير النصية في شاشة التقارير
export async function reportsContext() {
  const word = (await listWordReports()).slice(0, 20)
    .map((m) => `- ${m.title} (النسخة ${m.version}، ${fmtDate.format(m.createdAt)}، ملف ${m.filename})`);
  const text = (await listReports()).slice(0, 10)
    .map((r) => `- ${r.headline} (${r.label || ''}، ${fmtDate.format(r.createdAt)}) [تقرير نصي]`);
  const lines = [...word, ...text];
  return lines.length ? lines.join('\n') : '';
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
  await saveWordReport({ title, filename, version: 1, blocks });
  return { blob, filename, count: msgs.length, images: imgCount, version: 1 };
}

// ملف تقرير محفوظ (للحفظ أو المشاركة من المحادثة): الأحدث، أو المطابق لعبارة البحث
export async function reportFile(query = '') {
  const meta = await findWordReport(query);
  if (!meta) throw new Error('لا توجد تقارير محفوظة بعد. أنشئ تقريراً من نافذة التقارير أولاً.');
  const doc = await getWordReport(meta.id);
  if (!doc?.blocks?.length) throw new Error('محتوى هذا التقرير لم يعد متاحاً. أنشئه من جديد.');
  return { blob: await buildDocx(doc.blocks), filename: doc.filename, version: doc.version, title: doc.title };
}

const transcript = (msgs) => {
  const lines = msgs.filter((m) => m.text).map((m) => {
    const room = m.room && m.room !== GENERAL ? roomNameOf(m.room) || 'مجموعة' : 'المجموعة العامة';
    return `${fmtDate.format(m.sentAt)} ${fmtTime.format(m.sentAt)} | ${m.fromName || ''} | ${room}: ${m.text}`;
  });
  let out = '';
  for (let i = lines.length - 1; i >= 0 && out.length < MAX_TRANSCRIPT; i--) out = `${lines[i]}\n${out}`;
  return out.trim();
};

const REVISE_SYSTEM = `أنت تعدّل تقريراً عربياً في ملف Word. ستصلك مسودة التقرير الحالية كمصفوفة blocks، وتعليمات التعديل.
أعد التقرير كاملاً بعد التعديل، بصيغة JSON فقط: مصفوفة، كل عنصر {"t":"title|h|h2|meta|p|img","text":"..."} أو {"t":"img","ref":رقم}.
- الصور: {"t":"img","ref":رقم} كما وردت تماماً، ولا تخترع صوراً ولا أرقاماً جديدة.
- لا تضف عناوين أو فقرات لم يطلبها المستخدم، ولا تخترع وقائع غير موجودة في المسودة.
- بلا أي نص خارج JSON ولا رموز تنسيق.`;

// يعدّل تقريراً محفوظاً (المطابق لعبارة البحث، أو الأحدث) حسب التعليمات، ويحفظ نسخة جديدة في السلسلة نفسها
export async function editLastReport(instruction, query = '') {
  const meta = await findWordReport(query);
  if (!meta) throw new Error('لا يوجد تقرير سابق للتعديل. أنشئ تقريراً من نافذة التقارير أولاً.');
  const doc = await getWordReport(meta.id);
  if (!doc?.blocks?.length) throw new Error('محتوى هذا التقرير لم يعد متاحاً. أنشئه من جديد.');

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
  const version = (meta.version || 1) + 1;
  const base = (meta.filename || 'تقرير.docx').replace(/\.docx$/, '').replace(/-v\d+$/, '');
  const filename = `${base}-v${version}.docx`;
  const blob = await buildDocx(blocks);
  await saveWordReport({ title: meta.title, filename, version, blocks, family: meta.family });
  return { blob, filename, version };
}

// الهيكل الحالي للنطاقات (تُستعمل في النافذة)
export async function structureFor(orgName) {
  return loadStructure(orgName);
}
