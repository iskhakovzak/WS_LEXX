/**
 * routes/offerings.ts — cache-first decision of GET /offerings/watch (ROMAN-04). Pure function only: no route is
 * called, so nothing here can reach SEC / NASDAQ / Yahoo.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [] })) } }));
process.env.JWT_SECRET ??= "vitest-only-secret";
const { watchCachePlan } = await import("../offerings");

const MIN = 60_000;
const NOW = Date.parse("2026-10-19T14:00:00Z"); // Mon 10:00 NY
const base = { day: "2026-10-19", today: "2026-10-19", now: NOW, ttlMs: 10 * MIN, force: false, revalidate: false };

describe("watchCachePlan", () => {
  it("nothing stored or force=1 → upstream fetch", () => {
    expect(watchCachePlan({ ...base, storedAt: null })).toBe("fetch");
    expect(watchCachePlan({ ...base, storedAt: NOW - MIN, force: true })).toBe("fetch");
  });

  it("stored within the TTL → served as fresh", () => {
    expect(watchCachePlan({ ...base, storedAt: NOW - 3 * MIN })).toBe("fresh");
  });

  it("older today → served at once as stale; the page's revalidate=1 call fetches", () => {
    const storedAt = Date.parse("2026-10-19T12:10:00Z"); // 08:10 NY
    expect(watchCachePlan({ ...base, storedAt })).toBe("stale");
    expect(watchCachePlan({ ...base, storedAt, revalidate: true })).toBe("fetch");
  });

  it("a past day stored after it was over no longer changes → fresh; stored during that day → stale", () => {
    const past = { ...base, day: "2026-10-16" };
    expect(watchCachePlan({ ...past, storedAt: Date.parse("2026-10-17T15:00:00Z") })).toBe("fresh");
    expect(watchCachePlan({ ...past, storedAt: Date.parse("2026-10-16T15:00:00Z") })).toBe("stale");
  });
});
