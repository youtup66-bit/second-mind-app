// الأقسام التي تُصنَّف إليها الملاحظات
export const CATEGORIES = [
  { id: 'worry',     label: 'قلق',          color: '#ff6b8a' },
  { id: 'thought',   label: 'تفكير',        color: '#8b6cff' },
  { id: 'idea',      label: 'فكرة إبداعية', color: '#ffc857' },
  { id: 'task',      label: 'مهمة',         color: '#4f7dff' },
  { id: 'memory',    label: 'ذكرى',         color: '#c08bff' },
  { id: 'gratitude', label: 'امتنان',       color: '#5fe0b0' },
  { id: 'dream',     label: 'حلم',          color: '#7fd4ff' },
  { id: 'decision',  label: 'قرار',         color: '#ff9f5a' },
  { id: 'question',  label: 'سؤال',         color: '#e2e2ff' },
];

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id);
