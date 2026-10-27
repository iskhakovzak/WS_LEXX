import { describe, expect, it } from "vitest";
import { FLASH_EPSILON, INITIAL_FLASH, flashClassName, flashDirection, reduceFlash, type FlashState } from "./live-flash";

/** Feed a sequence of values (same resetKey) and collect the direction after each. */
function run(values: (number | null | undefined)[], resetKey?: unknown, start: FlashState = INITIAL_FLASH) {
  let s = start;
  const dirs: (string | null)[] = [];
  for (const v of values) {
    s = reduceFlash(s, v, resetKey);
    dirs.push(s.dir);
  }
  return { state: s, dirs };
}

describe("flashDirection", () => {
  it("up / down by the sign of the move", () => {
    expect(flashDirection(100, 120)).toBe("up");
    expect(flashDirection(100, -5)).toBe("down");
  });
  it("ignores sub-cent noise, keeps exactly one cent (float-safe)", () => {
    expect(flashDirection(100, 100.004)).toBeNull();
    expect(flashDirection(100, 99.995)).toBeNull();
    expect(flashDirection(0.29, 0.3)).toBe("up");
    expect(flashDirection(10.3, 10.29)).toBe("down");
    expect(FLASH_EPSILON).toBe(0.01);
  });
  it("nothing without two finite numbers", () => {
    expect(flashDirection(null, 5)).toBeNull();
    expect(flashDirection(5, undefined)).toBeNull();
    expect(flashDirection(5, Number.NaN)).toBeNull();
    expect(flashDirection(5, 5)).toBeNull();
  });
  it("a custom epsilon (R, percent)", () => {
    expect(flashDirection(1, 1.05, 0.1)).toBeNull();
    expect(flashDirection(1, 1.1, 0.1)).toBe("up");
  });
});

describe("reduceFlash", () => {
  it("no flash on the first value", () => {
    const { dirs, state } = run([250]);
    expect(dirs).toEqual([null]);
    expect(state.base).toBe(250);
    expect(state.tick).toBe(0);
  });

  it("flashes on a real move, not on a refetch with the same value", () => {
    const { dirs, state } = run([250, 250, 300, 300, 120]);
    expect(dirs).toEqual([null, null, "up", "up", "down"]);
    // The direction stays until the next change; the tick only bumps on flashes.
    expect(state.tick).toBe(2);
  });

  it("a repeat in the same direction bumps the tick (restarts the animation)", () => {
    const a = run([0, 10]).state;
    const b = reduceFlash(a, 20);
    expect(a.dir).toBe("up");
    expect(b.dir).toBe("up");
    expect(b.tick).toBe(a.tick + 1);
  });

  it("sub-cent noise neither flashes nor moves the baseline; drift that adds up to a cent does", () => {
    const s1 = run([100, 100.004]).state;
    expect(s1.dir).toBeNull();
    expect(s1.base).toBe(100);
    const s2 = reduceFlash(s1, 100.008);
    expect(s2.dir).toBeNull();
    const s3 = reduceFlash(s2, 100.012);
    expect(s3.dir).toBe("up");
    expect(s3.base).toBe(100.012);
  });

  it("returns the same object when nothing changed (no extra render)", () => {
    const s = run([5, 5.001]).state;
    expect(reduceFlash(s, 5)).toBe(s);
  });

  it("null breaks continuity: the next number is a fresh start", () => {
    const { dirs } = run([100, null, 500, 400]);
    expect(dirs).toEqual([null, null, null, "down"]);
  });

  it("starts with null, then the first number does not flash", () => {
    expect(run([null, undefined, 80, 90]).dirs).toEqual([null, null, null, "up"]);
  });

  it("a new resetKey (scope / period / unit switch) re-bases without a flash", () => {
    let s = reduceFlash(INITIAL_FLASH, 100, "me");
    s = reduceFlash(s, 200, "me");
    expect(s.dir).toBe("up");
    const tick = s.tick;
    s = reduceFlash(s, -900, "team");
    expect(s.dir).toBeNull();
    expect(s.base).toBe(-900);
    expect(s.tick).toBe(tick);
    s = reduceFlash(s, -850, "team");
    expect(s.dir).toBe("up");
  });

  it("honours a custom epsilon", () => {
    let s = reduceFlash(INITIAL_FLASH, 1, undefined, 0.1);
    s = reduceFlash(s, 1.05, undefined, 0.1);
    expect(s.dir).toBeNull();
    s = reduceFlash(s, 0.9, undefined, 0.1);
    expect(s.dir).toBe("down");
  });
});

describe("flashClassName", () => {
  it("empty without a direction", () => {
    expect(flashClassName(null, 3)).toBe("");
  });
  it("tone class + odd twin on odd ticks", () => {
    expect(flashClassName("up", 2)).toBe("live-flash live-flash-up");
    expect(flashClassName("down", 1)).toBe("live-flash live-flash-down live-flash-odd");
  });
});
