// حفظ الملفات ومشاركتها: داخل تطبيق أندرويد عبر الجسر الأصلي (AqliFiles)،
// وفي المتصفح عبر رابط التنزيل ومشاركة المتصفح.

const nativeFiles = () => (typeof window !== 'undefined' && window.AqliFiles) || null;
// متصفح الغلاف الأندرويدي (WebView): لا يحفظ التنزيلات ولا يدعم المشاركة إلا عبر الجسر الأصلي
const inWebView = () => typeof navigator !== 'undefined' && /\bwv\b|; wv\)/.test(navigator.userAgent || '');
const NEEDS_UPDATE = 'حفظ الملفات يحتاج أحدث نسخة من التطبيق (APK). ثبّتها ثم أعد المحاولة.';

export const hasNativeFiles = () => !!nativeFiles();

// رابط بيانات base64 بلا الترويسة
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// يحفظ الملف في التنزيلات. يعيد اسم المكان الذي حُفظ فيه
export async function saveFile(blob, filename) {
  const native = nativeFiles();
  if (native) {
    const ok = native.save(filename, blob.type || 'application/octet-stream', await blobToBase64(blob));
    if (!ok) throw new Error('تعذّر حفظ الملف على الجوال.');
    return 'التنزيلات';
  }
  if (inWebView()) throw new Error(NEEDS_UPDATE);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'التنزيلات';
}

// يفتح مشاركة أندرويد للملف (Drive، البريد، واتساب...)
export async function shareFile(blob, filename) {
  const native = nativeFiles();
  if (native) {
    const ok = native.share(filename, blob.type || 'application/octet-stream', await blobToBase64(blob));
    if (!ok) throw new Error('تعذّرت مشاركة الملف.');
    return;
  }
  if (inWebView() || !navigator.share) throw new Error(NEEDS_UPDATE);
  await navigator.share({ files: [new File([blob], filename, { type: blob.type })], title: filename });
}
