// الصوت: تحويل الكلام إلى نص، ونطق ردود الرفيقة بصوت يناسب شخصيتها.
// محرّكان للنطق: صوت الجهاز (فوري ومجاني) أو صوت Gemini الطبيعي (اختياري).
import { getSetting } from './storage.js';
import { skinVoice } from './skins.js';
import { tts } from './gemini.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = !!Recognition;
export const canSpeak = 'speechSynthesis' in window;

// يبدأ الاستماع ويعيد دالة للإيقاف
export function listen({ onText, onInterim, onEnd, onError }) {
  const rec = new Recognition();
  rec.lang = 'ar-SA';
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = '';

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterim?.(finalText + interim);
  };
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => {
    if (finalText.trim()) onText?.(finalText.trim());
    onEnd?.();
  };
  rec.start();
  return () => rec.stop();
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

function speakDevice(text, profile, opts, { onStart, onEnd }, my) {
  if (!canSpeak) { onEnd?.(); return; }
  speechSynthesis.cancel();
  const v = pickVoice(profile.gender, opts.voiceURI);
  const pitch = Math.max(0, Math.min(2, profile.pitch + opts.pitchShift));
  const rate = Math.max(0.5, Math.min(2, profile.rate * opts.rateScale));
  const queue = sentences(text);
  let started = false, finished = false;
  const finish = () => { if (!finished) { finished = true; clearTimeout(watchdog); onEnd?.(); } };
  // إن لم يبدأ الصوت خلال ٤ ثوانٍ (لا أصوات مثبتة مثلاً) نعيد الرفيقة لحالها
  const watchdog = setTimeout(() => { if (!started) finish(); }, 4000);

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

// يُستدعى داخل لمسة المستخدم (زر الإرسال أو الميكروفون) ليسمح المتصفح بالتشغيل لاحقاً
export function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* غير مدعوم */ }
}

function playPCM({ samples, rate }, { onStart, onEnd }) {
  unlockAudio();
  const buf = ctx.createBuffer(1, samples.length, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
  source = ctx.createBufferSource();
  source.buffer = buf;
  source.connect(ctx.destination);
  source.onended = () => { source = null; onEnd?.(); };
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
export async function speak(text, { skin, onStart, onEnd, onFallback } = {}) {
  stopSpeaking();
  const my = ++token;
  const profile = skinVoice(skin);
  const opts = await voiceSettings();
  if (my !== token) return;

  if (opts.engine === 'gemini') {
    try {
      const audio = await tts(text.slice(0, MAX_TTS_CHARS), { voice: profile.gemini, style: profile.style });
      if (my !== token) return; // أُلغي أثناء الانتظار
      if (!ctx || ctx.state !== 'running') throw new Error('الصوت لم يُفعَّل بعد، المس الشاشة مرة');
      playPCM(audio, { onStart, onEnd });
      return;
    } catch (err) {
      if (my !== token) return;
      onFallback?.(err);
    }
  }
  speakDevice(text, profile, opts, { onStart, onEnd }, my);
}

export function stopSpeaking() {
  token++;
  if (canSpeak) speechSynthesis.cancel();
  if (source) { try { source.onended = null; source.stop(); } catch { /* انتهى */ } source = null; }
}
