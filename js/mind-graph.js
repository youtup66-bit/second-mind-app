// رسم الكرات المترابطة بفيزياء بسيطة: تطفو بحرية، تُسحب باللمس، وتتصل بخطوط بيضاء.
// المشهد يُكبَّر ويُصغَّر بإصبعين (أو بعجلة الفأرة)، ويُحرَّك بإصبع على الفراغ.
// nodes: [{ id, label, color, weight, fixedR? }]
// links: [{ a, b, w }]  حيث w بين 0 و1 (قوة الرابط: سماكة الخط ووضوحه وقِصره)
export function createMindGraph(canvas, nodesIn, linksIn, { onTap, onGroupTap, groups: groupsIn = {}, groupLabels = {}, spacing: initialSpacing = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  // حجم الكرات يتناسب مع عرض الشاشة: على الجوال الضيق تصغر الكبيرة منها حتى لا تزدحم
  const radiusFor = (n, maxW) => {
    if (n.fixedR) return n.fixedR;
    const width = W || canvas.clientWidth || 360;
    const maxR = Math.max(24, Math.min(44, width * 0.085));
    const minR = Math.max(12, maxR * 0.4);
    return n.weight ? minR + (maxR - minR) * Math.sqrt(n.weight / maxW) : 9;
  };

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

  // groups: { معرّف الكرة: رقم مجموعتها } للكرات المترابطة؛ الكرات بلا مجموعة تبقى منفردة
  let groups = [];
  let labels = { ...groupLabels }; // رقم المجموعة ← اسمها
  let spacing = Math.min(2.2, Math.max(0.7, initialSpacing)); // مضاعِف المسافة بين الكرات
  function setData(weights, links, groupMap) {
    if (weights) nodes.forEach((n) => { if (n.id in weights) n.weight = weights[n.id]; });
    const maxW = Math.max(1, ...nodes.map((n) => n.weight || 0));
    nodes.forEach((n) => { n.targetR = radiusFor(n, maxW); });
    if (links) {
      // روابط "أنا" (المحور) أضعف من الروابط بين الأقسام، حتى لا تبتلع المجموعات
      edges = links.map((l) => ({ a: byId[l.a], b: byId[l.b], w: l.w ?? 0.5, hub: l.a === 'me' || l.b === 'me' }))
        .filter((e) => e.a && e.b);
      nodes.forEach((n) => { n.linked = edges.some((e) => !e.hub && e.w > 0 && (e.a === n || e.b === n)); });
    }
    if (groupMap) {
      nodes.forEach((n) => { n.group = groupMap[n.id] ?? null; });
      const ids = [...new Set(nodes.map((n) => n.group).filter((g) => g !== null))];
      groups = ids.map((g) => ({ id: g, members: nodes.filter((n) => n.group === g) })).filter((g) => g.members.length > 1);
    }
  }
  setData(null, linksIn, groupsIn);
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

  // ---- العرض: تكبير وتصغير وتحريك المشهد ----
  // view: إحداثيات الشاشة = إحداثيات المشهد × s + (x, y)
  const MIN_S = 0.4, MAX_S = 3;
  const view = { s: 1, x: 0, y: 0 };
  let viewAnim = null; // لحركة سلسة عند أزرار التكبير والرجوع
  const clampS = (v) => Math.min(MAX_S, Math.max(MIN_S, v));
  const toWorld = (p) => ({ x: (p.x - view.x) / view.s, y: (p.y - view.y) / view.s });
  // تكبير حول نقطة على الشاشة (تبقى النقطة تحت الإصبع أو المؤشر في مكانها)
  function zoomAt(px, py, s2) {
    s2 = clampS(s2);
    const wx = (px - view.x) / view.s, wy = (py - view.y) / view.s;
    view.s = s2;
    view.x = px - wx * s2;
    view.y = py - wy * s2;
  }
  function animateTo(target) {
    const from = { ...view }, t0 = performance.now();
    viewAnim = (now) => {
      const k = Math.min(1, (now - t0) / 250), e = 1 - (1 - k) ** 3;
      view.s = from.s + (target.s - from.s) * e;
      view.x = from.x + (target.x - from.x) * e;
      view.y = from.y + (target.y - from.y) * e;
      if (k >= 1) viewAnim = null;
    };
  }

  // ملاءمة: أصغر تكبير يُظهر كل الكرات وأسماءها (لا نكبّر فوق 1)
  function fitTarget() {
    if (!nodes.length) return { s: 1, x: 0, y: 0 };
    const minX = Math.min(...nodes.map((n) => n.x - n.r)) - 12, maxX = Math.max(...nodes.map((n) => n.x + n.r)) + 12;
    const minY = Math.min(...nodes.map((n) => n.y - n.r)) - 30, maxY = Math.max(...nodes.map((n) => n.y + n.r)) + 26;
    const availW = W - guard.w;
    const offX = guard.side === 'left' ? guard.w : 0;
    const sc = clampS(Math.min(1, availW / (maxX - minX), H / (maxY - minY)));
    return { s: sc, x: offX + availW / 2 - ((minX + maxX) / 2) * sc, y: H / 2 - ((minY + maxY) / 2) * sc };
  }
  let touched = false; // إن تحكّم المستخدم بالعرض لا نغيّره عليه تلقائياً
  let fitTimer = 0;
  // عمود أزرار التحكم فوق اللوحة: لا نضع الكرات تحته
  const guard = { side: getComputedStyle(canvas).direction === 'rtl' ? 'right' : 'left', w: 46 };
  setTimeout(() => { if (!touched) animateTo(fitTarget()); }, 1600);

  // ---- اللمس: إصبع على كرة يسحبها، على الفراغ يحرّك المشهد، وإصبعان للتكبير والتصغير ----
  const pointers = new Map(); // معرّف الإصبع ← موضعه على الشاشة
  let drag = null;   // سحب كرة
  let pan = null;    // تحريك المشهد
  let pinch = null;  // إصبعان
  const pointerPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const hitTest = (w) => [...nodes].reverse().find((n) => Math.hypot(n.x - w.x, n.y - w.y) <= n.r + 10 / view.s);
  const groupAt = (w) => groups.find((g) => g.box && w.x >= g.box.x - 4 && w.x <= g.box.x + g.box.w + 4 && w.y >= g.box.y - 4 && w.y <= g.box.y + g.box.h + 4) || null;
  const pair = () => {
    const [a, b] = [...pointers.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };
  const startPan = (p, slop) => { pan = { sx: p.x, sy: p.y, vx: view.x, vy: view.y, moved: false, slop }; };

  function onDown(e) {
    const p = pointerPos(e);
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    viewAnim = null;
    touched = true;
    // الإصبع يهتز أكثر من الفأرة، فنتسامح معه أكثر قبل اعتبار اللمسة سحباً
    const slop = e.pointerType === 'mouse' ? 6 : 16;
    if (pointers.size === 2) {
      // إصبع ثانٍ: نلغي السحب ونبدأ التكبير/التصغير
      drag = null; pan = null;
      const { mid, dist } = pair();
      pinch = { mid0: mid, d0: dist, s0: view.s, wx: (mid.x - view.x) / view.s, wy: (mid.y - view.y) / view.s };
      return;
    }
    if (pointers.size > 2) return;
    const w = toWorld(p);
    // اسم المجموعة له الأولوية: يقع فوق أعلى كرة مباشرة، ومنطقة لمس الكرة تمتد قليلاً حولها
    const label = groupAt(w);
    const hit = label ? null : hitTest(w);
    if (hit) {
      drag = { node: hit, startX: p.x, startY: p.y, lastX: w.x, lastY: w.y, t: performance.now(), moved: false, slop };
    } else {
      startPan(p, slop);
      pan.label = label; // إن لم يتحرك الإصبع نعتبرها لمسة على الاسم
    }
  }

  function onMove(e) {
    const p = pointerPos(e);
    if (!pointers.has(e.pointerId)) {
      canvas.style.cursor = hitTest(toWorld(p)) ? 'pointer' : 'grab';
      return;
    }
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const { mid, dist } = pair();
      view.s = clampS(pinch.s0 * dist / pinch.d0);
      view.x = mid.x - pinch.wx * view.s;
      view.y = mid.y - pinch.wy * view.s;
      return;
    }
    if (pan) {
      if (!pan.moved && Math.hypot(p.x - pan.sx, p.y - pan.sy) > pan.slop) pan.moved = true;
      if (pan.moved) {
        view.x = pan.vx + (p.x - pan.sx);
        view.y = pan.vy + (p.y - pan.sy);
        canvas.style.cursor = 'grabbing';
      }
      return;
    }
    if (!drag) return;
    if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > drag.slop) drag.moved = true;
    if (!drag.moved) return;
    const w = toWorld(p);
    const now = performance.now();
    const dt = Math.max(16, now - drag.t);
    drag.node.vx = ((w.x - drag.lastX) / dt) * 16;
    drag.node.vy = ((w.y - drag.lastY) / dt) * 16;
    drag.node.x = w.x; drag.node.y = w.y;
    drag.lastX = w.x; drag.lastY = w.y; drag.t = now;
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      // انتهى التكبير؛ إن بقي إصبع واحد نكمل به تحريك المشهد بسلاسة
      pinch = null;
      if (pointers.size === 1) { startPan([...pointers.values()][0], 0); pan.moved = true; }
      return;
    }
    if (drag && !drag.moved) {
      drag.node.pop = 1; // نبضة صغيرة عند اللمس
      onTap?.(drag.node);
    }
    if (pan && !pan.moved && pan.label) {
      const g = pan.label;
      onGroupTap?.({ id: g.id, name: labels[g.id] || '', members: g.members.map((n) => n.id) });
    }
    drag = null;
    pan = null;
    canvas.style.cursor = 'grab';
  }
  const onCancel = (e) => { pointers.delete(e.pointerId); drag = null; pan = null; pinch = null; };

  // عجلة الفأرة (وإيماءة لوحة اللمس) على الكمبيوتر
  function onWheel(e) {
    e.preventDefault();
    viewAnim = null;
    touched = true;
    const p = pointerPos(e);
    zoomAt(p.x, p.y, view.s * Math.exp(-e.deltaY * 0.0015));
  }
  // نقرتان على الفراغ: تكبير، أو رجوع للوضع الأصلي إن كان مكبّراً
  function onDbl(e) {
    const p = pointerPos(e);
    if (hitTest(toWorld(p))) return;
    if (view.s > 1.05) animateTo({ s: 1, x: 0, y: 0 });
    else {
      const s2 = 2, wx = (p.x - view.x) / view.s, wy = (p.y - view.y) / view.s;
      animateTo({ s: s2, x: p.x - wx * s2, y: p.y - wy * s2 });
    }
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  window.addEventListener('resize', resize);
  canvas.style.cursor = 'grab';

  // ---- الفيزياء ----
  // - تنافر عام بين الكرات، يشتد بين كرتين من مجموعتين مختلفتين
  // - نوابض على الروابط: كلما قوي الرابط قصر طوله وزادت شدّته
  // - تماسك: كل كرة تنجذب إلى مركز مجموعتها، و"أنا" تبقى في الوسط، والمنفردة تبتعد إلى الأطراف
  function step(t) {
    const cx = W / 2, cy = H / 2;
    const base = Math.min(W, H) * 0.32 * spacing;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const minD = a.r + b.r + 16;
        const apart = a.group !== null && b.group !== null && a.group !== b.group;
        let f = ((apart ? 2200 : 900) * spacing * spacing) / (d * d);
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
      let rest, k;
      if (e.hub) { rest = base * 1.05 + (a.r + b.r) * 0.5; k = 0.0006; }
      else { rest = base * (0.5 - 0.25 * e.w) + (a.r + b.r) + 26 * spacing; k = 0.002 + 0.004 * e.w; }
      const f = (d - rest) * k;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    // تماسك المجموعات
    for (const g of groups) {
      let gx = 0, gy = 0;
      for (const n of g.members) { gx += n.x; gy += n.y; }
      gx /= g.members.length; gy /= g.members.length;
      g.cx = gx; g.cy = gy;
      for (const n of g.members) { n.vx += (gx - n.x) * 0.0025; n.vy += (gy - n.y) * 0.0025; }
    }
    for (const n of nodes) {
      n.r += (n.targetR - n.r) * 0.1;
      if (n.pop) n.pop = Math.max(0, n.pop - 0.06);
      const pull = n.id === 'me' ? 0.01 : 0.0008;
      n.vx += (cx - n.x) * pull + Math.cos(t / 1400 + n.phase) * 0.03;
      n.vy += (cy - n.y) * pull + Math.sin(t / 1700 + n.phase) * 0.03;
      // كرة بلا روابط مع أقسام أخرى: تبتعد بهدوء إلى حلقة خارجية
      if (n.id !== 'me' && !n.linked) {
        const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy) || 1;
        const ring = base * 1.25;
        n.vx += (dx / d) * (ring - d) * 0.0015;
        n.vy += (dy / d) * (ring - d) * 0.0015;
      }
      if (drag?.node === n && drag.moved) continue;
      n.vx *= 0.92; n.vy *= 0.92;
      n.x += n.vx; n.y += n.vy;
      keepInside(n);
    }
    separate();
  }

  function keepInside(n) {
    const pad = n.r + 4;
    const left = pad + (guard.side === 'left' ? guard.w : 0);
    const right = W - pad - (guard.side === 'right' ? guard.w : 0);
    if (n.x < left) { n.x = left; n.vx = Math.abs(n.vx) * 0.6; }
    if (n.x > right) { n.x = right; n.vx = -Math.abs(n.vx) * 0.6; }
    if (n.y < pad) { n.y = pad; n.vy = Math.abs(n.vy) * 0.6; }
    if (n.y > H - pad - 22) { n.y = H - pad - 22; n.vy = -Math.abs(n.vy) * 0.6; }
  }

  // منع التداخل: كرتان أقرب من مجموع نصفي قطريهما + مسافة للاسم تُدفعان بعيداً فوراً
  function separate() {
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          // الاسم تحت الكرة: إن كانتا فوق بعضهما نحتاج مسافة أكبر
          const gap = (10 + 16 * Math.abs(dy) / d) * spacing;
          const minD = a.r + b.r + gap;
          if (d >= minD) continue;
          const push = (minD - d) / 2;
          dx /= d; dy /= d;
          const aFixed = drag?.node === a && drag.moved, bFixed = drag?.node === b && drag.moved;
          const ka = aFixed ? 0 : bFixed ? 2 : 1, kb = bFixed ? 0 : aFixed ? 2 : 1;
          a.x -= dx * push * ka; a.y -= dy * push * ka;
          b.x += dx * push * kb; b.y += dy * push * kb;
        }
      }
      nodes.forEach(keepInside);
    }
  }

  // هالة ملونة خلف كل مجموعة، بمزيج ألوان أفرادها
  function drawGroups() {
    for (const g of groups) {
      if (g.cx == null) continue;
      let rad = 0, R = 0, G = 0, B = 0;
      for (const n of g.members) {
        rad = Math.max(rad, Math.hypot(n.x - g.cx, n.y - g.cy) + n.r);
        const c = parseInt(n.color.slice(1), 16);
        R += c >> 16; G += (c >> 8) & 255; B += c & 255;
      }
      const k = g.members.length;
      const col = `${Math.round(R / k)},${Math.round(G / k)},${Math.round(B / k)}`;
      rad += 22;
      const grad = ctx.createRadialGradient(g.cx, g.cy, rad * 0.2, g.cx, g.cy, rad);
      grad.addColorStop(0, `rgba(${col},0.16)`);
      grad.addColorStop(0.8, `rgba(${col},0.08)`);
      grad.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(g.cx, g.cy, rad, 0, Math.PI * 2); ctx.fill();
      g.rad = rad;
      g.col = col;
    }
  }

  // اسم المجموعة: شارة صغيرة أعلى هالتها (تُرسم فوق الخطوط والكرات لتبقى مقروءة)
  function drawGroupLabels() {
    ctx.font = '700 12px Tajawal, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const g of groups) {
      const name = labels[g.id];
      if (!name || g.cx == null) { g.box = null; continue; }
      const w = ctx.measureText(name).width + 18, h = 22;
      // فوق أعلى كرة في المجموعة، ولا تخرج عن حدود اللوحة
      const top = Math.min(...g.members.map((n) => n.y - n.r));
      const x = Math.min(W - w / 2 - 4, Math.max(w / 2 + 4, g.cx));
      const y = Math.max(h / 2 + 4, top - 18);
      g.box = { x: x - w / 2, y: y - h / 2, w, h };
      ctx.fillStyle = `rgba(${g.col},0.28)`;
      ctx.strokeStyle = `rgba(${g.col},0.75)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(g.box.x, g.box.y, w, h, 11) : ctx.rect(g.box.x, g.box.y, w, h);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(name, x, y + 1);
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
    drawGroups();
    for (const { a, b, w, hub } of edges) {
      // خطوط "أنا" أخف، وخطوط المجموعات أوضح
      ctx.strokeStyle = `rgba(255,255,255,${(hub ? 0.22 + 0.3 * w : 0.4 + 0.55 * w).toFixed(2)})`;
      ctx.lineWidth = hub ? 1 : 1.2 + 2.8 * w;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '500 13px Tajawal, system-ui, sans-serif';
    for (const n of nodes) {
      const empty = n.id !== 'me' && !n.weight;
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
      // حلقة بلون القسم الأصلي (في وضع الحرارة) حتى يبقى القسم معروفاً من لونه
      // نواة ضوئية ناعمة في وسط الكرة بلون حرارتها (عدد الملاحظات)، تذوب تدريجياً في لون القسم دون أي حافة
      if (n.core) {
        const rgb = hexRgb(n.core);
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 0.92);
        glow.addColorStop(0, `rgba(${rgb},1)`);
        glow.addColorStop(0.28, `rgba(${rgb},0.9)`);
        glow.addColorStop(0.55, `rgba(${rgb},0.45)`);
        glow.addColorStop(0.8, `rgba(${rgb},0.12)`);
        glow.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.92, 0, Math.PI * 2); ctx.fill();
      }
      if (n.ring) {
        ctx.strokeStyle = n.ring;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#ece9ff';
      ctx.fillText(n.label, n.x, n.y + r + 4);
      ctx.globalAlpha = 1;
    }
    drawGroupLabels();
  }

  let raf = 0;
  const loop = (t) => { viewAnim?.(t); step(t); draw(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  const api = {
    update: setData,
    nodes,
    // أزرار التحكم: تكبير/تصغير حول منتصف اللوحة، والرجوع للوضع الأصلي
    zoomBy(f) {
      const cx = W / 2, cy = H / 2, s2 = clampS(view.s * f);
      const wx = (cx - view.x) / view.s, wy = (cy - view.y) / view.s;
      animateTo({ s: s2, x: cx - wx * s2, y: cy - wy * s2 });
    },
    resetView() { animateTo(fitTarget()); },
    fitView: () => animateTo(fitTarget()),
    setGroupLabels(map) { labels = { ...map }; },
    // تغيير المسافة بين الكرات (0.7 إلى 2.2) وإعادة ملاءمة المشهد بعد أن تستقر
    setSpacing(v) {
      spacing = Math.min(2.2, Math.max(0.7, v));
      nodes.forEach((n) => { n.vx += (Math.random() - 0.5) * 0.5; n.vy += (Math.random() - 0.5) * 0.5; });
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => animateTo(fitTarget()), 1200);
    },
    // تغيير مظهر الكرات دون إعادة بنائها: { معرّف: { color, ring, fixedR } }
    setStyles(map) {
      nodes.forEach((n) => {
        const st = map[n.id];
        if (!st) return;
        n.color = st.color; n.ring = st.ring; n.core = st.core; n.fixedR = st.fixedR;
      });
      setData();
    },
    // مواضع أسماء المجموعات على الشاشة (للاختبار وإمكانية الوصول)
    groupBoxes() {
      return groups.filter((g) => g.box).map((g) => ({
        id: g.id, name: labels[g.id],
        x: g.box.x * view.s + view.x + g.box.w * view.s / 2, y: g.box.y * view.s + view.y + g.box.h * view.s / 2,
      }));
    },
    get scale() { return view.s; },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    },
  };
  canvas.mindGraph = api;
  return api;
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${n >> 16},${(n >> 8) & 255},${n & 255}`;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + c * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
