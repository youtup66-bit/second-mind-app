// الرفيقة: شخصية أنمي صغيرة (SVG متحرك) تطفو وترمش وتتبع اللمس بعينيها.
// الحالات: idle | listening | thinking | talking | happy  (تُستخدم في المراحل القادمة)

const SVG = `
<svg class="companion__svg" viewBox="0 0 200 250" role="img" aria-label="الرفيقة">
  <defs>
    <linearGradient id="cmp-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7a5cff"/>
      <stop offset="1" stop-color="#3b56d6"/>
    </linearGradient>
    <linearGradient id="cmp-dress" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2e2675"/>
      <stop offset="1" stop-color="#4f7dff"/>
    </linearGradient>
    <linearGradient id="cmp-tail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4f7dff" stop-opacity=".9"/>
      <stop offset="1" stop-color="#8b6cff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="cmp-iris" cx="50%" cy="35%" r="70%">
      <stop offset="0" stop-color="#b9a6ff"/>
      <stop offset=".55" stop-color="#6c4dff"/>
      <stop offset="1" stop-color="#2a2a8a"/>
    </radialGradient>
    <radialGradient id="cmp-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#8b6cff" stop-opacity=".55"/>
      <stop offset="1" stop-color="#8b6cff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse class="cmp-shadow" cx="100" cy="238" rx="38" ry="6" fill="#000" opacity=".35"/>

  <g class="cmp-float">
    <circle class="cmp-aura" cx="100" cy="115" r="100" fill="url(#cmp-aura)"/>

    <!-- الشعر الخلفي -->
    <path class="cmp-hair-back" fill="url(#cmp-hair)"
      d="M40 100 C35 45 70 24 100 24 C130 24 165 45 160 100 C163 140 152 168 138 182
         L62 182 C48 168 37 140 40 100 Z"/>

    <!-- الجسم: فستان صغير وذراعان -->
    <g class="cmp-body">
      <g transform="rotate(20 70 168)"><ellipse class="cmp-arm cmp-arm--r" cx="70" cy="168" rx="9" ry="20" fill="#ffe3d6"/></g>
      <g transform="rotate(-20 130 168)"><ellipse class="cmp-arm cmp-arm--l" cx="130" cy="168" rx="9" ry="20" fill="#ffe3d6"/></g>
      <path class="cmp-tail" fill="url(#cmp-tail)"
        d="M78 205 C88 225 112 225 122 205 C116 228 104 240 100 246 C96 240 84 228 78 205 Z"/>
      <path fill="url(#cmp-dress)" d="M80 140 C70 155 64 185 68 205 C82 222 118 222 132 205 C136 185 130 155 120 140 Z"/>
      <path fill="#ece9ff" d="M86 141 L100 156 L114 141 Z"/>
      <circle cx="100" cy="160" r="4" fill="#ffc857"/>
    </g>

    <!-- الوجه -->
    <ellipse cx="100" cy="98" rx="50" ry="47" fill="#ffe8dc"/>

    <!-- العينان -->
    <g class="cmp-eyes cmp-eyes--open">
      <g class="cmp-eye">
        <ellipse cx="80" cy="106" rx="10" ry="13" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="80" cy="107" rx="8" ry="11" fill="url(#cmp-iris)"/>
          <ellipse cx="80" cy="109" rx="4" ry="5.5" fill="#1a1450"/>
          <circle cx="77" cy="102" r="3" fill="#fff"/>
          <circle cx="83" cy="112" r="1.4" fill="#fff" opacity=".85"/>
        </g>
      </g>
      <g class="cmp-eye">
        <ellipse cx="120" cy="106" rx="10" ry="13" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="120" cy="107" rx="8" ry="11" fill="url(#cmp-iris)"/>
          <ellipse cx="120" cy="109" rx="4" ry="5.5" fill="#1a1450"/>
          <circle cx="117" cy="102" r="3" fill="#fff"/>
          <circle cx="123" cy="112" r="1.4" fill="#fff" opacity=".85"/>
        </g>
      </g>
      <path d="M68 92 Q80 86 91 92" stroke="#3b2a7a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M109 92 Q120 86 132 92" stroke="#3b2a7a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </g>
    <g class="cmp-eyes cmp-eyes--happy" stroke="#3b2a7a" stroke-width="3" fill="none" stroke-linecap="round">
      <path d="M70 108 Q80 96 90 108"/>
      <path d="M110 108 Q120 96 130 108"/>
    </g>

    <!-- الخدود -->
    <ellipse cx="68" cy="122" rx="8" ry="4.5" fill="#ff8fb1" opacity=".45"/>
    <ellipse cx="132" cy="122" rx="8" ry="4.5" fill="#ff8fb1" opacity=".45"/>

    <!-- الفم -->
    <path class="cmp-mouth cmp-mouth--smile" d="M93 126 Q100 132 107 126" stroke="#a8466a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <ellipse class="cmp-mouth cmp-mouth--talk" cx="100" cy="128" rx="5" ry="4" fill="#a8466a"/>
    <path class="cmp-mouth cmp-mouth--o" d="M97 128 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0" fill="#a8466a"/>

    <!-- الغُرّة وخصلة الرأس -->
    <path fill="url(#cmp-hair)"
      d="M48 102 C44 55 70 34 100 34 C130 34 156 55 152 102 Q147 90 141 80 Q136 91 129 96
         Q123 84 118 70 Q112 82 105 91 Q99 80 93 68 Q87 82 81 93 Q75 86 69 76 Q63 89 58 100 Z"/>
    <path class="cmp-ahoge" d="M100 36 C96 18 110 10 118 14 C108 16 104 24 104 36 Z" fill="#7a5cff"/>
    <g transform="translate(138 52)"><path class="cmp-star" fill="#ffc857"
      d="M0 -9 L2.6 -2.8 L9 -2.8 L3.8 1.4 L5.6 8 L0 4.2 L-5.6 8 L-3.8 1.4 L-9 -2.8 L-2.6 -2.8 Z"/></g>

    <!-- فقاعات التفكير -->
    <g class="cmp-think" fill="#ece9ff">
      <circle cx="158" cy="44" r="4"/>
      <circle cx="170" cy="30" r="6"/>
      <circle cx="186" cy="14" r="8"/>
    </g>
  </g>
</svg>`;

const STATES = ['idle', 'listening', 'thinking', 'talking', 'happy'];

export function createCompanion(host, { onTap } = {}) {
  const el = document.createElement('div');
  el.className = 'companion is-idle';
  el.innerHTML = SVG;
  host.append(el);

  const svg = el.querySelector('svg');
  const pupils = el.querySelectorAll('.cmp-pupil');
  let state = 'idle';
  let blinkTimer = 0;
  let happyTimer = 0;

  function setState(next) {
    if (!STATES.includes(next)) return;
    el.classList.remove(`is-${state}`);
    state = next;
    el.classList.add(`is-${state}`);
  }

  // رمشة طبيعية على فترات عشوائية
  function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      el.classList.add('is-blinking');
      setTimeout(() => el.classList.remove('is-blinking'), 140);
      scheduleBlink();
    }, 2200 + Math.random() * 3500);
  }
  scheduleBlink();

  // العينان تتبعان الإصبع أو المؤشر
  function look(e) {
    const r = svg.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.42;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 200);
    const x = (dx / d) * 3 * k, y = (dy / d) * 3 * k;
    pupils.forEach((p) => p.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`));
  }
  window.addEventListener('pointermove', look);
  window.addEventListener('pointerdown', look);

  // لمسة: تفرح قليلاً
  function tap() {
    const prev = state === 'happy' ? 'idle' : state;
    setState('happy');
    clearTimeout(happyTimer);
    happyTimer = setTimeout(() => setState(prev), 1400);
    onTap?.();
  }
  el.addEventListener('click', tap);

  return {
    el,
    setState,
    get state() { return state; },
    destroy() {
      clearTimeout(blinkTimer);
      clearTimeout(happyTimer);
      window.removeEventListener('pointermove', look);
      window.removeEventListener('pointerdown', look);
      el.remove();
    },
  };
}
