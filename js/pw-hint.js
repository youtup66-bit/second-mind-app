// تلميح كلمة المرور (اختياري): يُحفظ على هذا الجهاز فقط، ولا يُرفع إلى السحابة لأن التلميح قد يكشف كلمة المرور،
// ولا يُصدَّر في النسخ الاحتياطية. يظهر عند الدخول باسم المستخدم نفسه على هذا الجهاز.
import { getSetting, setSetting } from './storage.js';

const KEY = 'pwHints'; // { اسم المستخدم (بحروف صغيرة): التلميح }
const norm = (u) => String(u || '').trim().toLowerCase();

export async function getHint(username) {
  return ((await getSetting(KEY, {})) || {})[norm(username)] || '';
}
export async function setHint(username, hint) {
  const all = (await getSetting(KEY, {})) || {};
  const t = String(hint || '').trim().slice(0, 120);
  if (t) all[norm(username)] = t; else delete all[norm(username)];
  await setSetting(KEY, all);
}
