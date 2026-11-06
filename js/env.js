// البيئة: النسخة الحقيقية، أو نسخة التجربة (تحت المسار ‎/dev/‎).
// نسخة التجربة معزولة تماماً: قاعدة بيانات أخرى على الجهاز، ومخازن أخرى، ومشروع Firebase تجريبي تربطه من إعداداتها.
export const IS_DEV = /\/dev\//.test(location.pathname);
export const DB_NAME = IS_DEV ? 'second-mind-dev' : 'second-mind';
