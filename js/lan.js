// الاتصال بخادم المؤسسة الداخلي (وضع «شبكة داخلية» فقط). الخادم يخزن مهام كل حساب بعد تسجيل دخول.
// في وضع الشبكة الداخلية لا نرجع إلى التخزين المحلي عند الخطأ، حتى لا تنقسم المهام بين مكانين.
import { getSetting, setSetting, deleteSetting } from './storage.js';
import { DEFAULT_SERVER } from './net-defaults.js';

const clean = (v) => String(v || '').trim().replace(/\/+$/, '');

export async function lanOn() {
  return (await getSetting('netMode', 'internet')) === 'lan';
}
async function base() {
  const b = clean(await getSetting('netServer', '')) || DEFAULT_SERVER;
  if (!/^https?:\/\//.test(b)) throw new Error('اكتب عنوان خادم المؤسسة في الإعدادات ← الشبكة.');
  return b;
}
export async function lanUser() {
  return (await getSetting('lanUser', '')) || '';
}

async function call(method, path, body) {
  const token = await getSetting('lanToken', '');
  if (!token) throw new Error('سجّل الدخول إلى خادم المؤسسة من الإعدادات ← الشبكة أولاً.');
  let res;
  try {
    res = await fetch(`${await base()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new Error('تعذّر الوصول إلى خادم المؤسسة. تحقق من الشبكة الداخلية.');
  }
  if (res.status === 401) {
    await deleteSetting('lanToken');
    throw new Error('انتهت جلسة خادم المؤسسة. سجّل الدخول من الإعدادات ← الشبكة.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error === 'locked' ? 'الحساب مقفل مؤقتاً بسبب محاولات فاشلة.' : 'تعذّر الحفظ على خادم المؤسسة.');
  return data;
}

export async function lanLogin(username, password) {
  const user = String(username || '').trim().toLowerCase();
  const res = await fetch(`${await base()}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: String(password || '') }),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) throw new Error('تعذّر الوصول إلى خادم المؤسسة. تحقق من الشبكة الداخلية.');
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error('الحساب مقفل مؤقتاً بسبب محاولات فاشلة. انتظر ٥ دقائق.');
  if (!res.ok || !data.ok) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
  await setSetting('lanToken', data.token);
  await setSetting('lanUser', data.user);
  return data.user;
}
export async function lanLogout() {
  const token = await getSetting('lanToken', '');
  if (token) {
    const b = clean(await getSetting('netServer', ''));
    if (/^https?:\/\//.test(b)) fetch(`${b}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  await deleteSetting('lanToken');
  await deleteSetting('lanUser');
}

export async function lanListTasks() {
  return (await call('GET', '/api/tasks')).tasks || [];
}
export async function lanSaveTasks(tasks) {
  await call('PUT', '/api/tasks', { tasks });
}
