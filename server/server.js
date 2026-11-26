// خادم عقلي الثاني الداخلي: بلا تبعيات خارجية، يعمل على Termux (أندرويد) وعلى Linux بالكود نفسه.
// يقدّم ملفات التطبيق، ونقطة فحص /health التي يختبرها زر «اختبار الاتصال» في قسم الشبكة.
// تشغيل: node server/server.js   (المنفذ الافتراضي 8080، ويمكن تغييره: PORT=8443 node server/server.js)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // يستقبل من الشبكة المحلية
const ROOT = path.resolve(__dirname, '..'); // جذر المشروع (فيه index.html)
const VERSION = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/const VERSION = (\d+)/)?.[1] || '0';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  // فحص الاتصال: يعيد هوية الخادم وإصدار التطبيق
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, name: 'aqli-server', version: VERSION, time: Date.now() }));
    return;
  }

  // الملفات الثابتة فقط، ولا خروج من مجلد المشروع
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); res.end('forbidden'); return; }
  // لا نعرض ملفات الخادم أو الإعدادات الحساسة
  if (rel.startsWith('/.') || rel.startsWith('/server/') || rel.startsWith('/firebase/') || rel.startsWith('/.github')) { res.writeHead(404); res.end('not found'); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`عقلي الثاني: الخادم يعمل على http://${HOST === '0.0.0.0' ? '<عنوان-الجهاز>' : HOST}:${PORT}`);
  console.log(`فحص الاتصال: http://<عنوان-الجهاز>:${PORT}/health`);
});
