// الميكروفون: تحويل الكلام إلى نص (خدمة المتصفح) وتسجيل الصوت (لتفريغه عبر Gemini عند المدير).
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
export async function record({ onStart, onLevel, onDone, onError, maxMs = 60_000, silenceStop = true }) {
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
      if (level > 0.08) { heard = true; silentSince = 0; }
      else if (heard) {
        silentSince ||= now;
        if (silenceStop && now - silentSince > 2000) return stop();
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

// لا نطق في التطبيق؛ نُبقي الدالتين لأن الاستماع يستدعيهما قبل فتح الميكروفون
export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function suspendAudio() { /* لا محرك صوت للتشغيل */ }
