/** Qo‘ng‘iroq ovozlari — WebAudio bilan yaratiladi (fayl yuklanmaydi) */
let ctx: AudioContext | null = null;
let stopCurrent: (() => void) | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Brauzer avtomatik ovozni bloklamasligi uchun birinchi bosishda AudioContext ochiladi */
export function primeCallAudio() {
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, gain = 0.12, type: OscillatorType = "sine") {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.02);
  g.gain.setValueAtTime(gain, start + dur - 0.04);
  g.gain.linearRampToValueAtTime(0, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function loop(pattern: (ac: AudioContext, t: number) => void, periodSec: number, vibrate?: number[]) {
  stopSound();
  const ac = audio();
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    if (!alive) return;
    if (ac) pattern(ac, ac.currentTime + 0.05);
    if (vibrate && "vibrate" in navigator) navigator.vibrate(vibrate);
    timer = setTimeout(tick, periodSec * 1000);
  };
  tick();
  stopCurrent = () => {
    alive = false;
    if (timer) clearTimeout(timer);
    if (vibrate && "vibrate" in navigator) navigator.vibrate(0);
  };
}

export function stopSound() {
  stopCurrent?.();
  stopCurrent = null;
}

/** Kiruvchi qo‘ng‘iroq — yoqimli ikki bosqichli kuy */
export function playRingtone() {
  loop(
    (ac, t) => {
      const notes = [659.25, 783.99, 987.77, 783.99];
      notes.forEach((f, i) => tone(ac, f, t + i * 0.16, 0.15, 0.14, "triangle"));
      notes.forEach((f, i) => tone(ac, f, t + 0.8 + i * 0.16, 0.15, 0.14, "triangle"));
    },
    2.6,
    [400, 200, 400],
  );
}

/** Foydalanuvchi bosgan paytda chaqiriladi — keyingi ovozlar brauzerda bloklanmasin */
export function unlockAudio() {
  audio();
}

/** Chiquvchi — «gudok» (425 Hz, 1 s / 3 s) */
export function playRingback() {
  loop((ac, t) => tone(ac, 425, t, 1, 0.18), 4);
}

export function playBusy() {
  stopSound();
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.05;
  for (let i = 0; i < 4; i++) tone(ac, 425, t + i * 0.7, 0.35, 0.16);
}

export function playEnded() {
  stopSound();
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.03;
  tone(ac, 620, t, 0.12, 0.08);
  tone(ac, 420, t + 0.14, 0.18, 0.08);
}

export function playConnected() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.03;
  tone(ac, 520, t, 0.09, 0.07);
  tone(ac, 780, t + 0.1, 0.12, 0.07);
}
