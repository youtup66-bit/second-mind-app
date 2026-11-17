// أشكال الرفيقة (تشيبي). كل شكل رسم SVG أصلي يشترك في أسماء الأجزاء نفسها
// (cmp-eye, cmp-pupil, cmp-mouth--*, ...) حتى تعمل معه الحركات والحالات كلها.
// لإضافة شكل جديد: أضف عنصراً هنا بمعرّفات تدرّج فريدة (مثل neko-*).

export const SKINS = {
  star: {
    label: 'نجمة',
    note: 'شعر بنفسجي ونجمة',
    voice: { piperRate: 1.28, pitch: 1.55, rate: 1.05, gender: 'female', gemini: 'Leda', style: 'Speak in Arabic with a sweet, gentle, slightly high-pitched young anime girl voice, warm and caring' },
    svg: `
<svg class="companion__svg" viewBox="0 0 200 250" role="img" aria-label="الرفيقة">
  <defs>
    <clipPath id="star-face"><ellipse cx="100" cy="98" rx="50" ry="47"/></clipPath>
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
    <path class="cmp-hair-back" fill="url(#cmp-hair)" stroke="#2c2290" stroke-width="1.6" stroke-linejoin="round"
      d="M40 100 C35 45 70 24 100 24 C130 24 165 45 160 100 C163 140 152 168 138 182
         L62 182 C48 168 37 140 40 100 Z"/>
    <path d="M47 112 Q45 142 58 172 M153 112 Q155 142 142 172" stroke="#2c2290" stroke-width="1.4" fill="none" opacity=".35" stroke-linecap="round"/>

    <!-- الجسم: فستان صغير وذراعان -->
    <g class="cmp-body">
      <g transform="rotate(20 70 168)"><ellipse class="cmp-arm cmp-arm--r" cx="70" cy="168" rx="9" ry="20" fill="#ffe3d6"/></g>
      <g transform="rotate(-20 130 168)"><ellipse class="cmp-arm cmp-arm--l" cx="130" cy="168" rx="9" ry="20" fill="#ffe3d6"/></g>
      <path class="cmp-tail" fill="url(#cmp-tail)"
        d="M78 205 C88 225 112 225 122 205 C116 228 104 240 100 246 C96 240 84 228 78 205 Z"/>
      <path stroke="#1c1660" stroke-width="1.4" stroke-linejoin="round" fill="url(#cmp-dress)" d="M80 140 C70 155 64 185 68 205 C82 222 118 222 132 205 C136 185 130 155 120 140 Z"/>
      <path fill="#ece9ff" d="M86 141 L100 156 L114 141 Z"/>
      <circle cx="100" cy="160" r="4" fill="#ffc857"/>
    </g>

    <g class="cmp-shading">
      <path d="M111 141 C119 156 125 186 123 214 C127 211 130 208 132 205 C136 185 130 155 120 140 Z" fill="#12103f" opacity=".32"/>
      <path d="M90 172 Q87 192 89 212 M104 176 Q106 196 104 214" stroke="#12103f" stroke-width="1.4" fill="none" opacity=".16" stroke-linecap="round"/>
    </g>

    <!-- الوجه -->
    <ellipse cx="100" cy="142" rx="21" ry="7" fill="#000" opacity=".2"/>
    <ellipse cx="100" cy="98" rx="50" ry="47" fill="#ffe8dc" stroke="#e9b4a2" stroke-width="1.4"/>
    <g clip-path="url(#star-face)">
      <path d="M48 102 C44 55 70 34 100 34 C130 34 156 55 152 102 Q147 90 141 80 Q136 91 129 96
         Q123 84 118 70 Q112 82 105 91 Q99 80 93 68 Q87 82 81 93 Q75 86 69 76 Q63 89 58 100 Z" transform="translate(0 6)" fill="#f2b6a6" opacity=".6"/>
      <ellipse cx="100" cy="145" rx="44" ry="9" fill="#f2b6a6" opacity=".2"/>
    </g>
    <path d="M98.5 118 q1.5 1.6 3 0" stroke="#e9b4a2" stroke-width="1.4" fill="none" stroke-linecap="round"/>

    <!-- العينان -->
    <g class="cmp-eyes cmp-eyes--open">
      <g class="cmp-eye">
        <ellipse cx="80" cy="106" rx="10" ry="13" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="80" cy="107" rx="8" ry="11" fill="url(#cmp-iris)"/>
          <ellipse cx="80" cy="107.0" rx="8.0" ry="11.0" fill="none" stroke="#2a2a8a" stroke-width="1.3" opacity=".75"/>
          <ellipse cx="80" cy="112.0" rx="4.4" ry="3.3" fill="#fff" opacity=".18"/>
          <ellipse cx="80" cy="109" rx="4" ry="5.5" fill="#1a1450"/>
          <circle cx="77" cy="102" r="3" fill="#fff"/>
          <circle cx="83" cy="112" r="1.4" fill="#fff" opacity=".85"/>
        </g>
        <path d="M71.5 102.8 Q80 91 88.5 102.8" stroke="#3b2a7a" stroke-width="2.4" fill="none" opacity=".16" stroke-linecap="round"/>
        <path d="M69.5 101.5 Q76 91.5 80 92.5 Q86 92.5 90.5 100.8" stroke="#2a2060" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      </g>
      <g class="cmp-eye">
        <ellipse cx="120" cy="106" rx="10" ry="13" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="120" cy="107" rx="8" ry="11" fill="url(#cmp-iris)"/>
          <ellipse cx="120" cy="107.0" rx="8.0" ry="11.0" fill="none" stroke="#2a2a8a" stroke-width="1.3" opacity=".75"/>
          <ellipse cx="120" cy="112.0" rx="4.4" ry="3.3" fill="#fff" opacity=".18"/>
          <ellipse cx="120" cy="109" rx="4" ry="5.5" fill="#1a1450"/>
          <circle cx="117" cy="102" r="3" fill="#fff"/>
          <circle cx="123" cy="112" r="1.4" fill="#fff" opacity=".85"/>
        </g>
        <path d="M111.5 102.8 Q120 91 128.5 102.8" stroke="#3b2a7a" stroke-width="2.4" fill="none" opacity=".16" stroke-linecap="round"/>
        <path d="M109.5 101.5 Q116 91.5 120 92.5 Q126 92.5 130.5 100.8" stroke="#2a2060" stroke-width="2.6" fill="none" stroke-linecap="round"/>
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
    <path fill="url(#cmp-hair)" stroke="#2c2290" stroke-width="1.6" stroke-linejoin="round"
      d="M48 102 C44 55 70 34 100 34 C130 34 156 55 152 102 Q147 90 141 80 Q136 91 129 96
         Q123 84 118 70 Q112 82 105 91 Q99 80 93 68 Q87 82 81 93 Q75 86 69 76 Q63 89 58 100 Z"/>
    <path d="M76 48 Q70 62 68 80 M100 40 Q98 56 95 70 M124 48 Q128 62 130 80" stroke="#2c2290" stroke-width="1.4" fill="none" opacity=".45" stroke-linecap="round"/>
    <path d="M64 60 Q80 44 106 43" stroke="#fff" stroke-width="3.5" fill="none" opacity=".28" stroke-linecap="round"/>
    <path d="M112 44 Q124 46 132 54" stroke="#fff" stroke-width="2" fill="none" opacity=".2" stroke-linecap="round"/>
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
</svg>`,
  },
};

export const DEFAULT_SKIN = 'star';
// كل نسخة من الرسم تأخذ أسماء فريدة لتدرّجاتها ومقاطعها: إن ظهر الرسم أكثر من مرة في الصفحة
// (الرفيقة، صورتها في رأس المحادثة، الطافية، معاينات الإعدادات) لا تتعارض الأسماء،
// ولا تختفي الألوان حين تكون إحدى النسخ مخفية.
let instance = 0;
export const skinSVG = (id) => {
  const n = ++instance;
  return (SKINS[id] || SKINS[DEFAULT_SKIN]).svg
    .replace(/\bid="([^"]+)"/g, `id="$1-i${n}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-i${n})`);
};
export const skinVoice = (id) => (SKINS[id] || SKINS[DEFAULT_SKIN]).voice;
