// صورة مشاركة من تطبيق المعرض: يحفظها عامل الخدمة في مخزن خاص، والتطبيق يقرأها ويرسلها للمحادثة المختارة
const CACHE = 'second-mind-share';
const KEY = () => new URL('__share', document.baseURI).href;

export async function pendingShare() {
  return !!(await (await caches.open(CACHE)).match(KEY()));
}

// يُرجع الصورة ويحذفها من المخزن حتى لا تُرسل مرتين
export async function takeShare() {
  const c = await caches.open(CACHE);
  const hit = await c.match(KEY());
  if (!hit) return null;
  await c.delete(KEY());
  return hit.blob();
}
