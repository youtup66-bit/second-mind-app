// شاشة العقل: الأقسام ككرات مترابطة.
// - حجم الكرة = عدد ملاحظاتها.
// - الخط بين قسمين يقوى كلما تحدثت عنهما في الجلسة نفسها (ملاحظات متقاربة زمنياً).
// - لمس الكرة يفتح ملاحظاتها، ويمكن نقلها لقسم آخر أو حذفها.
// - "＋ قسم جديد" يضيف كرة لقسم من اختيارك، يصنّف Gemini ملاحظاتك فيه تلقائياً.
import {
  CATEGORIES, categoryById, isCustom, PALETTE, SUGGESTED, MAX_CUSTOM,
  addCategory, updateCategory, removeCategory,
} from '../categories.js';
import { getEntries, getSetting, setSetting } from '../storage.js';
import { nameGroup } from '../gemini.js';
import { createMindGraph } from '../mind-graph.js';
import { noteHTML, bindNoteActions, esc } from '../notes-view.js';
import { createSummary, summaryHTML } from '../summaries.js';
import { findOldNotesFor } from '../suggest.js';
import { setCategory } from '../classifier.js';

export const title = 'العقل';

const SESSION_GAP = 45 * 60 * 1000; // ملاحظتان بينهما أقل من ٤٥ دقيقة تُعدّان في جلسة واحدة
// على الجوال يرسل المتصفح "نقرة" إضافية بعد رفع الإصبع؛ إن فُتحت نافذة في تلك اللحظة
// وصلتها النقرة على الخلفية فأغلقتها فوراً. لذلك نتجاهل لمس الخلفية لحظة بعد الفتح.
const GHOST_CLICK_MS = 500;

let graph = null;

// ---- مقياس الحرارة: من الأبرد (ملاحظات أقل) إلى الأسخن (أكثر) ----
// تدرّج واسع: أزرق ← سماوي ← أخضر ← أصفر ← برتقالي ← أحمر
const HEAT = ['#3b4cc0', '#3d8bff', '#2fc6d6', '#4fd18a', '#b8e04a', '#f7d154', '#f99a3e', '#ee5a32', '#d7263d'];

function heatColor(t) {
  const x = Math.min(1, Math.max(0, t)) * (HEAT.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = HEAT[i], b = HEAT[Math.min(HEAT.length - 1, i + 1)];
  const mix = (k) => Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - f) + parseInt(b.slice(k, k + 2), 16) * f);
  return `#${[1, 3, 5].map((k) => mix(k).toString(16).padStart(2, '0')).join('')}`;
}

// مقياس لوغاريتمي: حتى لا يجعل قسمٌ ضخم كل الأقسام الأخرى زرقاء
function heatOf(n, min, max) {
  if (!n) return null;
  if (max <= min) return 1;
  return (Math.log(n) - Math.log(min)) / (Math.log(max) - Math.log(min));
}

// ---- أسماء المجموعات ----
// تُحفظ حسب أعضاء المجموعة (مثلاً "task+worry")، فيبقى الاسم ما دامت المجموعة نفسها.
// by: 'ai' (اقترحه Gemini) أو 'user' (كتبه المستخدم، ولا يُستبدل).
const groupSig = (members) => [...members].sort().join('+');

function groupList(groupMap) {
  const byNum = {};
  for (const [id, num] of Object.entries(groupMap)) (byNum[num] ||= []).push(id);
  return Object.entries(byNum).map(([num, members]) => ({ num: Number(num), members, sig: groupSig(members) }));
}

// اسم فوري من أسماء أكبر قسمين في المجموعة
function autoName(members, weights) {
  const top = [...members].sort((a, b) => (weights[b] || 0) - (weights[a] || 0)).map((id) => categoryById(id)?.label).filter(Boolean);
  return top.length > 2 ? `${top[0]} و${top[1]}…` : top.join(' و');
}

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
  return { weights, links, total: known.length, groups: findGroups(weights, pairs) };
}

// يكتشف مجموعات الأقسام المترابطة (انتشار التسميات الموزون):
// كل قسم يتبنّى تسمية جيرانه الأقوى رابطاً، حتى تستقر، فتتكون مجموعات متماسكة.
function findGroups(weights, pairs) {
  const adj = {};
  for (const [k, n] of Object.entries(pairs)) {
    const [a, b] = k.split('|');
    (adj[a] ||= {})[b] = n;
    (adj[b] ||= {})[a] = n;
  }
  const ids = Object.keys(adj).sort((a, b) => (weights[b] || 0) - (weights[a] || 0) || a.localeCompare(b));
  const label = Object.fromEntries(ids.map((id) => [id, id]));
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (const id of ids) {
      const score = {};
      for (const [nb, w] of Object.entries(adj[id])) score[label[nb]] = (score[label[nb]] || 0) + w;
      score[label[id]] = (score[label[id]] || 0) + 0.5; // ميل بسيط للبقاء
      const best = Object.entries(score).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
      if (best !== label[id]) { label[id] = best; changed = true; }
    }
    if (!changed) break;
  }
  // نرقّم المجموعات، ونُبقي فقط ما فيه قسمان فأكثر
  const count = {};
  Object.values(label).forEach((l) => { count[l] = (count[l] || 0) + 1; });
  const num = {};
  const out = {};
  for (const [id, l] of Object.entries(label)) {
    if (count[l] < 2) continue;
    out[id] = num[l] ??= Object.keys(num).length;
  }
  return out;
}

export async function mount(root) {
  let entries = await getEntries();
  let model = buildModel(entries);

  root.innerHTML = `
    <div class="mind-full">
      <canvas class="mind-canvas" aria-label="خريطة أقسام عقلك. قرّب إصبعين أو باعدهما للتصغير والتكبير"></canvas>
      <button type="button" class="struct-handle" id="handle" aria-label="القائمة" aria-expanded="false"><span></span></button>
      <div class="struct-menu mind-menu" id="menu" hidden>
        <p class="mind-hint" id="hint"></p>
        <div class="mind-words zoom-ctrl" role="group" aria-label="الخيارات">
          <button type="button" class="text-btn" id="add-cat">قسم جديد</button>
          <button type="button" class="text-btn" id="toggle-empty" hidden></button>
          <button type="button" class="text-btn" data-zoom="reset">عرض الكل</button>
          <button type="button" class="text-btn" data-zoom="style" id="style-word"></button>
          <button type="button" class="text-btn" data-zoom="mode" id="mode-word"></button>
          <button type="button" class="text-btn" data-zoom="space">المسافة</button>
        </div>
        <div class="space-ctrl" id="space-ctrl" hidden>
          <label for="spacing">المسافة بين الكرات</label>
          <input type="range" id="spacing" min="0.7" max="2.2" step="0.1">
          <span id="spacing-val"></span>
        </div>
        <div class="heat-legend" id="heat-legend" hidden>
          <span id="heat-min"></span>
          <i style="background:linear-gradient(90deg, ${HEAT.join(', ')})"></i>
          <span id="heat-max"></span>
        </div>
      </div>
      <button type="button" class="struct-name" id="mind-name" hidden></button>
    </div>

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
          <button class="btn btn--ghost sheet__sum" id="find-old" hidden>🔎 ابحث في ملاحظاتي القديمة عمّا يناسبه</button>
          <div id="find-results"></div>
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
  // شكل الكرات: نقاط صافية (الافتراضي) أو كرات مضيئة بهالات
  let mindStyle = await getSetting('mindStyle', 'dots');

  const setHint = () => {
    hint.textContent = model.total
      ? (mindStyle === 'dots' ? 'المس نقطة لترى ما يرتبط بها · قرّب بإصبعين لتظهر الأسماء' : 'المس كرة أو اسم مجموعة · بإصبعين كبّر وصغّر')
      : 'تحدّث مع الرفيقة، وستكبر الكرات مع كل ما تقوله.';
  };
  setHint();

  // ---- بأسلوب عقل المؤسسة: ملء الشاشة، ونقطة متوهجة تُسدل الخيارات، واسم الكرة يفتح ملاحظاتها ----
  const menu = root.querySelector('#menu');
  const handle = root.querySelector('#handle');
  const nameBtn = root.querySelector('#mind-name');
  let picked = null;
  const setMenu = (on) => {
    menu.hidden = !on;
    handle.setAttribute('aria-expanded', String(on));
    handle.classList.toggle('is-open', on);
  };
  handle.addEventListener('click', () => setMenu(menu.hidden));
  const showName = (n) => {
    picked = n;
    if (!n) { nameBtn.hidden = true; return; }
    nameBtn.innerHTML = `<i class="sdot" style="background:${n.color}"></i><span>${n.label}</span>`;
    nameBtn.hidden = false;
  };
  nameBtn.addEventListener('click', () => { if (picked && picked.id !== 'me') openSheet(picked.id); });
  const renderWords = () => {
    root.querySelector('#style-word').textContent = mindStyle === 'dots' ? 'كرات مضيئة' : 'نقاط';
    root.querySelector('#mode-word').textContent = colorMode === 'heat' ? 'الحجم' : 'الحرارة';
  };

  // ---- اللوحة ----
  function buildGraph() {
    graph?.destroy();
    // الأقسام الأساسية الفارغة تُخفى (إلا إن طلب إظهارها أو لا توجد ملاحظات بعد)؛ أقسامك المضافة تظهر دائماً
    const hideEmpty = !showEmpty && model.total > 0;
    const visible = CATEGORIES.filter((c) => !hideEmpty || model.weights[c.id] || isCustom(c.id));
    const hiddenCount = CATEGORIES.length - visible.length;
    const tgl = root.querySelector('#toggle-empty');
    tgl.hidden = model.total === 0 || (!showEmpty && !hiddenCount);
    tgl.textContent = showEmpty ? 'إخفاء الفارغة' : `+${hiddenCount} فارغة`;
    const nodes = [
      { id: 'me', label: 'أنا', color: '#ffffff', weight: 0, fixedR: 22 },
      ...visible.map((c) => ({ id: c.id, label: c.label, color: c.color, weight: model.weights[c.id] || 0, ...styleFor(c) })),
    ];
    graph = createMindGraph(canvas, nodes, model.links, {
      spacing,
      flat: mindStyle === 'dots',
      // النقاط: لمسة أولى تُبرز الكرة وما يرتبط بها، والثانية تفتح ملاحظاتها
      onSelect: (n) => { showName(n); if (n) setMenu(false); },
      groups: model.groups,
      groupLabels: labelsFor(model),
      // الكرات المضيئة: اللمس يفتح مباشرة؛ النقاط: لمسة ثانية على المختارة تفتحها أيضاً
      onTap: (n) => { if (n.id !== 'me') openSheet(n.id); else showName(n); },
      onGroupTap: renameGroup,
    });
  }

  let showEmpty = await getSetting('showEmptyCats', false);

  // ---- وضع العرض: الحرارة (اللون حسب العدد، والحجم ثابت) أو الحجم (الأصلي) ----
  let colorMode = await getSetting('mindColorMode', 'heat');

  // ---- المسافة بين الكرات ----
  let spacing = Number(await getSetting('mindSpacing', 1)) || 1;
  const spaceCtrl = root.querySelector('#space-ctrl');
  const spaceIn = root.querySelector('#spacing');
  const spaceVal = () => { root.querySelector('#spacing-val').textContent = `×${spacing.toFixed(1)}`; };
  spaceIn.value = spacing;
  spaceVal();
  spaceIn.addEventListener('input', () => { spacing = Number(spaceIn.value); spaceVal(); graph.setSpacing(spacing); });
  spaceIn.addEventListener('change', () => setSetting('mindSpacing', spacing));
  const counts = () => Object.values(model.weights).filter(Boolean);
  function styleFor(c) {
    if (colorMode !== 'heat') return { color: c.color, ring: null, core: null, fixedR: undefined };
    const n = model.weights[c.id] || 0;
    const vals = counts();
    const t = heatOf(n, Math.min(...vals, Infinity), Math.max(...vals, 0));
    const width = canvas.clientWidth || 360;
    // الكرة بلون قسمها، وفي وسطها نواة بلون الحرارة
    return {
      color: c.color,
      ring: null,
      core: t === null ? null : heatColor(t),
      fixedR: n ? Math.max(17, Math.min(25, width * 0.058)) : 11,
    };
  }
  function renderLegend() {
    const legend = root.querySelector('#heat-legend');
    const vals = counts();
    // نمط النقاط بلون القسم دائماً: لا حرارة فيه
    root.querySelector('[data-zoom="mode"]').hidden = mindStyle === 'dots';
    legend.hidden = mindStyle === 'dots' || colorMode !== 'heat' || !vals.length;
    if (legend.hidden) return;
    root.querySelector('#heat-min').textContent = `${Math.min(...vals)} أقل`;
    root.querySelector('#heat-max').textContent = `أكثر ${Math.max(...vals)}`;
  }
  function applyStyles() {
    graph.setStyles(Object.fromEntries(CATEGORIES.map((c) => [c.id, styleFor(c)])));
    renderLegend();
  }
  root.querySelector('#toggle-empty').addEventListener('click', async () => {
    showEmpty = !showEmpty;
    await setSetting('showEmptyCats', showEmpty);
    buildGraph();
  });

  let savedNames = await getSetting('groupNames', {});
  function labelsFor(m) {
    const out = {};
    for (const g of groupList(m.groups)) out[g.num] = savedNames[g.sig]?.name || autoName(g.members, m.weights);
    return out;
  }
  const refreshLabels = () => graph?.setGroupLabels(labelsFor(model));

  // يطلب من Gemini اسماً للمجموعات التي ليس لها اسم محفوظ (مرة واحدة لكل مجموعة)
  let naming = false;
  async function nameNewGroups() {
    if (naming || !(await getSetting('geminiApiKey', ''))) return;
    naming = true;
    try {
      for (const g of groupList(model.groups)) {
        if (savedNames[g.sig]) continue;
        const members = g.members.map((id) => ({
          label: categoryById(id)?.label || id,
          titles: entries.filter((e) => e.category === id).slice(0, 3).map((e) => e.meta?.title || e.text.slice(0, 30)),
        }));
        let name = '';
        try { name = await nameGroup(members); } catch { break; } // بلا اتصال أو نفدت الحصة: نكتفي بالاسم الفوري
        if (!name) continue;
        savedNames = { ...(await getSetting('groupNames', {})), [g.sig]: { name, by: 'ai' } };
        await setSetting('groupNames', savedNames);
        refreshLabels();
      }
    } finally {
      naming = false;
    }
  }

  async function renameGroup({ members, name }) {
    const sig = groupSig(members);
    const next = prompt('اسم هذه المجموعة (اتركه فارغاً لتعود إلى الاسم التلقائي):', name);
    if (next === null) return;
    savedNames = { ...(await getSetting('groupNames', {})) };
    if (next.trim()) savedNames[sig] = { name: next.trim().slice(0, 28), by: 'user' };
    else delete savedNames[sig];
    await setSetting('groupNames', savedNames);
    refreshLabels();
    hint.textContent = next.trim() ? 'غيّرتُ اسم المجموعة ✓' : 'عاد اسم المجموعة إلى التلقائي.';
  }

  buildGraph();
  nameNewGroups();

  root.querySelector('.zoom-ctrl').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (z === 'in') graph.zoomBy(1.35);
    else if (z === 'out') graph.zoomBy(1 / 1.35);
    else if (z === 'reset') { graph.resetView(); setMenu(false); } // ملاءمة كل الكرات للشاشة
    else if (z === 'space') spaceCtrl.hidden = !spaceCtrl.hidden;
    else if (z === 'style') {
      mindStyle = mindStyle === 'dots' ? 'balls' : 'dots';
      setSetting('mindStyle', mindStyle);
      graph.setFlat(mindStyle === 'dots');
      renderLegend();
      hint.textContent = mindStyle === 'dots'
        ? 'نقاط: قرّب بإصبعين لتظهر الأسماء، والمس نقطة لترى ما يرتبط بها.'
        : 'كرات مضيئة: المس الكرة لعرض ملاحظاتها.';
    }
    else if (z === 'mode') {
      colorMode = colorMode === 'heat' ? 'size' : 'heat';
      setSetting('mindColorMode', colorMode);
      applyStyles();
      hint.textContent = colorMode === 'heat'
        ? 'وضع الحرارة: الكرة بلون قسمها، والنواة في وسطها من الأبرد (ملاحظات أقل) إلى الأسخن (أكثر).'
        : 'وضع الحجم: الكرة تكبر بعدد ملاحظاتها، بلون قسمها.';
    }
    renderWords();
  });
  renderLegend();
  renderWords();
  // أول مرة (لا ملاحظات بعد): نُظهر القائمة ليعرف مكانها
  if (!model.total) setMenu(true);

  async function refresh() {
    entries = await getEntries();
    model = buildModel(entries);
    graph.update(model.weights, model.links, model.groups);
    applyStyles();
    refreshLabels();
    nameNewGroups();
    setHint();
    if (openCat) renderNotes();
  }

  // بعد إضافة قسم أو تعديله أو حذفه نعيد بناء الكرات
  async function rebuild() {
    entries = await getEntries();
    model = buildModel(entries);
    buildGraph();
    nameNewGroups();
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
    findBtn.hidden = !isCustom(catId);
    findBox.innerHTML = '';
    renderNotes();
    show(sheet);
  }

  // ---- البحث في الملاحظات القديمة (للأقسام المضافة) ----
  const findBtn = root.querySelector('#find-old');
  const findBox = root.querySelector('#find-results');
  let found = [];

  findBtn.addEventListener('click', async () => {
    const cat = categoryById(openCat);
    if (!cat) return;
    findBtn.disabled = true;
    findBox.innerHTML = '<p class="muted"><span class="dots"><i></i><i></i><i></i></span> أبحث في ملاحظاتك…</p>';
    try {
      const { entries: list, mode, reason } = await findOldNotesFor(cat);
      found = list;
      const how = mode === 'local'
        ? `<p class="muted find__note">بحث محلي بكلمات القسم${reason ? ` (${esc(reason)})` : ''}، فقد تفوته ملاحظات.</p>` : '';
      if (!list.length) {
        findBox.innerHTML = `${how}<p class="muted">لم أجد ملاحظات قديمة تناسب هذا القسم.</p>`;
        return;
      }
      findBox.innerHTML = `
        ${how}
        <p class="find__title">وجدت ${list.length} ${list.length === 1 ? 'ملاحظة قد تناسبه' : 'ملاحظات قد تناسبه'}. اختر ما تريد نقله:</p>
        <ul class="find__list">${list.map((e, i) => {
          const from = categoryById(e.category);
          return `<li><label class="switch">
            <input type="checkbox" data-pick="${i}" checked>
            <span><b>${esc(e.meta?.title || e.text.slice(0, 40))}</b>
              <span class="muted"> · من ${esc(from?.label || '')}</span><br>
              <span class="find__text">${esc(e.text.slice(0, 120))}${e.text.length > 120 ? '…' : ''}</span></span>
          </label></li>`;
        }).join('')}</ul>
        <div class="row">
          <button class="btn" id="move-picked">انقل المحدد (${list.length})</button>
          <button class="btn btn--ghost" id="cancel-picked">إلغاء</button>
        </div>`;
    } catch (err) {
      findBox.innerHTML = `<p class="status status--err">${esc(err.message)}</p>`;
    } finally {
      findBtn.disabled = false;
    }
  });

  findBox.addEventListener('change', () => {
    const n = findBox.querySelectorAll('[data-pick]:checked').length;
    const b = findBox.querySelector('#move-picked');
    if (b) { b.textContent = `انقل المحدد (${n})`; b.disabled = !n; }
  });

  findBox.addEventListener('click', async (e) => {
    if (e.target.closest('#cancel-picked')) { findBox.innerHTML = ''; return; }
    if (!e.target.closest('#move-picked')) return;
    const picked = [...findBox.querySelectorAll('[data-pick]:checked')].map((x) => found[Number(x.dataset.pick)]);
    for (const entry of picked) await setCategory(entry.id, openCat);
    findBox.innerHTML = `<p class="status status--ok">نقلتُ ${picked.length} ${picked.length === 1 ? 'ملاحظة' : 'ملاحظات'} إلى هذا القسم ✓</p>`;
    sumBtn.hidden = false;
    await refresh();
  });

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
      let created = null;
      if (editingId) await updateCategory(editingId, data);
      else created = await addCategory(data);
      form.hidden = true;
      await rebuild();
      hint.textContent = editingId ? 'عدّلتُ القسم ✓' : `أضفتُ "${data.label.trim()}" ✓ ستصنّف الرفيقة فيه ما يناسبه من كلامك القادم.`;
      // قسم جديد: نفتح نافذته ونقترح البحث في الملاحظات القديمة
      if (created && entries.some((e) => e.category && e.category !== 'none')) {
        openSheet(created.id);
        findBox.innerHTML = '<p class="muted">قسمك جاهز. هل أبحث في ملاحظاتك القديمة عمّا يناسبه؟ اضغط 🔎 بالأعلى.</p>';
      }
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
