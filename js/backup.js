// النسخ الاحتياطي (للمدير): ملف ZIP فيه أرشيف منشورات الأعمال والهيكل والنقاط (data.json)،
// ونسخة مقروءة من المنشورات. كل شيء يُبنى على الجهاز؛ لا يُرفع إلى أي خادم.
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

// أرشيف المنشورات مقروءاً، يوماً بيوم
function postsMarkdown(posts) {
  const lines = ['# منشورات الأعمال', ''];
  let lastDay = '';
  for (const m of [...posts].sort((a, b) => a.sentAt - b.sentAt)) {
    const d = day(m.sentAt);
    if (d !== lastDay) { lines.push(`## ${d}`, ''); lastDay = d; }
    lines.push(`**${m.fromName}** (${fmt.format(m.sentAt)}): ${m.text || ''}${m.image ? ' [صورة]' : ''}`, '');
  }
  return lines.join('\n');
}

export async function buildBackupZip() {
  const data = await exportData();
  const posts = data.group || [];
  const files = [
    { name: 'data.json', data: JSON.stringify(data, null, 2) },
    {
      name: 'اقرأني.txt',
      data: [
        'نسخة احتياطية من تطبيق "عقلي الثاني" (المؤسسة).',
        `التاريخ: ${fmt.format(data.exportedAt)}`,
        `عدد المنشورات: ${posts.length}`,
        '',
        'لاستعادتها: الإعدادات ← النسخ الاحتياطي ← استيراد، واختر هذا الملف.',
        'المنشورات.md نسخة مقروءة لأي برنامج، و data.json هو ما يستخدمه التطبيق (ومعه الهيكل والنقاط).',
        'مفتاح Gemini وكلمات المرور غير موجودة في هذه النسخة.',
      ].join('\n'),
    },
  ];
  if (posts.length) files.push({ name: 'المنشورات.md', data: postsMarkdown(posts) });
  const blob = await createZip(files);
  return { blob, filename: `second-mind-${day(Date.now())}.zip`, count: posts.length };
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
  // لقطة الهيكل والنقاط (الأرشيف الكامل في ملف النسخة الاحتياطية)
  if (!data.points?.length && !data.settings?.orgStructure) return null;
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
