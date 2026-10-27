/**
 * Live numbers (risk desk, «left to the stop», dashboard today, team view, office KPIs): the pure part of the
 * «flash on change» rule. A value that moved by at least `epsilon` (default one cent) flashes green when it went up and
 * red when it went down. Never on the first value, after a gap (null), after a context switch (`resetKey`), on a
 * refetch with the same value or on sub-cent noise. The React hook and <LiveNumber> live in components/ds/live-number.
 */

export type FlashDir = "up" | "down";

/** Changes below one cent are noise (float drift of a sum of fills), not a move. */
export const FLASH_EPSILON = 0.01;
/** The tint fades out over this many ms (CSS `live-flash` keyframes use the same value). */
export const FLASH_MS = 700;
/** Under reduced motion: a static marker (no fade) held this long, then removed. */
export const FLASH_STATIC_MS = 1500;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Direction of a move from `prev` to `next`, or null when there is nothing to flash. */
export function flashDirection(prev: number | null | undefined, next: number | null | undefined, epsilon = FLASH_EPSILON): FlashDir | null {
  if (!isNum(prev) || !isNum(next)) return null;
  const d = next - prev;
  // 1e-9: 0.30 − 0.29 is 0.0099999… in floats; it is still one cent.
  if (Math.abs(d) + 1e-9 < epsilon) return null;
  return d > 0 ? "up" : "down";
}

export type FlashState = {
  /** The baseline the next value is compared with (the last value that flashed, or the first one seen). */
  base: number | null;
  /** The context the baseline belongs to (scope, period, unit…): a new context starts without a flash. */
  resetKey: unknown;
  dir: FlashDir | null;
  /** Bumps on every flash, so two flashes in the same direction in a row still restart the animation. */
  tick: number;
  /** False until the first value has been seen. */
  seen: boolean;
};

export const INITIAL_FLASH: FlashState = { base: null, resetKey: undefined, dir: null, tick: 0, seen: false };

/**
 * Next state for a newly rendered value. Pure; the hook calls it once per value change.
 *  - first value / new resetKey / value after null → becomes the baseline, no flash;
 *  - null → clears the baseline (the next number is a fresh start);
 *  - a move below `epsilon` → no flash and the baseline is kept, so slow drift still flashes once it adds up to a cent;
 *  - otherwise → flash in the direction of the move, the value becomes the baseline.
 */
export function reduceFlash(state: FlashState, value: number | null | undefined, resetKey: unknown = undefined, epsilon = FLASH_EPSILON): FlashState {
  const v = isNum(value) ? value : null;
  if (!state.seen || !Object.is(state.resetKey, resetKey)) {
    return { base: v, resetKey, dir: null, tick: state.tick, seen: true };
  }
  if (v == null) return state.base == null ? state : { ...state, base: null, dir: null };
  if (state.base == null) return { ...state, base: v, dir: null };
  const dir = flashDirection(state.base, v, epsilon);
  if (!dir) return state;
  return { ...state, base: v, dir, tick: state.tick + 1 };
}

/** Class names for a flashing element: tone + an odd/even twin of the keyframes so a repeat flash restarts. */
export function flashClassName(dir: FlashDir | null, tick: number): string {
  if (!dir) return "";
  return `live-flash live-flash-${dir}${tick % 2 ? " live-flash-odd" : ""}`;
}
