// رسم الكرات المترابطة بفيزياء بسيطة: تطفو بحرية، تُسحب باللمس، وتتصل بخطوط بيضاء.
// nodes: [{ id, label, color, weight, fixedR? }]
// links: [{ a, b, w }]  حيث w بين 0 و1 (قوة الرابط: سماكة الخط ووضوحه وقِصره)
export function createMindGraph(canvas, nodesIn, linksIn, { onTap } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  const radiusFor = (n, maxW) =>
    n.fixedR ?? (n.weight ? 18 + 26 * Math.sqrt(n.weight / maxW) : 11);

  const nodes = nodesIn.map((n, i) => {
    const a = (i / nodesIn.length) * Math.PI * 2;
    return {
      ...n, r: 0, targetR: 0,
      x: Math.cos(a) * 90, y: Math.sin(a) * 90,
      vx: 0, vy: 0,
      phase: Math.random() * Math.PI * 2,
    };
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  let edges = [];

  function setData(weights, links) {
    if (weights) nodes.forEach((n) => { if (n.id in weights) n.weight = weights[n.id]; });
    const maxW = Math.max(1, ...nodes.map((n) => n.weight || 0));
    nodes.forEach((n) => { n.targetR = radiusFor(n, maxW); });
    if (links) {
      edges = links.map((l) => ({ a: byId[l.a], b: byId[l.b], w: l.w ?? 0.5 })).filter((e) => e.a && e.b);
    }
  }
  setData(null, linksIn);
  nodes.forEach((n) => { n.r = n.targetR; });

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  nodes.forEach((n) => { n.x += W / 2; n.y += H / 2; });

  // ---- السحب واللمس ----
  let drag = null;
  const pointerPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const hitTest = (p) => [...nodes].reverse().find((n) => Math.hypot(n.x - p.x, n.y - p.y) <= n.r + 10);

  function onDown(e) {
    const p = pointerPos(e);
    const hit = hitTest(p);
    if (!hit) return;
    // الإصبع يهتز أكثر من الفأرة، فنتسامح معه أكثر قبل اعتبار اللمسة سحباً
    const slop = e.pointerType === 'mouse' ? 6 : 16;
    drag = { node: hit, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, t: performance.now(), t0: performance.now(), moved: false, slop };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag) {
      canvas.style.cursor = hitTest(pointerPos(e)) ? 'pointer' : 'default';
      return;
    }
    const p = pointerPos(e);
    if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > drag.slop) drag.moved = true;
    if (!drag.moved) return;
    const now = performance.now();
    const dt = Math.max(16, now - drag.t);
    drag.node.vx = ((p.x - drag.lastX) / dt) * 16;
    drag.node.vy = ((p.y - drag.lastY) / dt) * 16;
    drag.node.x = p.x; drag.node.y = p.y;
    drag.lastX = p.x; drag.lastY = p.y; drag.t = now;
  }
  function onUp() {
    if (drag && !drag.moved) {
      drag.node.pop = 1; // نبضة صغيرة عند اللمس
      onTap?.(drag.node);
    }
    drag = null;
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  const onCancel = () => { drag = null; };
  canvas.addEventListener('pointercancel', onCancel);
  window.addEventListener('resize', resize);

  // ---- الفيزياء ----
  function step(t) {
    const cx = W / 2, cy = H / 2;
    const base = Math.min(W, H) * 0.32;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const minD = a.r + b.r + 16;
        let f = 900 / (d * d);
        if (d < minD) f += (minD - d) * 0.08;
        dx /= d; dy /= d;
        a.vx -= dx * f; a.vy -= dy * f;
        b.vx += dx * f; b.vy += dy * f;
      }
    }
    for (const e of edges) {
      const { a, b } = e;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const rest = base * (1.05 - 0.45 * e.w) + (a.r + b.r) * 0.5;
      const f = (d - rest) * (0.0015 + 0.002 * e.w);
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      n.r += (n.targetR - n.r) * 0.1;
      if (n.pop) n.pop = Math.max(0, n.pop - 0.06);
      n.vx += (cx - n.x) * 0.0008 + Math.cos(t / 1400 + n.phase) * 0.03;
      n.vy += (cy - n.y) * 0.0008 + Math.sin(t / 1700 + n.phase) * 0.03;
      if (drag?.node === n && drag.moved) continue;
      n.vx *= 0.92; n.vy *= 0.92;
      n.x += n.vx; n.y += n.vy;
      const pad = n.r + 2;
      if (n.x < pad) { n.x = pad; n.vx = Math.abs(n.vx) * 0.6; }
      if (n.x > W - pad) { n.x = W - pad; n.vx = -Math.abs(n.vx) * 0.6; }
      if (n.y < pad) { n.y = pad; n.vy = Math.abs(n.vy) * 0.6; }
      if (n.y > H - pad - 20) { n.y = H - pad - 20; n.vy = -Math.abs(n.vy) * 0.6; }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const { a, b, w } of edges) {
      ctx.strokeStyle = `rgba(255,255,255,${(0.35 + 0.55 * w).toFixed(2)})`;
      ctx.lineWidth = 1 + 2.5 * w;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '500 13px Tajawal, system-ui, sans-serif';
    for (const n of nodes) {
      const empty = !n.fixedR && !n.weight;
      const r = n.r * (1 + 0.15 * Math.sin((n.pop || 0) * Math.PI));
      ctx.globalAlpha = empty ? 0.45 : 1;
      const g = ctx.createRadialGradient(n.x - r * 0.35, n.y - r * 0.35, r * 0.1, n.x, n.y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, n.color);
      g.addColorStop(1, shade(n.color, -0.45));
      ctx.shadowColor = n.color; ctx.shadowBlur = drag?.node === n ? 30 : empty ? 4 : 16;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ece9ff';
      ctx.fillText(n.label, n.x, n.y + r + 4);
      ctx.globalAlpha = 1;
    }
  }

  let raf = 0;
  const loop = (t) => { step(t); draw(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  return {
    update: setData,
    nodes,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
    },
  };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + c * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
