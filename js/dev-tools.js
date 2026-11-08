// أدوات المطوّر (نسخة التجربة فقط): مؤسسة تجريبية جاهزة، ومبدّل أدوار للدخول بأي حساب بلمسة.
// الحسابات هنا وهمية في مشروع Firebase التجريبي، وكلمات مرورها محفوظة في قاعدة نسخة التجربة وحدها.
import { IS_DEV } from './env.js';
import { getSetting, setSetting, putPoint } from './storage.js';
import {
  session, signIn, signOut, createInvite, secondaryApi, usernameEmail, listMembers,
} from './cloud.js';
import {
  loadStructure, saveStructure, addNode, addCustom, placePerson, toggleLink, setHead,
} from './org-structure.js';
import { getWorks, addWork } from './points.js';
import { publishRooms, roomIdOf, startGroupSync } from './group.js';

const KEY = 'devAccounts'; // { manager: { username, password, name }, people: [{ name, username, password, uid }] }
const DEMO_PASSWORD = 'demo12345';
const DEMO_PEOPLE = [
  { name: 'أحمد علي', username: 'demo.ahmed' },
  { name: 'سارة محمد', username: 'demo.sara' },
  { name: 'حسين كريم', username: 'demo.hussein' },
  { name: 'زينب جاسم', username: 'demo.zainab' },
  { name: 'مصطفى عادل', username: 'demo.mustafa' },
];
// [موظف، نص، قبل كم يوم]؛ منشورات العامة (تصل للمدير) ثم منشورات مجموعات الكرات
const DEMO_POSTS = [
  [0, 'خلصت تسليك ثلاث كاميرات بالمدخل الشمالي', 1],
  [1, 'صيانة الراوتر بغرفة الاجتماعات تمت، كان المنفذ محترق', 1],
  [2, 'راح اسوي تمديد الكابلات للطابق الثاني باجر', 2],
  [0, 'ركبت جهاز تسجيل جديد بوحدة الكاميرات', 3],
  [3, 'عندنا نقص بالكابلات، نحتاج طلبية جديدة', 3],
  [4, 'خلصت تمديد كابل الشبكة لقاعة التدريب', 4],
  [1, 'الكاميرا رقم ٧ ما تشتغل بعد الصيانة، أحتاج فحص', 5],
];

// [موظف، كرة (اسمها في الهيكل)، نص، قبل كم يوم]
const DEMO_ROOM_POSTS = [
  [0, 'وحدة الكاميرات', 'الكاميرات الجديدة وصلت، منو يساعدني بالتركيب؟', 1],
  [2, 'وحدة الكاميرات', 'أني أجي بعد الظهر', 1],
  [0, 'مشروع المبنى الجديد', 'خلصنا مخطط الكاميرات للطابق الأول', 2],
  [3, 'مشروع المبنى الجديد', 'الكابلات للطابق الأول جاهزة', 2],
  [4, 'شعبة الشبكات', 'تحديث برنامج الراوترات يوم الخميس', 3],
];

export const devAccounts = () => getSetting(KEY, null);
export async function updateManagerPassword(password) {
  const a = await devAccounts();
  if (a?.manager) await setSetting(KEY, { ...a, manager: { ...a.manager, password } });
}
const guard = () => { if (!IS_DEV) throw new Error('أدوات المطوّر في نسخة التجربة فقط.'); };

// ينشئ موظفاً تجريبياً كاملاً: دعوة من المدير، ثم حساب ينضم بها (عبر الاتصال الثاني)
async function createDemoEmployee(p, managerUid, sec) {
  const code = await createInvite({ name: p.name, username: p.username });
  const { auth, db, A, F } = sec;
  try {
    await A.createUserWithEmailAndPassword(auth, usernameEmail(p.username), DEMO_PASSWORD);
  } catch (err) {
    if (!/email-already-in-use/.test(err?.code || '')) throw err;
    await A.signInWithEmailAndPassword(auth, usernameEmail(p.username), DEMO_PASSWORD);
  }
  const uid = auth.currentUser.uid;
  const b = F.writeBatch(db);
  b.set(F.doc(db, 'members', uid), { role: 'employee', displayName: p.name, username: p.username, invite: code, createdAt: F.serverTimestamp() });
  b.delete(F.doc(db, 'invites', code));
  await b.commit();
  return uid;
}

// منشورات تجريبية باسم الموظف، موجّهة للمدير (تصل كأي منشور حقيقي)
async function demoPost(sec, uid, name, managerUid, text, daysAgo, room = null) {
  const { db, F } = sec;
  const ref = F.doc(F.collection(db, 'relay'));
  await F.setDoc(ref, {
    mid: ref.id, from: uid, fromName: name, text, sentAt: Date.now() - daysAgo * 86400000 - Math.floor(Math.random() * 3600000),
    createdAt: F.serverTimestamp(), pending: room ? room.members.filter((u) => u !== uid) : [managerUid], ...(room ? { room: room.id } : {}),
  });
}

// المؤسسة التجريبية: موظفون، وهيكل، وأعمال ونقاط، ومنشورات. onStep(نص) لعرض التقدم
export async function seedDemoOrg({ managerPassword }, onStep = () => {}) {
  guard();
  const s = await session();
  if (s?.member?.role !== 'manager') throw new Error('ادخل بحساب المدير في نسخة التجربة أولاً.');
  const managerUid = s.user.id;
  // نتحقق من كلمة مرور المدير الآن (نحتاجها للعودة إليه من مبدّل الأدوار)
  onStep('أتحقق من كلمة مرور المدير…');
  await signIn(s.member.username, managerPassword);

  const existing = new Map((await listMembers()).map((m) => [m.username, m]));
  const sec = await secondaryApi('seed');
  const people = [];
  for (const p of DEMO_PEOPLE) {
    onStep(`أنشئ حساب ${p.name}…`);
    let uid = existing.get(p.username)?.user_id;
    if (!uid) uid = await createDemoEmployee(p, managerUid, sec);
    else {
      try { await sec.A.signInWithEmailAndPassword(sec.auth, usernameEmail(p.username), DEMO_PASSWORD); } catch { /* كلمة مرور مختلفة؛ لا بأس */ }
    }
    people.push({ ...p, password: DEMO_PASSWORD, uid });
    // منشوراته
    if (sec.auth.currentUser?.uid === uid) {
      for (const [who, text, days] of DEMO_POSTS) if (DEMO_PEOPLE[who].username === p.username) await demoPost(sec, uid, p.name, managerUid, text, days);
    }
    await sec.A.signOut(sec.auth).catch(() => {});
  }
  await setSetting(KEY, { manager: { username: s.member.username, password: managerPassword, name: s.member.display_name }, people });

  onStep('أبني عقل المؤسسة…');
  const st = await loadStructure(s.org?.name || 'المؤسسة التجريبية');
  if (st.nodes.length < 2) {
    const maint = addNode(st, 'root', 'شعبة الصيانة');
    const net = addNode(st, 'root', 'شعبة الشبكات');
    const cams = addNode(st, maint.id, 'وحدة الكاميرات');
    const power = addNode(st, maint.id, 'وحدة الكهرباء');
    const cables = addNode(st, net.id, 'وحدة الكابلات');
    const install = addNode(st, cams.id, 'قسم التركيب');
    const project = addCustom(st, cams.id, 'مشروع المبنى الجديد', '#f472b6');
    toggleLink(st, project.id, cables.id);
    const [ahmed, sara, hussein, zainab, mustafa] = people.map((x) => x.uid);
    placePerson(st, ahmed, cams.id); placePerson(st, ahmed, project.id);
    placePerson(st, sara, maint.id, true);
    placePerson(st, ahmed, cams.id); setHead(st, ahmed, cams.id, true);
    placePerson(st, hussein, install.id);
    placePerson(st, zainab, cables.id); placePerson(st, zainab, project.id);
    placePerson(st, mustafa, power.id); placePerson(st, mustafa, net.id, true);
    await saveStructure(st);
  }

  // مجموعات الكرات: ينشرها هاتف المدير، ثم يكتب كل موظف فيها منشوراته التجريبية
  onStep('أنشر مجموعات الكرات…');
  await startGroupSync();
  await publishRooms();
  const st2 = await loadStructure();
  const { roomsFromStructure } = await import('./group.js');
  const rooms = roomsFromStructure(st2, managerUid);
  if (!(await getSetting('devRoomPosts', false))) {
    for (const [who, ballName, text, days] of DEMO_ROOM_POSTS) {
      const node = st2.nodes.find((n) => n.name === ballName);
      const r = node && rooms.get(roomIdOf(node.id));
      const p = people[who];
      if (!r || !r.members.includes(p.uid)) continue;
      onStep(`منشور ${p.name} في ${ballName}…`);
      try {
        await sec.A.signInWithEmailAndPassword(sec.auth, usernameEmail(p.username), DEMO_PASSWORD);
        await demoPost(sec, p.uid, p.name, managerUid, text, days, { id: roomIdOf(node.id), members: r.members });
      } catch (e) { console.warn('demo room post', e); }
      await sec.A.signOut(sec.auth).catch(() => {});
    }
    await setSetting('devRoomPosts', true);
  }

  onStep('أضيف الأعمال والنقاط…');
  if (!(await getWorks()).length) {
    for (const [n, v] of [['تسليك كاميرا', 5], ['صيانة راوتر', 3], ['تمديد كابل', 2], ['تركيب جهاز', 4]]) await addWork(n, v);
  }
  // نقاط معتمدة نموذجية لتظهر الأرقام فوراً (الذكاء يقترح غيرها إن وُجد مفتاح Gemini)
  const works = await getWorks();
  const w = (n) => works.find((x) => x.name === n);
  const demo = [[0, 'تسليك كاميرا', 3, 1], [1, 'صيانة راوتر', 1, 1], [0, 'تركيب جهاز', 1, 3], [4, 'تمديد كابل', 2, 4]];
  for (const [who, work, count, days] of demo) {
    const wk = w(work);
    if (!wk) continue;
    await putPoint({
      id: `demo:${people[who].uid}:${wk.id}:${days}`, user: people[who].uid, workId: wk.id, workName: wk.name,
      points: wk.points * count, count, at: Date.now() - days * 86400000, status: 'approved', source: 'manual', quote: 'نقاط تجريبية',
    });
  }
  // يقرأ الذكاء المنشورات التجريبية أيضاً (من آخر أسبوع)
  const since = await getSetting('pointsSince', 0);
  if (!since || since > Date.now() - 8 * 86400000) await setSetting('pointsSince', Date.now() - 8 * 86400000);
  onStep('');
  return people.length;
}

// مبدّل الأدوار: يخرج من الحساب الحالي ويدخل بالحساب المختار
export async function switchTo(account) {
  guard();
  await signOut();
  await signIn(account.username, account.password);
  location.hash = '#/settings';
  location.reload();
}
