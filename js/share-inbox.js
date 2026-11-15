// صورة مشاركة من تطبيق المعرض: إما من غلاف أندرويد (جسر Android)، أو من عامل الخدمة في المتصفح
const CACHE = 'second-mind-share';
const KEY = () => new URL('__share', document.baseURI).href;

export async function pendingShare() {
  if (window.Android?.hasShare) return !!window.Android.hasShare();
  return !!(await (await caches.open(CACHE)).match(KEY()));
}

// يُرجع الصورة ويحذفها حتى لا تُرسل مرتين
export async function takeShare() {
  if (window.Android?.takeShare) {
    const dataUrl = window.Android.takeShare();
    if (!dataUrl) return null;
    return (await fetch(dataUrl)).blob();
  }
  const c = await caches.open(CACHE);
  const hit = await c.match(KEY());
  if (!hit) return null;
  await c.delete(KEY());
  return hit.blob();
}
