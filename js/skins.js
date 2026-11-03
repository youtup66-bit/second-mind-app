// أشكال الرفيقة (تشيبي). كل شكل رسم SVG أصلي يشترك في أسماء الأجزاء نفسها
// (cmp-eye, cmp-pupil, cmp-mouth--*, ...) حتى تعمل معه الحركات والحالات كلها.
// لإضافة شكل جديد: أضف عنصراً هنا بمعرّفات تدرّج فريدة (مثل neko-*).

export const SKINS = {
  star: {
    label: 'نجمة',
    note: 'شعر بنفسجي ونجمة',
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
  neko: {
    label: 'نيكو',
    note: 'فتاة قطة بشعر أسود',
    svg: `
<svg class="companion__svg" viewBox="0 0 200 250" role="img" aria-label="الرفيقة">
  <defs>
    <clipPath id="neko-face"><ellipse cx="100" cy="98" rx="50" ry="47"/></clipPath>
    <linearGradient id="neko-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#34303d"/>
      <stop offset="1" stop-color="#16141b"/>
    </linearGradient>
    <linearGradient id="neko-dress" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3644"/>
      <stop offset="1" stop-color="#25222c"/>
    </linearGradient>
    <radialGradient id="neko-iris" cx="50%" cy="30%" r="75%">
      <stop offset="0" stop-color="#e2b88a"/>
      <stop offset=".5" stop-color="#9a6238"/>
      <stop offset="1" stop-color="#3f2114"/>
    </radialGradient>
    <radialGradient id="neko-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ff9aa8" stop-opacity=".35"/>
      <stop offset="1" stop-color="#8b6cff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse class="cmp-shadow" cx="100" cy="240" rx="38" ry="6" fill="#000" opacity=".35"/>

  <g class="cmp-float">
    <circle class="cmp-aura" cx="100" cy="118" r="100" fill="url(#neko-aura)"/>

    <!-- ذيل القطة -->
    <path class="cmp-cattail" fill="#24212b" stroke="#0f0d12" stroke-width="1.5"
      d="M122 204 C150 210 172 196 170 170 C168 150 152 146 148 158 C156 158 160 168 154 180
         C146 194 132 196 120 194 Z"/>

    <!-- الشعر الخلفي الطويل -->
    <path class="cmp-hair-back" fill="url(#neko-hair)" stroke="#08070a" stroke-width="1.6" stroke-linejoin="round"
      d="M38 104 C33 48 70 26 100 26 C130 26 167 48 162 104 C166 140 162 168 148 188
         C142 178 136 184 128 192 L72 192 C64 184 58 178 52 188 C38 168 34 140 38 104 Z"/>
    <path d="M46 112 Q43 145 56 178 M154 112 Q157 145 144 178 M52 150 Q54 166 60 180" stroke="#000" stroke-width="1.4" fill="none" opacity=".4" stroke-linecap="round"/>

    <!-- الأذنان -->
    <g class="cmp-ear cmp-ear--r">
      <path d="M46 76 L40 16 L90 46 Z" fill="#24212b" stroke="#0f0d12" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M52 66 L48 30 L78 48 Z" fill="#f4a3a0"/>
    </g>
    <g class="cmp-ear cmp-ear--l">
      <path d="M154 76 L160 16 L110 46 Z" fill="#24212b" stroke="#0f0d12" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M148 66 L152 30 L122 48 Z" fill="#f4a3a0"/>
    </g>

    <!-- الجسم: قميص أبيض بأكمام منفوخة وفستان أسود -->
    <g class="cmp-body">
      <ellipse cx="88" cy="226" rx="8" ry="12" fill="#1d1a22"/>
      <ellipse cx="112" cy="226" rx="8" ry="12" fill="#1d1a22"/>
      <g transform="rotate(18 69 174)"><ellipse class="cmp-arm cmp-arm--r" cx="69" cy="174" rx="7" ry="15" fill="#ffe8dc"/></g>
      <g transform="rotate(-18 131 174)"><ellipse class="cmp-arm cmp-arm--l" cx="131" cy="174" rx="7" ry="15" fill="#ffe8dc"/></g>
      <path fill="#f3f1f6" d="M80 140 C72 150 68 165 70 182 L130 182 C132 165 128 150 120 140 Z"/>
      <ellipse cx="73" cy="153" rx="12" ry="10" fill="#f3f1f6" stroke="#d6d2dd" stroke-width="1"/>
      <ellipse cx="127" cy="153" rx="12" ry="10" fill="#f3f1f6" stroke="#d6d2dd" stroke-width="1"/>
      <path stroke="#0f0d12" stroke-width="1.4" stroke-linejoin="round" fill="url(#neko-dress)" d="M86 146 L114 146 L116 176 C128 182 132 196 132 210 C116 222 84 222 68 210 C68 196 72 182 84 176 Z"/>
      <path d="M70 208 Q76 216 82 210 Q88 218 94 211 Q100 219 106 211 Q112 218 118 210 Q124 216 130 208"
        fill="none" stroke="#4a4654" stroke-width="3" stroke-linecap="round"/>
      <path d="M88 146 L86 140 M112 146 L114 140" stroke="#25222c" stroke-width="4" stroke-linecap="round"/>
      <circle cx="91" cy="153" r="2.6" fill="#b47c6a"/>
      <circle cx="109" cy="153" r="2.6" fill="#b47c6a"/>
      <circle cx="91" cy="166" r="2.6" fill="#b47c6a"/>
      <circle cx="109" cy="166" r="2.6" fill="#b47c6a"/>
    </g>

    <g class="cmp-shading">
      <path d="M106 178 C118 184 124 196 124 214 C128 213 131 211 132 210 C132 196 128 182 116 176 Z" fill="#000" opacity=".25"/>
      <path d="M92 182 Q89 198 90 212 M106 182 Q109 198 108 213" stroke="#000" stroke-width="1.3" fill="none" opacity=".16" stroke-linecap="round"/>
      <path d="M78 152 Q73 156 70 154 M122 152 Q127 156 130 154" stroke="#c9c4d2" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    </g>

    <!-- الوجه -->
    <ellipse cx="100" cy="142" rx="21" ry="7" fill="#000" opacity=".2"/>
    <ellipse cx="100" cy="98" rx="50" ry="47" fill="#fff1e8" stroke="#ecc0ad" stroke-width="1.4"/>
    <g clip-path="url(#neko-face)">
      <path d="M50 104 C46 56 72 36 100 36 C128 36 154 56 150 104 Q146 86 139 76 Q133 92 124 99
         Q120 80 112 64 Q108 84 101 95 Q96 78 89 64 Q84 84 76 97 Q70 86 64 78 Q58 92 54 102 Z" transform="translate(0 6)" fill="#f4c6b6" opacity=".6"/>
      <ellipse cx="100" cy="145" rx="44" ry="9" fill="#f4c6b6" opacity=".2"/>
    </g>
    <path d="M98.5 118 q1.5 1.6 3 0" stroke="#ecc0ad" stroke-width="1.4" fill="none" stroke-linecap="round"/>

    <!-- العينان -->
    <g class="cmp-eyes cmp-eyes--open">
      <g class="cmp-eye">
        <ellipse cx="80" cy="108" rx="12" ry="15" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="80" cy="109.5" rx="10.5" ry="13.5" fill="url(#neko-iris)"/>
          <ellipse cx="80" cy="109.5" rx="10.5" ry="13.5" fill="none" stroke="#3f2114" stroke-width="1.3" opacity=".75"/>
          <ellipse cx="80" cy="115.6" rx="5.8" ry="4.0" fill="#fff" opacity=".18"/>
          <ellipse cx="80" cy="110" rx="4.5" ry="6" fill="#2a140a"/>
          <circle cx="76.5" cy="102.5" r="3.4" fill="#fff"/>
          <circle cx="84" cy="114" r="1.6" fill="#fff" opacity=".9"/>
        </g>
        <path d="M69.5 104.2 Q80 91 90.5 104.2" stroke="#3a1f12" stroke-width="2.4" fill="none" opacity=".16" stroke-linecap="round"/>
        <path d="M66 103 Q70 92 81 92.5 Q90 93 94 100" stroke="#1a1418" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M66 103 l-3 -2" stroke="#1a1418" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <g class="cmp-eye">
        <ellipse cx="120" cy="108" rx="12" ry="15" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="120" cy="109.5" rx="10.5" ry="13.5" fill="url(#neko-iris)"/>
          <ellipse cx="120" cy="109.5" rx="10.5" ry="13.5" fill="none" stroke="#3f2114" stroke-width="1.3" opacity=".75"/>
          <ellipse cx="120" cy="115.6" rx="5.8" ry="4.0" fill="#fff" opacity=".18"/>
          <ellipse cx="120" cy="110" rx="4.5" ry="6" fill="#2a140a"/>
          <circle cx="116.5" cy="102.5" r="3.4" fill="#fff"/>
          <circle cx="124" cy="114" r="1.6" fill="#fff" opacity=".9"/>
        </g>
        <path d="M109.5 104.2 Q120 91 130.5 104.2" stroke="#3a1f12" stroke-width="2.4" fill="none" opacity=".16" stroke-linecap="round"/>
        <path d="M134 103 Q130 92 119 92.5 Q110 93 106 100" stroke="#1a1418" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M134 103 l3 -2" stroke="#1a1418" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <path d="M73 84 Q80 82 87 84" stroke="#3a2a2a" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".5"/>
      <path d="M113 84 Q120 82 127 84" stroke="#3a2a2a" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".5"/>
    </g>
    <g class="cmp-eyes cmp-eyes--happy" stroke="#1a1418" stroke-width="3.2" fill="none" stroke-linecap="round">
      <path d="M69 109 Q80 97 91 109"/>
      <path d="M109 109 Q120 97 131 109"/>
    </g>

    <!-- الخدود -->
    <ellipse cx="67" cy="123" rx="8" ry="4.5" fill="#ff9aa8" opacity=".5"/>
    <ellipse cx="133" cy="123" rx="8" ry="4.5" fill="#ff9aa8" opacity=".5"/>
    <path d="M63 122 l3 -3 M68 123 l3 -3 M129 122 l3 -3 M134 123 l3 -3" stroke="#ff7f93" stroke-width="1" opacity=".6"/>

    <!-- الفم (فم قطة صغير) -->
    <path class="cmp-mouth cmp-mouth--smile" d="M93 126 Q96.5 130 100 126 Q103.5 130 107 126" stroke="#a8466a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <ellipse class="cmp-mouth cmp-mouth--talk" cx="100" cy="128" rx="5" ry="4" fill="#a8466a"/>
    <path class="cmp-mouth cmp-mouth--o" d="M97 128 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0" fill="#a8466a"/>

    <!-- الغُرّة -->
    <path fill="url(#neko-hair)" stroke="#08070a" stroke-width="1.6" stroke-linejoin="round"
      d="M50 104 C46 56 72 36 100 36 C128 36 154 56 150 104 Q146 86 139 76 Q133 92 124 99
         Q120 80 112 64 Q108 84 101 95 Q96 78 89 64 Q84 84 76 97 Q70 86 64 78 Q58 92 54 102 Z"/>
    <path d="M78 46 Q72 62 70 80 M100 40 Q99 56 97 70 M122 46 Q127 62 129 82" stroke="#000" stroke-width="1.4" fill="none" opacity=".45" stroke-linecap="round"/>
    <path d="M116 44 Q128 48 136 58" stroke="#fff" stroke-width="2" fill="none" opacity=".16" stroke-linecap="round"/>
    <path d="M70 52 Q86 40 104 42" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".18"/>

    <!-- فقاعات التفكير -->
    <g class="cmp-think" fill="#ece9ff">
      <circle cx="158" cy="44" r="4"/>
      <circle cx="170" cy="30" r="6"/>
      <circle cx="186" cy="14" r="8"/>
    </g>
  </g>
</svg>`,
  },
  mage: {
    label: 'لهب',
    note: 'ساحر بشعر أحمر',
    svg: `
<svg class="companion__svg" viewBox="0 0 200 250" role="img" aria-label="الرفيقة">
  <defs>
    <clipPath id="mage-face"><ellipse cx="100" cy="100" rx="49" ry="46"/></clipPath>
    <linearGradient id="mage-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff7a52"/>
      <stop offset="1" stop-color="#c62f2a"/>
    </linearGradient>
    <linearGradient id="mage-robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a3fb0"/>
      <stop offset="1" stop-color="#231d63"/>
    </linearGradient>
    <linearGradient id="mage-hat" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5a4bd1"/>
      <stop offset="1" stop-color="#2a2275"/>
    </linearGradient>
    <radialGradient id="mage-iris" cx="50%" cy="30%" r="75%">
      <stop offset="0" stop-color="#b8f5cf"/>
      <stop offset=".5" stop-color="#3fb57a"/>
      <stop offset="1" stop-color="#155c3a"/>
    </radialGradient>
    <radialGradient id="mage-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ff8a5c" stop-opacity=".32"/>
      <stop offset="1" stop-color="#8b6cff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mage-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff6c2"/>
      <stop offset=".45" stop-color="#ffc857" stop-opacity=".8"/>
      <stop offset="1" stop-color="#ffc857" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse class="cmp-shadow" cx="100" cy="240" rx="38" ry="6" fill="#000" opacity=".35"/>

  <g class="cmp-float">
    <circle class="cmp-aura" cx="100" cy="118" r="100" fill="url(#mage-aura)"/>

    <!-- الشعر الخلفي القصير -->
    <path class="cmp-hair-back" fill="url(#mage-hair)" stroke="#8f1f1a" stroke-width="1.6" stroke-linejoin="round"
      d="M44 100 C40 60 68 38 100 38 C132 38 160 60 156 100 C159 116 154 130 146 138
         L138 128 L132 140 L68 140 L62 128 L54 138 C46 130 41 116 44 100 Z"/>
    <path d="M47 108 Q46 124 52 134 M153 108 Q154 124 148 134" stroke="#8f1f1a" stroke-width="1.4" fill="none" opacity=".4" stroke-linecap="round"/>

    <!-- الرداء والذراعان -->
    <g class="cmp-body">
      <g transform="rotate(16 68 176)"><ellipse class="cmp-arm cmp-arm--r" cx="68" cy="176" rx="7" ry="15" fill="#ffe6d5"/></g>
      <g transform="rotate(-34 134 170)"><ellipse cx="134" cy="170" rx="7" ry="15" fill="#ffe6d5"/></g>
      <path stroke="#15114a" stroke-width="1.4" stroke-linejoin="round" fill="url(#mage-robe)" d="M80 140 C68 158 62 190 66 216 C82 230 118 230 134 216 C138 190 132 158 120 140 Z"/>
      <path fill="#ffc857" d="M100 146 L96 228 L104 228 Z" opacity=".85"/>
      <path fill="#3a2f99" d="M80 140 L100 160 L120 140 L114 136 L100 150 L86 136 Z"/>
      <path fill="#ffc857" d="M82 141 L100 158 L118 141" stroke="#ffc857" stroke-width="2" fill-opacity="0"/>
      <circle cx="80" cy="190" r="2" fill="#ffc857" opacity=".8"/>
      <circle cx="120" cy="200" r="2.4" fill="#ffc857" opacity=".8"/>
      <circle cx="84" cy="210" r="1.6" fill="#fff" opacity=".7"/>
      <circle cx="116" cy="176" r="1.6" fill="#fff" opacity=".7"/>
      <path d="M66 216 C82 230 118 230 134 216" fill="none" stroke="#ffc857" stroke-width="2.5" opacity=".8"/>
    </g>

    <!-- العصا السحرية -->
    <g class="cmp-wand">
      <path d="M138 182 L164 136" stroke="#7a4a2a" stroke-width="4" stroke-linecap="round"/>
      <path d="M138 182 L164 136" stroke="#a8693d" stroke-width="1.5" stroke-linecap="round"/>
      <circle class="cmp-wand-glow" cx="166" cy="132" r="14" fill="url(#mage-glow)"/>
      <g transform="translate(166 132)"><path class="cmp-star" fill="#fff6c2"
        d="M0 -7 L2 -2.2 L7 -2.2 L3 1.1 L4.4 6.2 L0 3.3 L-4.4 6.2 L-3 1.1 L-7 -2.2 L-2 -2.2 Z"/></g>
    </g>

    <g class="cmp-shading">
      <path d="M111 141 C119 156 125 188 123 220 C128 218 131 216 134 214 C138 190 132 158 120 140 Z" fill="#0d0a33" opacity=".32"/>
      <path d="M86 172 Q83 196 85 222 M114 176 Q117 198 115 222" stroke="#0d0a33" stroke-width="1.4" fill="none" opacity=".16" stroke-linecap="round"/>
    </g>

    <!-- الوجه -->
    <ellipse cx="100" cy="143" rx="21" ry="7" fill="#000" opacity=".2"/>
    <ellipse cx="100" cy="100" rx="49" ry="46" fill="#ffe6d5" stroke="#e8b096" stroke-width="1.4"/>
    <g clip-path="url(#mage-face)">
      <path d="M51 104 C48 68 70 50 100 50 C130 50 152 68 149 104 L142 86 L137 100 L127 78 L118 95
         L106 72 L97 92 L86 74 L78 97 L67 82 L59 101 Z" transform="translate(0 6)" fill="#f2b39c" opacity=".6"/>
      <ellipse cx="100" cy="146" rx="43" ry="9" fill="#f2b39c" opacity=".2"/>
    </g>
    <path d="M98.5 120 q1.5 1.6 3 0" stroke="#e8b096" stroke-width="1.4" fill="none" stroke-linecap="round"/>

    <!-- العينان -->
    <g class="cmp-eyes cmp-eyes--open">
      <g class="cmp-eye">
        <ellipse cx="80" cy="109" rx="10" ry="12" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="80" cy="110" rx="8.5" ry="10.5" fill="url(#mage-iris)"/>
          <ellipse cx="80" cy="110.0" rx="8.5" ry="10.5" fill="none" stroke="#155c3a" stroke-width="1.3" opacity=".75"/>
          <ellipse cx="80" cy="114.7" rx="4.7" ry="3.1" fill="#fff" opacity=".18"/>
          <ellipse cx="80" cy="111.5" rx="4" ry="5" fill="#0f3322"/>
          <circle cx="77" cy="105.5" r="2.8" fill="#fff"/>
          <circle cx="83.5" cy="115" r="1.3" fill="#fff" opacity=".9"/>
        </g>
        <path d="M71.5 106 Q80 95 88.5 106" stroke="#0f3322" stroke-width="2.4" fill="none" opacity=".16" stroke-linecap="round"/>
        <path d="M69 103 Q80 95 91 101" stroke="#3a1a14" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      </g>
      <g class="cmp-eye">
        <ellipse cx="120" cy="109" rx="10" ry="12" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="120" cy="110" rx="8.5" ry="10.5" fill="url(#mage-iris)"/>
          <ellipse cx="120" cy="110.0" rx="8.5" ry="10.5" fill="none" stroke="#155c3a" stroke-width="1.3" opacity=".75"/>
          <ellipse cx="120" cy="114.7" rx="4.7" ry="3.1" fill="#fff" opacity=".18"/>
          <ellipse cx="120" cy="111.5" rx="4" ry="5" fill="#0f3322"/>
          <circle cx="117" cy="105.5" r="2.8" fill="#fff"/>
          <circle cx="123.5" cy="115" r="1.3" fill="#fff" opacity=".9"/>
        </g>
        <path d="M111.5 106 Q120 95 128.5 106" stroke="#0f3322" stroke-width="2.4" fill="none" opacity=".16" stroke-linecap="round"/>
        <path d="M109 101 Q120 95 131 103" stroke="#3a1a14" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      </g>
      <path d="M69 92 Q79 87 90 91" stroke="#b0321f" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M110 91 Q121 87 131 92" stroke="#b0321f" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    </g>
    <g class="cmp-eyes cmp-eyes--happy" stroke="#3a1a14" stroke-width="3" fill="none" stroke-linecap="round">
      <path d="M70 111 Q80 100 90 111"/>
      <path d="M110 111 Q120 100 130 111"/>
    </g>

    <!-- الخدود والفم -->
    <ellipse cx="68" cy="124" rx="7" ry="4" fill="#ff9a8a" opacity=".4"/>
    <ellipse cx="132" cy="124" rx="7" ry="4" fill="#ff9a8a" opacity=".4"/>
    <path class="cmp-mouth cmp-mouth--smile" d="M92 127 Q100 134 108 126" stroke="#9a3f4a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <ellipse class="cmp-mouth cmp-mouth--talk" cx="100" cy="129" rx="5" ry="4" fill="#9a3f4a"/>
    <path class="cmp-mouth cmp-mouth--o" d="M97 129 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0" fill="#9a3f4a"/>

    <!-- الغُرّة المدببة -->
    <path fill="url(#mage-hair)" stroke="#8f1f1a" stroke-width="1.6" stroke-linejoin="round"
      d="M51 104 C48 68 70 50 100 50 C130 50 152 68 149 104 L142 86 L137 100 L127 78 L118 95
         L106 72 L97 92 L86 74 L78 97 L67 82 L59 101 Z"/>
    <path d="M80 60 Q76 72 76 86 M100 56 Q100 68 98 80 M120 60 Q124 72 126 86" stroke="#8f1f1a" stroke-width="1.4" fill="none" opacity=".45" stroke-linecap="round"/>
    <path d="M62 78 Q70 66 82 62" stroke="#fff" stroke-width="3" fill="none" opacity=".25" stroke-linecap="round"/>

    <!-- قبعة الساحر -->
    <g class="cmp-hat">
      <path fill="url(#mage-hat)" d="M64 56 C76 36 84 18 70 4 C96 8 122 28 138 56 Z"/>
      <path fill="#ffc857" d="M66 50 Q100 40 136 50 L138 57 Q100 47 64 57 Z"/>
      <ellipse cx="100" cy="58" rx="60" ry="10" fill="#2a2275"/>
      <path d="M44 58 Q100 72 156 58" fill="none" stroke="#6a5ce0" stroke-width="2" opacity=".7"/>
      <g transform="translate(103 32)"><path class="cmp-star" fill="#ffc857"
        d="M0 -7 L2 -2.2 L7 -2.2 L3 1.1 L4.4 6.2 L0 3.3 L-4.4 6.2 L-3 1.1 L-7 -2.2 L-2 -2.2 Z"/></g>
      <circle cx="86" cy="22" r="1.6" fill="#fff" opacity=".8"/>
      <circle cx="118" cy="44" r="1.3" fill="#fff" opacity=".7"/>
    </g>

    <!-- فقاعات التفكير -->
    <g class="cmp-think" fill="#ece9ff">
      <circle cx="150" cy="44" r="4"/>
      <circle cx="164" cy="30" r="6"/>
      <circle cx="182" cy="14" r="8"/>
    </g>
  </g>
</svg>`,
  },
  bunny: {
    label: 'لولو',
    note: 'أرنبة بفستان وردي',
    svg: `
<svg class="companion__svg" viewBox="0 0 200 250" role="img" aria-label="الرفيقة">
  <defs>
    <clipPath id="bunny-face"><ellipse cx="100" cy="98" rx="50" ry="47"/></clipPath>
    <linearGradient id="bunny-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff2d9"/>
      <stop offset="1" stop-color="#efc58c"/>
    </linearGradient>
    <linearGradient id="bunny-dress" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffbfd8"/>
      <stop offset="1" stop-color="#ff7fb0"/>
    </linearGradient>
    <radialGradient id="bunny-iris" cx="50%" cy="30%" r="75%">
      <stop offset="0" stop-color="#ffd3e3"/>
      <stop offset=".5" stop-color="#ff5c95"/>
      <stop offset="1" stop-color="#8a1f4a"/>
    </radialGradient>
    <radialGradient id="bunny-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ff9ac4" stop-opacity=".4"/>
      <stop offset="1" stop-color="#8b6cff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse class="cmp-shadow" cx="100" cy="242" rx="38" ry="6" fill="#000" opacity=".35"/>

  <g class="cmp-float">
    <circle class="cmp-aura" cx="100" cy="118" r="100" fill="url(#bunny-aura)"/>

    <!-- أذنا الأرنب الطويلتان (اليسرى منحنية الطرف) -->
    <g class="cmp-ear cmp-ear--r">
      <path d="M70 56 C58 34 56 8 68 3 C81 -1 88 26 87 54 Z" fill="#fffaf5" stroke="#e0b9c4" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M72 50 C65 34 64 14 70 10 C77 8 81 28 81 50 Z" fill="#ffb3cc"/>
    </g>
    <g class="cmp-ear cmp-ear--l">
      <path d="M113 54 C111 30 117 10 131 8 C144 6 153 15 148 24 C141 19 133 22 129 32 C126 40 127 48 128 56 Z" fill="#fffaf5" stroke="#e0b9c4" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M118 50 C117 32 121 17 131 14 C138 13 143 17 141 20 C134 18 127 24 124 34 C122 41 122 46 123 51 Z" fill="#ffb3cc"/>
    </g>

    <!-- الذيل الصوفي -->
    <g class="cmp-pom">
      <circle cx="140" cy="198" r="11" fill="#fffaf5" stroke="#e0b9c4" stroke-width="1.4"/>
      <path d="M133 195 q3 -4 7 -2 M138 204 q4 2 7 -2" stroke="#e8d3da" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    </g>

    <!-- الشعر الخلفي -->
    <path class="cmp-hair-back" fill="url(#bunny-hair)" stroke="#c9975a" stroke-width="1.6" stroke-linejoin="round"
      d="M40 102 C36 50 70 30 100 30 C130 30 164 50 160 102 C163 132 158 156 146 172 C140 164 134 168 128 174
         L72 174 C66 168 60 164 54 172 C42 156 37 132 40 102 Z"/>
    <path d="M47 112 Q45 140 56 166 M153 112 Q155 140 144 166" stroke="#c9975a" stroke-width="1.4" fill="none" opacity=".35" stroke-linecap="round"/>

    <!-- الجسم: فستان وردي بطبقات وياقة بيضاء -->
    <g class="cmp-body">
      <ellipse cx="88" cy="226" rx="7.5" ry="11" fill="#fff" stroke="#e6d6dc" stroke-width="1"/>
      <ellipse cx="112" cy="226" rx="7.5" ry="11" fill="#fff" stroke="#e6d6dc" stroke-width="1"/>
      <ellipse cx="87" cy="236" rx="9" ry="5" fill="#ff7fb0" stroke="#d9578f" stroke-width="1"/>
      <ellipse cx="113" cy="236" rx="9" ry="5" fill="#ff7fb0" stroke="#d9578f" stroke-width="1"/>
      <g transform="rotate(18 69 174)"><ellipse class="cmp-arm cmp-arm--r" cx="69" cy="174" rx="7" ry="15" fill="#fff0e8"/></g>
      <g transform="rotate(-18 131 174)"><ellipse class="cmp-arm cmp-arm--l" cx="131" cy="174" rx="7" ry="15" fill="#fff0e8"/></g>
      <path fill="url(#bunny-dress)" stroke="#d9578f" stroke-width="1.4" stroke-linejoin="round"
        d="M84 140 L116 140 L118 172 C134 182 140 200 138 214 C120 228 80 228 62 214 C60 200 66 182 82 172 Z"/>
      <path d="M64 206 C80 216 120 216 136 206" fill="none" stroke="#ffd6e6" stroke-width="2" opacity=".9"/>
      <path d="M62 214 Q68 222 74 216 Q80 224 87 217 Q93 225 100 217 Q107 225 113 217 Q120 224 126 216 Q132 222 138 214"
        fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
      <ellipse cx="74" cy="152" rx="12" ry="10" fill="#ffaed0" stroke="#d9578f" stroke-width="1.2"/>
      <ellipse cx="126" cy="152" rx="12" ry="10" fill="#ffaed0" stroke="#d9578f" stroke-width="1.2"/>
      <path d="M70 158 Q74 162 79 160 M121 160 Q126 162 130 158" stroke="#d9578f" stroke-width="1" fill="none" opacity=".6" stroke-linecap="round"/>
      <path d="M84 141 Q92 152 100 144 Q108 152 116 141 Z" fill="#fff" stroke="#e6d6dc" stroke-width="1"/>
      <path d="M94 160 L100 164 L94 168 Z M106 160 L100 164 L106 168 Z" fill="#ff5c95"/>
      <circle cx="100" cy="164" r="2.2" fill="#d9578f"/>
    </g>
    <g class="cmp-shading">
      <path d="M108 174 C124 184 132 198 132 216 C135 215 137 214 138 213 C140 200 134 182 118 172 Z" fill="#b8336e" opacity=".22"/>
      <path d="M86 184 Q82 200 84 214 M114 184 Q118 200 116 215" stroke="#b8336e" stroke-width="1.3" fill="none" opacity=".16" stroke-linecap="round"/>
    </g>

    <!-- الوجه -->
    <ellipse cx="100" cy="142" rx="21" ry="7" fill="#000" opacity=".2"/>
    <ellipse cx="100" cy="98" rx="50" ry="47" fill="#fff3ec" stroke="#efc0b0" stroke-width="1.4"/>
    <g clip-path="url(#bunny-face)">
      <path d="M50 104 C46 58 72 40 100 40 C128 40 154 58 150 104 Q147 90 140 82 Q134 96 124 100 Q122 84 114 72 Q108 90 100 96 Q94 86 88 72 Q82 88 76 100 Q68 92 62 82 Q56 94 54 104 Z" transform="translate(0 6)" fill="#f6c6b6" opacity=".6"/>
      <ellipse cx="100" cy="145" rx="44" ry="9" fill="#f6c6b6" opacity=".2"/>
    </g>

    <!-- العينان -->
    <g class="cmp-eyes cmp-eyes--open">
      <g class="cmp-eye">
        <ellipse cx="80" cy="108" rx="12" ry="15" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="80" cy="109.5" rx="10.5" ry="13.5" fill="url(#bunny-iris)"/>
          <ellipse cx="80" cy="109.5" rx="10.5" ry="13.5" fill="none" stroke="#8a1f4a" stroke-width="1.3" opacity=".75"/>
          <ellipse cx="80" cy="115.6" rx="5.8" ry="4" fill="#fff" opacity=".2"/>
          <ellipse cx="80" cy="111" rx="4.5" ry="6" fill="#4a0d26"/>
          <circle cx="76.5" cy="103.5" r="3.6" fill="#fff"/>
          <circle cx="84" cy="115" r="1.7" fill="#fff" opacity=".9"/>
          <path d="M83 104 l1.2 -2.4 l1.2 2.4 l-1.2 2.4 Z" fill="#fff" opacity=".8"/>
        </g>
        <path d="M69.5 104.2 Q80 91 90.5 104.2" stroke="#8a1f4a" stroke-width="2.4" fill="none" opacity=".16" stroke-linecap="round"/>
        <path d="M66 103 Q70 92 81 92.5 Q90 93 94 100" stroke="#5a2a3a" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <path d="M66 103 l-3 -2.4" stroke="#5a2a3a" stroke-width="2.2" stroke-linecap="round"/>
      </g>
      <g class="cmp-eye">
        <ellipse cx="120" cy="108" rx="12" ry="15" fill="#fff"/>
        <g class="cmp-pupil">
          <ellipse cx="120" cy="109.5" rx="10.5" ry="13.5" fill="url(#bunny-iris)"/>
          <ellipse cx="120" cy="109.5" rx="10.5" ry="13.5" fill="none" stroke="#8a1f4a" stroke-width="1.3" opacity=".75"/>
          <ellipse cx="120" cy="115.6" rx="5.8" ry="4" fill="#fff" opacity=".2"/>
          <ellipse cx="120" cy="111" rx="4.5" ry="6" fill="#4a0d26"/>
          <circle cx="116.5" cy="103.5" r="3.6" fill="#fff"/>
          <circle cx="124" cy="115" r="1.7" fill="#fff" opacity=".9"/>
          <path d="M123 104 l1.2 -2.4 l1.2 2.4 l-1.2 2.4 Z" fill="#fff" opacity=".8"/>
        </g>
        <path d="M109.5 104.2 Q120 91 130.5 104.2" stroke="#8a1f4a" stroke-width="2.4" fill="none" opacity=".16" stroke-linecap="round"/>
        <path d="M134 103 Q130 92 119 92.5 Q110 93 106 100" stroke="#5a2a3a" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <path d="M134 103 l3 -2.4" stroke="#5a2a3a" stroke-width="2.2" stroke-linecap="round"/>
      </g>
      <path d="M73 84 Q80 82 87 84" stroke="#c9975a" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>
      <path d="M113 84 Q120 82 127 84" stroke="#c9975a" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>
    </g>
    <g class="cmp-eyes cmp-eyes--happy" stroke="#5a2a3a" stroke-width="3.2" fill="none" stroke-linecap="round">
      <path d="M69 109 Q80 97 91 109"/>
      <path d="M109 109 Q120 97 131 109"/>
    </g>

    <!-- الخدود والأنف والفم -->
    <ellipse cx="67" cy="123" rx="8.5" ry="5" fill="#ff8fb8" opacity=".5"/>
    <ellipse cx="133" cy="123" rx="8.5" ry="5" fill="#ff8fb8" opacity=".5"/>
    <path d="M98 118 L102 118 L100 120.6 Z" fill="#ff8fb1"/>
    <g class="cmp-mouth cmp-mouth--smile">
      <path d="M100 121 L100 124 M94 125 Q97 128 100 124 Q103 128 106 125" stroke="#a8466a" stroke-width="2" fill="none" stroke-linecap="round"/>
      <rect x="98" y="125.4" width="4" height="3" rx="1" fill="#fff" stroke="#e0c4cc" stroke-width=".6"/>
    </g>
    <ellipse class="cmp-mouth cmp-mouth--talk" cx="100" cy="128" rx="5" ry="4" fill="#a8466a"/>
    <path class="cmp-mouth cmp-mouth--o" d="M97 128 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0" fill="#a8466a"/>

    <!-- الغُرّة -->
    <path fill="url(#bunny-hair)" stroke="#c9975a" stroke-width="1.6" stroke-linejoin="round"
      d="M50 104 C46 58 72 40 100 40 C128 40 154 58 150 104 Q147 90 140 82 Q134 96 124 100 Q122 84 114 72 Q108 90 100 96 Q94 86 88 72 Q82 88 76 100 Q68 92 62 82 Q56 94 54 104 Z"/>
    <path d="M78 48 Q72 62 70 80 M100 42 Q99 58 97 72 M122 48 Q127 62 129 80" stroke="#c9975a" stroke-width="1.4" fill="none" opacity=".4" stroke-linecap="round"/>
    <path d="M64 62 Q80 46 104 45" stroke="#fff" stroke-width="3.5" fill="none" opacity=".45" stroke-linecap="round"/>

    <!-- الفيونكة -->
    <g transform="translate(132 50) rotate(18)">
      <path d="M0 0 L-13 -8 Q-16 0 -13 8 Z" fill="#ff7fb0" stroke="#d9578f" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M0 0 L13 -8 Q16 0 13 8 Z" fill="#ff7fb0" stroke="#d9578f" stroke-width="1.2" stroke-linejoin="round"/>
      <circle r="3.6" fill="#ff5c95" stroke="#d9578f" stroke-width="1"/>
    </g>

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
export const skinSVG = (id) => (SKINS[id] || SKINS[DEFAULT_SKIN]).svg;
