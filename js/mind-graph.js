// رسم الكرات المترابطة بفيزياء بسيطة: تطفو بحرية، تُسحب باللمس، وتتصل بخطوط بيضاء.
// nodes: [{ id, label, color, weight }], links: [[idA, idB], ...]
export function createMindGraph(canvas, nodesIn, links) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  const maxW = Math.max(1, ...nodesIn.map((n) => n.weight));
  const nodes = nodesIn.map((n, i) => {
    const a = (i / nodesIn.length) * Math.PI * 2;
    return {
      ...n,
      // الحجم بدل الرقم: نصف القطر يكبر مع الجذر التربيعي لعدد الملاحظات
      r: n.fixedR ?? 16 + 26 * Math.sqrt(n.weight / maxW),
      x: Math.cos(a) * 80, y: Math.sin(a) * 80,
      vx: 0, vy: 0,
      phase: Math.random() * Math.PI * 2,
    };
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = links.map(([a, b]) => [byId[a], byId[b]]).filter(([a, b]) => a && b);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  nodes.forEach((n) => { n.x += W / 2; n.y += H / 2; });

  // ---- السحب ----
  let drag = null;
  const pointerPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  function onDown(e) {
    const p = pointerPos(e);
    const hit = [...nodes].reverse().find((n) => Math.hypot(n.x - p.x, n.y - p.y) <= n.r + 8);
    if (!hit) return;
    drag = { node: hit, lastX: p.x, lastY: p.y, t: performance.now() };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag) return;
    const p = pointerPos(e);
    const now = performance.now();
    const dt = Math.max(16, now - drag.t);
    drag.node.vx = ((p.x - drag.lastX) / dt) * 16;
    drag.node.vy = ((p.y - drag.lastY) / dt) * 16;
    drag.node.x = p.x; drag.node.y = p.y;
    drag.lastX = p.x; drag.lastY = p.y; drag.t = now;
  }
  function onUp() { drag = null; }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', resize);

  // ---- الفيزياء ----
  function step(t) {
    const cx = W / 2, cy = H / 2;
    const rest = Math.min(W, H) * 0.3;

    // تنافر بين الكرات
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy) || 0.01;
        const minD = a.r + b.r + 14;
        let f = 900 / (d * d);
        if (d < minD) f += (minD - d) * 0.08;
        dx /= d; dy /= d;
        a.vx -= dx * f; a.vy -= dy * f;
        b.vx += dx * f; b.vy += dy * f;
      }
    }
    // نوابض على الروابط
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - rest) * 0.0025;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      // جذب خفيف نحو المركز + طفو هادئ
      n.vx += (cx - n.x) * 0.0008 + Math.cos(t / 1400 + n.phase) * 0.03;
      n.vy += (cy - n.y) * 0.0008 + Math.sin(t / 1700 + n.phase) * 0.03;
      if (drag?.node === n) continue;
      n.vx *= 0.92; n.vy *= 0.92;
      n.x += n.vx; n.y += n.vy;
      // ارتداد عن الحواف
      if (n.x < n.r) { n.x = n.r; n.vx = Math.abs(n.vx) * 0.6; }
      if (n.x > W - n.r) { n.x = W - n.r; n.vx = -Math.abs(n.vx) * 0.6; }
      if (n.y < n.r) { n.y = n.r; n.vy = Math.abs(n.vy) * 0.6; }
      if (n.y > H - n.r - 18) { n.y = H - n.r - 18; n.vy = -Math.abs(n.vy) * 0.6; }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.2;
    for (const [a, b] of edges) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '500 13px Tajawal, system-ui, sans-serif';
    for (const n of nodes) {
      const g = ctx.createRadialGradient(n.x - n.r * 0.35, n.y - n.r * 0.35, n.r * 0.1, n.x, n.y, n.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, n.color);
      g.addColorStop(1, shade(n.color, -0.45));
      ctx.shadowColor = n.color; ctx.shadowBlur = drag?.node === n ? 30 : 16;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ece9ff';
      ctx.fillText(n.label, n.x, n.y + n.r + 4);
    }
  }

  let raf = 0;
  const loop = (t) => { step(t); draw(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    },
  };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + c * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
