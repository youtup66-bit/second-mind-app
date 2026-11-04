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
    id: 'qwen25-05b', engine: 'webllm', modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 (0.5B)', note: 'الأصغر والأسرع، ردوده أبسط.', sizeMB: 400, gpuMB: 945,
  },
  {
    id: 'qwen35-08b', engine: 'webllm', modelId: 'Qwen3.5-0.8B-q4f16_1-MLC',
    label: 'Qwen 3.5 (0.8B)', note: 'الأحدث، يفهم العربية واللهجات أفضل.', sizeMB: 600, gpuMB: 1630, noThinking: true,
  },
  {
    id: 'qwen25-15b', engine: 'webllm', modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
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
let gpuCheck = null;
export function webgpuSupported() {
  gpuCheck ||= (async () => {
    try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
  })();
  return gpuCheck;
}

// ---- حالة التنزيل ----
// WebLLM يعرف بنفسه إن كان النموذج محفوظاً؛ لـ wllama نتذكر ذلك في الإعدادات
async function readyFlags() { return getSetting('localModelsReady', {}); }

export async function isModelReady(model) {
  if (!model) return false;
  if (model.engine === 'webllm') {
    try { return await (await import(WEBLLM_URL)).hasModelInCache(model.modelId); } catch { return !!(await readyFlags())[model.id]; }
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
      if (!(await webgpuSupported())) throw new LocalAIError('جوالك أو متصفحك لا يدعم WebGPU. اختر نموذج "للمعالج".', 'NO_GPU');
      const webllm = await import(WEBLLM_URL);
      const engine = await webllm.CreateMLCEngine(model.modelId, {
        initProgressCallback: (r) => onProgress?.(Math.min(0.99, r.progress || 0), r.text || ''),
      });
      active = { model, kind: 'webllm', engine };
    } else {
      const { Wllama } = await import(WLLAMA_URL);
      const engine = new Wllama({ default: WLLAMA_WASM });
      await engine.loadModelFromUrl(model.url, {
        n_ctx: 2048,
        progressCallback: ({ loaded, total }) => onProgress?.(total ? Math.min(0.99, loaded / total) : 0, ''),
      });
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
    if (model.engine === 'webllm') await (await import(WEBLLM_URL)).deleteModelAllInfoInCache(model.modelId);
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
  const model = await selectedModel();
  if (!model) throw new LocalAIError('لم تختر نموذجاً على الجهاز بعد.', 'NOT_READY');
  if (active?.model.id === model.id) return active;
  if (!(await isModelReady(model))) throw new LocalAIError('النموذج المختار لم يُنزَّل بعد.', 'NOT_READY');
  return prepareModel(model);
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
