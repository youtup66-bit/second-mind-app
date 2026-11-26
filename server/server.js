// خادم عقلي الثاني الداخلي: بلا تبعيات خارجية، يعمل على Termux (أندرويد) وعلى Linux بالكود نفسه.
// يقدّم: ملفات التطبيق، و/health لاختبار الاتصال، و/api/* لمهام الحسابات (الشريحة الأولى).
// تشغيل:            node server/server.js
// إنشاء حساب:       node server/server.js adduser <اسم_المستخدم> <كلمة_المرور>
// المنفذ الافتراضي 8080 (PORT=8443 node server/server.js). بيانات الخادم في server/data/ (لا تُرفع إلى Git).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // يستقبل من الشبكة المحلية
const ROOT = path.resolve(__dirname, '..'); // جذر المشروع (فيه index.html)
const DATA = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA, 'users.json');
const TASKS_FILE = path.join(DATA, 'tasks.json');
const VERSION = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/const VERSION = (\d+)/)?.[1] || '0';
const MAX_BODY = 1024 * 1024; // 1MB
const MAX_TASKS = 500;
const SESSION_MS = 30 * 24 * 3600 * 1000; // 30 يوماً
const LOCK_MS = 5 * 60 * 1000; // بعد 8 محاولات فاشلة لحساب، يُقفل خمس دقائق

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ---------- التخزين ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file); // كتابة ذرية: لا يتلف الملف إن انقطعت الكهرباء أثناء الكتابة
}
const users = () => readJson(USERS_FILE, {});
const allTasks = () => readJson(TASKS_FILE, {});

// ---------- كلمات المرور ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function checkPassword(password, rec) {
  if (!rec.salt || !rec.hash) return false; // حساب بانتظار التفعيل
  const { hash } = hashPassword(password, rec.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(rec.hash, 'hex'));
}

// ---------- الجلسات والقفل ----------
const sessions = new Map(); // token -> { user, exp }
const failures = new Map(); // اسم المستخدم -> { n, until }

function newSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, exp: Date.now() + SESSION_MS });
  return token;
}
function userFromAuth(req) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { sessions.delete(m[1]); return null; }
  return s.user;
}

// ---------- أدوات الطلب والرد ----------
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ---------- واجهة /api ----------
async function handleApi(req, res, pathname) {
  // تسجيل الدخول: كلمة المرور تُرسل لأول مرة عبر الشبكة المحلية (HTTP). الحل الكامل HTTPS في الخطوة التالية.
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.username || '').trim().toLowerCase();
    const pass = String(body.password || '');
    const f = failures.get(name);
    if (f && f.until > Date.now()) return sendJson(res, 429, { ok: false, error: 'locked' });
    const rec = users()[name];
    if (!rec || !pass || !checkPassword(pass, rec)) {
      const expired = f && f.until > 0 && f.until <= Date.now(); // انتهى القفل: نبدأ العدّ من جديد
      const n = (f && !expired ? f.n : 0) + 1;
      failures.set(name, { n, until: n >= 8 ? Date.now() + LOCK_MS : 0 });
      return sendJson(res, 401, { ok: false, error: 'bad credentials' });
    }
    failures.delete(name);
    return sendJson(res, 200, { ok: true, token: newSession(name), user: name });
  }

  // تفعيل الحساب: المنتسب يكتب اسمه ورمز التفعيل (لمرة واحدة) ثم يختار كلمة سره بنفسه
  if (pathname === '/api/activate' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.username || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();
    const pass = String(body.password || '');
    const fkey = `act:${name}`;
    const f = failures.get(fkey);
    if (f && f.until > Date.now()) return sendJson(res, 429, { ok: false, error: 'locked' });
    const all = users();
    const rec = all[name];
    const pending = rec && rec.invite;
    const valid = pending && pending.exp > Date.now() && checkPassword(code, pending.code) && pass.length >= 6;
    if (!valid) {
      const expired = f && f.until > 0 && f.until <= Date.now();
      const n = (f && !expired ? f.n : 0) + 1;
      failures.set(fkey, { n, until: n >= 8 ? Date.now() + LOCK_MS : 0 });
      return sendJson(res, 401, { ok: false, error: 'bad activation' });
    }
    failures.delete(fkey);
    all[name] = { ...hashPassword(pass), created: rec.created || Date.now() };
    writeJson(USERS_FILE, all);
    return sendJson(res, 200, { ok: true, user: name });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '');
    if (m) sessions.delete(m[1]);
    return sendJson(res, 200, { ok: true });
  }

  const user = userFromAuth(req);
  if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  if (pathname === '/api/tasks' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, tasks: allTasks()[user] || [] });
  }
  if (pathname === '/api/tasks' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!Array.isArray(body.tasks)) return sendJson(res, 400, { ok: false, error: 'tasks must be an array' });
    const all = allTasks();
    all[user] = body.tasks.slice(0, MAX_TASKS);
    writeJson(TASKS_FILE, all);
    return sendJson(res, 200, { ok: true, count: all[user].length });
  }
  return sendJson(res, 404, { ok: false, error: 'not found' });
}

// ---------- الخادم ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname.startsWith('/api/')) {
    try { return await handleApi(req, res, url.pathname); }
    catch (err) { return sendJson(res, err.status || 500, { ok: false, error: err.status ? err.message : 'server error' }); }
  }

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
  // لا نعرض ملفات الخادم أو بياناته أو الإعدادات الحساسة
  if (rel.startsWith('/.') || rel.startsWith('/server/') || rel.startsWith('/firebase/') || rel.startsWith('/.github')) { res.writeHead(404); res.end('not found'); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// أمر إنشاء الحساب من الطرفية (لا يمر عبر الشبكة)
if (process.argv[2] === 'invite') {
  const name = String(process.argv[3] || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,32}$/.test(name)) {
    console.log('الاستعمال: node server/server.js invite <اسم_المستخدم>');
    process.exit(1);
  }
  const all = users();
  const code = crypto.randomBytes(5).toString('hex').toUpperCase(); // ١٠ أحرف، تُكتب للمنتسب
  const rec = all[name] || { created: Date.now() };
  // كلمة السر القديمة (إن وُجدت) تبقى حتى يُفعَّل الرمز الجديد
  all[name] = { ...rec, invite: { code: hashPassword(code), exp: Date.now() + 48 * 3600 * 1000 } };
  writeJson(USERS_FILE, all);
  console.log(`رمز التفعيل لـ ${name}: ${code}  (صالح ٤٨ ساعة، لمرة واحدة)`);
  process.exit(0);
}

if (process.argv[2] === 'adduser') {
  const name = String(process.argv[3] || '').trim().toLowerCase();
  const pass = String(process.argv[4] || '');
  if (!/^[a-z0-9._-]{2,32}$/.test(name) || pass.length < 6) {
    console.log('الاستعمال: node server/server.js adduser <اسم_بالإنجليزية_أو_أرقام> <كلمة_مرور_٦_أحرف_على_الأقل>');
    process.exit(1);
  }
  const all = users();
  all[name] = { ...hashPassword(pass), created: Date.now() };
  writeJson(USERS_FILE, all);
  console.log(`تم إنشاء الحساب: ${name}`);
  process.exit(0);
} else {
  server.listen(PORT, HOST, () => {
    console.log(`عقلي الثاني: الخادم يعمل على http://${HOST === '0.0.0.0' ? '<عنوان-الجهاز>' : HOST}:${PORT}`);
    console.log(`فحص الاتصال: http://<عنوان-الجهاز>:${PORT}/health`);
  });
}
