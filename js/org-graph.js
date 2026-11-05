// رسم الهيكل ككرات صغيرة مترابطة (بلا هالات): الأسماء تظهر عند التقريب،
// ولمس كرة يُبرز ما يرتبط بها فقط ويُعتّم الباقي.
const DIM = '#2a323c';
const EDGE = 'rgba(160,170,185,.22)';
const EDGE_HI = '#5aa7ff';
const LABEL = '#9aa4b2';
const LABEL_HI = '#7fb8ff';
const LABEL_ZOOM = 1.15; // أسماء كل الكرات من هذا التقريب فأكثر

export function createOrgGraph(canvas, { onSelect } = {}) {
  const ctx = canvas.getContext('2d');
  let nodes = [], edges = [], byId = new Map(), adj = new Map();
  let view = { x: 0, y: 0, k: 1 };
  let selected = null;
  let raf = 0, energy = 1, w = 0, h = 0, dpr = 1;
  let fitted = false;

  function setData(data, { keepView = true } = {}) {
    const old = byId;
    nodes = data.nodes.map((n) => {
      const prev = old.get(n.id);
      const parent = old.get(n.parent) || null;
      // كرة جديدة تبدأ قرب أبيها لتستقر بسرعة
      const a = Math.random() * Math.PI * 2;
      const base = prev || (parent ? { x: parent.x + Math.cos(a) * 40, y: parent.y + Math.sin(a) * 40 } : { x: (Math.random() - 0.5) * 60, y: (Math.random() - 0.5) * 60 });
      return { ...n, x: base.x, y: base.y, vx: 0, vy: 0 };
    });
    byId = new Map(nodes.map((n) => [n.id, n]));
    edges = data.edges.filter(([a, b]) => byId.has(a) && byId.has(b));
    adj = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const [a, b] of edges) { adj.get(a).add(b); adj.get(b).add(a); }
    if (selected && !byId.has(selected)) selected = null;
    if (!keepView) fitted = false;
    kick();
  }

  // ---- الفيزياء: تنافر بين الكرات، ونوابض على الخطوط، والقسم ثابت في الوسط ----
  function step() {
    const root = nodes.find((n) => n.kind === 'dept');
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 160000) continue;
        const f = 1500 / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    for (const [ia, ib] of edges) {
      const a = byId.get(ia), b = byId.get(ib);
      const rest = b.rest || 60;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - rest) * 0.04;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    energy = 0;
    for (const n of nodes) {
      if (n === root) { n.x = 0; n.y = 0; n.vx = 0; n.vy = 0; continue; }
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += Math.max(-12, Math.min(12, n.vx));
      n.y += Math.max(-12, Math.min(12, n.vy));
      energy += Math.abs(n.vx) + Math.abs(n.vy);
    }
    energy /= Math.max(1, nodes.length);
  }

  function fit() {
    if (!nodes.length || !w || !h) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const pad = 40;
    const k = Math.min(2.2, Math.max(0.3, Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))));
    view = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    return true;
  }

  // ---- الرسم ----
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);
    const near = selected ? adj.get(selected) : null;
    const lit = (id) => !selected || id === selected || near.has(id);

    ctx.lineWidth = 1 / view.k;
    for (const [ia, ib] of edges) {
      const a = byId.get(ia), b = byId.get(ib);
      const hi = selected && (ia === selected || ib === selected);
      ctx.strokeStyle = hi ? EDGE_HI : selected ? 'rgba(160,170,185,.07)' : EDGE;
      ctx.lineWidth = (hi ? 1.6 : 1) / view.k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const n of nodes) {
      ctx.fillStyle = lit(n.id) ? n.color : DIM;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      if (n.id === selected) {
        // حلقة رفيعة حول المختارة (لا هالة)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2 / view.k;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 / view.k + 1, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // الأسماء بحجم ثابت على الشاشة
    const fs = 12.5 / view.k;
    ctx.font = `500 ${fs}px Tajawal, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.direction = 'rtl';
    for (const n of nodes) {
      const show = view.k >= LABEL_ZOOM || (selected && lit(n.id)) || n.kind === 'dept';
      if (!show) continue;
      if (selected && !lit(n.id) && view.k < LABEL_ZOOM * 1.6) continue;
      ctx.fillStyle = n.id === selected ? LABEL_HI : selected && !lit(n.id) ? 'rgba(154,164,178,.35)' : LABEL;
      ctx.fillText(n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label, n.x, n.y + n.r + 4 / view.k);
    }
    ctx.restore();
  }

  function loop() {
    raf = 0;
    if (energy > 0.02) for (let i = 0; i < 2; i++) step();
    // أول عرض: نُسكّن الكرات ثم نضبط الإطار (بعد أن يُعرف حجم اللوحة)
    if (!fitted && nodes.length && w) { for (let i = 0; i < 160; i++) step(); fitted = fit(); }
    draw();
    if (energy > 0.02 || gesture) raf = requestAnimationFrame(loop);
  }
  function kick() { energy = 1; if (!raf) raf = requestAnimationFrame(loop); }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(loop); };

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    // نُبقي المنتصف في مكانه إن تغيّر حجم اللوحة
    if (w && h) { view.x += (r.width - w) / 2; view.y += (r.height - h) / 2; }
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    redraw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // ---- اللمس: سحب للتحريك، قرص للتكبير، لمسة للاختيار ----
  const pts = new Map();
  let gesture = null;
  const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function hit(sx, sy) {
    const p = toWorld(sx, sy);
    let best = null, bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < n.r + 14 / view.k && d < bd) { best = n; bd = d; }
    }
    return best;
  }
  function zoomAt(sx, sy, k) {
    const nk = Math.min(6, Math.max(0.25, k));
    view.x = sx - (sx - view.x) * (nk / view.k);
    view.y = sy - (sy - view.y) * (nk / view.k);
    view.k = nk;
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) gesture = { type: 'pan', start: local(e), t: Date.now(), moved: false, vx: view.x, vy: view.y };
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, moved: true };
    }
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (gesture?.type === 'pan' && pts.size === 1) {
      const p = local(e);
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      if (Math.hypot(dx, dy) > 6) gesture.moved = true;
      view.x = gesture.vx + dx; view.y = gesture.vy + dy;
      redraw();
    } else if (gesture?.type === 'pinch' && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.k * (d / gesture.d));
      redraw();
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.delete(e.pointerId);
    if (gesture?.type === 'pan' && !gesture.moved && Date.now() - gesture.t < 500) {
      const n = hit(p.x, p.y);
      select(n && n.id !== selected ? n.id : null);
    }
    if (!pts.size) gesture = null;
    else if (pts.size === 1) { const [q] = [...pts.values()]; gesture = { type: 'pan', start: q, t: 0, moved: true, vx: view.x, vy: view.y }; }
    redraw();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, view.k * Math.exp(-e.deltaY * 0.0015));
    redraw();
  }, { passive: false });

  function select(id) {
    selected = id;
    onSelect?.(id ? byId.get(id) : null);
    redraw();
  }

  return {
    setData,
    select,
    selected: () => selected,
    zoom: (f) => { zoomAt(w / 2, h / 2, view.k * f); redraw(); },
    fit: () => { fit(); redraw(); },
    destroy: () => { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
