// شاشة العقل: الأقسام ككرات مترابطة (المرحلة ٥)
import { CATEGORIES } from '../categories.js';
import { getEntries } from '../storage.js';

export const title = 'العقل';

export async function mount(root) {
  const entries = await getEntries();
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  entries.forEach((e) => { if (e.category in counts) counts[e.category]++; });

  root.innerHTML = `
    <section class="card">
      <h2>أقسام عقلك</h2>
      <p class="muted">ستتحول هذه الأقسام إلى كرات مترابطة في مرحلة لاحقة.</p>
      <ul class="cat-list">
        ${CATEGORIES.map((c) => `
          <li><span class="cat-dot" style="background:${c.color}"></span>${c.label}
          <span class="muted">(${counts[c.id]})</span></li>`).join('')}
      </ul>
    </section>
  `;
}
