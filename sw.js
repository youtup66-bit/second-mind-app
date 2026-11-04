// عامل الخدمة: يجعل التطبيق يعمل دون اتصال.
// ملفات التطبيق: الشبكة أولاً (لتصلك آخر نسخة فوراً)، والمخزّن عند انقطاع الاتصال.
// الخطوط: المخزّن أولاً. طلبات Gemini لا تمر عبر المخزّن أبداً.
const CACHE = 'second-mind-v30';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/storage.js',
  './js/categories.js',
  './js/mind-graph.js',
  './js/companion.js',
  './js/floater.js',
  './js/pip.js',
  './js/skins.js',
  './js/gemini.js',
  './js/voice.js',
  './js/piper.js',
  './js/local-ai.js',
  './js/ai.js',
  './js/classifier.js',
  './js/zip.js',
  './js/backup.js',
  './js/notes-view.js',
  './js/summaries.js',
  './js/recall.js',
  './js/suggest.js',
  './js/screens/home.js',
  './js/screens/mind.js',
  './js/screens/folder.js',
  './js/screens/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return cache.match('./index.html');
    throw new Error('offline');
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) return e.respondWith(networkFirst(e.request));
  if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return e.respondWith(cacheFirst(e.request));
  // مكوّنات صوت Piper من jsDelivr: روابطها بإصدارات ثابتة لا تتغير، فنحفظها ليعمل الصوت دون إنترنت
  if (url.hostname === 'cdn.jsdelivr.net' && /@\d/.test(url.pathname)) return e.respondWith(cacheFirst(e.request));
});
