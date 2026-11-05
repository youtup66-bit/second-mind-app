// خدمة Gemini (للمدير فقط): احتساب النقاط من منشورات الأعمال، وتفريغ كلامه إلى نص.
// المفتاح على جهاز المدير فقط، ولا يُرسل إلا نص المنشور أو التسجيل المطلوب تفريغه.
import { getSetting, setSetting } from './storage.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.6-flash';
export const DEFAULT_LITE_MODEL = 'gemini-3.5-flash-lite';

// وضع التوفير: أي المهام تذهب إلى نموذج Flash-Lite (حصته المجانية أكبر عادة)
//   off: لا شيء  |  saver: احتساب النقاط وتفريغ الكلام
export const ECONOMY_DEFAULT = 'saver';
const LITE_KINDS = {
  off: new Set(),
  saver: new Set(['classify', 'transcribe', 'summary']),
  max: new Set(['classify', 'transcribe', 'summary']),
};

export class GeminiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function getKey() {
  const key = await getSetting('geminiApiKey', '');
  if (!key) throw new GeminiError('لم يُضف مفتاح Gemini بعد.', 'NO_KEY');
  return key;
}

// ---- عدّاد الطلبات (على الجهاز فقط) ----
// يحفظ لكل يوم عدد الطلبات من كل نوع: ناجحة، ومرفوضة لتجاوز الحد. نحتفظ بآخر ٧ أيام.
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let usageQueue = Promise.resolve();

function track(kind, outcome) {
  usageQueue = usageQueue.then(async () => {
    const u = await getSetting('usage', { days: {} });
    const k = dayKey();
    const day = (u.days[k] ||= {});
    const row = (day[kind] ||= { ok: 0, limited: 0, error: 0 });
    row[outcome]++;
    const keep = Object.keys(u.days).sort().slice(-7);
    u.days = Object.fromEntries(keep.map((d) => [d, u.days[d]]));
    await setSetting('usage', u);
  }).catch(() => {});
  return usageQueue;
}

export async function getUsage() {
  await usageQueue;
  const u = await getSetting('usage', { days: {} });
  return { today: u.days[dayKey()] || {}, days: u.days };
}

// كل طلب له مهلة، حتى لا تبقى الرفيقة "تفكر" إلى الأبد إن تعلّق الاتصال
// kind: نوع الطلب للعدّاد (chat, classify, summary, transcribe, tts, other)
async function call(path, key, body, timeoutMs = 60_000, kind = 'other') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res, data;
  try {
    res = await fetch(`${API}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    if (err?.name === 'AbortError') throw new GeminiError('تأخر الرد كثيراً، جرّب مرة أخرى.', 'TIMEOUT');
    throw new GeminiError('تعذّر الاتصال. تحقق من الإنترنت.', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  track(kind, res.ok ? 'ok' : res.status === 429 ? 'limited' : 'error');
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new GeminiError('المفتاح غير صالح.', 'BAD_KEY');
    if (res.status === 403) throw new GeminiError('المفتاح لا يملك صلاحية.', 'BAD_KEY');
    if (res.status === 404) throw new GeminiError('النموذج غير متاح.', 'NO_MODEL');
    if (res.status === 429) throw new GeminiError('تجاوزت الحد المسموح، حاول بعد قليل.', 'RATE');
    throw new GeminiError(msg, 'API');
  }
  return data;
}

// يختار نموذج Flash متاحاً لهذا المفتاح إن لم يعمل النموذج المحفوظ
export async function findWorkingModel(key) {
  const data = await call('models?pageSize=200', key);
  const ok = (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /flash/.test(n) && !/(image|tts|audio|live|embed|preview|exp)/.test(n));
  const pick = ok.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    .find((n) => !/lite/.test(n)) || ok[0];
  if (!pick) throw new GeminiError('لم أجد نموذجاً مناسباً لهذا المفتاح.', 'NO_MODEL');
  return pick;
}

// يختار أحدث نموذج Flash-Lite متاح لهذا المفتاح
async function findLiteModel(key) {
  const data = await call('models?pageSize=200', key);
  const lite = (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /flash-lite/.test(n) && !/(image|tts|audio|live|embed|exp)/.test(n))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  return lite.find((n) => !/preview/.test(n)) || lite[0] || null;
}

export async function economyMode() {
  const m = await getSetting('economyMode', ECONOMY_DEFAULT);
  return LITE_KINDS[m] ? m : ECONOMY_DEFAULT;
}

// إن نفدت حصة النموذج الخفيف نرتاح منه ١٥ دقيقة بدل أن نفشل معه في كل طلب
const LITE_COOLDOWN = 15 * 60 * 1000;

async function useLite(kind) {
  if (!LITE_KINDS[await economyMode()].has(kind)) return false;
  return Number(await getSetting('liteCooldownUntil', 0)) <= Date.now();
}

// طلب على نموذج معيّن، مع البحث عن بديل إن لم يكن متاحاً لهذا المفتاح
async function callModel(tier, key, body, kind) {
  const setting = tier === 'lite' ? 'geminiLiteModel' : 'geminiModel';
  let model = await getSetting(setting, tier === 'lite' ? DEFAULT_LITE_MODEL : DEFAULT_MODEL);
  try {
    return await call(`models/${model}:generateContent`, key, body, 60_000, kind);
  } catch (err) {
    if (err.code !== 'NO_MODEL') throw err;
    model = tier === 'lite' ? await findLiteModel(key) : await findWorkingModel(key);
    if (!model) throw err; // لا يوجد Flash-Lite لهذا المفتاح
    await setSetting(setting, model);
    return call(`models/${model}:generateContent`, key, body, 60_000, kind);
  }
}

// طلب توليد: يختار النموذج حسب وضع التوفير، ويعود إلى النموذج الرئيسي إن تعذّر الخفيف
async function generate(body, kind = 'other') {
  const key = await getKey();
  let data;
  if (await useLite(kind)) {
    try {
      data = await callModel('lite', key, body, kind);
    } catch (err) {
      if (!['NO_MODEL', 'RATE'].includes(err.code)) throw err;
      if (err.code === 'RATE') await setSetting('liteCooldownUntil', Date.now() + LITE_COOLDOWN);
      data = await callModel('main', key, body, kind);
    }
  } else {
    data = await callModel('main', key, body, kind);
  }
  const text = data?.candidates?.[0]?.content?.parts
    ?.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!text) throw new GeminiError('لم يصلني رد، جرّب مرة أخرى.', 'EMPTY');
  return text;
}

// ---- نقاط المؤسسة: هل تذكر رسالة الموظف إنجاز عمل من قائمة الأعمال؟ ----
// works: [{ key, name }] · يعيد [{ key, count }] للأعمال التي أُنجزت فعلاً فقط
export async function detectWorks(text, works) {
  if (!works.length || !String(text).trim()) return [];
  const raw = await generate({
    systemInstruction: { parts: [{ text: `أنت تساعد مدير مؤسسة في احتساب نقاط موظفيه من رسائلهم في مجموعة العمل.
لديك قائمة أعمال. حدّد هل تقول الرسالة إن مرسلها أنجز عملاً منها فعلاً (فعل ماضٍ أو "خلصت/أنجزت/سويت/ركبت/صلّحت...").
لا تحتسب الخطط أو الطلبات أو الأسئلة أو الأعمال المنسوبة لغيره. إن شككت فلا تحتسب.
count: عدد المرات المذكورة صراحة (مثل "ثلاث كاميرات" = 3)، وإلا 1.` }] },
    contents: [{ role: 'user', parts: [{ text: `الأعمال:
${works.map((w) => `[${w.key}] ${w.name}`).join('\n')}

الرسالة:
${text}` }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { done: { type: 'ARRAY', items: { type: 'OBJECT', properties: { key: { type: 'STRING' }, count: { type: 'INTEGER' } }, required: ['key', 'count'] } } },
        required: ['done'],
      },
    },
  }, 'classify');
  try {
    const done = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')).done;
    const valid = new Set(works.map((w) => w.key));
    return (Array.isArray(done) ? done : [])
      .filter((d) => valid.has(String(d.key)))
      .map((d) => ({ key: String(d.key), count: Math.min(50, Math.max(1, Math.round(Number(d.count) || 1))) }));
  } catch {
    throw new GeminiError('رد احتساب النقاط غير مفهوم.', 'PARSE');
  }
}

// ---- تفريغ الكلام إلى نص ----
// يُرسل التسجيل الصوتي إلى Gemini (بديل خدمة الكلام في المتصفح التي لا تعمل على بعض الجوالات).
const TRANSCRIBER = `فرّغ هذا التسجيل الصوتي إلى نص عربي حرفياً كما قيل، فصحى كان أو عامية، مع علامات ترقيم بسيطة.
لا تترجم ولا تلخّص ولا تعلّق ولا تضف أي شيء. إن لم يكن فيه كلام مفهوم فأعد نصاً فارغاً تماماً.`;

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function transcribe(blob) {
  const mimeType = (blob.type || 'audio/webm').split(';')[0];
  const text = await generate({
    systemInstruction: { parts: [{ text: TRANSCRIBER }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: await blobToBase64(blob) } }, { text: 'فرّغ التسجيل.' }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048 },
  }, 'transcribe').catch((err) => { if (err.code === 'EMPTY') return ''; throw err; });
  return text.replace(/^["«]|["»]$/g, '').trim();
}

// للتحقق من المفتاح من الإعدادات
export async function testKey(key) {
  const model = await findWorkingModel(key);
  return model;
}
