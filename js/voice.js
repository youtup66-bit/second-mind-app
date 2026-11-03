// الصوت: تحويل الكلام إلى نص، ونطق الردود. يعتمد على ما يوفره المتصفح.
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

function arabicVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => /^ar/i.test(v.lang) && /female|zira|hoda|salma|laila/i.test(v.name))
    || voices.find((v) => /^ar/i.test(v.lang));
}

export function speak(text, { onStart, onEnd } = {}) {
  if (!canSpeak) { onEnd?.(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ar-SA';
  const v = arabicVoice();
  if (v) u.voice = v;
  u.pitch = 1.3;
  u.rate = 1;
  u.onstart = () => onStart?.();
  u.onend = u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
}
