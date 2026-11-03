// خدمة Gemini: الشيء الوحيد الذي يغادر الجهاز هو نص المحادثة.
import { getSetting, setSetting } from './storage.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.6-flash';

const PERSONA = `أنتِ "رفيقة"، رفيقة صغيرة لطيفة بأسلوب الأنمي تعيش في تطبيق "عقلي الثاني".
دورك: الاستماع لصاحبك وهو يفرّغ أفكاره ومشاعره، وتشجيعه على التعبير.
- تحدثي بالعربية بلهجة بسيطة دافئة، وخاطبي المستخدم بصيغة محايدة.
- ردودك قصيرة: جملة إلى ثلاث جمل، بلا قوائم ولا تنسيق.
- اعكسي ما فهمتِه باختصار، ثم اسألي سؤالاً واحداً لطيفاً يساعده على التوسع إن كان مناسباً.
- كل ما يقوله يُحفظ في عقله الثاني، فطمئنيه أنه محفوظ عند الحاجة دون تكرار ذلك كل مرة.
- لستِ طبيبة؛ إن ظهرت علامات خطر على سلامته فشجّعيه بلطف على التواصل مع شخص يثق به أو جهة مختصة.`;

export class GeminiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function getKey() {
  const key = await getSetting('geminiApiKey', '');
  if (!key) throw new GeminiError('لم يُضف مفتاح Gemini بعد.', 'NO_KEY');
  return key;
}

async function call(path, key, body) {
  let res;
  try {
    res = await fetch(`${API}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GeminiError('تعذّر الاتصال. تحقق من الإنترنت.', 'NETWORK');
  }
  const data = await res.json().catch(() => ({}));
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

// ندمج الرسائل المتتالية من نفس الطرف، ونبدأ دائماً برسالة من المستخدم
function toContents(history) {
  const out = [];
  for (const m of history) {
    const last = out[out.length - 1];
    if (last?.role === m.role) last.parts[0].text += `\n${m.text}`;
    else out.push({ role: m.role, parts: [{ text: m.text }] });
  }
  while (out[0]?.role === 'model') out.shift();
  return out;
}

// history: [{ role: 'user'|'model', text }]
export async function chat(history) {
  const key = await getKey();
  let model = await getSetting('geminiModel', DEFAULT_MODEL);
  const body = {
    systemInstruction: { parts: [{ text: PERSONA }] },
    contents: toContents(history),
    generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
  };

  let data;
  try {
    data = await call(`models/${model}:generateContent`, key, body);
  } catch (err) {
    if (err.code !== 'NO_MODEL') throw err;
    model = await findWorkingModel(key);
    await setSetting('geminiModel', model);
    data = await call(`models/${model}:generateContent`, key, body);
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  if (!text) throw new GeminiError('لم يصلني رد، جرّب مرة أخرى.', 'EMPTY');
  return text;
}

// للتحقق من المفتاح من الإعدادات
export async function testKey(key) {
  const model = await findWorkingModel(key);
  return model;
}
