/** Qo‘ng‘iroq ovozlari — WebAudio bilan yaratiladi (fayl yuklanmaydi) */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let stopCurrent: (() => void) | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    // Kompressor: kuy telefon karnayida ham bir tekis baland va aniq eshitiladi
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

function out(ac: AudioContext): AudioNode {
  return master ?? ac.destination;
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
  osc.connect(g).connect(out(ac));
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Qo‘ng‘iroqcha / marimba tembri: asosiy ton + obertonlar, tez hujum va so‘nish */
function bell(ac: AudioContext, freq: number, start: number, dur: number, gain = 0.25) {
  const partials: Array<[number, number]> = [
    [1, 1],
    [2, 0.42],
    [3, 0.18],
    [4.16, 0.08],
  ];
  for (const [mul, amp] of partials) {
    const f = freq * mul;
    if (f > 12000) continue;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    const peak = gain * amp;
    const d = dur / (1 + (mul - 1) * 0.6);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(g).connect(out(ac));
    osc.start(start);
    osc.stop(start + d + 0.05);
  }
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

// Notalar (Hz)
const N = {
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  Fs5: 739.99,
  G5: 783.99,
  A5: 880.0,
  B5: 987.77,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
};

/** Kiruvchi qo‘ng‘iroq — ravshan, ko‘tariluvchi kuy (uzoqdan ham eshitiladi) */
export function playRingtone() {
  loop(
    (ac, t) => {
      const phrase: Array<[number, number, number]> = [
        [N.E5, 0.0, 0.5],
        [N.G5, 0.15, 0.5],
        [N.B5, 0.3, 0.5],
        [N.E6, 0.45, 0.9],
        [N.D6, 0.9, 0.5],
        [N.B5, 1.05, 0.5],
        [N.G5, 1.2, 0.5],
        [N.A5, 1.35, 1.0],
      ];
      for (const [f, at, d] of phrase) bell(ac, f, t + at, d, 0.3);
      for (const [f, at, d] of phrase.slice(0, 4)) bell(ac, f, t + 2.0 + at, d, 0.3);
      bell(ac, N.D6, t + 2.6, 1.1, 0.3);
    },
    4.2,
    [600, 250, 600, 250, 600],
  );
}

/** Foydalanuvchi bosgan paytda chaqiriladi — keyingi ovozlar brauzerda bloklanmasin */
export function unlockAudio() {
  audio();
}

/** Chiquvchi — yoqimli musiqiy «gudok»: yumshoq kuy, har 4 soniyada (kutayotgani aniq bilinadi) */
export function playRingback() {
  loop(
    (ac, t) => {
      const notes: Array<[number, number, number]> = [
        [N.G4, 0.0, 1.0],
        [N.B4, 0.22, 1.0],
        [N.D5, 0.44, 1.0],
        [N.G5, 0.66, 1.6],
        [N.Fs5, 1.3, 0.9],
        [N.D5, 1.52, 1.4],
      ];
      for (const [f, at, d] of notes) bell(ac, f, t + at, d, 0.24);
      // past ohang — kuy to‘liqroq eshitilsin
      tone(ac, N.G4 / 2, t, 1.6, 0.05, "triangle");
    },
    4,
  );
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
  bell(ac, N.E5, t, 0.5, 0.16);
  bell(ac, N.C5, t + 0.16, 0.7, 0.16);
}

export function playConnected() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.03;
  bell(ac, N.C5, t, 0.4, 0.16);
  bell(ac, N.G5, t + 0.11, 0.6, 0.16);
}
