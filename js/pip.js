// الرفيقة فوق التطبيقات الأخرى، عبر ميزة "صورة داخل صورة" (PiP) في المتصفح.
// المتصفح لا يسمح لموقع بالرسم فوق التطبيقات، لكنه يسمح لفيديو بأن يطفو في نافذة صغيرة.
// لذلك نسجّل مرة واحدة حلقة متحركة مدتها ٤ ثوانٍ للرفيقة (طفو ورمشة)، ونحفظها على الجهاز،
// ثم نشغّلها فيديو متكرراً في نافذة عائمة؛ الفيديو يستمر حتى وأنت في تطبيق آخر دون أي كود يعمل في الخلفية.
import { skinSVG } from './skins.js';

const CACHE = 'second-mind-pip-v1';
const LOOP_MS = 4000;
const W = 400, H = 500;

export const canPip = !!(
  document.pictureInPictureEnabled &&
  HTMLVideoElement.prototype.requestPictureInPicture &&
  window.MediaRecorder &&
  HTMLCanvasElement.prototype.captureStream
);

const keyFor = (skin) => new Request(`./pip/${encodeURIComponent(skin)}.webm`);

async function cachedLoop(skin) {
  try {
    const hit = await (await caches.open(CACHE)).match(keyFor(skin));
    return hit ? await hit.blob() : null;
  } catch { return null; }
}

export const hasLoop = async (skin) => !!(await cachedLoop(skin));

// صورة ثابتة من رسم الشخصية: بعينين مفتوحتين أو مغمضتين
async function svgImage(skin, closed) {
  const src = skinSVG(skin).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" `);
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const hide = (sel) => doc.querySelectorAll(sel).forEach((n) => n.setAttribute('style', 'display:none'));
  hide('.cmp-think, .cmp-mouth--talk, .cmp-mouth--o');
  hide(closed ? '.cmp-eyes--open' : '.cmp-eyes--happy');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function drawFrame(ctx, open, closed, t) {
  const ph = (t / LOOP_MS) * Math.PI * 2;
  const bg = ctx.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H / 2, H * 0.7);
  bg.addColorStop(0, '#2a2068');
  bg.addColorStop(1, '#0b0820');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // طفو هادئ يعود إلى نقطة البداية تماماً في نهاية الحلقة
  const dy = -9 * (1 - Math.cos(ph)) / 2;
  const rot = (1.5 * Math.PI / 180) * Math.sin(ph);
  const blink = (t > 2300 && t < 2440) || (t > 2560 && t < 2680);
  ctx.save();
  ctx.translate(W / 2, H / 2 + dy);
  ctx.rotate(rot);
  ctx.drawImage(blink ? closed : open, -W / 2, -H / 2, W, H);
  ctx.restore();
}

// يسجّل الحلقة (يستغرق ٤ ثوانٍ) ويحفظها. onProgress(0..1)
export async function prepareLoop(skin, onProgress) {
  const [open, closed] = await Promise.all([svgImage(skin, false), svgImage(skin, true)]);
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  drawFrame(ctx, open, closed, 0);
  const stream = canvas.captureStream(30);
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, { ...(type && { mimeType: type }), videoBitsPerSecond: 1_200_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const done = new Promise((r) => { rec.onstop = r; });

  rec.start();
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = performance.now() - t0;
      drawFrame(ctx, open, closed, Math.min(t, LOOP_MS));
      onProgress?.(Math.min(1, t / LOOP_MS));
      if (t >= LOOP_MS) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  URL.revokeObjectURL(open.src);
  URL.revokeObjectURL(closed.src);

  const blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' });
  try { await (await caches.open(CACHE)).put(keyFor(skin), new Response(blob, { headers: { 'Content-Type': blob.type } })); } catch { /* بلا حفظ */ }
  memo.set(skin, blob);
  return blob;
}

const memo = new Map();
let video = null;

export const isFloating = () => !!document.pictureInPictureElement;

// يجب استدعاؤها مباشرة من لمسة المستخدم. ترمي خطأ إن لم تكن الحلقة جاهزة بعد.
export async function startFloating(skin) {
  const blob = memo.get(skin) || await cachedLoop(skin);
  if (!blob) throw Object.assign(new Error('الحلقة غير جاهزة'), { code: 'NOT_READY' });
  memo.set(skin, blob);
  if (!video) {
    video = Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true });
    video.className = 'pip-video';
    document.body.append(video);
    video.addEventListener('leavepictureinpicture', () => video.pause());
  }
  if (video.dataset.skin !== skin) {
    if (video.src) URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(blob);
    video.dataset.skin = skin;
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'رفيقتك هنا 💜', artist: 'عقلي الثاني' });
  }
  await video.play();
  await video.requestPictureInPicture();
}

export async function stopFloating() {
  if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {});
}

// زر واحد يجمع الحالات: يجهّز الحلقة أول مرة، ثم يطفو، وضغطة أثناء الطفو تعيدها.
// report(text): لعرض الحالة للمستخدم
export async function pipAction(skin, report) {
  if (!canPip) {
    report('متصفحك لا يدعم النوافذ العائمة (صورة داخل صورة). جرّب Chrome على أندرويد.');
    return;
  }
  if (isFloating()) {
    await stopFloating();
    report('أعدتُ الرفيقة إلى التطبيق.');
    return;
  }
  if (!(await hasLoop(skin))) {
    report('أجهّز الرفيقة العائمة… (٤ ثوانٍ، مرة واحدة فقط)');
    try {
      await prepareLoop(skin);
    } catch {
      report('تعذّر تجهيز النافذة العائمة على هذا الجهاز.');
      return;
    }
    report('جاهزة! اضغط 🪟 مرة أخرى لتطفو فوق التطبيقات.');
    return;
  }
  try {
    await startFloating(skin);
    report('ها أنا أطفو 🪟 اخرج من التطبيق وسأبقى معك. اضغط النافذة لتعود.');
  } catch (err) {
    report(err.name === 'NotAllowedError'
      ? 'الجوال رفض النافذة العائمة. فعّل "صورة داخل صورة" لـ Chrome من إعدادات التطبيقات، ثم حاول.'
      : 'تعذّر فتح النافذة العائمة على هذا الجهاز.');
  }
}
