// شاشة المجلد: كل ملاحظاتك في مكان واحد، مع بحث وتصفية حسب القسم
import { CATEGORIES, NONE, categoryById } from '../categories.js';
import { getEntries } from '../storage.js';
import { noteHTML, bindNoteActions, esc } from '../notes-view.js';
import { backupStatus } from '../backup.js';

export const title = 'المجلد';

const dayKey = (t) => new Date(t).toDateString();
const fmtDay = new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function dayLabel(t) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86_400_000);
  if (diff === 0) return 'اليوم';
  if (diff === 1) return 'أمس';
  return fmtDay.format(t);
}

// تطبيع بسيط للعربية حتى يجد البحث "أفكار" عند كتابة "افكار"
const norm = (s) => String(s || '').toLowerCase()
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

let state = { q: '', cat: 'all' };

export async function mount(root) {
  let entries = await getEntries();
  const status = await backupStatus();

  root.innerHTML = `
    ${status.needsReminder && entries.length ? `
      <a class="banner" href="#/settings?backup">
        💾 ${status.lastExportAt ? 'مرّ أسبوع على آخر نسخة احتياطية.' : 'لم تحفظ نسخة احتياطية بعد.'}
        <strong>احفظها الآن</strong>
      </a>` : ''}
    <div class="search">
      <input type="search" id="q" placeholder="ابحث في ملاحظاتك…" aria-label="بحث" value="${esc(state.q)}">
    </div>
    <div class="filters" id="filters" role="tablist" aria-label="الأقسام"></div>
    <div id="list"></div>
  `;
  const q = root.querySelector('#q');
  const filters = root.querySelector('#filters');
  const list = root.querySelector('#list');

  function renderFilters() {
    const counts = {};
    entries.forEach((e) => { const k = categoryById(e.category) ? e.category : 'pending'; counts[k] = (counts[k] || 0) + 1; });
    const opts = [
      { id: 'all', label: 'الكل', color: 'var(--accent)', n: entries.length },
      ...[...CATEGORIES, NONE].map((c) => ({ ...c, n: counts[c.id] || 0 })).filter((c) => c.n),
      ...(counts.pending ? [{ id: 'pending', label: 'لم تُصنّف', color: 'var(--muted)', n: counts.pending }] : []),
    ];
    if (!opts.some((o) => o.id === state.cat)) state.cat = 'all';
    filters.innerHTML = opts.map((o) => `
      <button class="chip chip--tiny ${o.id === state.cat ? 'is-active' : ''}" role="tab"
        aria-selected="${o.id === state.cat}" data-filter="${o.id}" style="--c:${o.color}">
        ${o.label} <span class="chip__n">${o.n}</span>
      </button>`).join('');
  }

  function renderList() {
    const nq = norm(state.q.trim());
    const shown = entries.filter((e) => {
      if (state.cat === 'pending' ? categoryById(e.category) : state.cat !== 'all' && e.category !== state.cat) return false;
      return !nq || norm(e.text).includes(nq) || norm(e.meta?.title).includes(nq);
    });
    if (!entries.length) {
      list.innerHTML = `<p class="empty muted">مجلدك فارغ. تحدّث مع <a href="#/home">الرفيقة</a> وستظهر ملاحظاتك هنا.</p>`;
      return;
    }
    if (!shown.length) {
      list.innerHTML = `<p class="empty muted">لا نتائج.</p>`;
      return;
    }
    const groups = [];
    for (const e of shown) {
      const k = dayKey(e.createdAt);
      if (groups.at(-1)?.k !== k) groups.push({ k, t: e.createdAt, items: [] });
      groups.at(-1).items.push(e);
    }
    // البحث بالنص الأصلي (للتظليل) فقط إن طابق حرفياً
    const hl = state.q.trim();
    list.innerHTML = groups.map((g) => `
      <h3 class="day">${dayLabel(g.t)}</h3>
      <ul class="notes">${g.items.map((e) => noteHTML(e, { showCategory: true, highlight: hl })).join('')}</ul>
    `).join('');
  }

  renderFilters();
  renderList();

  q.addEventListener('input', () => { state.q = q.value; renderList(); });
  filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.cat = b.dataset.filter;
    renderFilters();
    renderList();
  });
  bindNoteActions(list, async () => {
    entries = await getEntries();
    renderFilters();
    renderList();
  });
}

export function unmount() {}
