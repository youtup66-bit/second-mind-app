// شاشة العقل: الأقسام ككرات مترابطة.
// - حجم الكرة = عدد ملاحظاتها.
// - الخط بين قسمين يقوى كلما تحدثت عنهما في الجلسة نفسها (ملاحظات متقاربة زمنياً).
// - لمس الكرة يفتح ملاحظاتها، ويمكن نقلها لقسم آخر أو حذفها.
import { CATEGORIES, categoryById } from '../categories.js';
import { getEntries } from '../storage.js';
import { createMindGraph } from '../mind-graph.js';
import { noteHTML, bindNoteActions, esc } from '../notes-view.js';
import { createSummary, summaryHTML } from '../summaries.js';

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
        <div class="sheet__body">
          <button class="btn btn--ghost sheet__sum" id="sum-cat">✨ لخّص هذا القسم</button>
          <div id="cat-sum"></div>
          <ul class="notes" id="notes"></ul>
        </div>
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

  const catSum = root.querySelector('#cat-sum');
  const sumBtn = root.querySelector('#sum-cat');
  sumBtn.addEventListener('click', async () => {
    sumBtn.disabled = true;
    catSum.innerHTML = '<p class="muted"><span class="dots"><i></i><i></i><i></i></span> أقرأ ملاحظات هذا القسم…</p>';
    try {
      catSum.innerHTML = summaryHTML(await createSummary({ category: openCat }), { removable: false });
    } catch (err) {
      catSum.innerHTML = `<p class="status status--err">${esc(err.message)}${err.code === 'NO_KEY' ? ' <a href="#/settings">الإعدادات</a>' : ''}</p>`;
    } finally {
      sumBtn.disabled = false;
    }
  });

  function openSheet(catId) {
    openCat = catId;
    catSum.innerHTML = '';
    sumBtn.hidden = !model.weights[catId];
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
    notesEl.innerHTML = list.map((e) => noteHTML(e)).join('');
  }

  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('#sheet-close')) closeSheet();
  });
  bindNoteActions(notesEl, refresh);
}

export function unmount() {
  graph?.destroy();
  graph = null;
}
