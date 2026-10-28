import { describe, expect, it } from "vitest";
import { EMPTY_ROTATION, SURFACE_WEIGHTS, eligiblePool, hashString, nextQuote, parseRotation, quoteForSlot, seededRandom, type RotationState } from "../rotation";
import { QUOTE_CATS, QUOTE_TAGS, type QuoteCat, type QuoteMeta, type QuoteTag } from "../types";

/** A random pool: n quotes over random categories and tags. */
function pool(n: number, seed: number): QuoteMeta[] {
  const rnd = seededRandom(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `q-${String(i).padStart(4, "0")}`,
    cat: QUOTE_CATS[Math.floor(rnd() * QUOTE_CATS.length)]!,
    tags: [QUOTE_TAGS[Math.floor(rnd() * QUOTE_TAGS.length)]!],
    author: "a",
    work: "w",
    loc: "",
    rel: "verified" as const,
  }));
}

function drawMany(list: QuoteMeta[], k: number, opt: Parameters<typeof nextQuote>[2], start: RotationState = EMPTY_ROTATION) {
  let s = start;
  const ids: string[] = [];
  for (let i = 0; i < k; i++) {
    const r = nextQuote(list, s, opt, `slot-${i}`)!;
    ids.push(r.id);
    s = r.state;
  }
  return { ids, state: s };
}

describe("nextQuote — no repeats until the whole pool is shown (property)", () => {
  it("for random pools, seeds, surfaces and context tags: the first N draws are N distinct ids", () => {
    for (let trial = 0; trial < 60; trial++) {
      const rnd = seededRandom(1000 + trial);
      const n = 1 + Math.floor(rnd() * 180);
      const list = pool(n, trial);
      const surface = rnd() < 0.5 ? "dash" : "lock";
      const preferTags: QuoteTag[] | null = rnd() < 0.5 ? [QUOTE_TAGS[Math.floor(rnd() * QUOTE_TAGS.length)]!] : null;
      const { ids } = drawMany(list, n, { seed: Math.floor(rnd() * 2 ** 31), weights: SURFACE_WEIGHTS[surface], preferTags });
      expect(new Set(ids).size, `trial ${trial} (n=${n})`).toBe(n);
      expect(new Set(ids)).toEqual(new Set(list.map((q) => q.id)));
    }
  });

  it("with categories switched off: every eligible quote once, none from the others", () => {
    const list = pool(300, 7);
    const cats: QuoteCat[] = ["olympus", "philosophy"];
    const eligible = eligiblePool(list, { weights: SURFACE_WEIGHTS.dash, cats });
    const { ids } = drawMany(list, eligible.length, { seed: 42, weights: SURFACE_WEIGHTS.dash, cats });
    expect(new Set(ids).size).toBe(eligible.length);
    expect(ids.every((id) => cats.includes(list.find((q) => q.id === id)!.cat))).toBe(true);
  });

  it("the next cycle starts after the pool is exhausted, never with the quote that closed the previous one", () => {
    for (let trial = 0; trial < 20; trial++) {
      const list = pool(2 + trial, 50 + trial);
      const first = drawMany(list, list.length, { seed: trial, weights: SURFACE_WEIGHTS.lock });
      expect(first.state.cycle).toBe(0);
      const next = nextQuote(list, first.state, { seed: trial, weights: SURFACE_WEIGHTS.lock }, "x")!;
      expect(next.state.cycle).toBe(1);
      expect(next.id).not.toBe(first.ids[first.ids.length - 1]);
      // …and the second cycle is again a full permutation.
      const second = drawMany(list, list.length, { seed: trial, weights: SURFACE_WEIGHTS.lock }, first.state);
      expect(new Set(second.ids).size).toBe(list.length);
    }
  });

  it("is deterministic: same seed → same order; another seed → another order", () => {
    const list = pool(120, 3);
    const a = drawMany(list, 40, { seed: 1, weights: SURFACE_WEIGHTS.dash }).ids;
    const b = drawMany(list, 40, { seed: 1, weights: SURFACE_WEIGHTS.dash }).ids;
    const c = drawMany(list, 40, { seed: 2, weights: SURFACE_WEIGHTS.dash }).ids;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("weights: the lock screen front-loads «Олимп» and philosophers, the dashboard trading and psychology", () => {
    const list = QUOTE_CATS.flatMap((cat) => Array.from({ length: 200 }, (_, i) => ({ id: `${cat}-${i}`, cat, tags: ["wisdom" as QuoteTag], author: "a", work: "w", loc: "", rel: "verified" as const })));
    const share = (ids: string[], cats: QuoteCat[]) => ids.filter((id) => cats.some((c) => id.startsWith(`${c}-`))).length / ids.length;
    const lock = drawMany(list, 200, { seed: 9, weights: SURFACE_WEIGHTS.lock }).ids;
    const dash = drawMany(list, 200, { seed: 9, weights: SURFACE_WEIGHTS.dash }).ids;
    expect(share(lock, ["olympus", "philosophy"])).toBeGreaterThan(0.6);
    expect(share(dash, ["trading", "psychology"])).toBeGreaterThan(0.45);
  });
});

describe("nextQuote — context tags", () => {
  it("prefers unseen quotes with a context tag while any is left, then falls back to the rest", () => {
    const list: QuoteMeta[] = Array.from({ length: 30 }, (_, i) => ({
      id: `q-${i}`, cat: "olympus", tags: [i < 5 ? "patience" : "wisdom"], author: "a", work: "w", loc: "", rel: "verified",
    }));
    const { ids } = drawMany(list, 30, { seed: 5, weights: SURFACE_WEIGHTS.dash, preferTags: ["patience", "loss"] });
    expect(new Set(ids.slice(0, 5))).toEqual(new Set(["q-0", "q-1", "q-2", "q-3", "q-4"]));
    expect(new Set(ids).size).toBe(30);
  });
});

describe("quoteForSlot", () => {
  const list = pool(50, 11);
  const opt = { seed: 3, weights: SURFACE_WEIGHTS.dash };
  it("keeps the quote within a slot and draws a new one when the slot changes", () => {
    const a = quoteForSlot(list, EMPTY_ROTATION, opt, "2026-10-26")!;
    expect(a.changed).toBe(true);
    const again = quoteForSlot(list, a.state, opt, "2026-10-26")!;
    expect(again).toMatchObject({ id: a.id, changed: false });
    const next = quoteForSlot(list, a.state, opt, "2026-10-27")!;
    expect(next.changed).toBe(true);
    expect(next.id).not.toBe(a.id);
  });
  it("re-draws when the stored quote left the library", () => {
    const s: RotationState = { v: 1, cycle: 0, seen: ["gone"], current: { id: "gone", slot: "d" } };
    const r = quoteForSlot(list, s, opt, "d")!;
    expect(r.changed).toBe(true);
    expect(list.some((q) => q.id === r.id)).toBe(true);
  });
});

describe("parseRotation / hashString", () => {
  it("rejects malformed state", () => {
    expect(parseRotation(null)).toEqual(EMPTY_ROTATION);
    expect(parseRotation({ v: 2, seen: [] })).toEqual(EMPTY_ROTATION);
    expect(parseRotation({ v: 1, cycle: -3, seen: ["a", 5, "b"], current: { id: "b", slot: 1 } })).toEqual({ v: 1, cycle: 0, seen: ["a", "b"], current: null });
  });
  it("hashes stably", () => {
    expect(hashString("zakir")).toBe(hashString("zakir"));
    expect(hashString("zakir")).not.toBe(hashString("Zakir"));
  });
});

// The tag sets the web sends after a red day / on a green streak (edge-tracker lib/quotes/context.ts MOOD_TAGS).
describe("context selection", () => {
  const list: QuoteMeta[] = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `w-${i}`, cat: "trading" as const, tags: ["wisdom" as const], author: "a", work: "w", loc: "", rel: "verified" as const })),
    { id: "r-1", cat: "philosophy", tags: ["loss"], author: "a", work: "w", loc: "", rel: "verified" },
    { id: "r-2", cat: "olympus", tags: ["patience", "fate"], author: "a", work: "w", loc: "", rel: "verified" },
    { id: "g-1", cat: "psychology", tags: ["humility"], author: "a", work: "w", loc: "", rel: "verified" },
    { id: "g-2", cat: "trading", tags: ["process"], author: "a", work: "w", loc: "", rel: "verified" },
  ];
  it("after a red day the day's quote carries a patience / loss / resilience tag", () => {
    for (let seed = 0; seed < 25; seed++) {
      const r = nextQuote(list, EMPTY_ROTATION, { seed, weights: SURFACE_WEIGHTS.dash, preferTags: ["patience", "loss", "resilience", "endurance", "control"] }, "d")!;
      expect(["r-1", "r-2"]).toContain(r.id);
    }
  });
  it("on a green streak it carries humility / process", () => {
    for (let seed = 0; seed < 25; seed++) {
      const r = nextQuote(list, EMPTY_ROTATION, { seed, weights: SURFACE_WEIGHTS.dash, preferTags: ["humility", "process", "moderation", "discipline", "ego"] }, "d")!;
      expect(["g-1", "g-2"]).toContain(r.id);
    }
  });
});
