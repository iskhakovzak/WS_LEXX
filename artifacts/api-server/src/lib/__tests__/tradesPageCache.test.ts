import { describe, expect, it } from "vitest";
import { BoundedPromiseCache } from "../tradesPageCache";

describe("BoundedPromiseCache (trades/page summary, DEV-02)", () => {
  it("serves the cached value within the TTL and reloads after it", async () => {
    let now = 1_000;
    const cache = new BoundedPromiseCache<number>(60_000, 10, () => now);
    let loads = 0;
    const load = () => Promise.resolve(++loads);
    expect(await cache.getOrLoad("a", load)).toBe(1);
    now += 59_999;
    expect(await cache.getOrLoad("a", load)).toBe(1);
    now += 2;
    expect(await cache.getOrLoad("a", load)).toBe(2);
  });

  it("shares one in-flight computation between parallel callers", async () => {
    const cache = new BoundedPromiseCache<string>(60_000, 10);
    let loads = 0;
    let release!: (v: string) => void;
    const load = () => { loads++; return new Promise<string>((r) => { release = r; }); };
    const a = cache.getOrLoad("k", load);
    const b = cache.getOrLoad("k", load);
    release("x");
    expect(await Promise.all([a, b])).toEqual(["x", "x"]);
    expect(loads).toBe(1);
  });

  it("evicts a rejected load so the next call retries", async () => {
    const cache = new BoundedPromiseCache<number>(60_000, 10);
    await expect(cache.getOrLoad("k", () => Promise.reject(new Error("db")))).rejects.toThrow("db");
    await Promise.resolve();
    expect(await cache.getOrLoad("k", () => Promise.resolve(7))).toBe(7);
  });

  it("keeps at most maxEntries keys (oldest dropped) and clear() empties it", async () => {
    const cache = new BoundedPromiseCache<number>(60_000, 2);
    await cache.getOrLoad("a", () => Promise.resolve(1));
    await cache.getOrLoad("b", () => Promise.resolve(2));
    await cache.getOrLoad("c", () => Promise.resolve(3));
    expect(cache.size).toBe(2);
    expect(await cache.getOrLoad("a", () => Promise.resolve(10))).toBe(10);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
