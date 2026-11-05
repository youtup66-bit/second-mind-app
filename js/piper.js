// صوت Piper العربي ("كريم") يعمل داخل التطبيق على الجهاز نفسه:
// - يُنزَّل النموذج مرة واحدة (~٦٠ ميغابايت) ويُحفظ على الجهاز، ثم يعمل دون إنترنت ودون أي حصة.
// - لا يُرسل أي نص إلى أي جهة؛ التحويل إلى صوت يحدث في المتصفح.
// - نُبقي النموذج محمّلاً في الذاكرة بعد أول استخدام، فتصبح الجمل التالية أسرع بكثير.
//
// المكوّنات تُحمَّل من jsDelivr عند أول استخدام فقط (ثم يخزّنها المتصفح):
//   onnxruntime-web (تشغيل النموذج) + piper_phonemize (تحويل النص العربي إلى أصوات لغوية عبر espeak-ng)
// النموذج نفسه من مستودع أصوات Piper على HuggingFace.

const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
const PHONEMIZE_JS = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js';
const PHONEMIZE_BUILD = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const VOICE = {
  id: 'ar_JO-kareem-low',
  model: 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/ar/ar_JO/kareem/low/ar_JO-kareem-low.onnx',
  config: 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/ar/ar_JO/kareem/low/ar_JO-kareem-low.onnx.json',
  approxMB: 61,
};
const CACHE = 'second-mind-piper-v1';

export const piperVoice = VOICE;
export const canPiper = typeof WebAssembly === 'object' && 'caches' in window;

// ---- التنزيل والتخزين ----
async function cached(url) {
  try { return await (await caches.open(CACHE)).match(url); } catch { return null; }
}

export async function isPiperReady() {
  return !!((await cached(VOICE.model)) && (await cached(VOICE.config)));
}

// onProgress(0..1). يُستأنف من البداية إن انقطع (الملف يُحفظ كاملاً فقط)
export async function downloadPiper(onProgress) {
  const cache = await caches.open(CACHE);
  const cfg = await fetch(VOICE.config);
  if (!cfg.ok) throw new Error(`تعذّر تنزيل إعدادات الصوت (${cfg.status}).`);
  await cache.put(VOICE.config, cfg);

  const res = await fetch(VOICE.model);
  if (!res.ok || !res.body) throw new Error(`تعذّر تنزيل الصوت (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || VOICE.approxMB * 1024 * 1024;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(0.99, got / total));
  }
  await cache.put(VOICE.model, new Response(new Blob(chunks), { headers: { 'Content-Type': 'application/octet-stream' } }));
  // نجهّز المكوّنات الأخرى أيضاً ليعمل الصوت لاحقاً دون إنترنت
  await Promise.all([`${PHONEMIZE_BUILD}.wasm`, `${PHONEMIZE_BUILD}.data`, PHONEMIZE_JS].map((u) => fetch(u).then((r) => r.ok && cache.put(u, r)).catch(() => {})));
  onProgress?.(1);
}

export async function removePiper() {
  engine = null;
  try { await caches.delete(CACHE); } catch { /* لا شيء */ }
}

// يجلب من المخزن أولاً ثم من الشبكة
async function fetchCached(url) {
  const hit = await cached(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`تعذّر تحميل ${url.split('/').pop()} (${res.status})`);
  return res;
}

// ---- المحرك (يُحمَّل مرة واحدة) ----
let engine = null;

async function loadEngine() {
  if (engine) return engine;
  engine = (async () => {
    if (!(await isPiperReady())) throw Object.assign(new Error('صوت Piper لم يُنزَّل بعد.'), { code: 'NOT_READY' });
    const ort = await import(/* @vite-ignore */ `${ORT_BASE}esm/ort.min.js`);
    ort.env.wasm.wasmPaths = ORT_BASE;
    // بلا عزل عبر المصادر (GitHub Pages) لا تتوفر الخيوط المتعددة؛ خيط واحد يكفي لنموذج صغير
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const config = await (await fetchCached(VOICE.config)).json();
    const model = await (await fetchCached(VOICE.model)).arrayBuffer();
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    const { createPiperPhonemize } = await import(/* @vite-ignore */ PHONEMIZE_JS);
    // ملفات المحلل اللغوي: من المخزن إن وُجدت (للعمل دون إنترنت)
    const blobUrl = async (u) => URL.createObjectURL(await (await fetchCached(u)).blob());
    const files = { wasm: await blobUrl(`${PHONEMIZE_BUILD}.wasm`), data: await blobUrl(`${PHONEMIZE_BUILD}.data`) };
    return { ort, config, session, createPiperPhonemize, files };
  })();
  try { return await engine; } catch (err) { engine = null; throw err; }
}

// نص عربي ← أرقام الأصوات اللغوية لكل جملة (espeak-ng عبر piper_phonemize)
async function phonemize(eng, sentences) {
  const out = [];
  const mod = await eng.createPiperPhonemize({
    print: (line) => { try { out.push(JSON.parse(line).phoneme_ids); } catch { /* سطر غير متوقع */ } },
    printErr: () => {},
    locateFile: (f) => (f.endsWith('.wasm') ? eng.files.wasm : f.endsWith('.data') ? eng.files.data : f),
  });
  mod.callMain(['-l', eng.config.espeak.voice, '--input', JSON.stringify(sentences.map((text) => ({ text }))), '--espeak_data', '/espeak-ng-data']);
  return out;
}

// يعيد مقطعاً صوتياً { samples: Float32Array, rate } لكل جملة، بالتتابع (الأولى تجهز أسرع)
export async function* synthesize(sentences) {
  const eng = await loadEngine();
  const ids = await phonemize(eng, sentences);
  const { noise_scale: ns, length_scale: ls, noise_w: nw } = eng.config.inference;
  const rate = eng.config.audio.sample_rate;
  for (const p of ids) {
    if (!p?.length) continue;
    const feeds = {
      input: new eng.ort.Tensor('int64', BigInt64Array.from(p.map(BigInt)), [1, p.length]),
      input_lengths: new eng.ort.Tensor('int64', BigInt64Array.from([BigInt(p.length)]), [1]),
      scales: new eng.ort.Tensor('float32', Float32Array.from([ns, ls, nw]), [3]),
    };
    const { output } = await eng.session.run(feeds);
    yield { samples: output.data, rate };
  }
}

// تجهيز مسبق (لتسريع أول رد): يحمّل النموذج في الذاكرة دون نطق
export async function warmUpPiper() {
  try { await loadEngine(); return true; } catch { return false; }
}
