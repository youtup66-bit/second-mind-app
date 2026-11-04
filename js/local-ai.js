// ذكاء على الجهاز: نماذج لغوية صغيرة تُنزَّل مرة واحدة ثم تعمل دون إنترنت ودون أي حصة،
// ولا يغادر كلامك الجهاز إطلاقاً.
//
// محرّكان:
//   - WebLLM: يستخدم كرت الشاشة عبر WebGPU (سريع؛ متاح في Chrome على أغلب الجوالات الحديثة)
//   - wllama (llama.cpp): يعمل على المعالج (أبطأ، لكنه يعمل على أجهزة أكثر)
// المكتبات تُحمَّل من jsDelivr عند أول استخدام، والنماذج من HuggingFace، وكلاهما يُحفظ على الجهاز.
import { getSetting, setSetting } from './storage.js';

const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/lib/index.js';
const WLLAMA_URL = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js';
const WLLAMA_WASM = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/wasm/wllama.wasm';

// sizeMB تقريبي للتنزيل، gpuMB ذاكرة كرت الشاشة المطلوبة تقريباً
export const LOCAL_MODELS = [
  {
    id: 'gemma3-1b', engine: 'webllm', modelId: 'gemma3-1b-it-q4f16_1-MLC',
    label: 'Gemma 3 (1B)', note: 'خفيف ومتوازن، وعربيته جيدة. البداية الموصى بها.', sizeMB: 750, gpuMB: 711, recommended: true,
  },
  {
    id: 'qwen25-05b', engine: 'webllm', modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', f32Id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    label: 'Qwen 2.5 (0.5B)', note: 'الأصغر والأسرع، ردوده أبسط.', sizeMB: 400, gpuMB: 945,
  },
  {
    id: 'qwen35-08b', engine: 'webllm', modelId: 'Qwen3.5-0.8B-q4f16_1-MLC', f32Id: 'Qwen3.5-0.8B-q4f32_1-MLC',
    label: 'Qwen 3.5 (0.8B)', note: 'الأحدث، يفهم العربية واللهجات أفضل.', sizeMB: 600, gpuMB: 1630, noThinking: true,
  },
  {
    id: 'qwen25-15b', engine: 'webllm', modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', f32Id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    label: 'Qwen 2.5 (1.5B)', note: 'الأذكى بينها، للجوالات القوية (ذاكرة 6 جيجا فأكثر).', sizeMB: 1000, gpuMB: 1630,
  },
  {
    id: 'qwen25-05b-cpu', engine: 'wllama',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    label: 'Qwen 2.5 (0.5B) للمعالج', note: 'للجوالات التي لا تدعم WebGPU. أبطأ بوضوح.', sizeMB: 400, gpuMB: 0,
  },
];

export const modelById = (id) => LOCAL_MODELS.find((m) => m.id === id) || null;

export class LocalAIError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// ---- دعم WebGPU ----
// نماذج q4f16 تحتاج ميزة shader-f16 في كرت الشاشة؛ كثير من كروت الجوالات لا تدعمها،
// فنستخدم حينها نسخة q4f32 من النموذج نفسه (أكبر قليلاً في الذاكرة لكنها تعمل)
let gpuCheck = null;
function gpuInfo() {
  gpuCheck ||= (async () => {
    try {
      const adapter = navigator.gpu && (await navigator.gpu.requestAdapter());
      return { ok: !!adapter, f16: !!adapter?.features?.has?.('shader-f16') };
    } catch { return { ok: false, f16: false }; }
  })();
  return gpuCheck;
}
export const webgpuSupported = async () => (await gpuInfo()).ok;
export const shaderF16Supported = async () => (await gpuInfo()).f16;

// المعرّف الفعلي في WebLLM لهذا الجهاز (null إن لم يكن للنموذج نسخة تعمل عليه)
export async function effectiveModelId(model) {
  if (model.engine !== 'webllm') return null;
  if (await shaderF16Supported()) return model.modelId;
  return model.f32Id || null;
}

// هل يعمل النموذج على هذا الجهاز؟ يعيد سبب المنع بالعربية، أو null
export async function blockedReason(model) {
  if (model.engine !== 'webllm') return null;
  if (!(await webgpuSupported())) return 'متصفحك لا يدعم WebGPU؛ استخدم نموذج "للمعالج".';
  if (!(await effectiveModelId(model))) return 'كرت شاشة جوالك لا يدعم هذا النموذج (shader-f16)؛ اختر Qwen.';
  return null;
}

// رسائل الأخطاء الشائعة بالعربية
export function explainError(err) {
  const m = String(err?.message || err || '');
  if (/shader-f16/i.test(m)) return 'كرت شاشة جوالك لا يدعم هذه النسخة من النموذج. اختر نموذج Qwen (سيُستخدم إصدار متوافق تلقائياً).';
  if (/out of memory|OOM|device was lost|DeviceLost|allocation/i.test(m)) return 'ذاكرة الجوال لا تكفي لهذا النموذج. جرّب نموذجاً أصغر، أو أغلق التطبيقات الأخرى.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'يحتاج الاتصال بالإنترنت مرة واحدة لإكمال تجهيز الملفات.';
  if (/WebGPU|navigator.gpu/i.test(m)) return 'متصفحك لا يدعم WebGPU؛ استخدم نموذج "للمعالج".';
  return m || 'خطأ غير معروف';
}

// ---- حالة التنزيل ----
// WebLLM يعرف بنفسه إن كان النموذج محفوظاً؛ لـ wllama نتذكر ذلك في الإعدادات
async function readyFlags() { return getSetting('localModelsReady', {}); }

const MODELS_CACHE = 'second-mind-models';
const BGMAP_CACHE = 'second-mind-bgfetch';

async function cachedBlob(url) {
  try { const r = await (await caches.open(MODELS_CACHE)).match(url); return r ? r.blob() : null; } catch { return null; }
}

export async function isModelReady(model) {
  if (!model) return false;
  if (model.engine === 'wllama' && await cachedBlob(model.url).then((b) => !!b)) return true;
  if (model.engine === 'webllm') {
    const id = await effectiveModelId(model);
    if (!id) return false;
    try { return await (await import(WEBLLM_URL)).hasModelInCache(id); } catch { return !!(await readyFlags())[`${model.id}:${id}`]; }
  }
  return !!(await readyFlags())[model.id];
}

export async function selectedModel() {
  return modelById(await getSetting('localModel', '')) || null;
}

export async function localReady() {
  const m = await selectedModel();
  return !!m && await isModelReady(m);
}

// ---- المحرك النشط (نموذج واحد في الذاكرة) ----
let active = null; // { model, kind, engine }
let loading = null;

async function unloadActive() {
  const a = active;
  active = null;
  try { await (a?.kind === 'webllm' ? a.engine.unload() : a?.engine.exit()); } catch { /* لا شيء */ }
}

// يحمّل النموذج (وينزّله أول مرة). onProgress(0..1, نص)
export async function prepareModel(model, onProgress) {
  if (active?.model.id === model.id) return active;
  if (loading) await loading.catch(() => {});
  loading = (async () => {
    await unloadActive();
    if (model.engine === 'webllm') {
      const blocked = await blockedReason(model);
      if (blocked) throw new LocalAIError(blocked, 'NO_GPU');
      const id = await effectiveModelId(model);
      const webllm = await import(WEBLLM_URL);
      let engine;
      try {
        engine = await webllm.CreateMLCEngine(id, {
          initProgressCallback: (r) => onProgress?.(Math.min(0.99, r.progress || 0), r.text || ''),
        });
      } catch (err) {
        throw new LocalAIError(explainError(err), 'LOAD');
      }
      active = { model, kind: 'webllm', engine };
      await setSetting('localModelsReady', { ...(await readyFlags()), [`${model.id}:${id}`]: true });
    } else {
      const { Wllama } = await import(WLLAMA_URL);
      const engine = new Wllama({ default: WLLAMA_WASM });
      // نزّلناه في الخلفية سابقاً؟ نحمّله من المخزن مباشرة
      const blob = await cachedBlob(model.url);
      if (blob) await engine.loadModel([blob], { n_ctx: 2048 });
      else {
        await engine.loadModelFromUrl(model.url, {
          n_ctx: 2048,
          progressCallback: ({ loaded, total }) => onProgress?.(total ? Math.min(0.99, loaded / total) : 0, ''),
        });
      }
      active = { model, kind: 'wllama', engine };
    }
    await setSetting('localModelsReady', { ...(await readyFlags()), [model.id]: true });
    onProgress?.(1, '');
    return active;
  })();
  try { return await loading; } finally { loading = null; }
}

export async function removeModel(model) {
  if (active?.model.id === model.id) await unloadActive();
  try {
    if (model.engine === 'wllama') await (await caches.open(MODELS_CACHE)).delete(model.url);
    if (model.engine === 'webllm') {
      const webllm = await import(WEBLLM_URL);
      for (const id of [model.modelId, model.f32Id].filter(Boolean)) await webllm.deleteModelAllInfoInCache(id).catch(() => {});
    }
    else {
      const mod = await import(WLLAMA_URL);
      const cm = mod.CacheManager ? new mod.CacheManager() : null;
      const name = cm && await cm.getNameFromURL(model.url);
      if (cm && name) await cm.delete?.(name);
    }
  } catch { /* قد يكون محذوفاً أصلاً */ }
  const flags = await readyFlags();
  delete flags[model.id];
  await setSetting('localModelsReady', flags);
}

// يحمّل النموذج المختار إن لم يكن في الذاكرة (لا ينزّله أبداً من تلقاء نفسه)
async function ensureActive() {
  try { return await ensureActiveRaw(); } catch (err) {
    throw err instanceof LocalAIError ? err : new LocalAIError(explainError(err), 'LOAD');
  }
}
async function ensureActiveRaw() {
  const model = await selectedModel();
  if (!model) throw new LocalAIError('لم تختر نموذجاً على الجهاز بعد.', 'NOT_READY');
  if (active?.model.id === model.id) return active;
  if (!(await isModelReady(model))) throw new LocalAIError('النموذج المختار لم يُنزَّل بعد.', 'NOT_READY');
  return prepareModel(model);
}

// يحفظ مكتبة تشغيل النموذج المختار على الجهاز وأنت متصل، ليعمل دون إنترنت لاحقاً
export async function prefetchRuntime() {
  const model = await selectedModel();
  if (!model || !navigator.onLine) return;
  const urls = model.engine === 'webllm' ? [WEBLLM_URL] : [WLLAMA_URL, WLLAMA_WASM];
  await Promise.all(urls.map((u) => fetch(u).catch(() => {})));
}

// تجهيز مسبق في الخلفية حتى لا يتأخر أول رد
export async function warmUpLocal() {
  try { await ensureActive(); return true; } catch { return false; }
}

const stripThinking = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

// النموذج يخدم طلباً واحداً في كل مرة؛ نصفّ الطلبات حتى لا يتصادم رد وتصنيف
let queue = Promise.resolve();
export function localChat(messages, opts = {}) {
  const run = queue.then(() => localChatNow(messages, opts));
  queue = run.catch(() => {});
  return run;
}

// messages: [{ role: 'system'|'user'|'assistant', content }]. onToken(نص حتى الآن)
async function localChatNow(messages, { onToken, maxTokens = 400, temperature = 0.7 } = {}) {
  const a = await ensureActive();
  let text = '';
  const push = (piece) => {
    if (!piece) return;
    text += piece;
    onToken?.(stripThinking(text));
  };
  if (a.kind === 'webllm') {
    const stream = await a.engine.chat.completions.create({
      messages, stream: true, temperature, max_tokens: maxTokens,
      ...(a.model.noThinking && { extra_body: { enable_thinking: false } }),
    });
    for await (const chunk of stream) push(chunk.choices?.[0]?.delta?.content);
  } else {
    const stream = await a.engine.createChatCompletion({ messages, stream: true, temperature, max_tokens: maxTokens });
    for await (const chunk of stream) push(chunk.choices?.[0]?.delta?.content);
  }
  const out = stripThinking(text);
  if (!out) throw new LocalAIError('لم يخرج رد من النموذج على الجهاز.', 'EMPTY');
  return out;
}

export const activeModelLabel = () => active?.model.label || '';


// ======================================================================
// التنزيل المستمر
// ======================================================================
// ١) في الخلفية (Background Fetch، متاح في Chrome على أندرويد): المتصفح نفسه يتولى التنزيل
//    مع إشعار في شريط الجوال، فيستمر حتى لو خرجت من التطبيق أو أغلقته. عامل الخدمة يحفظ الملفات
//    في المخازن نفسها التي تقرأ منها المكتبة، فيصبح النموذج جاهزاً دون تنزيل جديد.
// ٢) بدونها: تنزيل داخل الصفحة، يستمر أثناء التنقل بين شاشات التطبيق، مع إبقاء الشاشة مضاءة.

export const canBackgroundFetch = 'serviceWorker' in navigator && 'BackgroundFetchManager' in self;
const bgId = (model) => `model:${model.id}`;

// كل ملفات النموذج ومخزن كل منها (بنفس أسماء مخازن WebLLM ومفاتيحها)
async function filesFor(model) {
  if (model.engine === 'wllama') return [{ url: model.url, cache: MODELS_CACHE, size: model.sizeMB * 1e6, exact: false }];
  const webllm = await import(WEBLLM_URL);
  const id = await effectiveModelId(model);
  const rec = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
  if (!rec) throw new LocalAIError('النموذج غير موجود في قائمة المكتبة.', 'NO_MODEL');
  let base = rec.model.endsWith('/') ? rec.model : `${rec.model}/`;
  if (!/\/resolve\/.+\//.test(base)) base += 'resolve/main/';
  const configUrl = new URL('mlc-chat-config.json', base).href;
  const tensorUrl = new URL('tensor-cache.json', base).href;
  const [config, tensors] = await Promise.all([
    fetch(configUrl).then((r) => { if (!r.ok) throw new Error(`config ${r.status}`); return r.json(); }),
    fetch(tensorUrl).then((r) => { if (!r.ok) throw new Error(`tensors ${r.status}`); return r.json(); }),
  ]);
  const files = [
    { url: configUrl, cache: 'webllm/config', size: 4e3 },
    { url: tensorUrl, cache: 'webllm/model', size: 6e4 },
    ...(rec.model_manifest ? [{ url: new URL(rec.model_manifest, base).href, cache: 'webllm/config', size: 4e3 }] : []),
    ...(config.tokenizer_files || []).map((f) => ({ url: new URL(f, base).href, cache: 'webllm/model', size: 4e6 })),
    ...tensors.records.map((r) => ({ url: new URL(r.dataPath, base).href, cache: 'webllm/model', size: r.nbytes || 3e7, exact: !!r.nbytes })),
    { url: rec.model_lib, cache: 'webllm/wasm', size: 6e6 },
  ];
  return files;
}

// الحجم الحقيقي لملف (طلب HEAD)؛ null إن تعذّر
async function exactSize(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const n = Number(r.headers.get('content-length'));
    return r.ok && n > 0 ? n : null;
  } catch { return null; }
}

// هل الملف محفوظ أصلاً (من تنزيل سابق انقطع)؟ نتخطاه فيكمل التنزيل بدل أن يبدأ من الصفر
async function alreadyCached(f) {
  try { return !!(await (await caches.open(f.cache)).match(f.url)); } catch { return false; }
}

// يبدأ التنزيل في الخلفية. يعيد كائن التسجيل (له أحداث progress)
export async function startBackgroundDownload(model) {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.backgroundFetch.get(bgId(model));
  if (existing) return existing;
  const all = await filesFor(model);
  const missing = [];
  for (const f of all) if (!(await alreadyCached(f))) missing.push(f);
  if (!missing.length) throw Object.assign(new LocalAIError('الملفات كلها محفوظة؛ سيُجهَّز النموذج عند أول استخدام.', 'ALREADY'), {});
  // Chrome يلغي التنزيل إن تجاوز الحجمَ المعلن، فنعلن الحجم الحقيقي مع هامش، أو لا نعلنه إن تعذّر معرفته
  let total = 0, known = true;
  for (const f of missing) {
    const n = f.exact ? f.size : await exactSize(f.url);
    if (n) total += n; else { known = false; break; }
  }
  await (await caches.open(BGMAP_CACHE)).put(`./__bgmap/${bgId(model)}`,
    new Response(JSON.stringify(Object.fromEntries(all.map((f) => [f.url, f.cache]))), { headers: { 'Content-Type': 'application/json' } }));
  await setSetting('pendingModelDownload', model.id);
  return reg.backgroundFetch.fetch(bgId(model), missing.map((f) => f.url), {
    title: `تنزيل ${model.label} لعقلي الثاني`,
    icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    ...(known && { downloadTotal: Math.ceil(total * 1.03) }),
  });
}

// كم ملفاً من ملفات النموذج غير محفوظ فعلاً؟ (null إن تعذّر الفحص، كأن لا إنترنت لجلب القائمة)
export async function missingFiles(model) {
  try {
    const files = await filesFor(model);
    const missing = [];
    for (const f of files) if (!(await alreadyCached(f))) missing.push(f.url.split('/').pop());
    return { total: files.length, missing };
  } catch { return null; }
}

// تقرير عامل الخدمة عن آخر تنزيل في الخلفية لهذا النموذج
export async function backgroundReport(model) {
  try {
    const r = await (await caches.open(BGMAP_CACHE)).match(`./__bgresult/${bgId(model)}`);
    return r ? r.json() : null;
  } catch { return null; }
}

// تنزيل بدأ ولم يكتمل (انقطع أو أُلغي)؟ لعرض زر "استئناف"
export async function interruptedDownload() {
  const id = await getSetting('pendingModelDownload', '');
  const model = modelById(id);
  if (!model) return null;
  if (await isModelReady(model)) { await setSetting('pendingModelDownload', ''); return null; }
  if (await backgroundDownload(model)) return null; // ما زال جارياً
  return model;
}

// تنزيل جارٍ في الخلفية لهذا النموذج؟
export async function backgroundDownload(model) {
  if (!canBackgroundFetch) return null;
  try { return await (await navigator.serviceWorker.ready).backgroundFetch.get(bgId(model)); } catch { return null; }
}

export async function cancelBackgroundDownload(model) {
  const bg = await backgroundDownload(model);
  if (bg) await bg.abort();
}

// ---- التنزيل داخل الصفحة (البديل)، بحالة مشتركة تبقى أثناء التنقل بين الشاشات ----
export const downloads = new EventTarget(); // أحداث: progress { id, f, text } و done { id, error? }
const inPage = new Map(); // id ← { f, promise }

export const inPageDownload = (id) => inPage.get(id) || null;

export function downloadInPage(model) {
  if (inPage.has(model.id)) return inPage.get(model.id).promise;
  const state = { f: 0, promise: null };
  inPage.set(model.id, state);
  let lock = null;
  setSetting('pendingModelDownload', model.id);
  state.promise = (async () => {
    // نبقي الشاشة مضاءة حتى لا يتوقف التنزيل حين ينطفئ الجوال
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* غير مدعوم */ }
    try {
      await prepareModel(model, (f, text) => {
        state.f = f;
        downloads.dispatchEvent(new CustomEvent('progress', { detail: { id: model.id, f, text } }));
      });
      downloads.dispatchEvent(new CustomEvent('done', { detail: { id: model.id } }));
    } catch (error) {
      downloads.dispatchEvent(new CustomEvent('done', { detail: { id: model.id, error } }));
      throw error;
    } finally {
      inPage.delete(model.id);
      lock?.release?.().catch(() => {});
    }
  })();
  return state.promise;
}
