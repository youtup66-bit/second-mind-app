// ميكروفون بالضغط المطوّل (مثل واتساب): اضغط وتكلّم، أفلت للإرسال،
// اسحب جانباً للإلغاء، أو للأعلى للتثبيت دون إمساك. الكلام يتحول إلى نص ثم onText(text).
import { canRecord, canBrowserListen, listen, record, stopSpeaking } from './voice.js';
import { transcribe } from './gemini.js';
import { getSetting } from './storage.js';

const fmtDur = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const MIN_HOLD = 600;

// opts: { mic, form, input, say(text), onText(text), onBusy(on) }
export function attachHoldMic({ mic, form, input, say, onText, onBusy }) {
  const bar = document.createElement('div');
  bar.className = 'rec-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <button type="button" class="rec-bar__trash" aria-label="ألغِ التسجيل">🗑</button>
    <span class="rec-bar__dot" aria-hidden="true"></span>
    <span class="rec-bar__time">0:00</span>
    <span class="rec-bar__hint">→ اسحب للإلغاء</span>
    <span class="rec-bar__lock" aria-hidden="true">🔒<small>⌃</small></span>`;
  input.before(bar);
  const time = bar.querySelector('.rec-bar__time');
  const hint = bar.querySelector('.rec-bar__hint');
  let cap = null;

  const ui = (on, c) => {
    form.classList.toggle('is-recording', on);
    form.classList.toggle('is-locked', !!c?.locked);
    bar.hidden = !on;
    mic.textContent = c?.locked ? '➤' : '🎙';
    mic.classList.toggle('is-on', on);
    if (!on) { hint.style.transform = ''; hint.style.opacity = ''; mic.style.removeProperty('--lvl'); }
    hint.textContent = c?.locked ? 'اضغط ➤ للإرسال' : '→ اسحب للإلغاء';
  };
  const finish = (c) => { clearInterval(c.timer); if (cap === c) cap = null; ui(false); };
  function end(send, why) {
    const c = cap;
    if (!c) return;
    c.cancelled = !send;
    finish(c);
    if (c.stop) c.stop(); else c.pendingStop = true;
    if (!send && why === 'short') say('اضغط مطولاً على 🎙 وتكلّم، ثم أفلت للإرسال.');
    if (!send && why === 'cancel') say('أُلغي التسجيل 🗑');
  }

  async function pickEngine() {
    const hasKey = !!(await getSetting('geminiApiKey', ''));
    let engine = await getSetting('sttEngine', canRecord ? 'gemini' : 'browser');
    if (engine === 'gemini' && (!canRecord || !hasKey)) engine = canBrowserListen ? 'browser' : 'none';
    if (engine === 'browser' && !canBrowserListen) engine = canRecord && hasKey ? 'gemini' : 'none';
    if (engine === 'none') {
      say(hasKey ? 'الإدخال الصوتي غير متاح هنا.' : 'أضف مفتاح Gemini في <a href="#/settings">الإعدادات</a> لتحويل كلامك إلى نص.');
      return null;
    }
    return engine;
  }

  async function start(engine, c) {
    if (engine === 'gemini') {
      const rec = await record({
        silenceStop: false, maxMs: 120_000,
        onLevel: (l) => mic.style.setProperty('--lvl', l.toFixed(2)),
        onError: (code) => { finish(c); if (!c.cancelled) say(code === 'not-allowed' ? 'أحتاج إذن الميكروفون.' : 'تعذّر الوصول إلى الميكروفون.'); },
        onDone: async (blob, heard) => {
          finish(c);
          if (c.cancelled) return;
          if (!heard || blob.size < 2000) { say('لم أسمع شيئاً، جرّب مرة أخرى.'); return; }
          onBusy?.(true);
          try {
            const text = await transcribe(blob);
            if (text) onText(text); else say('لم أفهم الكلام جيداً، جرّب مرة أخرى.');
          } catch (err) { say(`${err.message} جرّب مرة أخرى أو اكتب.`); } finally { onBusy?.(false); }
        },
      });
      c.stop = () => rec.stop();
    } else {
      c.stop = listen({
        onText: (t) => { if (!c.cancelled) onText(t); },
        onError: () => { if (!c.cancelled) say('تعذّر الاستماع. جرّب مرة أخرى.'); },
        onEnd: () => finish(c),
      });
    }
    if (c.pendingStop) c.stop();
  }

  mic.addEventListener('contextmenu', (e) => e.preventDefault());
  mic.addEventListener('pointerdown', async (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    if (cap?.locked) { end(true); return; }
    if (cap) return;
    try { mic.setPointerCapture(e.pointerId); } catch { /* لا شيء */ }
    const c = cap = { x0: e.clientX, y0: e.clientY, t0: Date.now(), pointer: e.pointerId, cancelled: false, locked: false };
    const engine = await pickEngine();
    if (!engine) { cap = null; return; }
    if (cap !== c) return;
    stopSpeaking();
    time.textContent = '0:00';
    ui(true, c);
    c.timer = setInterval(() => { time.textContent = fmtDur(Date.now() - c.t0); }, 250);
    navigator.vibrate?.(30);
    try { await start(engine, c); } catch { finish(c); say('الإدخال الصوتي غير متاح في هذا المتصفح.'); }
  });
  mic.addEventListener('pointermove', (e) => {
    const c = cap;
    if (!c || c.locked || e.pointerId !== c.pointer) return;
    const dx = e.clientX - c.x0, dy = e.clientY - c.y0;
    hint.style.transform = `translateX(${Math.max(-60, Math.min(60, dx / 2))}px)`;
    hint.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / 140));
    if (Math.abs(dx) > 110) { navigator.vibrate?.(20); end(false, 'cancel'); return; }
    if (dy < -70) { c.locked = true; navigator.vibrate?.(20); ui(true, c); }
  });
  mic.addEventListener('pointerup', (e) => {
    const c = cap;
    if (!c || c.locked || e.pointerId !== c.pointer) return;
    end(Date.now() - c.t0 >= MIN_HOLD, 'short');
  });
  mic.addEventListener('pointercancel', (e) => {
    const c = cap;
    if (!c || c.locked || e.pointerId !== c.pointer) return;
    end(false);
    say('الميكروفون جاهز. اضغط مطولاً على 🎙 وتكلّم، ثم أفلت للإرسال.');
  });
  bar.querySelector('.rec-bar__trash').addEventListener('click', () => end(false, 'cancel'));

  return { stop: () => end(false) };
}
