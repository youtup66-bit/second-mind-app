// شاشة الإعدادات: مفتاح Gemini يُحفظ على الجهاز فقط
import { getSetting, setSetting, deleteSetting, clearAll } from '../storage.js';

export const title = 'الإعدادات';

export async function mount(root) {
  const key = await getSetting('geminiApiKey', '');

  root.innerHTML = `
    <section class="card">
      <h2>مفتاح Gemini API</h2>
      <p class="muted">يُحفظ المفتاح على جهازك فقط، ويُستخدم للمحادثة والتصنيف.</p>
      <label for="api-key">المفتاح</label>
      <input id="api-key" type="password" dir="ltr" autocomplete="off" spellcheck="false"
             placeholder="AIza..." value="${key.replace(/"/g, '&quot;')}">
      <div class="row">
        <button class="btn" id="save-key">حفظ</button>
        <button class="btn btn--ghost" id="toggle-key">إظهار</button>
        <button class="btn btn--ghost" id="remove-key">حذف المفتاح</button>
      </div>
      <p class="status" id="key-status" role="status"></p>
    </section>

    <section class="card">
      <h2>الخصوصية</h2>
      <p class="muted">كل ملاحظاتك محفوظة على هذا الجهاز. لا يُرسل شيء للخارج إلا نص المحادثة إلى Gemini عند استخدامها.</p>
      <div class="row">
        <button class="btn btn--danger" id="wipe">مسح كل البيانات</button>
      </div>
      <p class="status" id="wipe-status" role="status"></p>
    </section>
  `;

  const input = root.querySelector('#api-key');
  const keyStatus = root.querySelector('#key-status');
  const show = (el, msg, ok = true) => {
    el.textContent = msg;
    el.className = `status ${ok ? 'status--ok' : 'status--err'}`;
  };

  root.querySelector('#save-key').addEventListener('click', async () => {
    const v = input.value.trim();
    if (!v) return show(keyStatus, 'أدخل المفتاح أولاً.', false);
    await setSetting('geminiApiKey', v);
    show(keyStatus, 'تم حفظ المفتاح على جهازك.');
  });

  root.querySelector('#toggle-key').addEventListener('click', (e) => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    e.currentTarget.textContent = hidden ? 'إخفاء' : 'إظهار';
  });

  root.querySelector('#remove-key').addEventListener('click', async () => {
    await deleteSetting('geminiApiKey');
    input.value = '';
    show(keyStatus, 'تم حذف المفتاح.');
  });

  root.querySelector('#wipe').addEventListener('click', async () => {
    if (!confirm('سيُحذف كل شيء نهائياً من هذا الجهاز. هل أنت متأكد؟')) return;
    await clearAll();
    input.value = '';
    show(root.querySelector('#wipe-status'), 'تم مسح كل البيانات.');
  });
}
