// البيئة: النسخة الحقيقية، أو نسخة التجربة (تحت المسار ‎/dev/‎).
// نسخة التجربة معزولة تماماً: قاعدة بيانات أخرى على الجهاز، ومخازن أخرى، ومشروع Firebase تجريبي تربطه من إعداداتها.
export const IS_DEV = /\/dev\//.test(location.pathname);
export const DB_NAME = IS_DEV ? 'second-mind-dev' : 'second-mind';

// داخل تطبيق الأندرويد تُحمَّل الصفحة من داخل الـ APK نفسه (عنوان داخلي لا يفتحه غيره)
export const IS_BUNDLED = location.hostname === 'appassets.androidplatform.net';
// الروابط التي نشاركها (الدعوات، صفحة المؤسسة) تفتح الموقع العام لا العنوان الداخلي
export const PUBLIC_BASE = IS_BUNDLED ? 'https://youtup66-bit.github.io/second-mind-app/' : `${location.origin}${location.pathname}`;
