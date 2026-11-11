// الموظفون المحذوفون: قائمة داخل شاشة الموظفين (رئيس القسم) بآخر معلوماتهم قبل الحذف.
// تُلتقط اللقطة قبل نقل الأماكن وحذف الحساب، وتُحفظ على جهاز رئيس القسم فقط.
import { getSetting, setSetting, getPoints, getGroupMessages } from './storage.js';
import { placesOf, nodeById } from './org-structure.js';
import { groupMembers } from './group.js';

const KEY = 'removedStaff';
const fmt = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', year: 'numeric' });

// لقطة لموظف قبل حذفه. st: الهيكل قبل أي نقل
export async function snapshotMember(uid, st, successorName = '') {
  const m = groupMembers().get(uid);
  const pts = (await getPoints()).filter((p) => p.status === 'approved' && p.user === uid);
  const posts = (await getGroupMessages()).filter((x) => x.from === uid && x.text);
  const lastWork = [...(await getGroupMessages())].filter((x) => x.from === uid && (x.work || x.works?.length)).sort((a, b) => b.sentAt - a.sentAt)[0];
  return {
    uid,
    name: m?.name || 'موظف',
    username: m?.username || '',
    deletedAt: Date.now(),
    places: placesOf(st, uid).map((x) => nodeById(st, x.node)?.name).filter(Boolean),
    points: pts.reduce((a, p) => a + (p.points || 0), 0),
    postCount: posts.length,
    lastPostAt: posts.reduce((a, x) => Math.max(a, x.sentAt || 0), 0) || null,
    lastWork: lastWork ? (lastWork.work || lastWork.works?.map((w) => `${w.name}${w.count > 1 ? ` ×${w.count}` : ''}`).join('، ')) : '',
    successor: successorName,
  };
}

export async function archiveMember(snap) {
  const list = (await getSetting(KEY, [])) || [];
  await setSetting(KEY, [snap, ...list.filter((x) => x.uid !== snap.uid)].slice(0, 300));
}
// القائمة الظاهرة والأرشيف (المؤرشف يبقى محفوظاً ولا يظهر في القائمة الأساسية)
export const listRemoved = async () => ((await getSetting(KEY, [])) || []).filter((x) => !x.archived);
export const listArchived = async () => ((await getSetting(KEY, [])) || []).filter((x) => x.archived);
export async function setArchived(uid, on) {
  const list = (await getSetting(KEY, [])) || [];
  await setSetting(KEY, list.map((x) => (x.uid === uid ? { ...x, archived: !!on } : x)));
}
// حذف نهائي: تُمسح اللقطة من الجهاز، ويمكن أن تُمسح منشوراته ونقاطه من الجهاز أيضاً (اختياري)
export async function deleteRemovedForever(uid, { alsoData = false } = {}) {
  const { getPoints, deletePoint, getGroupMessages, deleteGroupMessage } = await import('./storage.js');
  if (alsoData) {
    for (const p of (await getPoints()).filter((x) => x.user === uid)) await deletePoint(p.id).catch(() => {});
    for (const m of (await getGroupMessages()).filter((x) => x.from === uid)) await deleteGroupMessage(m.id).catch(() => {});
  }
  const list = (await getSetting(KEY, [])) || [];
  await setSetting(KEY, list.filter((x) => x.uid !== uid));
}

// نص سطر للعرض
export function removedLines(s) {
  return [
    s.places?.length ? `كان في: ${s.places.join('، ')}` : 'بلا كرات',
    `نقاط: ${s.points}`,
    `منشورات: ${s.postCount}${s.lastPostAt ? ` · آخرها ${fmt.format(s.lastPostAt)}` : ''}`,
    s.lastWork ? `آخر عمل: ${s.lastWork}` : '',
    s.successor ? `سُلّمت إلى: ${s.successor}` : '',
  ].filter(Boolean);
}
