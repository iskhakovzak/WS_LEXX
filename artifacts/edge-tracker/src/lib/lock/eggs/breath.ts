/**
 * Lock-screen easter egg «Дыхание»: a paced-breathing timeline for a minute's reset after a loss. Pure: the component
 * asks `breathAt(elapsed)` every frame and draws the circle at `scale`.
 *
 *   box — 4 in · 4 hold · 4 out · 4 hold (16 s); 4 cycles ≈ 1 minute.
 *   478 — 4 in · 7 hold · 8 out (19 s); 3 cycles ≈ 1 minute.
 */

export type BreathPattern = "box" | "478";
export const BREATH_PATTERNS: readonly BreathPattern[] = ["box", "478"];

export type BreathPhase = "in" | "hold" | "out" | "rest";

const STEPS: Record<BreathPattern, readonly { phase: BreathPhase; s: number }[]> = {
  box: [{ phase: "in", s: 4 }, { phase: "hold", s: 4 }, { phase: "out", s: 4 }, { phase: "rest", s: 4 }],
  "478": [{ phase: "in", s: 4 }, { phase: "hold", s: 7 }, { phase: "out", s: 8 }],
};

export function cycleSeconds(p: BreathPattern): number {
  return STEPS[p].reduce((a, x) => a + x.s, 0);
}

/** Whole cycles that make about a minute. */
export function cyclesFor(p: BreathPattern): number {
  return Math.max(1, Math.round(60 / cycleSeconds(p)));
}

export function sessionSeconds(p: BreathPattern): number {
  return cycleSeconds(p) * cyclesFor(p);
}

export const MIN_SCALE = 0.55;

const ease = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;

export type BreathFrame = {
  phase: BreathPhase;
  /** Whole seconds left in this phase (the big countdown: 4, 3, 2, 1). */
  count: number;
  /** Circle scale, MIN_SCALE (empty) … 1 (full). */
  scale: number;
  cycle: number;
  done: boolean;
};

export function breathAt(elapsed: number, p: BreathPattern): BreathFrame {
  const total = sessionSeconds(p);
  if (elapsed >= total) return { phase: "rest", count: 0, scale: MIN_SCALE, cycle: cyclesFor(p), done: true };
  const t = Math.max(0, elapsed);
  const cyc = cycleSeconds(p);
  const cycle = Math.floor(t / cyc);
  let into = t - cycle * cyc;
  for (const st of STEPS[p]) {
    if (into < st.s) {
      const k = into / st.s;
      const span = 1 - MIN_SCALE;
      const scale = st.phase === "in" ? MIN_SCALE + span * ease(k)
        : st.phase === "out" ? 1 - span * ease(k)
          : st.phase === "hold" ? 1 : MIN_SCALE;
      return { phase: st.phase, count: Math.ceil(st.s - into), scale, cycle, done: false };
    }
    into -= st.s;
  }
  return { phase: "rest", count: 0, scale: MIN_SCALE, cycle, done: false };
}
