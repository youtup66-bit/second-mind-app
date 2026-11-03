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

// طلب توليد مع اختيار نموذج بديل تلقائياً إن لم يكن المحفوظ متاحاً
async function generate(body) {
  const key = await getKey();
  let model = await getSetting('geminiModel', DEFAULT_MODEL);
  let data;
  try {
    data = await call(`models/${model}:generateContent`, key, body);
  } catch (err) {
    if (err.code !== 'NO_MODEL') throw err;
    model = await findWorkingModel(key);
    await setSetting('geminiModel', model);
    data = await call(`models/${model}:generateContent`, key, body);
  }
  const text = data?.candidates?.[0]?.content?.parts
    ?.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!text) throw new GeminiError('لم يصلني رد، جرّب مرة أخرى.', 'EMPTY');
  return text;
}

// history: [{ role: 'user'|'model', text }]
// ملاحظة: الحد الأعلى للرموز واسع لأن نماذج التفكير تحتسب تفكيرها منه.
export function chat(history) {
  return generate({
    systemInstruction: { parts: [{ text: PERSONA }] },
    contents: toContents(history),
    generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
  });
}

// ---- التصنيف ----
const CLASSIFIER = `أنت مصنِّف لملاحظات شخصية مكتوبة بالعربية (فصحى أو عامية).
صنّف "الملاحظة الحالية" فقط إلى قسم واحد هو الأنسب، واستعن بالسياق إن كانت قصيرة.
الأقسام:
- worry (قلق): خوف، توتر، همّ، انزعاج من أمر قادم أو حاصل.
- thought (تفكير): تأمل، رأي، تحليل، مشاعر عامة أو وصف لحال اليوم.
- idea (فكرة إبداعية): فكرة مشروع، اختراع، كتابة، تصميم، حل جديد.
- task (مهمة): شيء يجب فعله أو تذكّره، موعد، التزام.
- memory (ذكرى): حدث من الماضي يستعيده.
- gratitude (امتنان): شكر، تقدير، شيء جميل يحمد عليه.
- dream (حلم): حلم منام، أو أمنية وطموح بعيد.
- decision (قرار): قرار اتخذه أو يحسمه أو حيرة بين خيارين.
- question (سؤال): سؤال يشغله أو يريد معرفة جوابه.
- none: تحية أو رد قصير بلا مضمون (مثل: مرحبا، شكراً، تمام).
أعد أيضاً عنواناً قصيراً من ٢ إلى ٦ كلمات يلخّص الملاحظة.`;

const CATEGORY_IDS = ['worry', 'thought', 'idea', 'task', 'memory', 'gratitude', 'dream', 'decision', 'question', 'none'];

// context: رسائل سابقة قصيرة [{ role, text }] للمساعدة في فهم الردود القصيرة
export async function classify(text, context = []) {
  const ctx = context.map((m) => `${m.role === 'user' ? 'المستخدم' : 'الرفيقة'}: ${m.text}`).join('\n');
  const raw = await generate({
    systemInstruction: { parts: [{ text: CLASSIFIER }] },
    contents: [{
      role: 'user',
      parts: [{ text: `${ctx ? `السياق:\n${ctx}\n\n` : ''}الملاحظة الحالية:\n${text}` }],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: CATEGORY_IDS },
          title: { type: 'STRING' },
        },
        required: ['category', 'title'],
      },
    },
  });
  let out;
  try {
    out = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new GeminiError('رد التصنيف غير مفهوم.', 'PARSE');
  }
  const category = CATEGORY_IDS.includes(out.category) ? out.category : 'thought';
  return { category, title: String(out.title || '').trim().slice(0, 60) };
}

// ---- الملخصات ----
const SUMMARIZER = `أنت تكتب ملخصاً شخصياً دافئاً لصاحب مذكرات، بالعربية الفصحى البسيطة وبصيغة المخاطب المحايدة.
ستصلك ملاحظاته خلال فترة معينة، كل سطر فيه التاريخ والقسم والنص.
- اكتب بلطف وصدق، بلا مبالغة ولا وعظ، ولا تخترع أحداثاً غير مذكورة.
- overview: من جملتين إلى أربع تصف ما شغله وكيف بدا حاله.
- themes: من ٢ إلى ٥ مواضيع متكررة، كل واحد بكلمتين أو ثلاث.
- openTasks: المهام التي ذكرها ولم يذكر أنه أنجزها (فارغة إن لم توجد).
- ideas: الأفكار والأحلام التي تستحق العودة إليها (فارغة إن لم توجد).
- gratitude: ما امتنّ له (فارغة إن لم يوجد).
- suggestion: اقتراح واحد صغير عملي ولطيف للفترة القادمة.
- mood: كلمة أو كلمتان تصفان المزاج العام، و moodEmoji: رمز تعبيري واحد يناسبه.`;

const LIST = { type: 'ARRAY', items: { type: 'STRING' } };

// notes: [{ createdAt, categoryLabel, text, done }]
export async function summarize(notes, periodLabel) {
  const fmt = new Intl.DateTimeFormat('ar', { weekday: 'short', day: 'numeric', month: 'short' });
  const lines = notes.map((n) =>
    `- [${fmt.format(n.createdAt)}] (${n.categoryLabel}${n.done ? '، منجزة' : ''}) ${n.text.slice(0, 500).replace(/\s+/g, ' ')}`);
  const raw = await generate({
    systemInstruction: { parts: [{ text: SUMMARIZER }] },
    contents: [{ role: 'user', parts: [{ text: `الفترة: ${periodLabel}\nعدد الملاحظات: ${notes.length}\n\n${lines.join('\n')}` }] }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          headline: { type: 'STRING' },
          mood: { type: 'STRING' },
          moodEmoji: { type: 'STRING' },
          overview: { type: 'STRING' },
          themes: LIST, openTasks: LIST, ideas: LIST, gratitude: LIST,
          suggestion: { type: 'STRING' },
        },
        required: ['headline', 'mood', 'moodEmoji', 'overview', 'themes', 'openTasks', 'ideas', 'gratitude', 'suggestion'],
      },
    },
  });
  try {
    const out = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const arr = (x) => (Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 8) : []);
    return {
      headline: String(out.headline || ''), mood: String(out.mood || ''), moodEmoji: String(out.moodEmoji || '').slice(0, 4),
      overview: String(out.overview || ''), suggestion: String(out.suggestion || ''),
      themes: arr(out.themes), openTasks: arr(out.openTasks), ideas: arr(out.ideas), gratitude: arr(out.gratitude),
    };
  } catch {
    throw new GeminiError('رد الملخص غير مفهوم، جرّب مرة أخرى.', 'PARSE');
  }
}

// للتحقق من المفتاح من الإعدادات
export async function testKey(key) {
  const model = await findWorkingModel(key);
  return model;
}
