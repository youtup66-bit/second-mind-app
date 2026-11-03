// شاشة العقل: الأقسام ككرات مترابطة.
// - حجم الكرة = عدد ملاحظاتها.
// - الخط بين قسمين يقوى كلما تحدثت عنهما في الجلسة نفسها (ملاحظات متقاربة زمنياً).
// - لمس الكرة يفتح ملاحظاتها، ويمكن نقلها لقسم آخر أو حذفها.
import { CATEGORIES, NONE, categoryById } from '../categories.js';
import { getEntries, deleteEntry } from '../storage.js';
import { setCategory } from '../classifier.js';
import { createMindGraph } from '../mind-graph.js';

export const title = 'العقل';

const SESSION_GAP = 45 * 60 * 1000; // ملاحظتان بينهما أقل من ٤٥ دقيقة تُعدّان في جلسة واحدة

let graph = null;

// يحسب الأوزان والروابط من الملاحظات
function buildModel(entries) {
  const weights = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  entries.forEach((e) => { if (e.category in weights) weights[e.category]++; });

  const known = entries
    .filter((e) => e.category in weights)
    .sort((a, b) => a.createdAt - b.createdAt);
  const pairs = {};
  for (let i = 1; i < known.length; i++) {
    const a = known[i - 1], b = known[i];
    if (a.category === b.category || b.createdAt - a.createdAt > SESSION_GAP) continue;
    const k = [a.category, b.category].sort().join('|');
    pairs[k] = (pairs[k] || 0) + 1;
  }
  const maxPair = Math.max(1, ...Object.values(pairs));
  const maxW = Math.max(1, ...Object.values(weights));

  const links = [
    // كل قسم فيه ملاحظات يتصل بـ"أنا"
    ...CATEGORIES.filter((c) => weights[c.id]).map((c) => ({ a: 'me', b: c.id, w: 0.15 + 0.35 * (weights[c.id] / maxW) })),
    ...Object.entries(pairs).map(([k, n]) => {
      const [a, b] = k.split('|');
      return { a, b, w: 0.25 + 0.75 * (n / maxPair) };
    }),
  ];
  // قبل وجود أي ملاحظات: شبكة خفيفة حتى لا تبدو الشاشة فارغة
  if (!known.length) {
    CATEGORIES.forEach((c, i) => {
      links.push({ a: 'me', b: c.id, w: 0.1 });
      links.push({ a: c.id, b: CATEGORIES[(i + 1) % CATEGORIES.length].id, w: 0 });
    });
  }
  return { weights, links, total: known.length };
}

const fmtDate = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function mount(root) {
  let entries = await getEntries();
  let model = buildModel(entries);

  root.innerHTML = `
    <p class="mind-hint muted" id="hint"></p>
    <canvas class="mind-canvas" aria-label="خريطة أقسام عقلك"></canvas>
    <div class="sheet" id="sheet" hidden>
      <div class="sheet__panel sheet__panel--tall" role="dialog" aria-labelledby="sheet-title">
        <div class="sheet__head">
          <span class="sheet__dot" id="sheet-dot"></span>
          <p class="sheet__title" id="sheet-title"></p>
          <button class="btn btn--ghost sheet__close" id="sheet-close" aria-label="إغلاق">✕</button>
        </div>
        <ul class="notes" id="notes"></ul>
      </div>
    </div>
  `;
  const hint = root.querySelector('#hint');
  const canvas = root.querySelector('canvas');
  const sheet = root.querySelector('#sheet');
  const notesEl = root.querySelector('#notes');
  let openCat = null;

  const setHint = () => {
    hint.textContent = model.total
      ? 'المس كرة لترى ملاحظاتها · اسحبها لتحركها'
      : 'تحدّث مع الرفيقة، وستكبر الكرات مع كل ما تقوله.';
  };
  setHint();

  const top = canvas.getBoundingClientRect().top;
  const tabbar = document.querySelector('.tabbar').getBoundingClientRect().height;
  canvas.style.height = `${Math.max(320, innerHeight - top - tabbar - 16)}px`;

  const nodes = [
    { id: 'me', label: 'أنا', color: '#ffffff', weight: 0, fixedR: 22 },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, color: c.color, weight: model.weights[c.id] })),
  ];

  graph = createMindGraph(canvas, nodes, model.links, {
    onTap: (n) => { if (n.id !== 'me') openSheet(n.id); },
  });

  async function refresh() {
    entries = await getEntries();
    model = buildModel(entries);
    graph.update(model.weights, model.links);
    setHint();
    if (openCat) renderNotes();
  }

  function openSheet(catId) {
    openCat = catId;
    const c = categoryById(catId);
    root.querySelector('#sheet-title').textContent = c.label;
    root.querySelector('#sheet-dot').style.background = c.color;
    renderNotes();
    sheet.hidden = false;
  }

  function closeSheet() {
    sheet.hidden = true;
    openCat = null;
  }

  function renderNotes() {
    const list = entries.filter((e) => e.category === openCat);
    if (!list.length) {
      notesEl.innerHTML = `<li class="notes__empty muted">لا توجد ملاحظات هنا بعد.</li>`;
      return;
    }
    notesEl.innerHTML = list.map((e) => `
      <li class="note" data-id="${e.id}">
        ${e.meta?.title ? `<p class="note__title">${esc(e.meta.title)}</p>` : ''}
        <p class="note__text">${esc(e.text)}</p>
        <div class="note__foot">
          <time class="muted">${fmtDate.format(e.createdAt)}${e.source === 'voice' ? ' · 🎙' : ''}</time>
          <span class="note__actions">
            <button class="link-btn" data-act="move">نقل</button>
            <button class="link-btn link-btn--danger" data-act="delete">حذف</button>
          </span>
        </div>
        <div class="note__move" hidden>
          ${[...CATEGORIES, NONE].filter((c) => c.id !== openCat).map((c) => `
            <button class="chip chip--tiny" data-cat="${c.id}" style="--c:${c.color}">${c.label}</button>`).join('')}
        </div>
      </li>`).join('');
  }

  sheet.addEventListener('click', async (e) => {
    if (e.target === sheet || e.target.closest('#sheet-close')) return closeSheet();
    const li = e.target.closest('.note');
    if (!li) return;
    const id = li.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'move') {
      const box = li.querySelector('.note__move');
      box.hidden = !box.hidden;
    } else if (act === 'delete') {
      if (!confirm('حذف هذه الملاحظة نهائياً؟')) return;
      await deleteEntry(id);
      await refresh();
    } else if (e.target.closest('[data-cat]')) {
      await setCategory(id, e.target.closest('[data-cat]').dataset.cat);
      await refresh();
    }
  });
}

export function unmount() {
  graph?.destroy();
  graph = null;
}
