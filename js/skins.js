// أشكال المساعد (تشيبي). كل شكل رسم SVG أصلي يشترك في أسماء الأجزاء نفسها
// (cmp-eye, cmp-pupil, cmp-mouth--*, ...) حتى تعمل معه الحركات والحالات كلها.
// لإضافة شكل جديد: أضف عنصراً هنا بمعرّفات تدرّج فريدة (مثل neko-*).

export const SKINS = {
  star: {
    label: 'الكرة',
    note: 'كرة بنفسجية بسيطة',
    voice: { piperRate: 1.28, pitch: 1.55, rate: 1.05, gender: 'female', gemini: 'Leda', style: 'Speak in Arabic with a sweet, gentle, slightly high-pitched young anime girl voice, warm and caring' },
    svg: `
<svg class="companion__svg" viewBox="0 0 200 200" role="img" aria-label="الكرة">
  <defs>
    <radialGradient id="orb-core" cx="35%" cy="30%" r="75%">
      <stop offset="0" stop-color="#d9ccff"/>
      <stop offset=".45" stop-color="#8b6cff"/>
      <stop offset="1" stop-color="#3b2a9a"/>
    </radialGradient>
    <radialGradient id="orb-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#8b6cff" stop-opacity=".55"/>
      <stop offset="1" stop-color="#8b6cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse class="cmp-shadow" cx="100" cy="186" rx="50" ry="8" fill="#000" opacity=".35"/>
  <g class="cmp-float">
    <circle class="cmp-aura" cx="100" cy="100" r="98" fill="url(#orb-aura)"/>
    <circle cx="100" cy="100" r="62" fill="url(#orb-core)"/>
  </g>
</svg>`,
  },
};

export const DEFAULT_SKIN = 'star';
// كل نسخة من الرسم تأخذ أسماء فريدة لتدرّجاتها ومقاطعها: إن ظهر الرسم أكثر من مرة في الصفحة
// (المساعد، صورتها في رأس المحادثة، الطافية، معاينات الإعدادات) لا تتعارض الأسماء،
// ولا تختفي الألوان حين تكون إحدى النسخ مخفية.
let instance = 0;
export const skinSVG = (id) => {
  const n = ++instance;
  return (SKINS[id] || SKINS[DEFAULT_SKIN]).svg
    .replace(/\bid="([^"]+)"/g, `id="$1-i${n}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-i${n})`);
};
export const skinVoice = (id) => (SKINS[id] || SKINS[DEFAULT_SKIN]).voice;
