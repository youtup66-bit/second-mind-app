// شاشة العقل: الأقسام ككرات مترابطة.
// - حجم الكرة = عدد ملاحظاتها.
// - الخط بين قسمين يقوى كلما تحدثت عنهما في الجلسة نفسها (ملاحظات متقاربة زمنياً).
// - لمس الكرة يفتح ملاحظاتها، ويمكن نقلها لقسم آخر أو حذفها.
// - "＋ قسم جديد" يضيف كرة لقسم من اختيارك، يصنّف Gemini ملاحظاتك فيه تلقائياً.
import {
  CATEGORIES, categoryById, isCustom, PALETTE, SUGGESTED, MAX_CUSTOM,
  addCategory, updateCategory, removeCategory,
} from '../categories.js';
import { getEntries } from '../storage.js';
import { createMindGraph } from '../mind-graph.js';
import { noteHTML, bindNoteActions, esc } from '../notes-view.js';
import { createSummary, summaryHTML } from '../summaries.js';

export const title = 'العقل';

const SESSION_GAP = 45 * 60 * 1000; // ملاحظتان بينهما أقل من ٤٥ دقيقة تُعدّان في جلسة واحدة
// على الجوال يرسل المتصفح "نقرة" إضافية بعد رفع الإصبع؛ إن فُتحت نافذة في تلك اللحظة
// وصلتها النقرة على الخلفية فأغلقتها فوراً. لذلك نتجاهل لمس الخلفية لحظة بعد الفتح.
const GHOST_CLICK_MS = 500;

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
  // الأقسام الفارغة تبقى متصلة بخيط خفيف حتى لا تشرد بعيداً
  CATEGORIES.filter((c) => !weights[c.id]).forEach((c) => links.push({ a: 'me', b: c.id, w: 0.05 }));
  // قبل وجود أي ملاحظات: شبكة خفيفة حتى لا تبدو الشاشة فارغة
  if (!known.length) {
    CATEGORIES.forEach((c, i) => links.push({ a: c.id, b: CATEGORIES[(i + 1) % CATEGORIES.length].id, w: 0 }));
  }
  return { weights, links, total: known.length };
}

export async function mount(root) {
  let entries = await getEntries();
  let model = buildModel(entries);

  root.innerHTML = `
    <div class="mind-bar">
      <p class="mind-hint muted" id="hint"></p>
      <button class="tool" id="add-cat">＋ قسم جديد</button>
    </div>
    <canvas class="mind-canvas" aria-label="خريطة أقسام عقلك"></canvas>

    <div class="sheet" id="sheet" hidden>
      <div class="sheet__panel sheet__panel--tall" role="dialog" aria-labelledby="sheet-title">
        <div class="sheet__head">
          <span class="sheet__dot" id="sheet-dot"></span>
          <p class="sheet__title" id="sheet-title"></p>
          <button class="btn btn--ghost sheet__close" id="edit-cat" hidden aria-label="تعديل القسم">✏️</button>
          <button class="btn btn--ghost sheet__close" id="sheet-close" aria-label="إغلاق">✕</button>
        </div>
        <p class="muted sheet__desc" id="sheet-desc" hidden></p>
        <div class="sheet__body">
          <button class="btn btn--ghost sheet__sum" id="sum-cat">✨ لخّص هذا القسم</button>
          <div id="cat-sum"></div>
          <ul class="notes" id="notes"></ul>
        </div>
      </div>
    </div>

    <div class="sheet" id="cat-form" hidden>
      <div class="sheet__panel sheet__panel--tall" role="dialog" aria-labelledby="form-title">
        <div class="sheet__head">
          <p class="sheet__title" id="form-title">قسم جديد</p>
          <button class="btn btn--ghost sheet__close" data-close aria-label="إغلاق">✕</button>
        </div>
        <div class="sheet__body cat-form">
          <div id="suggest-box">
            <p class="muted">اقتراحات (المس لتعبئة النموذج):</p>
            <div class="chips-wrap" id="suggest"></div>
          </div>
          <label for="cat-name">اسم القسم</label>
          <input id="cat-name" type="text" maxlength="24" placeholder="مثلاً: صحة ورياضة">
          <label for="cat-desc">ماذا يدخل فيه؟ <span class="muted">(يساعد الرفيقة على التصنيف)</span></label>
          <textarea id="cat-desc" rows="2" maxlength="160" placeholder="مثلاً: النوم، الأكل، الرياضة، المواعيد الطبية"></textarea>
          <label>اللون</label>
          <div class="swatches" id="swatches" role="radiogroup" aria-label="لون القسم"></div>
          <p class="status" id="form-status" role="status"></p>
          <div class="row">
            <button class="btn" id="save-cat">حفظ</button>
            <button class="btn btn--danger" id="delete-cat" hidden>حذف القسم</button>
          </div>
          <p class="muted" id="delete-note" hidden>عند الحذف تنتقل ملاحظات هذا القسم إلى "تفكير" ولا تضيع.</p>
        </div>
      </div>
    </div>
  `;
  const hint = root.querySelector('#hint');
  const canvas = root.querySelector('canvas');
  const sheet = root.querySelector('#sheet');
  const form = root.querySelector('#cat-form');
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

  // ---- اللوحة ----
  function buildGraph() {
    graph?.destroy();
    const nodes = [
      { id: 'me', label: 'أنا', color: '#ffffff', weight: 0, fixedR: 22 },
      ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, color: c.color, weight: model.weights[c.id] || 0 })),
    ];
    graph = createMindGraph(canvas, nodes, model.links, {
      onTap: (n) => { if (n.id !== 'me') openSheet(n.id); },
    });
  }
  buildGraph();

  async function refresh() {
    entries = await getEntries();
    model = buildModel(entries);
    graph.update(model.weights, model.links);
    setHint();
    if (openCat) renderNotes();
  }

  // بعد إضافة قسم أو تعديله أو حذفه نعيد بناء الكرات
  async function rebuild() {
    entries = await getEntries();
    model = buildModel(entries);
    buildGraph();
    setHint();
  }

  // ---- فتح وإغلاق النوافذ مع حماية من "النقرة الشبح" ----
  const openedAt = new WeakMap();
  const show = (el) => { el.hidden = false; openedAt.set(el, performance.now()); };
  const isGhost = (el) => performance.now() - (openedAt.get(el) || 0) < GHOST_CLICK_MS;

  // ---- نافذة ملاحظات القسم ----
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
    const c = categoryById(catId);
    if (!c) return;
    openCat = catId;
    catSum.innerHTML = '';
    sumBtn.hidden = !model.weights[catId];
    root.querySelector('#sheet-title').textContent = c.label;
    root.querySelector('#sheet-dot').style.background = c.color;
    const desc = root.querySelector('#sheet-desc');
    desc.hidden = !isCustom(catId) || !c.desc;
    desc.textContent = c.desc || '';
    root.querySelector('#edit-cat').hidden = !isCustom(catId);
    renderNotes();
    show(sheet);
  }

  function closeSheet() {
    sheet.hidden = true;
    openCat = null;
  }

  function renderNotes() {
    const list = entries.filter((e) => e.category === openCat);
    if (!list.length) {
      notesEl.innerHTML = `<li class="notes__empty muted">لا توجد ملاحظات هنا بعد.${isCustom(openCat) ? ' ستصنّف الرفيقة فيه ما يناسبه من كلامك القادم.' : ''}</li>`;
      return;
    }
    notesEl.innerHTML = list.map((e) => noteHTML(e)).join('');
  }

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('#sheet-close') || (e.target === sheet && !isGhost(sheet))) closeSheet();
    if (e.target.closest('#edit-cat')) { const id = openCat; closeSheet(); openForm(id); }
  });
  bindNoteActions(notesEl, refresh);

  // ---- نموذج إضافة/تعديل قسم ----
  const nameIn = root.querySelector('#cat-name');
  const descIn = root.querySelector('#cat-desc');
  const swatches = root.querySelector('#swatches');
  const formStatus = root.querySelector('#form-status');
  const delBtn = root.querySelector('#delete-cat');
  let editingId = null;
  let color = PALETTE[0];

  function renderSwatches() {
    swatches.innerHTML = PALETTE.map((c) => `
      <button type="button" class="swatch ${c === color ? 'is-active' : ''}" role="radio" aria-checked="${c === color}"
        aria-label="لون" data-color="${c}" style="--c:${c}"></button>`).join('');
  }
  swatches.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (b) { color = b.dataset.color; renderSwatches(); }
  });

  function renderSuggestions() {
    const taken = new Set(CATEGORIES.map((c) => c.label));
    const list = SUGGESTED.filter((s) => !taken.has(s.label));
    root.querySelector('#suggest-box').hidden = !!editingId || !list.length;
    root.querySelector('#suggest').innerHTML = list.map((s, i) => `
      <button type="button" class="chip chip--tiny" data-suggest="${i}" style="--c:${s.color}">${s.label}</button>`).join('');
    root.querySelector('#suggest').dataset.list = JSON.stringify(list);
  }
  root.querySelector('#suggest').addEventListener('click', (e) => {
    const b = e.target.closest('[data-suggest]');
    if (!b) return;
    const s = JSON.parse(e.currentTarget.dataset.list)[Number(b.dataset.suggest)];
    nameIn.value = s.label;
    descIn.value = s.desc;
    color = s.color;
    renderSwatches();
  });

  function openForm(id = null) {
    editingId = id;
    const c = id ? categoryById(id) : null;
    const customCount = CATEGORIES.filter((x) => isCustom(x.id)).length;
    if (!id && customCount >= MAX_CUSTOM) {
      hint.textContent = `وصلت إلى الحد الأقصى (${MAX_CUSTOM} أقسام مضافة). احذف قسماً لتضيف غيره.`;
      return;
    }
    root.querySelector('#form-title').textContent = c ? `تعديل "${c.label}"` : 'قسم جديد';
    nameIn.value = c?.label || '';
    descIn.value = c?.desc || '';
    const used = new Set(CATEGORIES.map((x) => x.color));
    color = c?.color || PALETTE.find((p) => !used.has(p)) || PALETTE[0];
    formStatus.textContent = '';
    delBtn.hidden = !c;
    root.querySelector('#delete-note').hidden = !c;
    renderSwatches();
    renderSuggestions();
    show(form);
    if (!c) setTimeout(() => nameIn.focus(), 50);
  }
  root.querySelector('#add-cat').addEventListener('click', () => openForm());

  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || (e.target === form && !isGhost(form))) form.hidden = true;
  });

  root.querySelector('#save-cat').addEventListener('click', async () => {
    formStatus.className = 'status';
    try {
      const data = { label: nameIn.value, desc: descIn.value, color };
      if (editingId) await updateCategory(editingId, data);
      else await addCategory(data);
      form.hidden = true;
      await rebuild();
      hint.textContent = editingId ? 'عدّلتُ القسم ✓' : `أضفتُ "${data.label.trim()}" ✓ ستصنّف الرفيقة فيه ما يناسبه من كلامك القادم.`;
    } catch (err) {
      formStatus.className = 'status status--err';
      formStatus.textContent = err.message;
    }
  });

  delBtn.addEventListener('click', async () => {
    const c = categoryById(editingId);
    if (!c || !confirm(`حذف قسم "${c.label}"؟ تنتقل ملاحظاته إلى "تفكير".`)) return;
    const moved = await removeCategory(editingId);
    form.hidden = true;
    await rebuild();
    hint.textContent = `حذفتُ القسم${moved ? `، ونقلتُ ${moved} ملاحظة إلى "تفكير"` : ''}.`;
  });
}

export function unmount() {
  graph?.destroy();
  graph = null;
}
