// الأقسام التي تُصنَّف إليها الملاحظات: تسعة أساسية + أقسام يضيفها المستخدم.
// CATEGORIES مصفوفة "حية": تُحدَّث في مكانها عند إضافة قسم أو حذفه، فتراها كل الشاشات.
import { getSetting, setSetting, getEntries, updateEntry } from './storage.js';

// desc: متى تذهب الملاحظة لهذا القسم (يُرسل لـ Gemini ليصنّف بدقة)
export const BUILTIN = [
  { id: 'worry',     label: 'قلق',          color: '#ff6b8a', desc: 'خوف، توتر، همّ، انزعاج من أمر قادم أو حاصل' },
  { id: 'thought',   label: 'تفكير',        color: '#8b6cff', desc: 'تأمل، رأي، تحليل، مشاعر عامة أو وصف لحال اليوم' },
  { id: 'idea',      label: 'فكرة إبداعية', color: '#ffc857', desc: 'فكرة مشروع، اختراع، كتابة، تصميم، حل جديد' },
  { id: 'task',      label: 'مهمة',         color: '#4f7dff', desc: 'شيء يجب فعله أو تذكّره، موعد، التزام' },
  { id: 'memory',    label: 'ذكرى',         color: '#c08bff', desc: 'حدث من الماضي يستعيده' },
  { id: 'gratitude', label: 'امتنان',       color: '#5fe0b0', desc: 'شكر، تقدير، شيء جميل يحمد عليه' },
  { id: 'dream',     label: 'حلم',          color: '#7fd4ff', desc: 'حلم منام، أو أمنية وطموح بعيد' },
  { id: 'decision',  label: 'قرار',         color: '#ff9f5a', desc: 'قرار اتخذه أو يحسمه أو حيرة بين خيارين' },
  { id: 'question',  label: 'سؤال',         color: '#e2e2ff', desc: 'سؤال يشغله أو يريد معرفة جوابه' },
];

export const CATEGORIES = [...BUILTIN];

// "بلا تصنيف": تحيات وردود قصيرة لا تظهر في شاشة العقل
export const NONE = { id: 'none', label: 'بلا تصنيف', color: '#6b6690', desc: 'تحية أو رد قصير بلا مضمون (مثل: مرحبا، شكراً، تمام)' };

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) || (id === 'none' ? NONE : null);
export const isCustom = (id) => typeof id === 'string' && id.startsWith('c_');

// ألوان مقترحة للأقسام الجديدة (مختلفة عن ألوان الأقسام الأساسية)
export const PALETTE = ['#4fd1c5', '#f687b3', '#68d391', '#f6ad55', '#63b3ed', '#b794f4', '#fc8181', '#fbd38d', '#81e6d9', '#a3bffa', '#f6e05e', '#ed64a6'];

// أقسام مقترحة تُضاف بلمسة
export const SUGGESTED = [
  { label: 'صحة ورياضة',     color: '#68d391', desc: 'النوم، الأكل، الرياضة، الأعراض، المواعيد الطبية، العادات الصحية' },
  { label: 'عمل ودراسة',     color: '#63b3ed', desc: 'الوظيفة، الزملاء، المشاريع، الدراسة، الامتحانات، المسار المهني' },
  { label: 'علاقات وعائلة',  color: '#f687b3', desc: 'الأهل، الأصدقاء، الشريك، الخلافات والمواقف مع الناس' },
  { label: 'مال ومصاريف',    color: '#f6e05e', desc: 'المصاريف، الادخار، الديون، المشتريات، الميزانية' },
  { label: 'أهداف',          color: '#f6ad55', desc: 'هدف محدد يريد الوصول إليه وخطواته وتقدّمه فيه' },
  { label: 'تعلّم',          color: '#4fd1c5', desc: 'شيء جديد تعلّمه أو يريد تعلّمه، مهارة، معلومة مفيدة' },
  { label: 'اقتباسات',       color: '#b794f4', desc: 'جملة أو مقولة أعجبته من كتاب أو شخص أو مكان' },
  { label: 'كتب وأفلام',     color: '#fc8181', desc: 'كتاب أو فيلم أو مسلسل قرأه أو شاهده أو يريد ذلك، ورأيه فيه' },
  { label: 'روحانيات',       color: '#81e6d9', desc: 'العبادة، الدعاء، التأمل الروحي، القيم والمعنى' },
  { label: 'سفر',            color: '#a3bffa', desc: 'رحلة قام بها أو يخطط لها، أماكن يريد زيارتها' },
  { label: 'طبخ ووصفات',     color: '#fbd38d', desc: 'وصفة، طبق جربه، فكرة أكلة' },
];

export const MAX_CUSTOM = 12;

async function getCustom() {
  const list = await getSetting('customCategories', []);
  return Array.isArray(list) ? list.filter((c) => isCustom(c?.id) && c.label) : [];
}

// تُستدعى عند بدء التطبيق وبعد أي تعديل أو استيراد
export async function loadCategories() {
  const custom = await getCustom();
  CATEGORIES.splice(0, CATEGORIES.length, ...BUILTIN, ...custom);
  return CATEGORIES;
}

async function saveCustom(list) {
  await setSetting('customCategories', list);
  await loadCategories();
  window.dispatchEvent(new CustomEvent('sm:categories'));
}

export async function addCategory({ label, color, desc }) {
  const list = await getCustom();
  const name = String(label || '').trim().slice(0, 24);
  if (!name) throw new Error('اكتب اسماً للقسم.');
  if (list.length >= MAX_CUSTOM) throw new Error(`يمكنك إضافة ${MAX_CUSTOM} أقسام كحد أقصى.`);
  if (CATEGORIES.some((c) => c.label === name)) throw new Error('يوجد قسم بهذا الاسم.');
  const cat = {
    id: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    label: name,
    color: color || PALETTE[list.length % PALETTE.length],
    desc: String(desc || '').trim().slice(0, 160),
  };
  await saveCustom([...list, cat]);
  return cat;
}

export async function updateCategory(id, patch) {
  const list = await getCustom();
  const name = patch.label != null ? String(patch.label).trim().slice(0, 24) : null;
  if (name === '') throw new Error('اكتب اسماً للقسم.');
  if (name && CATEGORIES.some((c) => c.label === name && c.id !== id)) throw new Error('يوجد قسم بهذا الاسم.');
  await saveCustom(list.map((c) => (c.id === id ? {
    ...c,
    ...(name && { label: name }),
    ...(patch.color && { color: patch.color }),
    ...(patch.desc != null && { desc: String(patch.desc).trim().slice(0, 160) }),
  } : c)));
}

// حذف قسم مضاف: ملاحظاته لا تضيع، تنتقل إلى "تفكير"
export async function removeCategory(id) {
  const moved = [];
  for (const e of await getEntries({ category: id })) {
    e.category = 'thought';
    e.meta = { ...e.meta, classifiedBy: 'user', movedFrom: id };
    await updateEntry(e);
    moved.push(e.id);
  }
  await saveCustom((await getCustom()).filter((c) => c.id !== id));
  return moved.length;
}
