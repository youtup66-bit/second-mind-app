// موجّه الذكاء: يقرر لكل طلب هل يذهب إلى Gemini (سحابي) أم إلى النموذج على الجهاز.
//   gemini: دائماً Gemini
//   local : دائماً على الجهاز (لا يغادر شيء الجهاز)
//   auto  : Gemini عادةً، وعلى الجهاز عند انقطاع الإنترنت أو نفاد الحصة أو غياب المفتاح
import { getSetting } from './storage.js';
import { chat as geminiChat, classify as geminiClassify, memoriesBlock } from './gemini.js';
import { localChat, localReady, explainError, gpuUnavailable, gpuDeadError } from './local-ai.js';
import { CATEGORIES, NONE } from './categories.js';

export const AI_MODE_DEFAULT = 'auto';
const FALLBACK_CODES = new Set(['NETWORK', 'RATE', 'TIMEOUT', 'NO_KEY', 'BAD_KEY']);

// هل يمكن الرجوع إلى Gemini إن فشل النموذج على الجهاز؟ (الوضع التلقائي فقط)
const geminiAvailable = async (mode) => mode === 'auto' && navigator.onLine && !!(await getSetting('geminiApiKey', ''));
// خطأ محلي بصياغة عربية مفهومة
const localError = (err) => Object.assign(new Error(explainError(err)), { code: err.code || 'LOCAL_FAIL' });

// شخصية مختصرة تناسب النماذج الصغيرة (التعليمات الطويلة تربكها)
const LOCAL_PERSONA = `أنتِ "رفيقة"، رفيقة لطيفة ذكية في تطبيق "عقلي الثاني". تحدثي بالعربية البسيطة الدافئة، وخاطبي المستخدم بصيغة محايدة.
- ردّي باختصار: من جملتين إلى أربع.
- إن طلب حلاً فأعطيه خطوات عملية قصيرة تبدأ كل منها بـ "- ".
- إن كان يفضفض فتفهّمي مشاعره أولاً ثم اسألي سؤالاً واحداً لطيفاً.
- إن وصلتك ملاحظات من عقله الثاني ولها صلة، فاستعيني بها بقولك "ذكرتَ سابقاً أن...".
- لا تخترعي معلومات عنه.`;

export async function aiMode() {
  const m = await getSetting('aiMode', AI_MODE_DEFAULT);
  return ['gemini', 'local', 'auto'].includes(m) ? m : AI_MODE_DEFAULT;
}

async function wantLocalFirst(mode) {
  if (mode === 'local') return true;
  if (mode !== 'auto') return false;
  return !navigator.onLine || !(await getSetting('geminiApiKey', ''));
}

function toLocalMessages(history, memories) {
  const msgs = [{ role: 'system', content: LOCAL_PERSONA + memoriesBlock(memories) }];
  for (const m of history.slice(-10)) {
    const role = m.role === 'model' ? 'assistant' : 'user';
    const last = msgs[msgs.length - 1];
    if (last.role === role) last.content += `\n${m.text}`;
    else msgs.push({ role, content: m.text });
  }
  return msgs;
}

// تصنيف محلي: نطلب معرّف القسم فقط ونلتقطه من الرد
export async function localClassify(text) {
  const list = [...CATEGORIES, NONE].map((c) => `${c.id}: ${c.label} (${c.desc || c.label})`).join('\n');
  const out = await localChat([
    { role: 'system', content: `صنّف رسالة المستخدم إلى قسم واحد. أجب بمعرّف القسم فقط، بلا أي كلمة أخرى.\nالأقسام:\n${list}` },
    { role: 'user', content: text },
  ], { maxTokens: 12, temperature: 0 });
  const lower = out.toLowerCase();
  const byId = [...CATEGORIES, NONE].find((c) => lower.includes(c.id.toLowerCase()));
  const byLabel = [...CATEGORIES, NONE].find((c) => out.includes(c.label));
  return (byId || byLabel || { id: 'thought' }).id;
}

// يعيد { reply, category?, title?, engine: 'gemini'|'local' }
// onToken(نص حتى الآن): لعرض رد النموذج المحلي وهو يُكتب
export async function smartChat(history, { memories = [], classify = true, onToken } = {}) {
  const mode = await aiMode();
  const runLocal = async () => {
    const reply = await localChat(toLocalMessages(history, memories), { onToken });
    let category = null;
    if (classify) {
      const lastUser = [...history].reverse().find((m) => m.role === 'user')?.text || '';
      try { category = await localClassify(lastUser); } catch { /* يُصنّف لاحقاً */ }
    }
    return { reply, category, title: '', engine: 'local' };
  };

  if (await wantLocalFirst(mode)) {
    if (await localReady()) {
      try { return await runLocal(); } catch (err) {
        if (!(await geminiAvailable(mode))) throw localError(err);
        // النموذج على الجهاز تعطل، والإنترنت والمفتاح متاحان: نكمل عبر Gemini
      }
    }
    // كرت الشاشة تعطل في هذه الجلسة ولا بديل: نقول السبب الحقيقي
    if (gpuUnavailable() && !(await geminiAvailable(mode))) throw gpuDeadError();
    if (mode === 'local') {
      throw Object.assign(new Error('اختر نموذجاً على الجهاز ونزّله من الإعدادات ← الذكاء على الجهاز.'), { code: 'NO_LOCAL' });
    }
  }
  try {
    return { ...(await geminiChat(history, { memories, classify })), engine: 'gemini' };
  } catch (err) {
    if (mode === 'auto' && FALLBACK_CODES.has(err.code) && await localReady()) {
      try { return await runLocal(); } catch (e2) { throw localError(e2); }
    }
    throw err;
  }
}

// تصنيف ملاحظة: Gemini، أو محلياً حسب الوضع وعند التعذّر
export async function smartClassify(text, context) {
  const mode = await aiMode();
  if ((await wantLocalFirst(mode)) && await localReady()) {
    try { return { category: await localClassify(text), title: '' }; } catch (err) {
      if (!(await geminiAvailable(mode))) throw err;
    }
  }
  try {
    return await geminiClassify(text, context);
  } catch (err) {
    if (mode !== 'gemini' && FALLBACK_CODES.has(err.code) && await localReady()) {
      return { category: await localClassify(text), title: '' };
    }
    throw err;
  }
}
