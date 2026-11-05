// خدمة المؤسسة (Supabase): الحسابات، والمدير، والموظفون، والدعوات.
// الملاحظات الشخصية لا تمر من هنا أبداً؛ تبقى على الجهاز.
import { getSetting, setSetting, deleteSetting } from './storage.js';

const LIB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.99.3/dist/umd/supabase.js';
// أسماء المستخدمين تتحول داخلياً إلى بريد لا يُرسل إليه شيء (نطاق example.com محجوز عالمياً لهذا)
const EMAIL_DOMAIN = 'staff.example.com';

export class CloudError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// ---- الإعداد: رابط المشروع ومفتاحه العام ----
export const cloudConfig = () => getSetting('cloud', null); // { url, key }
export async function setCloudConfig({ url, key }) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  const k = String(key || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(u)) throw new CloudError('رابط المشروع غير صحيح. يشبه: https://abcd.supabase.co', 'BAD_CONFIG');
  if (k.length < 30) throw new CloudError('المفتاح العام (anon/publishable) غير صحيح.', 'BAD_CONFIG');
  const old = await cloudConfig();
  if (old && (old.url !== u || old.key !== k)) await signOut().catch(() => {});
  await setSetting('cloud', { url: u, key: k });
  client = null;
}
export async function clearCloudConfig() {
  await signOut().catch(() => {});
  await deleteSetting('cloud');
  client = null;
}

let client = null;
let libPromise = null;
function loadLib() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  libPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB_URL;
    s.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('lib')));
    s.onerror = () => { libPromise = null; s.remove(); reject(new CloudError('تعذّر الاتصال. تحقق من الإنترنت وحاول مجدداً.', 'NETWORK')); };
    document.head.append(s);
  });
  return libPromise;
}

export async function sb() {
  if (client) return client;
  const cfg = await cloudConfig();
  if (!cfg) throw new CloudError('لم تُربط المؤسسة بعد.', 'NO_CONFIG');
  const lib = await loadLib();
  client = lib.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sm-org-auth' } });
  return client;
}

// ---- أخطاء بالعربية ----
function explain(err) {
  const m = String(err?.message || err || '');
  if (err instanceof CloudError) return err;
  if (/Invalid login credentials/i.test(m)) return new CloudError('اسم المستخدم أو كلمة المرور غير صحيحة.', 'BAD_LOGIN');
  if (/already registered|already exists|User already/i.test(m)) return new CloudError('اسم المستخدم هذا مستخدم من قبل. اختر اسماً آخر.', 'TAKEN');
  if (/Password should be|weak/i.test(m)) return new CloudError('كلمة المرور ضعيفة: ٨ أحرف على الأقل، ويُفضّل خلط أرقام وحروف.', 'WEAK');
  if (/org_exists/.test(m)) return new CloudError('المؤسسة أُنشئت من قبل، ولها مدير واحد فقط. سجّل الدخول بدلاً من ذلك.', 'ORG_EXISTS');
  if (/bad_code/.test(m)) return new CloudError('رابط الدعوة غير صالح أو استُخدم من قبل. اطلب من المدير دعوة جديدة.', 'BAD_CODE');
  if (/already_member/.test(m)) return new CloudError('هذا الحساب منضم إلى المؤسسة من قبل.', 'ALREADY');
  if (/duplicate key.*username|invites_org_id_username/i.test(m)) return new CloudError('يوجد موظف أو دعوة بهذا الاسم من قبل.', 'TAKEN');
  if (/rate limit|too many/i.test(m)) return new CloudError('محاولات كثيرة. انتظر دقيقة ثم حاول.', 'RATE');
  if (/Email signups are disabled|Signups not allowed/i.test(m)) return new CloudError('التسجيل مغلق في إعدادات Supabase. فعّل "Allow new users to sign up".', 'SIGNUP_OFF');
  if (/invalid.*email|Email address .* is invalid/i.test(m)) return new CloudError('Supabase رفض اسم المستخدم كبريد. استخدم حروفاً إنجليزية وأرقاماً فقط.', 'BAD_USER');
  if (/Failed to fetch|NetworkError|network/i.test(m)) return new CloudError('تعذّر الاتصال. تحقق من الإنترنت.', 'NETWORK');
  if (/relation .* does not exist|function .* does not exist|Could not find the function/i.test(m)) {
    return new CloudError('قاعدة البيانات لم تُجهَّز. شغّل ملف supabase/schema.sql في Supabase ← SQL Editor.', 'NO_SCHEMA');
  }
  return new CloudError(m || 'خطأ غير معروف', 'UNKNOWN');
}
const run = async (p) => {
  try {
    const { data, error } = await p;
    if (error) throw error;
    return data;
  } catch (err) { throw explain(err); }
};

// ---- أسماء المستخدمين ----
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
// يعيد { user, member: { role, display_name, username, org_id }, org: { name } } أو null
export async function session() {
  if (!(await cloudConfig())) return null;
  const c = await sb();
  const { data } = await c.auth.getSession();
  const user = data?.session?.user;
  if (!user) return null;
  const member = await run(c.from('members').select('user_id, org_id, role, display_name, username').eq('user_id', user.id).maybeSingle());
  const org = member ? await run(c.from('orgs').select('id, name').eq('id', member.org_id).maybeSingle()) : null;
  const s = { user, member, org };
  cacheRole(s);
  return s;
}

// نتذكر الدور على الجهاز لإظهار تبويب "الموظفين" فوراً عند فتح التطبيق
function cacheRole(s) {
  const role = s?.member?.role || null;
  setSetting('orgRole', role);
  window.dispatchEvent(new CustomEvent('sm:setting', { detail: { key: 'orgRole', value: role } }));
}

export async function orgExists() {
  return run((await sb()).rpc('org_exists'));
}

export async function signIn(username, password) {
  const c = await sb();
  await run(c.auth.signInWithPassword({ email: toEmail(username), password }));
  return session();
}

export async function signOut() {
  if (client) await client.auth.signOut().catch(() => {});
  cacheRole(null);
}

async function signUp(username, password) {
  checkPassword(password);
  const c = await sb();
  const data = await run(c.auth.signUp({ email: toEmail(username), password }));
  if (!data?.session) {
    // تأكيد البريد مفعّل: الحساب ينتظر رسالة لن تصل
    throw new CloudError('أوقف تأكيد البريد في Supabase: Authentication ← Sign In / Providers ← Email ← أطفئ "Confirm email"، ثم احذف المستخدم من Authentication ← Users وأعد المحاولة.', 'CONFIRM_ON');
  }
  return data;
}

// المدير: إنشاء المؤسسة وحسابه (مرة واحدة فقط)
export async function createOrg({ orgName, name, username, password }) {
  if (!String(orgName || '').trim()) throw new CloudError('اكتب اسم المؤسسة.', 'BAD_INPUT');
  if (!String(name || '').trim()) throw new CloudError('اكتب اسمك.', 'BAD_INPUT');
  const u = checkUsername(username);
  if (await orgExists()) throw explain('org_exists');
  await signUp(u, password);
  await run((await sb()).rpc('create_org', { org_name: orgName.trim(), my_name: name.trim(), my_username: u }));
  return session();
}

// ---- الدعوات ----
function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بلا أحرف متشابهة
  const b = crypto.getRandomValues(new Uint8Array(10));
  return [...b].map((x) => abc[x % abc.length]).join('');
}

export async function createInvite({ name, username }) {
  if (!String(name || '').trim()) throw new CloudError('اكتب اسم الموظف.', 'BAD_INPUT');
  const s = await session();
  if (s?.member?.role !== 'manager') throw new CloudError('هذا للمدير فقط.', 'FORBIDDEN');
  const code = randomCode();
  await run((await sb()).from('invites').insert({
    code, org_id: s.member.org_id, display_name: name.trim(), username: checkUsername(username), created_by: s.user.id,
  }));
  return code;
}

export async function listInvites() {
  return run((await sb()).from('invites').select('code, display_name, username, created_at').is('used_by', null).order('created_at'));
}
export async function deleteInvite(code) {
  await run((await sb()).from('invites').delete().eq('code', code));
}

export async function inviteLink(code) {
  const cfg = await cloudConfig();
  const p = new URLSearchParams({ c: code, u: cfg.url, k: cfg.key });
  return `${location.origin}${location.pathname}#/join?${p}`;
}

// يقرأ رابط الدعوة: يحفظ إعداد المؤسسة من الرابط ثم يجلب الاسم واسم المستخدم
export async function readInvite(params) {
  const code = params.get('c');
  if (!code) throw explain('bad_code');
  if (params.get('u') && params.get('k')) {
    const cfg = await cloudConfig();
    if (!cfg || cfg.url !== params.get('u')) await setCloudConfig({ url: params.get('u'), key: params.get('k') });
  }
  const rows = await run((await sb()).rpc('invite_info', { c: code }));
  if (!rows?.length) throw explain('bad_code');
  return { code, ...rows[0] };
}

export async function joinWithInvite({ code, username, password }) {
  await signUp(username, password);
  await run((await sb()).rpc('redeem_invite', { c: code }));
  return session();
}

// ---- الأعضاء ----
export async function listMembers() {
  return run((await sb()).from('members').select('user_id, role, display_name, username, created_at').order('created_at'));
}
export async function removeMember(userId) {
  await run((await sb()).from('members').delete().eq('user_id', userId));
}
