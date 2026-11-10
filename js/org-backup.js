// نسخة احتياطية للهيكل (A45): الهيكل (الكرات والأشخاص والمناصب والإعدادات) على جوال رئيس القسم وحده.
// تُحفظ في ملف مشفّر بكلمة سر يختارها رئيس القسم (AES-GCM، ومفتاحها من PBKDF2)، فلا يقرأه من يحصل عليه.
// الملف لا يحوي أي كلمات مرور، ولا يُرفع إلى أي مكان: يحفظه رئيس القسم حيث يشاء.
import { getSetting, setSetting } from './storage.js';
import { loadStructure, saveStructure } from './org-structure.js';

const MAGIC = 'second-mind-org-structure';
const ITER = 250000;
const REMIND_AFTER = 7 * 86400000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptStructure(pass, payload) {
  if (String(pass).length < 8) throw new Error('كلمة سر النسخة ٨ أحرف على الأقل.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(pass, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  return JSON.stringify({ app: MAGIC, v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) }, null, 1);
}

export async function decryptStructure(pass, text) {
  let f;
  try { f = JSON.parse(text); } catch { throw new Error('الملف ليس نسخة هيكل.'); }
  if (f?.app !== MAGIC || !f.data) throw new Error('الملف ليس نسخة هيكل.');
  let plain;
  try {
    const key = await keyFrom(pass, unb64(f.salt));
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, key, unb64(f.data));
  } catch { throw new Error('كلمة السر غير صحيحة، أو الملف تالف.'); }
  const p = JSON.parse(dec.decode(plain));
  if (!Array.isArray(p?.structure?.nodes) || !p.structure.nodes.some((n) => n.id === 'root')) throw new Error('الهيكل داخل الملف غير صالح.');
  return p;
}

export async function makeStructureBackup(pass) {
  const st = await loadStructure();
  const text = await encryptStructure(pass, { at: Date.now(), structure: st });
  await setSetting('lastStructureBackupAt', Date.now());
  return text;
}

export async function restoreStructure(file, pass) {
  const p = await decryptStructure(pass, await file.text());
  await saveStructure(p.structure);
  return p.structure;
}

export async function structureBackupStatus() {
  const at = await getSetting('lastStructureBackupAt', 0);
  return { at, needsReminder: !at || Date.now() - at > REMIND_AFTER };
}

// يربط أزرار النسخ والاستعادة في شاشة الإعدادات (لرئيس القسم فقط)
// مشاركة الملف: تفتح قائمة الجوال، فيختار الشخص المكان (الملفات، Drive، واتساب...)
export const canShareStructure = () => !!navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.smorg')] });

export function bindStructureBackup(root) {
  const box = root.querySelector('#struct-backup');
  if (!box) return;
  const msg = box.querySelector('#sb-msg');
  const say = (t, ok = true) => { msg.textContent = t; msg.className = `status ${ok ? 'status--ok' : 'status--err'}`; };
  const pass = () => box.querySelector('#sb-pass').value;
  const refresh = async () => {
    const s = await structureBackupStatus();
    box.querySelector('#sb-info').textContent = s.at
      ? `آخر نسخة للهيكل: ${new Date(s.at).toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' })}${s.needsReminder ? ' · حان وقت نسخة جديدة' : ''}`
      : 'لم تُحفظ نسخة للهيكل بعد. الهيكل على هذا الجهاز وحده.';
  };
  refresh();
  const fileName = () => `هيكل-المؤسسة-${new Date().toISOString().slice(0, 10)}.smorg`;
  // التنزيل المباشر: يذهب إلى مجلد التنزيلات
  box.querySelector('#sb-save').addEventListener('click', async () => {
    try {
      const text = await makeStructureBackup(pass());
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: fileName() }).click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say('حُفظت النسخة في التنزيلات. احفظها في مكان آمن، وكلمة السر لا تُستعاد.');
      await refresh();
    } catch (err) { say(err.message, false); }
  });
  // المشاركة: تفتح قائمة الجوال ليختار المكان بنفسه
  const share = box.querySelector('#sb-share');
  if (share) share.addEventListener('click', async () => {
    try {
      const text = await makeStructureBackup(pass());
      const file = new File([text], fileName(), { type: 'application/json' });
      await navigator.share({ files: [file], title: 'نسخة هيكل المؤسسة' });
      say('شاركتَ النسخة. احفظها في مكان آمن، وكلمة السر لا تُستعاد.');
      await refresh();
    } catch (err) { if (err.name !== 'AbortError') say(err.message, false); }
  });
  box.querySelector('#sb-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!pass()) return say('اكتب كلمة سر النسخة أولاً.', false);
    if (!confirm('الاستعادة تستبدل الهيكل الحالي بالكامل (الكرات والأشخاص والمناصب). متابعة؟')) return;
    try {
      await restoreStructure(f, pass());
      say('استُعيد الهيكل ✓. يُنشر من جديد للمسؤولين.');
    } catch (err) { say(err.message, false); }
  });
}
