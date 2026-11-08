// خدمة المؤسسة (Firebase): الحسابات، والمدير، والموظفون، والدعوات.
// الملاحظات الشخصية لا تمر من هنا أبداً؛ تبقى على الجهاز.
import { getSetting, setSetting, deleteSetting } from './storage.js';

const FB = 'https://www.gstatic.com/firebasejs/12.19.0';
// أسماء المستخدمين تتحول داخلياً إلى بريد لا يُرسل إليه شيء (نطاق example.com محجوز عالمياً لهذا)
const EMAIL_DOMAIN = 'staff.example.com';

export class CloudError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// ---- الإعداد: لصقة firebaseConfig من موقع Firebase ----
// تقبل اللصقة كما هي (const firebaseConfig = {...}) أو JSON
export function parseFirebaseConfig(text) {
  const src = String(text || '');
  const pick = (k) => src.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`))?.[1]?.trim();
  const cfg = { apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'), appId: pick('appId') };
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    throw new CloudError('لم أجد إعداد Firebase في النص. انسخ لصقة firebaseConfig كاملة من إعدادات المشروع.', 'BAD_CONFIG');
  }
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(cfg.apiKey)) throw new CloudError('قيمة apiKey غير صحيحة.', 'BAD_CONFIG');
  cfg.authDomain ||= `${cfg.projectId}.firebaseapp.com`;
  return cfg;
}

export const cloudConfig = () => getSetting('cloud', null); // { apiKey, authDomain, projectId, appId }
export async function setCloudConfig(cfg) {
  const c = typeof cfg === 'string' ? parseFirebaseConfig(cfg) : parseFirebaseConfig(JSON.stringify(cfg));
  const old = await cloudConfig();
  if (old && old.projectId !== c.projectId) await signOut().catch(() => {});
  await setSetting('cloud', c);
  fb = null;
}
export async function clearCloudConfig() {
  await signOut().catch(() => {});
  await deleteSetting('cloud');
  fb = null;
}

// ---- تحميل Firebase عند الحاجة فقط ----
let fb = null; // { auth, db, A (دوال الدخول), F (دوال القاعدة) }
let loading = null;
export async function api() {
  if (fb) return fb;
  loading ||= (async () => {
    const cfg = await cloudConfig();
    if (!cfg) throw new CloudError('لم تُربط المؤسسة بعد.', 'NO_CONFIG');
    let appMod, A, F;
    try {
      [appMod, A, F] = await Promise.all([
        import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`),
      ]);
    } catch { throw new CloudError('تعذّر الاتصال. تحقق من الإنترنت وحاول مجدداً.', 'NETWORK'); }
    const name = `org-${cfg.projectId}`;
    const app = appMod.getApps().find((a) => a.name === name) || appMod.initializeApp(cfg, name);
    const auth = A.getAuth(app);
    // ذاكرة على الجهاز: ما يُرسل دون إنترنت ينتظر ويُرسل عند عودة الاتصال
    let db;
    try {
      db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
    } catch { db = F.getFirestore(app); }
    return { auth, db, A, F };
  })();
  try { fb = await loading; return fb; } finally { loading = null; }
}

// اتصال ثانٍ منفصل (لأدوات المطوّر في نسخة التجربة فقط): ينشئ حسابات تجريبية ويكتب باسمها
// دون أن يُخرج المطوّر من حسابه في الاتصال الأساسي
export async function secondaryApi(tag = 'seed') {
  const { IS_DEV } = await import('./env.js');
  if (!IS_DEV) throw new CloudError('أدوات المطوّر في نسخة التجربة فقط.', 'FORBIDDEN');
  const cfg = await cloudConfig();
  if (!cfg) throw new CloudError('لم تُربط المؤسسة بعد.', 'NO_CONFIG');
  const [appMod, A, F] = await Promise.all([
    import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`),
  ]);
  const name = `dev-${tag}-${cfg.projectId}`;
  const app = appMod.getApps().find((a) => a.name === name) || appMod.initializeApp(cfg, name);
  const auth = A.getAuth(app);
  await A.setPersistence(auth, A.inMemoryPersistence);
  return { auth, db: F.getFirestore(app), A, F };
}
export const usernameEmail = (u) => toEmail(u);

// ---- أخطاء بالعربية ----
function explain(err) {
  if (err instanceof CloudError) return err;
  const code = String(err?.code || '');
  const m = String(err?.message || err || '');
  const E = (t, c = code || 'UNKNOWN') => new CloudError(t, c);
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return E('اسم المستخدم أو كلمة المرور غير صحيحة.', 'BAD_LOGIN');
  if (/email-already-in-use/.test(code)) return E('اسم المستخدم هذا مستخدم من قبل. اختر اسماً آخر.', 'TAKEN');
  if (/weak-password/.test(code)) return E('كلمة المرور ضعيفة: ٨ أحرف على الأقل.', 'WEAK');
  if (/too-many-requests/.test(code)) return E('محاولات كثيرة. انتظر قليلاً ثم حاول.', 'RATE');
  if (/operation-not-allowed/.test(code)) return E('فعّل الدخول بالبريد وكلمة المرور في Firebase: Authentication ← Sign-in method ← Email/Password.', 'AUTH_OFF');
  if (/api-key-not-valid|invalid-api-key/.test(code)) return E('مفتاح apiKey غير صحيح. انسخ لصقة firebaseConfig من جديد.', 'BAD_CONFIG');
  if (/network-request-failed|unavailable/.test(code) || /Failed to fetch|offline/i.test(m)) return E('تعذّر الاتصال. تحقق من الإنترنت.', 'NETWORK');
  if (/not-found/.test(code) && /database/i.test(m)) return E('أنشئ قاعدة Firestore في المشروع: Firestore Database ← Create database.', 'NO_DB');
  if (/failed-precondition|Cloud Firestore API/i.test(code + m)) return E('قاعدة Firestore غير مفعّلة في المشروع. أنشئها من Firestore Database ← Create database.', 'NO_DB');
  if (/permission-denied/.test(code)) return E('العملية غير مسموحة. تأكد من لصق قواعد الحماية (firestore.rules) في Firebase، أو أن هذا للمدير فقط.', 'FORBIDDEN');
  return E(m || 'خطأ غير معروف');
}
const run = async (fn) => { try { return await fn(); } catch (err) { throw explain(err); } };

// ---- أسماء المستخدمين وكلمات المرور ----
export const normalizeUsername = (u) => String(u || '').trim().toLowerCase();
export function checkUsername(u) {
  const n = normalizeUsername(u);
  if (!/^[a-z0-9._-]{3,30}$/.test(n)) throw new CloudError('اسم المستخدم: ٣ إلى ٣٠ حرفاً إنجليزياً أو رقماً (يُسمح بـ . _ -) دون مسافات.', 'BAD_USER');
  return n;
}
const toEmail = (u) => `${checkUsername(u)}@${EMAIL_DOMAIN}`;
function checkPassword(p) {
  if (String(p || '').length < 8) throw new CloudError('كلمة المرور ٨ أحرف على الأقل.', 'WEAK');
}

// ---- الجلسة ----
const memberShape = (id, d) => d && ({
  user_id: id, role: d.role, display_name: d.displayName, username: d.username,
  created_at: d.createdAt?.toDate?.()?.toISOString?.() || null, org_id: 'main',
});

// يعيد { user, member, org } أو null
export async function session() {
  if (!(await cloudConfig())) return null;
  const { auth, db, F } = await api();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) { cacheRole(null); return null; }
  return run(async () => {
    const [m, o] = await Promise.all([F.getDoc(F.doc(db, 'members', user.uid)), F.getDoc(F.doc(db, 'orgs', 'main'))]);
    const s = { user: { id: user.uid }, member: m.exists() ? memberShape(user.uid, m.data()) : null, org: o.exists() ? { name: o.data().name } : null };
    cacheRole(s);
    return s;
  });
}

// نتذكر الدور على الجهاز لإظهار تبويب "الموظفين" فوراً عند فتح التطبيق
function cacheRole(s) {
  const role = s?.member?.role || null;
  setSetting('orgRole', role);
  window.dispatchEvent(new CustomEvent('sm:setting', { detail: { key: 'orgRole', value: role } }));
}

export async function orgExists() {
  const { db, F } = await api();
  return run(async () => (await F.getDoc(F.doc(db, 'orgs', 'main'))).exists());
}

// الدخول باسم المستخدم، أو بالبريد الحقيقي لمن ربطه للاستعادة (رئيس القسم)
export async function signIn(username, password) {
  const { auth, A } = await api();
  const email = String(username || '').includes('@') ? String(username).trim() : toEmail(username);
  await run(() => A.signInWithEmailAndPassword(auth, email, password));
  return session();
}

// ---- الحساب: كلمة المرور والاستعادة ----
export async function changePassword(current, next) {
  checkPassword(next);
  const { auth, A } = await api();
  const user = auth.currentUser;
  if (!user) throw new CloudError('ادخل أولاً.', 'NO_USER');
  await run(async () => {
    await A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, current));
    await A.updatePassword(user, next);
  });
}
// يربط بريداً حقيقياً: تصل رسالة تأكيد، وبعدها يُدخل بالبريد ويستعيد كلمة المرور منه
export async function linkRecoveryEmail(current, email) {
  email = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CloudError('اكتب بريداً صحيحاً.', 'BAD_EMAIL');
  const { auth, A } = await api();
  const user = auth.currentUser;
  await run(async () => {
    await A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, current));
    await A.verifyBeforeUpdateEmail(user, email);
  });
}
export async function currentEmail() {
  const { auth } = await api();
  const e = auth.currentUser?.email || '';
  return e.endsWith(`@${EMAIL_DOMAIN}`) ? '' : e;
}
export async function sendReset(email) {
  email = String(email || '').trim();
  if (!email.includes('@')) throw new CloudError('الاستعادة بالبريد لمن ربطه فقط. غير ذلك: اطلب من مسؤولك رابط استعادة.', 'BAD_EMAIL');
  const { auth, A } = await api();
  await run(() => A.sendPasswordResetEmail(auth, email));
}

export async function signOut() {
  window.dispatchEvent(new Event('sm:signout'));
  if (fb) await fb.A.signOut(fb.auth).catch(() => {});
  cacheRole(null);
}

// ينشئ الحساب، أو يدخل به إن كان موجوداً بكلمة المرور نفسها (موظف أُزيل ثم دُعي مجدداً)
async function signUpOrIn(username, password) {
  checkPassword(password);
  const { auth, A } = await api();
  try {
    await A.createUserWithEmailAndPassword(auth, toEmail(username), password);
  } catch (err) {
    if (!/email-already-in-use/.test(err?.code || '')) throw explain(err);
    try { await A.signInWithEmailAndPassword(auth, toEmail(username), password); } catch { throw explain(err); }
  }
}

// المدير: إنشاء المؤسسة وحسابه (مرة واحدة فقط)
export async function createOrg({ orgName, name, username, password }) {
  if (!String(orgName || '').trim()) throw new CloudError('اكتب اسم المؤسسة.', 'BAD_INPUT');
  if (!String(name || '').trim()) throw new CloudError('اكتب اسمك.', 'BAD_INPUT');
  const u = checkUsername(username);
  if (await orgExists()) throw new CloudError('المؤسسة أُنشئت من قبل، ولها مدير واحد فقط. سجّل الدخول بدلاً من ذلك.', 'ORG_EXISTS');
  await signUpOrIn(u, password);
  const { auth, db, F } = await api();
  const uid = auth.currentUser.uid;
  await run(async () => {
    const b = F.writeBatch(db);
    b.set(F.doc(db, 'orgs', 'main'), { name: orgName.trim(), owner: uid, createdAt: F.serverTimestamp() });
    b.set(F.doc(db, 'members', uid), { role: 'manager', displayName: name.trim(), username: u, createdAt: F.serverTimestamp() });
    await b.commit();
  }).catch(async (err) => {
    // سبقه غيره بإنشاء المؤسسة
    if (err.code === 'FORBIDDEN' && await orgExists().catch(() => false)) throw new CloudError('المؤسسة أُنشئت من قبل، ولها مدير واحد فقط.', 'ORG_EXISTS');
    throw err;
  });
  return session();
}

// ---- الدعوات ----
function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بلا أحرف متشابهة
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => abc[x % abc.length]).join('');
}

export async function createInvite({ name, username }) {
  if (!String(name || '').trim()) throw new CloudError('اكتب اسم الموظف.', 'BAD_INPUT');
  const u = checkUsername(username);
  const s = await session();
  if (s?.member?.role !== 'manager') throw new CloudError('هذا للمدير فقط.', 'FORBIDDEN');
  const [members, invites] = await Promise.all([listMembers(), listInvites()]);
  if (members.some((m) => m.username === u) || invites.some((i) => i.username === u)) {
    throw new CloudError('يوجد موظف أو دعوة بهذا الاسم من قبل.', 'TAKEN');
  }
  const { db, F } = await api();
  const code = randomCode();
  await run(() => F.setDoc(F.doc(db, 'invites', code), {
    displayName: name.trim(), username: u, createdBy: s.user.id, createdAt: F.serverTimestamp(),
  }));
  return code;
}

export async function listInvites() {
  const { db, F } = await api();
  return run(async () => {
    const snap = await F.getDocs(F.collection(db, 'invites'));
    return snap.docs.map((d) => ({ code: d.id, display_name: d.data().displayName, username: d.data().username, created_at: d.data().createdAt?.toMillis?.() || 0 }))
      .sort((a, b) => a.created_at - b.created_at);
  });
}
export async function deleteInvite(code) {
  const { db, F } = await api();
  await run(() => F.deleteDoc(F.doc(db, 'invites', code)));
}

// الرابط يحمل إعداد المشروع العام (ليس سرياً) ورمز الدعوة
const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export async function inviteLink(code) {
  const cfg = await cloudConfig();
  const p = new URLSearchParams({ c: code, f: b64(JSON.stringify(cfg)) });
  return `${location.origin}${location.pathname}#/join?${p}`;
}

// يقرأ رابط الدعوة: يحفظ إعداد المؤسسة منه ثم يجلب الاسم واسم المستخدم
export async function readInvite(params) {
  const code = params.get('c');
  const bad = new CloudError('رابط الدعوة غير صالح أو استُخدم من قبل. اطلب من المدير دعوة جديدة.', 'BAD_CODE');
  if (!code) throw bad;
  if (params.get('f')) {
    let cfg;
    try { cfg = JSON.parse(unb64(params.get('f'))); } catch { throw bad; }
    const cur = await cloudConfig();
    if (!cur || cur.projectId !== cfg.projectId) await setCloudConfig(cfg);
  }
  const { db, F } = await api();
  const [inv, org] = await run(() => Promise.all([F.getDoc(F.doc(db, 'invites', code)), F.getDoc(F.doc(db, 'orgs', 'main'))]));
  if (!inv.exists()) throw bad;
  return { code, org_name: org.exists() ? org.data().name : '', display_name: inv.data().displayName, username: inv.data().username };
}

export async function joinWithInvite({ code, username, password }) {
  const inv = await readInvite(new URLSearchParams({ c: code }));
  await signUpOrIn(username, password);
  const { auth, db, F } = await api();
  const uid = auth.currentUser.uid;
  await run(async () => {
    if ((await F.getDoc(F.doc(db, 'members', uid))).exists()) throw new CloudError('هذا الحساب منضم إلى المؤسسة من قبل.', 'ALREADY');
    const b = F.writeBatch(db);
    b.set(F.doc(db, 'members', uid), {
      role: 'employee', displayName: inv.display_name, username: inv.username, invite: code, createdAt: F.serverTimestamp(),
    });
    b.delete(F.doc(db, 'invites', code));
    await b.commit();
  });
  return session();
}

// ---- الأعضاء ----
export async function listMembers() {
  const { db, F } = await api();
  return run(async () => {
    const snap = await F.getDocs(F.collection(db, 'members'));
    return snap.docs.map((d) => memberShape(d.id, d.data())).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  });
}
export async function removeMember(userId) {
  const { db, F } = await api();
  await run(() => F.deleteDoc(F.doc(db, 'members', userId)));
}
