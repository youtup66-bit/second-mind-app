// نافذة «تقرير Word» داخل شاشة التقارير: نطاق (قسم، شعبة، وحدة، كرة) + كروبات إضافية، والفترة،
// وخياران: تلخيص بالذكاء (نص فقط)، وتضمين الصور. ثم حفظ الملف أو مشاركته.
import { session } from './cloud.js';
import { TYPES } from './org-structure.js';
import { GENERAL, groupRooms, roomNameOf } from './group.js';
import { saveFile, shareFile } from './native-files.js';
import { structureFor, scopeRooms, preview, buildReport } from './report-build.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function mountDocxReport(box) {
  if (!box) return;
  const s = await session().catch(() => null);
  const orgName = s?.org?.name || 'القسم';
  const st = await structureFor(orgName);
  const nodes = st.nodes.filter((n) => n.id !== 'root' && n.type !== 'personnel' && n.type !== 'employee');
  const roomEntries = [[GENERAL, { name: 'المجموعة العامة' }], ...[...groupRooms().entries()].filter(([id]) => id !== GENERAL)];

  box.innerHTML = `
    <h3>تقرير Word</h3>
    <form class="org-form rep-form" id="dc-form">
      <label class="org-field"><span>النطاق</span>
        <select id="dc-node">
          <option value="root">القسم كله</option>
          ${nodes.map((n) => `<option value="${esc(n.id)}">${esc(TYPES[n.type]?.label || '')} · ${esc(n.name)}</option>`).join('')}
        </select>
      </label>
      <label class="switch"><input type="checkbox" id="dc-below" checked><span>مع كل ما تحتها من كرات وكروبات</span></label>
      <fieldset class="dc-rooms"><legend>كروبات إضافية</legend>
        ${roomEntries.map(([id, r]) => `<label class="switch"><input type="checkbox" name="dc-room" value="${esc(id)}"><span>${esc(r.name || id)}</span></label>`).join('')}
      </fieldset>
      <label class="org-field"><span>الفترة</span>
        <select id="dc-days"><option value="7">آخر أسبوع</option><option value="30">آخر شهر</option></select>
      </label>
      <label class="switch"><input type="checkbox" id="dc-ai" checked><span>تلخيص بالذكاء (يُرسل <b>نص</b> الرسائل فقط إلى Gemini)</span></label>
      <label class="switch"><input type="checkbox" id="dc-images"><span>تضمين الصور في الملف (لا تُرسل إلى أي خدمة)</span></label>
      <p class="muted" id="dc-preview"></p>
      <div class="text-btns"><button class="text-btn" type="submit">إنشاء الملف</button></div>
      <p class="status" id="dc-msg" role="status"></p>
    </form>
    <div id="dc-result"></div>`;

  const form = box.querySelector('#dc-form');
  const msg = box.querySelector('#dc-msg');
  const result = box.querySelector('#dc-result');
  const pv = box.querySelector('#dc-preview');

  // القراءة من النموذج: النطاق والكروبات والفترة
  function read() {
    const nodeId = form.querySelector('#dc-node').value;
    const below = form.querySelector('#dc-below').checked;
    const extra = [...form.querySelectorAll('input[name="dc-room"]:checked')].map((i) => i.value);
    const days = Number(form.querySelector('#dc-days').value) || 7;
    const rooms = scopeRooms(st, { nodeId: nodeId === 'root' ? 'root' : nodeId, below, extra });
    const nodeName = nodeId === 'root' ? orgName : (st.nodes.find((n) => n.id === nodeId)?.name || '');
    const names = [nodeName, ...extra.filter((id) => !(id === GENERAL && nodeId === 'root')).map((id) => roomNameOf(id) || (id === GENERAL ? 'المجموعة العامة' : id))].filter(Boolean);
    return {
      scopeName: nodeName || 'كروبات محددة', rooms, names, days,
      withAi: form.querySelector('#dc-ai').checked,
      withImages: form.querySelector('#dc-images').checked,
    };
  }

  async function refresh() {
    const o = read();
    if (!o.rooms.length) { pv.textContent = 'اختر قسماً أو كروباً.'; return; }
    const p = await preview(o);
    pv.textContent = `${p.count} رسالة في الفترة${p.images ? `، منها ${p.images} صورة` : ''}.`;
  }
  form.addEventListener('change', refresh);
  refresh();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = read();
    if (!o.rooms.length) { msg.textContent = 'اختر قسماً أو كروباً.'; msg.className = 'status status--err'; return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    msg.className = 'status';
    result.innerHTML = '';
    try {
      const { blob, filename, count, images } = await buildReport({ ...o, onStatus: (t) => { msg.textContent = t; } });
      msg.textContent = `جاهز: ${count} رسالة${images ? `، ${o.withImages ? images : 0} صورة مضمّنة` : ''}.`;
      result.innerHTML = `<div class="file-card"><b></b><small>${Math.max(1, Math.round(blob.size / 1024))} ك.ب</small>
        <div class="file-card__actions">
          <button type="button" class="btn btn--ghost" data-act="save">حفظ</button>
          <button type="button" class="btn btn--ghost" data-act="share">مشاركة</button>
        </div></div>`;
      result.querySelector('b').textContent = filename;
      result.querySelector('.file-card').addEventListener('click', async (ev) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        try {
          if (act === 'save') msg.textContent = `حُفظ الملف في ${await saveFile(blob, filename)} ✓`;
          else await shareFile(blob, filename);
        } catch (err) { msg.textContent = err.message || String(err); msg.className = 'status status--err'; }
      });
    } catch (err) {
      msg.textContent = err.message || String(err);
      msg.className = 'status status--err';
    } finally {
      btn.disabled = false;
    }
  });
}
