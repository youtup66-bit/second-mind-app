// ورقة الدخول (A43): بعد أول دخول بالرابط يعرض التطبيق ورقة للمستخدم فيها اسمه واسم دخوله ورابط التطبيق
// وخانة يكتب فيها كلمة مروره بخط يده. لا تُحفظ كلمة المرور في الورقة ولا الأسئلة السرية (قرار المستخدم).
// تُفتح للطباعة، فيحفظها المستخدم PDF من نافذة الطباعة أو يطبعها.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function kitHTML({ org, name, username, url, date = new Date() }) {
  const day = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>ورقة الدخول: ${esc(name)}</title>
<style>
  @page { size: A5; margin: 14mm; }
  body { font-family: Tajawal, "Segoe UI", Tahoma, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  .org { font-size: 12pt; color: #555; margin: 0 0 18pt; }
  .row { display: flex; border-bottom: 1px solid #999; padding: 10pt 0; font-size: 13pt; gap: 10pt; }
  .row b { min-width: 90pt; }
  .pw { height: 42pt; border-bottom: 1px solid #111; margin-top: 26pt; position: relative; }
  .pw span { position: absolute; top: -14pt; font-size: 11pt; color: #555; }
  .url { direction: ltr; text-align: left; word-break: break-all; font-size: 12pt; }
  ul { font-size: 11.5pt; line-height: 1.7; padding-inline-start: 18pt; margin-top: 18pt; }
  .warn { margin-top: 18pt; border: 1px solid #b45309; padding: 8pt; font-size: 11pt; }
  .foot { margin-top: 22pt; font-size: 9.5pt; color: #777; }
</style></head><body>
  <h1>ورقة الدخول</h1>
  <p class="org">${esc(org)} · ${esc(day)}</p>
  <div class="row"><b>الاسم</b><span>${esc(name)}</span></div>
  <div class="row"><b>اسم الدخول</b><span dir="ltr">${esc(username)}</span></div>
  <div class="row"><b>رابط التطبيق</b><span class="url">${esc(url)}</span></div>
  <div class="pw"><span>كلمة المرور (اكتبها بخط يدك):</span></div>
  <ul>
    <li>ادخل من الرابط أعلاه، ثم اختر «الدخول إلى المؤسسة».</li>
    <li>اسم الدخول كما هو في هذه الورقة، وكلمة المرور التي كتبتها.</li>
    <li>احتفظ بهذه الورقة في مكان آمن. من يملكها يستطيع الدخول بحسابك.</li>
  </ul>
  <p class="warn">إن نسيت كلمة المرور اطلب من مسؤولك رابط استعادة جديداً. لا تُرسل كلمة المرور إلى أحد.</p>
  <p class="foot">عقلي الثاني · ورقة تُطبع أو تُحفظ مرة واحدة</p>
</body></html>`;
}

// يفتح الورقة في نافذة للطباعة (من ينقر «حفظ» فيها يختار PDF)
export function openKit(data) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(kitHTML(data));
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* المتصفح يسمح بالطباعة يدوياً */ } }, 500);
  return true;
}
