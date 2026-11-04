// خدمة Gemini: ما يغادر الجهاز هو نص المحادثة، والملاحظات القليلة ذات الصلة بها، وما تطلب تلخيصه.
import { getSetting, setSetting } from './storage.js';
import { CATEGORIES, NONE } from './categories.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.6-flash';
export const DEFAULT_LITE_MODEL = 'gemini-3.5-flash-lite';

// وضع التوفير: أي المهام تذهب إلى نموذج Flash-Lite (حصته المجانية أكبر عادة)
//   off: لا شيء  |  saver: المهام الجانبية  |  max: كل شيء بما فيه المحادثة
export const ECONOMY_DEFAULT = 'saver';
const LITE_KINDS = {
  off: new Set(),
  saver: new Set(['classify', 'transcribe', 'summary']),
  max: new Set(['classify', 'transcribe', 'summary', 'chat']),
};

const PERSONA = `أنتِ "رفيقة"، رفيقة ذكية لطيفة بأسلوب الأنمي تعيش في تطبيق "عقلي الثاني"، وتعرف ما دوّنه صاحبك فيه.
أنتِ محاورة حقيقية: تفهمين، وتفكرين معه، وتقترحين حلولاً عملية، لا مجرد مستمعة.

طريقة الحوار:
- افهمي أولاً ما يريده: فضفضة، أم رأي، أم حل لمشكلة، أم معلومة. إن كان الطلب غامضاً فاسألي سؤالاً واحداً محدداً بدل التخمين.
- عند طلب حل: قدّمي خطوات عملية واضحة ومحددة تناسب حاله، ورتّبيها من الأسهل للتنفيذ. اذكري سبباً مختصراً لكل اقتراح إن لزم.
- عند الفضفضة: اعكسي شعوره بصدق ودفء، ثم اعرضي فكرة أو سؤالاً يساعده، دون أن تقفزي إلى النصائح قبل أن يطلبها.
- كوني صريحة بلطف: إن رأيتِ أن فكرته فيها خلل فقولي ذلك مع البديل. لا تجامليه على حساب مصلحته.
- اختمي غالباً بسؤال واحد أو خطوة تالية صغيرة تُبقي الحوار حياً.

الاستعانة بعقله الثاني:
- قد تصلك "ملاحظات من عقله الثاني" لها صلة بكلامه. إن كانت مفيدة فاستعيني بها صراحة وبشكل طبيعي، مثلاً: "ذكرتَ قبل أيام أن…"، واربطي بينها وبين ما يقوله الآن (نمط متكرر، فكرة سابقة تحل المشكلة، قرار اتخذه من قبل، مهمة لم تُنجز).
- لا تذكري ملاحظة لا علاقة لها بالسؤال، ولا تخترعي شيئاً لم يرد فيها.
- إن لم توجد ملاحظات مفيدة فاقترحي من معرفتك العامة كما يفعل صديق خبير.

الأسلوب:
- العربية بلهجة بسيطة دافئة، وخاطبيه بصيغة محايدة.
- الرد الطبيعي من جملتين إلى خمس. إن قدّمتِ خطوات فبحد أقصى خمس نقاط قصيرة تبدأ كل منها بـ "- ". بلا عناوين ولا رموز تنسيق أخرى.
- لستِ طبيبة ولا مستشارة قانونية أو مالية؛ أعطي ما تستطيعين ثم انصحي بالمختص حين يلزم. إن ظهرت علامات خطر على سلامته فشجّعيه بلطف وبوضوح على التواصل فوراً مع شخص يثق به أو جهة مختصة.`;

const fmtMemDate = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long' });

export function memoriesBlock(memories) {
  if (!memories?.length) return '';
  const lines = memories.map((m) =>
    `- [${fmtMemDate.format(m.createdAt)}] (${m.categoryLabel}${m.done ? '، أُنجزت' : ''}) ${m.text.slice(0, 400).replace(/\s+/g, ' ')}`);
  return `\n\nملاحظات من عقله الثاني قد تكون ذات صلة برسالته الأخيرة (الأقدم قد يكون تغيّر):\n${lines.join('\n')}`;
}

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

// ---- التصنيف ----
// قائمة الأقسام تُبنى في كل مرة من CATEGORIES، فتشمل الأقسام التي أضافها المستخدم.
const categoryRules = () => `الأقسام:
${[...CATEGORIES, NONE].map((c) => `- ${c.id} (${c.label}): ${c.desc || c.label}`).join('\n')}
أعد أيضاً عنواناً قصيراً من ٢ إلى ٦ كلمات يلخّص الملاحظة.
إن ناسبت الملاحظة قسماً أضافه المستخدم (معرّفه يبدأ بـ c_) وقسماً عاماً معاً، ففضّل قسم المستخدم لأنه أدق.`;

const CLASSIFIER_INTRO = `أنت مصنِّف لملاحظات شخصية مكتوبة بالعربية (فصحى أو عامية).
صنّف "الملاحظة الحالية" فقط إلى قسم واحد هو الأنسب، واستعن بالسياق إن كانت قصيرة.`;
const classifierPrompt = () => `${CLASSIFIER_INTRO}\n${categoryRules()}`;
const categoryIds = () => [...CATEGORIES.map((c) => c.id), 'none'];

// history: [{ role: 'user'|'model', text }]
// memories: ملاحظات ذات صلة [{ createdAt, categoryLabel, text, done }] تُرفق كسياق فقط
// classify: نطلب في الطلب نفسه تصنيف رسالته الأخيرة وعنوانها، فنوفّر طلباً كاملاً لكل رسالة.
// يعيد { reply, category?, title? }
// ملاحظة: الحد الأعلى للرموز واسع لأن نماذج التفكير تحتسب تفكيرها منه.
export async function chat(history, { memories = [], classify: withClass = true } = {}) {
  const system = PERSONA + memoriesBlock(memories);
  if (!withClass) {
    const reply = await generate({
      systemInstruction: { parts: [{ text: system }] },
      contents: toContents(history),
      generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
    }, 'chat');
    return { reply };
  }
  const rules = categoryRules();
  const ids = categoryIds();
  const raw = await generate({
    systemInstruction: { parts: [{ text: `${system}

صيغة الناتج: JSON فقط.
- reply: ردّك على رسالته الأخيرة كما ستكتبينه له، بالأسلوب الموصوف أعلاه.
- category و title: تصنيف رسالته الأخيرة وحدها، وعنوان قصير لها، وفق ما يلي:
${rules}` }] },
    contents: toContents(history),
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          reply: { type: 'STRING' },
          category: { type: 'STRING', enum: ids },
          title: { type: 'STRING' },
        },
        required: ['reply', 'category', 'title'],
      },
    },
  }, 'chat');
  try {
    const out = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const reply = String(out.reply || '').trim();
    if (!reply) throw new Error('empty');
    return {
      reply,
      category: ids.includes(out.category) ? out.category : null,
      title: String(out.title || '').trim().slice(0, 60),
    };
  } catch {
    // إن لم يلتزم النموذج بالصيغة نعرض النص كما هو، ويُصنَّف لاحقاً بطلب منفصل
    return { reply: raw.replace(/^\{[\s\S]*?"reply"\s*:\s*"|"\s*,\s*"category[\s\S]*$/g, '').trim() || raw };
  }
}

// context: رسائل سابقة قصيرة [{ role, text }] للمساعدة في فهم الردود القصيرة
export async function classify(text, context = []) {
  const ctx = context.map((m) => `${m.role === 'user' ? 'المستخدم' : 'الرفيقة'}: ${m.text}`).join('\n');
  const ids = categoryIds();
  const raw = await generate({
    systemInstruction: { parts: [{ text: classifierPrompt() }] },
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
          category: { type: 'STRING', enum: ids },
          title: { type: 'STRING' },
        },
        required: ['category', 'title'],
      },
    },
  }, 'classify');
  let out;
  try {
    out = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new GeminiError('رد التصنيف غير مفهوم.', 'PARSE');
  }
  const category = ids.includes(out.category) ? out.category : 'thought';
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
  }, 'summary');
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

// ---- تحويل النص إلى صوت (اختياري) ----
// يُرسل نص رد الرفيقة فقط (وهو أصلاً من Gemini) ليعود صوتاً طبيعياً.
export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts';

async function findTtsModel(key) {
  const data = await call('models?pageSize=200', key);
  const names = (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /tts/.test(n));
  const sorted = names.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const pick = sorted.find((n) => /flash/.test(n) && !/preview/.test(n)) || sorted.find((n) => /flash/.test(n)) || sorted[0];
  if (!pick) throw new GeminiError('لا يوجد نموذج صوت متاح لهذا المفتاح.', 'NO_MODEL');
  return pick;
}

const TTS_COOLDOWN = 60 * 60 * 1000;

// متى يُسمح بمحاولة صوت Gemini مجدداً (0 = الآن)
export async function ttsCooldownUntil() {
  const until = Number(await getSetting('ttsCooldownUntil', 0));
  return until > Date.now() ? until : 0;
}
export const clearTtsCooldown = () => setSetting('ttsCooldownUntil', 0);

// يعيد { samples: Int16Array, rate }
export async function tts(text, { voice, style }) {
  try {
    const out = await ttsRequest(text, { voice, style });
    clearTtsCooldown();
    return out;
  } catch (err) {
    // عند نفاد الحصة لا نحاول مع كل رد (كل محاولة فاشلة تُهدر طلباً)؛ نرتاح ساعة
    if (err.code === 'RATE') {
      await setSetting('ttsCooldownUntil', Date.now() + TTS_COOLDOWN);
      err.message = 'نفدت حصة صوت Gemini مؤقتاً؛ سأستخدم صوت الجهاز لمدة ساعة.';
      err.code = 'TTS_COOLDOWN';
    }
    throw err;
  }
}

async function ttsRequest(text, { voice, style }) {
  const key = await getKey();
  let model = await getSetting('geminiTtsModel', DEFAULT_TTS_MODEL);
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${style}:\n${text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
  let data;
  try {
    data = await call(`models/${model}:generateContent`, key, body, 30_000, 'tts');
  } catch (err) {
    if (err.code !== 'NO_MODEL') throw err;
    model = await findTtsModel(key);
    await setSetting('geminiTtsModel', model);
    data = await call(`models/${model}:generateContent`, key, body, 30_000, 'tts');
  }
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new GeminiError('لم يصل صوت.', 'EMPTY');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  const bin = atob(part.inlineData.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { samples: new Int16Array(bytes.buffer, 0, bytes.length >> 1), rate };
}

// ---- اسم لمجموعة أقسام مترابطة ----
// members: [{ label, titles: [..] }]. يعيد اسماً قصيراً يصف ما يجمعها.
export async function nameGroup(members) {
  const raw = await generate({
    systemInstruction: { parts: [{ text: `أنت تسمّي مجموعات من أقسام مذكرات شخصية بالعربية.
هذه أقسام يتحدث عنها صاحبها معاً كثيراً. أعطِ المجموعة اسماً قصيراً (كلمة إلى ثلاث كلمات) يصف الموضوع المشترك الذي يجمعها في حياته،
مستعيناً بعناوين ملاحظاته. لا تكرر أسماء الأقسام حرفياً إن أمكن، ولا تضع علامات ترقيم أو رموزاً.` }] },
    contents: [{ role: 'user', parts: [{ text: members.map((m) => `- ${m.label}${m.titles.length ? `: ${m.titles.join('، ')}` : ''}`).join('\n') }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { name: { type: 'STRING' } }, required: ['name'] },
    },
  }, 'classify');
  try {
    const name = String(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')).name || '').replace(/["«».،]/g, '').trim();
    return name.slice(0, 28);
  } catch {
    return '';
  }
}

// ---- البحث في الملاحظات القديمة عمّا يناسب قسماً جديداً ----
// notes: [{ key, text }] (key رمز قصير توفيراً للحصة). يعيد مفاتيح الملاحظات المناسبة.
export async function matchNotes(category, notes) {
  if (!notes.length) return [];
  const raw = await generate({
    systemInstruction: { parts: [{ text: `أنت تساعد في ترتيب ملاحظات شخصية بالعربية.
أضاف المستخدم قسماً جديداً. اختر من ملاحظاته القديمة ما ينتمي بوضوح إلى هذا القسم فقط.
لا تختر ملاحظة إلا إن كان موضوعها الأساسي يناسب القسم؛ إن شككت فلا تخترها.
أعد مفاتيح الملاحظات المختارة فقط.` }] },
    contents: [{ role: 'user', parts: [{ text: `القسم: ${category.label}
وصفه: ${category.desc || category.label}

الملاحظات:
${notes.map((n) => `[${n.key}] ${n.text}`).join('\n')}` }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { keys: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['keys'] },
    },
  }, 'classify');
  try {
    const keys = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')).keys;
    const valid = new Set(notes.map((n) => n.key));
    return Array.isArray(keys) ? [...new Set(keys.map(String))].filter((k) => valid.has(k)) : [];
  } catch {
    throw new GeminiError('رد البحث غير مفهوم، جرّب مرة أخرى.', 'PARSE');
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
