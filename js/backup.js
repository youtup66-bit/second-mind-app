// النسخ الاحتياطي: ملف ZIP يحوي بياناتك كاملة (data.json) ونسخة مقروءة بأقسامها (Markdown).
// كل شيء يُبنى على الجهاز؛ لا يُرفع إلى أي خادم.
import { CATEGORIES, NONE, categoryById } from './categories.js';
import {
  exportData, importData, saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot,
  getSetting, setSetting,
} from './storage.js';
import { createZip, readZip } from './zip.js';

const KEEP_SNAPSHOTS = 7;
const SNAPSHOT_EVERY = 24 * 60 * 60 * 1000;
export const REMIND_AFTER = 7 * 24 * 60 * 60 * 1000;

const fmt = new Intl.DateTimeFormat('ar', { dateStyle: 'long', timeStyle: 'short' });
const day = (t) => new Date(t).toISOString().slice(0, 10);

function categoryMarkdown(cat, entries) {
  const lines = [`# ${cat.label}`, '', `${entries.length} ملاحظة`, ''];
  for (const e of entries) {
    lines.push(`## ${e.meta?.title || e.text.slice(0, 40)}`);
    lines.push(`_${fmt.format(e.createdAt)}${e.source === 'voice' ? ' · صوتية' : ''}_`, '');
    lines.push(e.text, '');
  }
  return lines.join('\n');
}

function chatMarkdown(messages) {
  const lines = ['# المحادثة مع الرفيقة', ''];
  let lastDay = '';
  for (const m of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    const d = day(m.createdAt);
    if (d !== lastDay) { lines.push(`## ${d}`, ''); lastDay = d; }
    lines.push(`**${m.role === 'user' ? 'أنا' : 'الرفيقة'}:** ${m.text}`, '');
  }
  return lines.join('\n');
}

export async function buildBackupZip() {
  const data = await exportData();
  const files = [
    { name: 'data.json', data: JSON.stringify(data, null, 2) },
    {
      name: 'اقرأني.txt',
      data: [
        'نسخة احتياطية من تطبيق "عقلي الثاني".',
        `التاريخ: ${fmt.format(data.exportedAt)}`,
        `عدد الملاحظات: ${data.entries.length}`,
        '',
        'لاستعادتها: الإعدادات ← النسخ الاحتياطي ← استيراد، واختر هذا الملف.',
        'مجلد "الأقسام" يحوي ملاحظاتك مقروءة لأي برنامج، و data.json هو ما يستخدمه التطبيق.',
        'مفتاح Gemini غير موجود في هذه النسخة حفاظاً على خصوصيتك.',
      ].join('\n'),
    },
  ];
  const sorted = [...data.entries].sort((a, b) => b.createdAt - a.createdAt);
  for (const cat of [...CATEGORIES, NONE]) {
    const list = sorted.filter((e) => e.category === cat.id);
    if (list.length) files.push({ name: `الأقسام/${cat.label}.md`, data: categoryMarkdown(cat, list) });
  }
  const unsorted = sorted.filter((e) => !categoryById(e.category));
  if (unsorted.length) files.push({ name: 'الأقسام/لم تُصنّف بعد.md', data: categoryMarkdown({ label: 'لم تُصنّف بعد' }, unsorted) });
  if (data.messages.length) files.push({ name: 'المحادثة.md', data: chatMarkdown(data.messages) });

  const blob = await createZip(files);
  return { blob, filename: `second-mind-${day(Date.now())}.zip`, count: data.entries.length };
}

const markExported = () => setSetting('lastExportAt', Date.now());

export function canShareFiles() {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'x.zip', { type: 'application/zip' })] });
  } catch { return false; }
}

export async function downloadBackup() {
  const { blob, filename, count } = await buildBackupZip();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  await markExported();
  return { filename, count };
}

// مشاركة الملف (مثلاً إلى Google Drive أو البريد) على الجوال
export async function shareBackup() {
  const { blob, filename, count } = await buildBackupZip();
  const file = new File([blob], filename, { type: 'application/zip' });
  await navigator.share({ files: [file], title: 'نسخة عقلي الثاني' });
  await markExported();
  return { filename, count };
}

// يقبل ملف ZIP من التطبيق أو ملف data.json مباشرة
export async function importFile(file, mode = 'merge') {
  let data;
  const isZip = /\.zip$/i.test(file.name) || file.type.includes('zip');
  if (isZip) {
    const files = await readZip(file);
    const json = files.get('data.json') || [...files].find(([n]) => n.endsWith('/data.json'))?.[1];
    if (!json) throw new Error('لم أجد data.json داخل الملف.');
    data = JSON.parse(new TextDecoder().decode(json));
  } else {
    data = JSON.parse(await file.text());
  }
  // لقطة أمان قبل أي استيراد، يمكن الرجوع إليها
  await saveSnapshot('before-import');
  await pruneSnapshots();
  return importData(data, mode);
}

// ---- اللقطات الداخلية ----
async function pruneSnapshots() {
  const snaps = await listSnapshots();
  for (const s of snaps.slice(KEEP_SNAPSHOTS)) await deleteSnapshot(s.id);
}

// تُستدعى عند فتح التطبيق: لقطة يومية على الجهاز إن وُجد جديد
export async function autoSnapshot() {
  const snaps = await listSnapshots();
  const last = snaps.find((s) => s.reason === 'auto');
  if (last && Date.now() - last.createdAt < SNAPSHOT_EVERY) return null;
  const data = await exportData({ withGroup: false });
  if (!data.entries.length) return null;
  const snap = await saveSnapshot('auto');
  await pruneSnapshots();
  return snap;
}

export async function restoreSnapshot(id) {
  const snap = await getSnapshot(id);
  if (!snap) throw new Error('اللقطة غير موجودة.');
  await saveSnapshot('before-restore');
  await pruneSnapshots();
  return importData(snap.data, 'replace');
}

export { listSnapshots };

// يطلب من المتصفح ألا يحذف بيانات التطبيق عند امتلاء التخزين
export async function requestPersistence() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) || false;
  } catch { return false; }
}

export async function backupStatus() {
  const lastExportAt = await getSetting('lastExportAt', 0);
  let persisted = false, usage = 0;
  try {
    persisted = (await navigator.storage?.persisted?.()) || false;
    usage = (await navigator.storage?.estimate?.())?.usage || 0;
  } catch { /* غير مدعوم */ }
  return { lastExportAt, persisted, usage, needsReminder: !lastExportAt || Date.now() - lastExportAt > REMIND_AFTER };
}
