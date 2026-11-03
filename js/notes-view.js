// عرض الملاحظات وأزرارها (نقل، حذف)، مشترك بين شاشة العقل وشاشة المجلد
import { CATEGORIES, NONE, categoryById } from './categories.js';
import { deleteEntry, getEntry, updateEntry } from './storage.js';
import { setCategory } from './classifier.js';

const fmtDate = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// showCategory: يُظهر شارة القسم (في المجلد)؛ في شاشة العقل القسم معروف فلا داعي لها
export function noteHTML(e, { showCategory = false, highlight = '' } = {}) {
  const cat = categoryById(e.category);
  const mark = (s) => {
    const safe = esc(s);
    if (!highlight) return safe;
    const q = esc(highlight).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(q, 'gi'), (m) => `<mark>${m}</mark>`);
  };
  return `
    <li class="note ${e.category === 'task' && e.meta?.done ? 'is-done' : ''}" data-id="${e.id}">
      ${showCategory ? `<span class="chip chip--small chip--static" style="--c:${cat ? cat.color : 'var(--muted)'}">${cat ? cat.label : 'لم تُصنّف بعد'}</span>` : ''}
      ${e.meta?.title ? `<p class="note__title">${mark(e.meta.title)}</p>` : ''}
      <p class="note__text">${mark(e.text)}</p>
      ${e.category === 'task' ? `
        <label class="switch note__done">
          <input type="checkbox" data-act="done" ${e.meta?.done ? 'checked' : ''}><span>أنجزتها</span>
        </label>` : ''}
      <div class="note__foot">
        <time class="muted">${fmtDate.format(e.createdAt)}${e.source === 'voice' ? ' · 🎙' : ''}</time>
        <span class="note__actions">
          <button class="link-btn" data-act="move">نقل</button>
          <button class="link-btn link-btn--danger" data-act="delete">حذف</button>
        </span>
      </div>
      <div class="note__move" hidden>
        ${[...CATEGORIES, NONE].filter((c) => c.id !== e.category).map((c) => `
          <button class="chip chip--tiny" data-cat="${c.id}" style="--c:${c.color}">${c.label}</button>`).join('')}
      </div>
    </li>`;
}

// يربط أزرار الملاحظات داخل container، ويستدعي onChange بعد أي تعديل
export function bindNoteActions(container, onChange) {
  container.addEventListener('click', async (e) => {
    const li = e.target.closest('.note');
    if (!li) return;
    const id = li.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'done') {
      const entry = await getEntry(id);
      entry.meta = { ...entry.meta, done: e.target.checked, doneAt: e.target.checked ? Date.now() : null };
      await updateEntry(entry);
      li.classList.toggle('is-done', e.target.checked);
    } else if (act === 'move') {
      const box = li.querySelector('.note__move');
      box.hidden = !box.hidden;
    } else if (act === 'delete') {
      if (!confirm('حذف هذه الملاحظة نهائياً؟')) return;
      await deleteEntry(id);
      await onChange();
    } else if (e.target.closest('[data-cat]')) {
      await setCategory(id, e.target.closest('[data-cat]').dataset.cat);
      await onChange();
    }
  });
}
