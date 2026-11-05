// وصف أوامر الرفيقة (بلا أي تبعيات ثقيلة، ليستورده gemini.js دون حلقة استيراد)
import { CATEGORIES, isCustom } from './categories.js';
import { SKINS } from './skins.js';

export const ACTION_IDS = [
  'create_category', 'rename_category', 'delete_category', 'set_note_category',
  'open_screen', 'make_summary', 'complete_task',
  'change_companion', 'set_voice', 'set_chat_style', 'set_mind_view', 'set_spacing', 'show_empty_categories',
];

// وصف الأوامر للنموذج (يُبنى في كل مرة ليحوي الأقسام والشخصيات الحالية)
export function actionsPrompt() {
  const cats = CATEGORIES.map((c) => `${c.label}${isCustom(c.id) ? ' (أضافه المستخدم)' : ''}`).join('، ');
  const skins = Object.entries(SKINS).map(([id, s]) => `${id} = ${s.label} (${s.note})`).join('، ');
  return `
أنتِ تستطيعين التحكم في التطبيق نفسه عبر الحقل actions (مصفوفة أوامر). نفّذي أمراً فقط إن طلبه المستخدم صراحة أو بوضوح،
واذكري في reply ما فعلتِه بجملة قصيرة. إن لم يطلب شيئاً فاتركي actions فارغة. لا تعدي بشيء لا تستطيعين فعله.
الأقسام الحالية (الكرات في شاشة العقل): ${cats}.
الأوامر المتاحة وحقولها:
- create_category: إنشاء كرة/قسم جديد. name: الاسم (كلمة إلى ثلاث)، description: ماذا يدخل فيه، color: لون اختياري بصيغة #RRGGBB.
- rename_category: target: اسم القسم الحالي، name: الاسم الجديد. (للأقسام التي أضافها المستخدم فقط)
- delete_category: target: اسم القسم. (للأقسام التي أضافها المستخدم فقط؛ سيُطلب منه التأكيد)
- set_note_category: نقل رسالته الأخيرة إلى قسم. target: اسم القسم (يمكن أن يكون قسماً أنشأتِه في الرد نفسه).
- open_screen: target: mind (الكرات) أو folder (المجلد) أو summaries (الملخصات) أو settings (الإعدادات).
- make_summary: value: day أو week أو month.
- complete_task: تعليم مهمة بأنها أُنجزت. target: كلمات من نص المهمة.
- change_companion: تغيير شكل الرفيقة. target: أحد: ${skins}.
- set_voice: value: on أو off (نطق الردود بصوت).
- set_chat_style: value: whatsapp (واجهة محادثة بلا رفيقة) أو companion (مع الرفيقة).
- set_mind_view: value: heat (الألوان حسب العدد) أو size (الحجم حسب العدد).
- set_spacing: value: رقم بين 0.7 و2.2 للمسافة بين الكرات (1 عادي).
- show_empty_categories: value: on أو off.`;
}

export const actionsSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      action: { type: 'STRING', enum: ACTION_IDS },
      name: { type: 'STRING' },
      target: { type: 'STRING' },
      value: { type: 'STRING' },
      description: { type: 'STRING' },
      color: { type: 'STRING' },
    },
    required: ['action'],
  },
};

