// شاشة العقل: الأقسام ككرات مترابطة، حجم الكرة يعبّر عن عدد الملاحظات فيها
import { CATEGORIES } from '../categories.js';
import { getEntries } from '../storage.js';
import { createMindGraph } from '../mind-graph.js';

export const title = 'العقل';

let graph = null;

export async function mount(root) {
  const entries = await getEntries();
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  entries.forEach((e) => { if (e.category in counts) counts[e.category]++; });

  root.innerHTML = `<canvas class="mind-canvas" aria-label="خريطة أقسام عقلك"></canvas>`;
  const canvas = root.querySelector('canvas');

  // نجعل اللوحة تملأ المساحة بين الشريط العلوي والسفلي
  const top = canvas.getBoundingClientRect().top;
  const tabbar = document.querySelector('.tabbar').getBoundingClientRect().height;
  canvas.style.height = `${Math.max(320, innerHeight - top - tabbar - 16)}px`;

  const nodes = [
    { id: 'me', label: 'أنا', color: '#ffffff', weight: 0, fixedR: 22 },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, color: c.color, weight: counts[c.id] })),
  ];
  // كل قسم يتصل بالمركز وبجاره، فتتكون شبكة مترابطة
  const links = CATEGORIES.flatMap((c, i) => [
    ['me', c.id],
    [c.id, CATEGORIES[(i + 1) % CATEGORIES.length].id],
  ]);

  graph = createMindGraph(canvas, nodes, links);
}

export function unmount() {
  graph?.destroy();
  graph = null;
}
