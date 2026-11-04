// أوامر تنفذها الرفيقة في التطبيق: تطلبها في ردّها نفسه (حقل actions)، فينفذها التطبيق هنا.
// كل أمر يعيد نتيجة تُعرض تحت الرد. الحذف لا يتم إلا بعد تأكيد المستخدم.
import {
  CATEGORIES, PALETTE, categoryById, isCustom, addCategory, updateCategory, removeCategory,
} from './categories.js';
import { getEntries, getEntry, updateEntry, setSetting } from './storage.js';
import { setCategory } from './classifier.js';
import { createSummary } from './summaries.js';
import { SKINS } from './skins.js';
import { normalize } from './recall.js';

export { ACTION_IDS, actionsPrompt, actionsSchema } from './actions-spec.js';

// يجد قسماً باسمه (مع تسامح في الهمزات والتشكيل والتعريف) أو بمعرّفه
function findCategory(name) {
  if (!name) return null;
  const n = normalize(name).replace(/^ال/, '').trim();
  return categoryById(name)
    || CATEGORIES.find((c) => normalize(c.label) === normalize(name))
    || CATEGORIES.find((c) => normalize(c.label).replace(/^ال/, '') === n)
    || CATEGORIES.find((c) => normalize(c.label).includes(n) || n.includes(normalize(c.label)));
}

const say = (ok, text, link) => ({ ok, text, link });

// ctx: { entryId, setWaMode(on), setVoice(on), remount() }
export async function executeActions(actions, ctx = {}) {
  const results = [];
  for (const a of (actions || []).slice(0, 6)) {
    try {
      results.push(await run(a, ctx));
    } catch (err) {
      results.push(say(false, `تعذّر: ${err.message || err}`));
    }
  }
  return results.filter(Boolean);
}

async function run(a, ctx) {
  const v = String(a.value || '').trim().toLowerCase();
  switch (a.action) {
    case 'create_category': {
      const used = new Set(CATEGORIES.map((c) => c.color));
      const color = /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : PALETTE.find((p) => !used.has(p)) || PALETTE[0];
      const existing = findCategory(a.name);
      if (existing && normalize(existing.label) === normalize(a.name)) return say(true, `قسم «${existing.label}» موجود أصلاً`, '#/mind');
      const cat = await addCategory({ label: a.name, desc: a.description, color });
      return say(true, `أنشأتُ قسم «${cat.label}»`, '#/mind');
    }
    case 'rename_category': {
      const c = findCategory(a.target);
      if (!c) return say(false, `لم أجد قسم «${a.target}»`);
      if (!isCustom(c.id)) return say(false, `«${c.label}» قسم أساسي لا يُعاد تسميته`);
      await updateCategory(c.id, { label: a.name });
      return say(true, `غيّرتُ «${c.label}» إلى «${a.name}»`, '#/mind');
    }
    case 'delete_category': {
      const c = findCategory(a.target);
      if (!c) return say(false, `لم أجد قسم «${a.target}»`);
      if (!isCustom(c.id)) return say(false, `«${c.label}» قسم أساسي لا يُحذف`);
      if (!confirm(`الرفيقة تريد حذف قسم «${c.label}». تنتقل ملاحظاته إلى "تفكير". موافق؟`)) return say(false, 'لم يُحذف القسم (ألغيتَ)');
      const n = await removeCategory(c.id);
      return say(true, `حذفتُ قسم «${c.label}»${n ? ` ونقلتُ ${n} ملاحظة إلى "تفكير"` : ''}`, '#/mind');
    }
    case 'set_note_category': {
      const c = findCategory(a.target);
      if (!c) return say(false, `لم أجد قسم «${a.target}»`);
      if (!ctx.entryId) return say(false, 'لا توجد رسالة لنقلها');
      const entry = await setCategory(ctx.entryId, c.id);
      ctx.onCategory?.(entry);
      return say(true, `وضعتُ رسالتك في «${c.label}»`);
    }
    case 'open_screen': {
      const map = { mind: '#/mind', folder: '#/folder', summaries: '#/folder?summaries', settings: '#/settings' };
      const to = map[String(a.target || v).toLowerCase()];
      if (!to) return say(false, 'شاشة غير معروفة');
      setTimeout(() => { location.hash = to; }, 1200);
      return say(true, 'أفتح الشاشة…');
    }
    case 'make_summary': {
      const period = ['day', 'week', 'month'].includes(v) ? v : 'week';
      await createSummary({ period });
      return say(true, 'جهّزتُ الملخص', '#/folder?summaries');
    }
    case 'complete_task': {
      const q = normalize(a.target || '');
      const tasks = (await getEntries({ category: 'task' })).filter((e) => !e.meta?.done);
      const words = q.split(/\s+/).filter((w) => w.length > 1);
      const scored = tasks.map((e) => ({ e, s: words.filter((w) => normalize(e.text).includes(w)).length })).sort((x, y) => y.s - x.s);
      const hit = scored[0]?.s ? scored[0].e : null;
      if (!hit) return say(false, 'لم أجد مهمة مفتوحة بهذا الوصف');
      const fresh = await getEntry(hit.id);
      fresh.meta = { ...fresh.meta, done: true, doneAt: Date.now() };
      await updateEntry(fresh);
      return say(true, `علّمتُ «${fresh.meta.title || fresh.text.slice(0, 30)}» كمنجزة ✓`, '#/folder');
    }
    case 'change_companion': {
      const t = String(a.target || v);
      const id = SKINS[t] ? t : Object.keys(SKINS).find((k) => normalize(SKINS[k].label) === normalize(t) || normalize(SKINS[k].note).includes(normalize(t)));
      if (!id) return say(false, `لا يوجد شكل باسم «${t}»`);
      await setSetting('companionSkin', id);
      window.dispatchEvent(new CustomEvent('sm:setting', { detail: { key: 'companionSkin', value: id } }));
      setTimeout(() => ctx.remount?.(), 1500);
      return say(true, `صرتُ «${SKINS[id].label}»`);
    }
    case 'set_voice': {
      const on = !['off', 'false', '0', 'لا', 'إيقاف'].includes(v);
      await setSetting('speakReplies', on);
      ctx.setVoice?.(on);
      return say(true, on ? 'شغّلتُ صوتي' : 'أطفأتُ صوتي');
    }
    case 'set_chat_style': {
      const wa = v.startsWith('wh') || v.includes('واتس');
      ctx.setWaMode?.(wa);
      return say(true, wa ? 'انتقلتُ إلى واجهة المحادثة' : 'عدتُ إلى واجهة الرفيقة');
    }
    case 'set_mind_view': {
      const mode = v.startsWith('s') || v.includes('حجم') ? 'size' : 'heat';
      await setSetting('mindColorMode', mode);
      return say(true, mode === 'heat' ? 'شاشة العقل الآن بالألوان (الحرارة)' : 'شاشة العقل الآن بالحجم', '#/mind');
    }
    case 'set_spacing': {
      const n = Math.min(2.2, Math.max(0.7, parseFloat(v) || 1));
      await setSetting('mindSpacing', n);
      return say(true, `جعلتُ المسافة بين الكرات ×${n.toFixed(1)}`, '#/mind');
    }
    case 'show_empty_categories': {
      const on = !['off', 'false', '0'].includes(v);
      await setSetting('showEmptyCats', on);
      return say(true, on ? 'أظهرتُ الأقسام الفارغة' : 'أخفيتُ الأقسام الفارغة', '#/mind');
    }
    default:
      return null;
  }
}
