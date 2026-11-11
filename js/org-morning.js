// صباح القسم (A47): شاشة واحدة لرئيس القسم فيها ما يحتاج قراره اليوم، تُبنى من بيانات موجودة (لا خادم، لا ذكاء).
// تظهر داخل تبويب «التقارير» فقط، ولا تُضاف إلى الشاشة الرئيسية.
import { getGroupMessages } from './storage.js';
import { listTasks, isSilent } from './tasks.js';
import { loadStructure, projectLate, projOf, projectLine } from './org-structure.js';
import { groupMembers, countsForPoints } from './group.js';
import { api } from './cloud.js';

const DAY = 86400000;
const today = () => new Date(new Date().toDateString()).getTime();

export async function morningBriefing() {
  const out = { late: [], silent: [], projects: [], requests: [], unposted: [] };

  // ١) مهام متأخرة (التي أرسلتها ولم تُنجز، وموعدها مضى)
  for (const t of await listTasks()) {
    if (!t.mine || t.status === 'done' || !t.due) continue;
    const due = new Date(`${t.due}T00:00`).getTime();
    if (due < today()) { const d = Math.round((today() - due) / DAY); out.late.push({ text: `${t.title} · ${t.toName}`, detail: `متأخرة ${d} ${d === 1 ? 'يوم' : 'أيام'}`, days: d, link: '#/tasks' }); }
    if (isSilent(t)) out.unposted.push({ text: `${t.toName} لم ينشر: ${t.title}`, link: '#/tasks' });
  }
  out.late.sort((a, b) => b.days - a.days);

  // ٢) موظفون لم ينشروا منذ ٥ أيام (مثل تنبيه التقارير، لكن مع العدد)
  const posts = (await getGroupMessages()).filter(countsForPoints);
  const now = Date.now();
  for (const [u, m] of groupMembers()) {
    if (m.role !== 'employee') continue;
    if (m.joinedAt && now - m.joinedAt < 5 * DAY) continue;
    const last = posts.filter((x) => x.from === u).at(-1)?.sentAt || 0;
    const days = last ? Math.floor((now - last) / DAY) : null;
    if (days === null || days >= 5) out.silent.push({ text: m.name, detail: days === null ? 'لم ينشر أبداً' : `منذ ${days} يوماً`, days, link: '#/group' });
  }
  out.silent.sort((a, b) => (b.days ?? 999) - (a.days ?? 999));

  // ٣) مشاريع تجاوزت موعدها ولم تكتمل
  const st = await loadStructure();
  for (const n of st.nodes) {
    if (n.type === 'custom' && projectLate(n)) out.projects.push({ text: `${n.name} · ${projOf(n).progress}٪`, detail: projectLine(n), link: '#/structure' });
  }

  // ٤) طلبات من المسؤولين لم تُطبَّق بعد (إن بقيت، فالهاتف لم يعالجها)
  try {
    const { db, F } = await api();
    out.requests = (await F.getDocs(F.collection(db, 'requests'))).docs.map((d) => ({ text: d.data().op, link: '#/structure' }));
  } catch { /* بلا اتصال: لا نعرض شيئاً */ }

  return out;
}

export function morningHTML(b, esc) {
  const block = (title, items, empty) => `
    <div class="morning__block">
      <h4>${title}${items.length ? ` <small>${items.length}</small>` : ''}</h4>
      ${items.length ? `<ul>${items.slice(0, 8).map((x) => `<li><a href="${x.link}">${esc(x.text)}${x.detail ? `<small> · ${esc(x.detail)}</small>` : ''}</a></li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`}
    </div>`;
  const total = b.late.length + b.silent.length + b.projects.length + b.requests.length + b.unposted.length;
  return `<h3>صباح القسم${total ? ` · ${total} ${total === 1 ? 'أمر ينتظرك' : 'أمراً ينتظرك'}` : ' · كل شيء على ما يرام'}</h3>
    <div class="morning">
      ${block('مهام متأخرة', b.late, 'لا مهام متأخرة.')}
      ${block('موظفون صامتون', b.silent, 'كل الموظفين ينشرون.')}
      ${block('مشاريع متأخرة', b.projects, 'لا مشاريع متأخرة.')}
      ${block('طلبات لم تُطبَّق', b.requests, 'لا طلبات معلّقة.')}
      ${block('مهام لم ينشر أصحابها', b.unposted, 'الجميع نشر في موعده.')}
    </div>`;
}
