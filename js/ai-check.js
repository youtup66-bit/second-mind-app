// فحص دعم الذكاء على الجهاز: يعمل دون إنترنت، ويعرض ما يدعمه المتصفح أو الغلاف
export async function aiCheck() {
  const rows = [];
  const row = (name, ok, detail = '') => rows.push(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);

  let gpuOk = false, f16 = false, gpuName = '';
  try {
    if (navigator.gpu) {
      const a = await navigator.gpu.requestAdapter();
      gpuOk = !!a;
      f16 = !!a?.features?.has?.('shader-f16');
      gpuName = a?.info?.description || a?.info?.device || '';
    }
  } catch (e) { gpuName = String(e.message || e).slice(0, 80); }
  row('WebGPU (تسريع الكرت)', gpuOk, gpuName || (navigator.gpu ? 'لا يوجد كرت متاح' : 'غير موجود في هذا المتصفح'));
  row('shader-f16 (النموذج السريع)', f16);

  const sw = navigator.serviceWorker;
  row('Service Worker', !!sw, sw ? (sw.controller ? 'مفعّل' : 'غير مفعّل على هذه الصفحة') : 'غير مدعوم');
  row('Background Fetch (التنزيل في الخلفية)', !!(sw && 'backgroundFetch' in ServiceWorkerRegistration.prototype));
  row('Cache API (تخزين النموذج)', !!window.caches);
  row('IndexedDB', !!window.indexedDB);
  row('WebAssembly (نموذج المعالج)', typeof WebAssembly === 'object');

  try {
    const e = await navigator.storage.estimate();
    const free = (e.quota || 0) - (e.usage || 0);
    row('مساحة التخزين المتاحة', free > 2e9, `${(free / 1e9).toFixed(1)} جيغابايت`);
  } catch { row('مساحة التخزين', false, 'تعذّر قياسها'); }

  row('الاتصال بالإنترنت', navigator.onLine, navigator.onLine ? 'متصل' : 'غير متصل (الفحص يعمل دون إنترنت)');
  row('البيئة', true, /wv\b/.test(navigator.userAgent) ? 'Android WebView (الغلاف)' : 'متصفح');
  return rows.join('\n');
}
