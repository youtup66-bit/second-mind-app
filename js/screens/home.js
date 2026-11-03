// شاشة الرفيقة: الشخصية الطافية وفقاعة كلامها (المحادثة في المرحلة ٣)
import { createCompanion } from '../companion.js';

export const title = 'الرفيقة';

const TAP_LINES = [
  'أنا هنا معك 💜',
  'بماذا تفكر الآن؟',
  'احكِ لي، سأحفظ كل شيء.',
  'هيهي، هذا يدغدغ!',
  'عقلك في أمان معي.',
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'سهران؟ أنا معك.';
  if (h < 12) return 'صباح الخير! كيف تشعر اليوم؟';
  if (h < 18) return 'أهلاً! ماذا يدور في بالك؟';
  return 'مساء الخير، كيف كان يومك؟';
}

let companion = null;
let bubbleTimer = 0;

export function mount(root) {
  root.innerHTML = `
    <section class="home">
      <p class="bubble" id="bubble" role="status">${greeting()}</p>
      <div class="home__stage" id="stage"></div>
      <p class="muted home__hint">المس الرفيقة · المحادثة قادمة في المرحلة القادمة</p>
    </section>
  `;
  const bubble = root.querySelector('#bubble');
  let i = 0;

  companion = createCompanion(root.querySelector('#stage'), {
    onTap() {
      say(bubble, TAP_LINES[i++ % TAP_LINES.length]);
    },
  });
}

function say(bubble, text) {
  bubble.classList.remove('is-shown');
  void bubble.offsetWidth; // إعادة تشغيل الحركة
  bubble.textContent = text;
  bubble.classList.add('is-shown');
  clearTimeout(bubbleTimer);
}

export function unmount() {
  companion?.destroy();
  companion = null;
  clearTimeout(bubbleTimer);
}
