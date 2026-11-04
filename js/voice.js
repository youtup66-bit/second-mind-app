// الصوت: تحويل الكلام إلى نص، ونطق ردود الرفيقة بصوت يناسب شخصيتها.
// محرّكان للنطق: صوت الجهاز (فوري ومجاني) أو صوت Gemini الطبيعي (اختياري).
import { getSetting } from './storage.js';
import { skinVoice } from './skins.js';
import { tts, ttsCooldownUntil } from './gemini.js';
import { synthesize } from './piper.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const canListen = !!Recognition || canRecord;
export const canBrowserListen = !!Recognition;
export const canSpeak = 'speechSynthesis' in window;

// يبدأ الاستماع ويعيد دالة للإيقاف.
// - نوقف أي صوت ونعلّق محرك الصوت قبل الاستماع، لأن أندرويد قد يمنح الصوت للتشغيل بدل الميكروفون.
// - الإيقاف لا ينتظر المتصفح إلى الأبد: إن لم ينتهِ خلال ثانية ونصف نُنهيه بالقوة.
// - عند الإيقاف اليدوي نرسل ما سُمع حتى الآن، حتى لو لم يكتمل.
export function listen({ onText, onInterim, onEnd, onError, onStart }) {
  stopSpeaking();
  suspendAudio();
  const rec = new Recognition();
  rec.lang = 'ar-SA';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '', interimText = '', started = false, ended = false, forceTimer = 0;

  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(startTimer);
    clearTimeout(forceTimer);
    const text = (finalText + ' ' + interimText).replace(/\s+/g, ' ').trim();
    if (text) onText?.(text);
    onEnd?.();
  };

  rec.onaudiostart = () => { started = true; onStart?.(); };
  rec.onstart = () => { started = true; onStart?.(); };
  rec.onresult = (e) => {
    let interim = '';
    finalText = '';
    // نعيد بناء النص من كل النتائج (أندرويد يكرر النتائج أحياناً إن جمعناها تراكمياً)
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    interimText = interim;
    onInterim?.((finalText + interim).trim());
  };
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = finish;

  // إن لم يبدأ الميكروفون فعلاً خلال ٦ ثوانٍ نخبره ونوقف
  const startTimer = setTimeout(() => {
    if (started || ended) return;
    onError?.('no-start');
    try { rec.abort(); } catch { /* انتهى */ }
    finish();
  }, 6000);

  rec.start();
  return () => {
    try { rec.stop(); } catch { /* انتهى */ }
    forceTimer = setTimeout(() => { try { rec.abort(); } catch { /* انتهى */ } finish(); }, 3500);
  };
}

// ---- تسجيل الصوت (لتفريغه عبر Gemini) ----
// onLevel(0..1): مستوى الصوت لعرضه. يتوقف تلقائياً بعد ثانيتين من الصمت (بعد أن يبدأ الكلام) أو بعد دقيقة.
// يعيد { stop() } ويستدعي onDone(blob) عند الانتهاء.
export async function record({ onStart, onLevel, onDone, onError, maxMs = 60_000 }) {
  stopSpeaking();
  suspendAudio();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    onError?.(err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'not-allowed' : 'audio-capture');
    return { stop() {} };
  }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  let done = false, raf = 0, heard = false, silentSince = 0;

  // قياس المستوى بمحرك صوت مستقل يُغلق بعد التسجيل
  let actx = null, analyser = null;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser();
    analyser.fftSize = 512;
    actx.createMediaStreamSource(stream).connect(analyser);
  } catch { /* بلا مؤشر */ }
  const buf = new Uint8Array(512);
  const started = performance.now();
  const tick = () => {
    if (done) return;
    if (analyser) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
      onLevel?.(level);
      const now = performance.now();
      if (level > 0.12) { heard = true; silentSince = 0; }
      else if (heard) {
        silentSince ||= now;
        if (now - silentSince > 2000) return stop();
      }
      if (now - started > maxMs) return stop();
    }
    raf = requestAnimationFrame(tick);
  };

  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    actx?.close().catch(() => {});
  };
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.onstop = () => {
    cleanup();
    onDone?.(new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), heard);
  };
  function stop() {
    if (done) return;
    done = true;
    try { rec.state !== 'inactive' ? rec.stop() : rec.onstop(); } catch { cleanup(); onDone?.(new Blob(chunks), heard); }
  }
  rec.start(250);
  onStart?.();
  raf = requestAnimationFrame(tick);
  return { stop };
}

// ---- أصوات الجهاز ----
const FEMALE = /female|woman|hoda|salma|laila|layla|zariyah|amira|amany|mariam|fatima|hala|rana|mona|sara|noura|zeina/i;
const MALE = /\bmale\b|man\b|naayf|hamed|tarik|shakir|maged|majed|omar|hamdan|fahed|bassel|ahmad|khalid/i;

export function arabicVoices() {
  if (!canSpeak) return [];
  return speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang));
}

// قائمة الأصوات قد تتأخر في Chrome؛ هذه تنتظرها قليلاً
export function voicesReady() {
  if (!canSpeak) return Promise.resolve([]);
  if (speechSynthesis.getVoices().length) return Promise.resolve(arabicVoices());
  return new Promise((resolve) => {
    const done = () => resolve(arabicVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

function pickVoice(gender, preferred) {
  const list = arabicVoices();
  if (preferred) {
    const v = list.find((x) => x.voiceURI === preferred);
    if (v) return v;
  }
  const re = gender === 'male' ? MALE : FEMALE;
  return list.find((v) => re.test(v.name)) || list.find((v) => !(gender === 'male' ? FEMALE : MALE).test(v.name)) || list[0] || null;
}

// Chrome يقطع النطق الطويل بعد ~١٥ ثانية، وبعض الجوالات تُسقط النطق الذي يبدأ مباشرة بعد الإلغاء؛
// لذلك نقسّم الرد إلى جمل وننطقها بالتتابع، ونبدأ بعد مهلة قصيرة، ونراقب إن لم يبدأ الصوت أبداً.
function sentences(text) {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?؟،\n]+[.!?؟،]*/g) || [text];
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && (last + p).length < 160) out[out.length - 1] = last + p;
    else out.push(p.trim());
  }
  return out.filter(Boolean);
}

function speakDevice(text, profile, opts, { onStart, onEnd, onSilent }, my) {
  if (!canSpeak) { onEnd?.(); return; }
  speechSynthesis.cancel();
  const v = pickVoice(profile.gender, opts.voiceURI);
  const pitch = Math.max(0, Math.min(2, profile.pitch + opts.pitchShift));
  const rate = Math.max(0.5, Math.min(2, profile.rate * opts.rateScale));
  const queue = sentences(text);
  let started = false, finished = false;
  const finish = () => { if (!finished) { finished = true; clearTimeout(watchdog); onEnd?.(); } };
  // إن لم يبدأ الصوت خلال ٤ ثوانٍ (لا أصوات مثبتة مثلاً) نعيد الرفيقة لحالها
  const watchdog = setTimeout(() => { if (!started) { onSilent?.(); finish(); } }, 4000);

  const next = () => {
    if (my !== token) return finish();
    const chunk = queue.shift();
    if (!chunk) return finish();
    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = v?.lang || 'ar-SA';
    try { if (v) u.voice = v; } catch { /* صوت غير صالح: نكمل بالافتراضي */ }
    u.pitch = pitch;
    u.rate = rate;
    u.onstart = () => { if (!started) { started = true; onStart?.(); } };
    u.onend = next;
    u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? finish() : next());
    speechSynthesis.resume?.();
    speechSynthesis.speak(u);
  };
  setTimeout(next, 80);
}

// ---- صوت Gemini عبر Web Audio ----
let ctx = null;
let source = null;
let token = 0;

// يُستدعى داخل لمسة المستخدم (زر الإرسال) ليسمح المتصفح بالتشغيل لاحقاً
export function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { /* غير مدعوم */ }
}

// نعلّق محرك الصوت حين لا نحتاجه، فيتحرر الصوت للميكروفون
function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

// يتأكد أن محرك الصوت يعمل قبل التشغيل (ينتظر حتى ثانية)
async function ensureAudio() {
  unlockAudio();
  if (!ctx) return false;
  if (ctx.state !== 'running') {
    await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
  }
  return ctx.state === 'running';
}

function playPCM({ samples, rate }, { onStart, onEnd }) {
  const buf = ctx.createBuffer(1, samples.length, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
  source = ctx.createBufferSource();
  source.buffer = buf;
  source.connect(ctx.destination);
  source.onended = () => { source = null; suspendAudio(); onEnd?.(); };
  onStart?.();
  source.start();
}

const MAX_TTS_CHARS = 600;

async function voiceSettings() {
  return {
    engine: await getSetting('voiceEngine', 'device'),
    voiceURI: await getSetting('deviceVoice', ''),
    pitchShift: Number(await getSetting('voicePitchShift', 0)),
    rateScale: Number(await getSetting('voiceRateScale', 1)),
  };
}

// skin: معرّف الشخصية لاختيار صوتها. onFallback: يُستدعى إن فشل صوت Gemini وعدنا لصوت الجهاز
// onWaiting: يُستدعى أثناء انتظار صوت Gemini. onSilent: إن لم يبدأ صوت الجهاز أبداً
// force: يتجاهل فترة الراحة (لزر "جرّب الصوت" في الإعدادات)
export async function speak(text, { skin, onStart, onEnd, onFallback, onWaiting, onSilent, force = false } = {}) {
  stopSpeaking();
  const my = ++token;
  const profile = skinVoice(skin);
  const opts = await voiceSettings();
  if (my !== token) return;

  if (opts.engine === 'piper') {
    try {
      onWaiting?.();
      await speakPiper(text, profile, opts, { onStart, onEnd }, my);
      return;
    } catch (err) {
      if (my !== token) return;
      onFallback?.(err);
    }
  }

  if (opts.engine === 'gemini' && (force || !(await ttsCooldownUntil()))) {
    try {
      onWaiting?.();
      const audio = await tts(text.slice(0, MAX_TTS_CHARS), { voice: profile.gemini, style: profile.style });
      if (my !== token) return; // أُلغي أثناء الانتظار
      if (!(await ensureAudio())) throw new Error('الصوت لم يُفعَّل بعد، المس الشاشة مرة');
      if (my !== token) return;
      playPCM(audio, { onStart, onEnd });
      return;
    } catch (err) {
      if (my !== token) return;
      onFallback?.(err);
    }
  }
  speakDevice(text, profile, opts, { onStart, onEnd, onSilent }, my);
}

// ---- صوت Piper (على الجهاز) ----
// نولّد الجملة التالية بينما تُنطق الحالية، فلا يطول الانتظار بين الجمل.
// rate: سرعة التشغيل لكل شخصية (ترفع الحدّة أيضاً، فيقترب صوت "كريم" من صوت الشخصية)
function playChunk({ samples, rate }, playbackRate, my) {
  return new Promise((resolve) => {
    if (my !== token) return resolve();
    const buf = ctx.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    source = ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = playbackRate;
    source.connect(ctx.destination);
    source.onended = () => { source = null; resolve(); };
    source.start();
  });
}

async function speakPiper(text, profile, opts, { onStart, onEnd }, my) {
  if (!(await ensureAudio())) throw new Error('الصوت لم يُفعَّل بعد، المس الشاشة مرة');
  const rate = Math.max(0.6, Math.min(2, (profile.piperRate || 1.2) * opts.rateScale + opts.pitchShift * 0.5));
  const gen = synthesize(sentences(text));
  let next = gen.next();
  let started = false;
  try {
    for (;;) {
      const { value, done } = await next;
      if (done || my !== token) break;
      next = gen.next(); // نبدأ تجهيز الجملة التالية فوراً
      if (!started) { started = true; onStart?.(); }
      await playChunk(value, rate, my);
      if (my !== token) break;
    }
  } catch (err) {
    if (!started) throw err; // فشل قبل أن يبدأ: نعود لصوت الجهاز. بعد البدء: نكتفي بما قيل
  } finally {
    gen.return?.();
    if (my === token) suspendAudio();
    if (started) onEnd?.();
  }
  if (!started) throw new Error('لم يخرج صوت من Piper.');
}

export function stopSpeaking() {
  token++;
  if (canSpeak) speechSynthesis.cancel();
  if (source) { try { source.onended = null; source.stop(); } catch { /* انتهى */ } source = null; }
}
