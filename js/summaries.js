// الملخصات: تجمع ملاحظات فترة أو قسم، ترسل نصها إلى Gemini (بطلب منك فقط)، وتحفظ النتيجة محلياً.
import { CATEGORIES, categoryById } from './categories.js';
import { getEntries, addSummary } from './storage.js';
import { summarize } from './gemini.js';

const DAY = 86_400_000;
const MAX_NOTES = 150;

export const PERIODS = {
  day:   { label: 'اليوم',          since: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); } },
  week:  { label: 'آخر ٧ أيام',     since: () => Date.now() - 7 * DAY },
  month: { label: 'آخر ٣٠ يوماً',   since: () => Date.now() - 30 * DAY },
};

// spec: { period: 'day'|'week'|'month' } أو { category: 'worry' }
export async function notesFor(spec) {
  const all = (await getEntries()).filter((e) => categoryById(e.category) && e.category !== 'none');
  if (spec.category) return all.filter((e) => e.category === spec.category);
  const since = PERIODS[spec.period].since();
  return all.filter((e) => e.createdAt >= since);
}

export function labelFor(spec) {
  return spec.category ? `قسم ${categoryById(spec.category).label}` : PERIODS[spec.period].label;
}

export async function createSummary(spec) {
  const notes = (await notesFor(spec)).slice(0, MAX_NOTES); // الأحدث أولاً
  if (!notes.length) throw new Error('لا توجد ملاحظات في هذه الفترة بعد.');
  const label = labelFor(spec);
  const result = await summarize(
    [...notes].reverse().map((e) => ({
      createdAt: e.createdAt, text: e.text, done: !!e.meta?.done,
      categoryLabel: categoryById(e.category).label,
    })),
    label,
  );
  const counts = {};
  notes.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + 1; });
  return addSummary({
    kind: spec.category ? 'category' : spec.period,
    category: spec.category || null,
    label,
    from: notes.at(-1).createdAt,
    to: notes[0].createdAt,
    count: notes.length,
    counts,
    result,
  });
}

const fmtShort = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' });
const fmtFull = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function list(title, items, icon) {
  if (!items?.length) return '';
  return `<div class="sum__block"><h4>${icon} ${title}</h4><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}

// شريط ملون يوضح توزيع الأقسام في الملخص
function bar(counts, total) {
  return `<div class="sum__bar" aria-hidden="true">${CATEGORIES.filter((c) => counts[c.id]).map((c) =>
    `<span style="flex:${counts[c.id]};background:${c.color}" title="${c.label}"></span>`).join('')}</div>
    <p class="sum__legend muted">${CATEGORIES.filter((c) => counts[c.id]).map((c) =>
      `<span><i style="background:${c.color}"></i>${c.label} ${counts[c.id]}</span>`).join('')}</p>`;
}

export function summaryHTML(s, { removable = true } = {}) {
  const r = s.result;
  const range = s.from && s.to && fmtShort.format(s.from) !== fmtShort.format(s.to)
    ? `${fmtShort.format(s.from)} – ${fmtShort.format(s.to)}` : fmtShort.format(s.to || s.createdAt);
  return `
    <article class="sum" data-id="${s.id}">
      <header class="sum__head">
        <span class="sum__mood" aria-hidden="true">${esc(r.moodEmoji || '✨')}</span>
        <div>
          <p class="sum__kind muted">${esc(s.label)} · ${range} · ${s.count} ملاحظة</p>
          <h3 class="sum__title">${esc(r.headline)}</h3>
          ${r.mood ? `<p class="sum__moodtext">المزاج: ${esc(r.mood)}</p>` : ''}
        </div>
      </header>
      ${s.counts ? bar(s.counts, s.count) : ''}
      <p class="sum__overview">${esc(r.overview)}</p>
      ${r.themes?.length ? `<p class="sum__themes">${r.themes.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</p>` : ''}
      ${list('مهام مفتوحة', r.openTasks, '☐')}
      ${list('أفكار تستحق العودة', r.ideas, '💡')}
      ${list('امتنان', r.gratitude, '💚')}
      ${r.suggestion ? `<p class="sum__tip">🌱 ${esc(r.suggestion)}</p>` : ''}
      <footer class="sum__foot muted">
        <time>${fmtFull.format(s.createdAt)}</time>
        ${removable ? '<button class="link-btn link-btn--danger" data-act="del-summary">حذف</button>' : ''}
      </footer>
    </article>`;
}
