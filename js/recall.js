// التذكّر: يبحث في ملاحظاتك على الجهاز نفسه عمّا له صلة بكلامك الآن.
// البحث محلي بالكامل؛ فقط الملاحظات القليلة الأقرب صلة تُرفق مع رسالتك إلى Gemini.

const STOP_WORDS = `من في على الى عن ما ماذا هل كيف ليش لماذا متي اين انا انت انتي هو هي نحن هم هذا هذه ذلك تلك
الذي التي اللي و او ثم لكن بس مع كان كانت يكون تكون عند عندي لدي كل بعض لا لم لن قد ان اذا لو حتي
شو ايش وش كذا جدا يعني ابي ابغي اريد ممكن شي شيء اليوم امس بكره الان هنا هناك مثل غير فقط ايضا
عشان علشان لان لانه لاني فيه فيها منه منها له لها لي لك بي به بها اني انه انها كيفك تمام طيب اوكي
على إلى متى أين أنا أنت إذا حتى أو أيضا لأن لأنه أني أنه أنها`;

// توحيد الكتابة: إزالة التشكيل وتوحيد الهمزات والتاء المربوطة والألف المقصورة
export function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
}

const STOP = new Set(STOP_WORDS.split(/\s+/).map(normalize));

// تجذيع خفيف: نزع أدوات التعريف والعطف وبعض اللواحق الشائعة
function stem(w) {
  for (const p of ['وبال', 'وال', 'بال', 'كال', 'فال', 'لل', 'ال']) {
    if (w.startsWith(p) && w.length - p.length >= (p === 'لل' ? 2 : 3)) { w = w.slice(p.length); break; }
  }
  if (/^[وفب]/.test(w) && w.length > 4) w = w.slice(1);
  for (const s of ['ات', 'ون', 'ين', 'ها', 'هم', 'كم', 'نا', 'تي', 'ه', 'ي']) {
    if (w.endsWith(s) && w.length - s.length >= 3) { w = w.slice(0, -s.length); break; }
  }
  return w;
}

export function tokens(text) {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

// entries: الملاحظات، query: النص الحالي، previous: رسالة المستخدم السابقة (لفهم الردود القصيرة)
export function recall(entries, query, { previous = '', exclude = [], limit = 5 } = {}) {
  const skip = new Set(exclude);
  const pool = entries.filter((e) => !skip.has(e.id) && e.category && e.category !== 'none');
  if (!pool.length) return [];

  const docs = pool.map((e) => ({ e, toks: new Set(tokens(`${e.meta?.title || ''} ${e.text}`)) }));
  const df = new Map();
  docs.forEach((d) => d.toks.forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const N = docs.length;
  const idf = (t) => Math.log(1 + N / (df.get(t) || N));

  const q = new Map();
  const own = tokens(query);
  own.forEach((t) => q.set(t, 1));
  // الرسالة السابقة تُحتسب فقط إن كانت الحالية رداً قصيراً متابعاً ("كيف؟"، "وبعدين؟")
  const followUp = own.length <= 1;
  if (followUp) tokens(previous).forEach((t) => { if (!q.has(t)) q.set(t, 0.5); });
  if (!q.size) return [];

  const now = Date.now();
  const scored = docs.map(({ e, toks }) => {
    let score = 0, hits = 0, ownHits = 0;
    for (const [t, w] of q) {
      if (toks.has(t)) { score += w * idf(t); hits++; if (w === 1) ownHits++; continue; }
      // تطابق جزئي للكلمات الطويلة (مثلاً: اجتماع / اجتماعات)
      if (t.length >= 4) {
        for (const d of toks) {
          if (d.length >= 4 && (d.startsWith(t) || t.startsWith(d))) { score += 0.6 * w * idf(d); hits++; if (w === 1) ownHits++; break; }
        }
      }
    }
    const ageDays = (now - e.createdAt) / 86_400_000;
    score *= 1 + 0.3 * Math.exp(-ageDays / 30); // الأحدث أولى قليلاً
    score /= 1 + 0.02 * toks.size;              // لا نفضّل الملاحظات الطويلة لمجرد طولها
    return { e, score, hits, ownHits };
  });

  return scored
    .filter((s) => s.hits && s.score >= 0.9 && (followUp || s.ownHits))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
}
