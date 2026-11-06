// وصف أوامر الرفيقة (بلا أي تبعيات ثقيلة، ليستورده gemini.js دون حلقة استيراد)
import { CATEGORIES, isCustom } from './categories.js';

export const ACTION_IDS = [
  'create_category', 'rename_category', 'delete_category', 'set_note_category',
  'open_screen', 'make_summary', 'complete_task',
  'set_voice', 'set_mind_view', 'set_spacing', 'show_empty_categories',
  'delete_note', 'set_theme',
  // إدارة المؤسسة (للمدير)
  'org_add_branch', 'org_add_custom', 'org_rename', 'org_delete', 'org_move', 'org_set_color', 'org_link',
  'org_place_employee', 'org_remove_employee', 'org_set_assistant',
  'work_add', 'work_update', 'work_delete', 'points_add', 'points_review', 'points_auto',
  'post_to_group', 'invite_employee',
];

// ملخص المؤسسة الحالي (يضعه التطبيق قبل كل طلب، للمدير فقط)
let orgCtx = '';
export const setActionContext = (text) => { orgCtx = text || ''; };

// وصف الأوامر للنموذج (يُبنى في كل مرة ليحوي الأقسام والشخصيات الحالية)
export function actionsPrompt() {
  const cats = CATEGORIES.map((c) => `${c.label}${isCustom(c.id) ? ' (أضافه المستخدم)' : ''}`).join('، ');
  return `
أنتِ تستطيعين التحكم في التطبيق نفسه عبر الحقل actions (مصفوفة أوامر). نفّذي أمراً فقط إن طلبه المستخدم صراحة أو بوضوح،
واذكري في reply ما فعلتِه بجملة قصيرة. إن لم يطلب شيئاً فاتركي actions فارغة. لا تعدي بشيء لا تستطيعين فعله.
الأقسام الحالية (الكرات في شاشة العقل): ${cats}.
الأوامر المتاحة وحقولها:
- create_category: إنشاء كرة/قسم جديد. name: الاسم (كلمة إلى ثلاث)، description: ماذا يدخل فيه، color: لون اختياري بصيغة #RRGGBB.
- rename_category: target: اسم القسم الحالي، name: الاسم الجديد. (للأقسام التي أضافها المستخدم فقط)
- delete_category: target: اسم القسم. (للأقسام التي أضافها المستخدم فقط؛ سيُطلب منه التأكيد)
- set_note_category: نقل رسالته الأخيرة إلى قسم. target: اسم القسم (يمكن أن يكون قسماً أنشأتِه في الرد نفسه).
- open_screen: target: mind (الكرات) أو folder (المجلد) أو summaries (الملخصات) أو settings (الإعدادات)
  أو structure (عقل المؤسسة) أو staff (الموظفين) أو points (النقاط) أو group (منشورات المجموعة).
- delete_note: حذف ملاحظة. target: كلمات من نصها. (سيُطلب منه التأكيد)
- set_theme: value: whatsapp أو purple (ألوان التطبيق).
- make_summary: value: day أو week أو month.
- complete_task: تعليم مهمة بأنها أُنجزت. target: كلمات من نص المهمة.
- set_voice: value: on أو off (نطق الردود بصوت).
- set_mind_view: value: heat (الألوان حسب العدد) أو size (الحجم حسب العدد).
- set_spacing: value: رقم بين 0.7 و2.2 للمسافة بين الكرات (1 عادي).
- show_empty_categories: value: on أو off.${orgCtx ? `
${orgCtx}
أوامر إدارة المؤسسة (استخدمي الأسماء كما وردت أعلاه):
- org_add_branch: إضافة فرع تحت فرع. target: اسم الأب (القسم أو شعبة أو وحدة)، name: الاسم. النوع يُحدَّد تلقائياً (تحت القسم شعبة، تحت الشعبة وحدة، تحت الوحدة قسم وحدة).
- org_add_custom: كرة مخصصة (مشروع، لجنة). name، color (#RRGGBB اختياري)، target: أسماء الفروع المرتبطة بها مفصولة بفواصل.
- org_rename: target، name. · org_delete: target (سيُطلب التأكيد).
- org_move: نقل فرع. target: الفرع، value: الأب الجديد.
- org_set_color: target (كرة مخصصة)، color. · org_link: target (كرة مخصصة)، value: فروع تُربط بها مفصولة بفواصل.
- org_place_employee: employee: اسم الموظف، target: الكرة (يبقى في أماكنه الأخرى).
- org_remove_employee: employee، target (اختياري؛ إن غاب يُخرج من كل الهيكل).
- org_set_assistant: employee، target.
- work_add: name: العمل، value: نقاطه. · work_update: target، name (اختياري)، value (اختياري). · work_delete: target.
- points_add: تسجيل نقاط. employee، target: اسم العمل، value: العدد.
- points_review: value: approve (قبول كل الاقتراحات المعلقة) أو reject.
- points_auto: value: on أو off.
- post_to_group: value: نص المنشور في مجموعة المؤسسة (سيُطلب التأكيد).
- invite_employee: name: اسم الموظف، value: اسم دخول بالإنجليزية (حروف وأرقام).
نفّذي عدة أوامر معاً إن طلب ذلك (حتى ٦)، مثل إنشاء شعبة ثم وحدات تحتها.` : ''}`;
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
      employee: { type: 'STRING' },
    },
    required: ['action'],
  },
};

