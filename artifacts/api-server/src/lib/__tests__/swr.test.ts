/** lib/swr.ts — single-flight, concurrency limiter, fresh / stale / miss windows (no network, no DB). */
import { describe, expect, it } from "vitest";
import { limiter, singleFlight, swrState } from "../swr";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("singleFlight", () => {
  it("concurrent callers of one key share one run; the key is free again once it settles", async () => {
    const f = singleFlight<string, number>();
    let calls = 0;
    const fn = async () => { calls++; await tick(5); return calls; };
    const [a, b, c] = await Promise.all([f.run("d", fn), f.run("d", fn), f.run("d", fn)]);
    expect([a, b, c]).toEqual([1, 1, 1]);
    expect(f.has("d")).toBe(false);
    expect(await f.run("d", fn)).toBe(2);
  });

  it("other keys run on their own; a rejection reaches every waiter and frees the key", async () => {
    const f = singleFlight<string, number>();
    const boom = f.run("x", async () => { await tick(1); throw new Error("down"); });
    const joined = f.run("x", async () => 7);
    expect(await f.run("y", async () => 3)).toBe(3);
    await expect(boom).rejects.toThrow("down");
    await expect(joined).rejects.toThrow("down");
    expect(f.size()).toBe(0);
  });
});

describe("limiter", () => {
  it("never more than n in flight; every task finishes, order of starts is FIFO", async () => {
    const limit = limiter(3);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => limit(async () => {
      started.push(i);
      active++; peak = Math.max(peak, active);
      await tick(2);
      active--;
      return i * 2;
    })));
    expect(peak).toBe(3);
    expect(out).toEqual(Array.from({ length: 10 }, (_, i) => i * 2));
    expect(started).toEqual([...started].sort((a, b) => a - b));
  });

  it("a failing task frees its slot", async () => {
    const limit = limiter(1);
    await expect(limit(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await limit(async () => 1)).toBe(1);
  });
});

describe("swrState", () => {
  it("fresh below the TTL, stale up to the keep window, miss beyond it or with nothing cached", () => {
    expect(swrState(null, 60, 180)).toBe("miss");
    expect(swrState(undefined, 60, 180)).toBe("miss");
    expect(swrState(0, 60, 180)).toBe("fresh");
    expect(swrState(-5, 60, 180)).toBe("fresh");
    expect(swrState(59, 60, 180)).toBe("fresh");
    expect(swrState(60, 60, 180)).toBe("stale");
    expect(swrState(179, 60, 180)).toBe("stale");
    expect(swrState(180, 60, 180)).toBe("miss");
    expect(swrState(Number.NaN, 60, 180)).toBe("miss");
  });
});
