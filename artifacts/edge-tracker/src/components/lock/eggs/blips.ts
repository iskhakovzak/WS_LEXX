/**
 * Soft WebAudio blips for the lock-screen games. Off by default; the AudioContext is created on the first blip after
 * the sound was switched on (that switch is a user gesture, so browsers allow it). Fails silently without WebAudio.
 */

export type Blip = "paddle" | "wall" | "point" | "lose" | "win" | "right" | "wrong" | "tick";

const TONES: Record<Blip, readonly [freq: number, ms: number][]> = {
  paddle: [[660, 45]],
  wall: [[440, 30]],
  point: [[523, 70], [784, 110]],
  lose: [[330, 90], [220, 160]],
  win: [[523, 80], [659, 80], [784, 80], [1047, 180]],
  right: [[880, 60]],
  wrong: [[196, 140]],
  tick: [[520, 25]],
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = Ctor ? new Ctor() : null;
  } catch { ctx = null; }
  return ctx;
}

export function playBlip(kind: Blip): void {
  const a = audio();
  if (!a) return;
  try {
    if (a.state === "suspended") void a.resume();
    let t = a.currentTime + 0.005;
    for (const [freq, ms] of TONES[kind]) {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain).connect(a.destination);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.02);
      t += ms / 1000;
    }
  } catch { /* audio is a nicety */ }
}
