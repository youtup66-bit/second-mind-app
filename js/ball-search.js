// بحث الكرات فوق رسم الأقسام: يكتب الاسم فيتمركز الرسم على أول كرة مطابقة، وتُختار غيرها من القائمة
const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ballSearchHTML = () => `<div class="ball-search">
  <input type="search" id="ball-q" placeholder="ابحث عن كرة بالاسم" aria-label="ابحث عن كرة">
  <div class="ball-hits" id="ball-hits" aria-live="polite"></div></div>`;

// focus(id): يتمركز الرسم على الكرة. nodes(): عقد الرسم الحالية (الكرات والأشخاص، وتتغير بعد التعديل)
export function bindBallSearch(root, { focus, nodes }) {
  const input = root.querySelector('#ball-q'), hits = root.querySelector('#ball-hits');
  if (!input || !hits) return;
  input.addEventListener('input', () => {
    const q = norm(input.value);
    if (!q) { hits.innerHTML = ''; return; }
    // ترتيب: الاسم المطابق تماماً، ثم ما يبدأ به، ثم ما تبدأ به إحدى كلماته، ثم الباقي
    const rank = (t) => (t === q ? 0 : t.startsWith(q) ? 1 : t.split(' ').some((w) => w.startsWith(q)) ? 2 : 3);
    const found = (nodes() || [])
      .filter((n) => n.id !== 'root' && norm(n.label ?? n.name).includes(q))
      .map((n) => ({ n, r: rank(norm(n.label ?? n.name)) }))
      .sort((a, b) => a.r - b.r)
      .slice(0, 8).map((x) => x.n);
    hits.innerHTML = found.length
      ? found.map((n) => `<button type="button" class="ball-hit" data-id="${esc(n.id)}">${esc(n.label ?? n.name)}</button>`).join('')
      : '<span class="ball-none">لا كرة بهذا الاسم</span>';
    if (found.length) focus(found[0].id);
  });
  hits.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) focus(b.dataset.id);
  });
}
