/**
 * «Мои темы» pure rules + the per-ticker cache + merging into the board (mocked providers, no network, no DB):
 * view normalising, Finviz screener URL / filter parsing (the auth token is dropped), limits, screener resolution,
 * personal quotes fetched only for missing / stale tickers.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MemberQuote } from "../../themes/logic";
import {
  DEFAULT_VIEW, MAX_PERSONAL_THEMES, MAX_SCREENER_FILTERS, RESOLVE_TTL_MS, SCREENER_TOP, normalizeView, parseScreenerInput, resolveStale, screenerKey,
} from "../../themes/personal";
import { FAIL_BACKOFF_MS, MAX_AGE_MS, isFresh, quotesFor, seedQuotes, setTickerCacheDeps } from "../../themes/tickerCache";
import { resolveScreener, setScreenerDeps } from "../../themes/screener";

const q = (ticker: string, today: number): MemberQuote => ({ ticker, price: 10, today, fromOpen: today / 2, premarket: null, afterHours: null });
const TODAY = "2026-10-20";

describe("view", () => {
  it("keeps known columns in table order, ≥ 1; hidden = unique positive ids", () => {
    expect(normalizeView({ columns: ["today", "premarket", "week"], hidden: [3, 3, -1, 2.5, 7] })).toEqual({ columns: ["premarket", "today"], hidden: [3, 7], sort: null, tab: "shared" });
    expect(normalizeView({ columns: [] })).toEqual(DEFAULT_VIEW);
    expect(normalizeView(null)).toEqual({ columns: ["premarket", "fromOpen", "today", "afterHours"], hidden: [], sort: null, tab: "shared" });
    expect(normalizeView({ sort: { col: "today", dir: "asc" }, tab: 12 })).toMatchObject({ sort: { col: "today", dir: "asc" }, tab: 12 });
    expect(normalizeView({ sort: { col: "gap", dir: "asc" }, tab: -1 })).toMatchObject({ sort: null, tab: "shared" });
  });
});

describe("parseScreenerInput", () => {
  it("a pasted Finviz URL: only f and o are kept — auth and everything else dropped", () => {
    const r = parseScreenerInput("https://elite.finviz.com/screener.ashx?v=111&f=sec_technology,cap_large,sh_avgvol_o500&o=-volume&auth=SECRET-123&ft=4");
    expect(r).toEqual({ ok: true, spec: { filters: ["sec_technology", "cap_large", "sh_avgvol_o500"], order: "-volume" } });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("a query string, a plain list; lower-cased and de-duplicated; order from the field when the URL has none", () => {
    expect(parseScreenerInput("f=ind_semiconductors&auth=x")).toEqual({ ok: true, spec: { filters: ["ind_semiconductors"], order: null } });
    expect(parseScreenerInput("SEC_Energy, cap_mid  sec_energy", "-marketcap")).toEqual({ ok: true, spec: { filters: ["sec_energy", "cap_mid"], order: "-marketcap" } });
    expect(parseScreenerInput("screener.ashx?f=sec_utilities")).toEqual({ ok: true, spec: { filters: ["sec_utilities"], order: null } });
  });

  it("strict tokens, ≤ 15, a valid order; empty input / URL without f → refused", () => {
    expect(parseScreenerInput("")).toEqual({ ok: false, reason: "empty" });
    expect(parseScreenerInput("https://finviz.com/screener.ashx?v=111&auth=x")).toEqual({ ok: false, reason: "empty" });
    expect(parseScreenerInput("sec_technology, sh_relvol_o1.5")).toEqual({ ok: true, spec: { filters: ["sec_technology", "sh_relvol_o1.5"], order: null } });
    expect(parseScreenerInput("sec_technology, .hidden")).toMatchObject({ ok: false, reason: "invalid", bad: [".hidden"] });
    expect(parseScreenerInput("x")).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseScreenerInput("sec_technology,<script>")).toMatchObject({ ok: false, reason: "invalid", bad: ["<script>"] });
    const many = Array.from({ length: MAX_SCREENER_FILTERS + 1 }, (_, i) => `f_${i}x`).join(",");
    expect(parseScreenerInput(many)).toEqual({ ok: false, reason: "tooMany" });
    expect(parseScreenerInput("sec_energy", "-market cap")).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("limits and keys", () => {
    expect(MAX_PERSONAL_THEMES).toBe(10);
    expect(SCREENER_TOP).toBe(25);
    expect(screenerKey({ filters: ["sec_energy"], order: null })).toBe("sec_energy|-marketcap");
    expect(resolveStale(null, 0)).toBe(true);
    expect(resolveStale(1000, 1000 + RESOLVE_TTL_MS - 1)).toBe(false);
    expect(resolveStale(1000, 1000 + RESOLVE_TTL_MS)).toBe(true);
  });
});

describe("per-ticker cache", () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  function setup(answer: (tickers: readonly string[]) => Map<string, MemberQuote> | Promise<Map<string, MemberQuote>>) {
    let now = Date.UTC(2026, 9, 20, 15);
    const calls: string[][] = [];
    restore = setTickerCacheDeps({
      now: () => now,
      fetchQuotes: async (tickers) => { calls.push([...tickers]); return { source: "yahoo", quotes: await answer(tickers) }; },
    });
    return { calls, advance: (ms: number) => { now += ms; }, now: () => now };
  }

  it("seeded (base) tickers cost nothing; only missing ones are fetched", async () => {
    const h = setup((t) => new Map(t.map((x) => [x, q(x, 1)])));
    seedQuotes(new Map([["MU", q("MU", 2)]]), "rth", h.now());
    const out = await quotesFor(["MU", "IONQ", "ionq"], "rth", TODAY);
    expect(h.calls).toEqual([["IONQ"]]);
    expect([out.get("MU")!.today, out.get("IONQ")!.today]).toEqual([2, 1]);
    expect(isFresh("IONQ", "rth", h.now())).toBe(true);
  });

  it("fresh within the session TTL; stale after it or when the session changes", async () => {
    const h = setup((t) => new Map(t.map((x) => [x, q(x, 1)])));
    await quotesFor(["A"], "rth", TODAY);
    h.advance(20_000);
    await quotesFor(["A"], "rth", TODAY);
    expect(h.calls).toHaveLength(1);
    h.advance(15_000);
    await quotesFor(["A"], "rth", TODAY);
    expect(h.calls).toHaveLength(2);
    await quotesFor(["A"], "post", TODAY);
    expect(h.calls).toHaveLength(3);
  });

  it("single-flight: concurrent requests for overlapping tickers share the batch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = setup(async (t) => { await gate; return new Map(t.map((x) => [x, q(x, 3)])); });
    const p = Promise.all([quotesFor(["A", "B"], "rth", TODAY), quotesFor(["B", "A"], "rth", TODAY), quotesFor(["A", "C"], "rth", TODAY)]);
    await new Promise((r) => setTimeout(r, 5));
    release();
    const [x, y, z] = await p;
    expect(h.calls).toEqual([["A", "B"], ["C"]]);
    expect([x.size, y.size, z.size]).toEqual([2, 2, 2]);
  });

  it("batches of ≤ 100; a ticker the providers did not return backs off; very old quotes are not served", async () => {
    const h = setup((t) => new Map(t.filter((x) => x !== "BAD").map((x) => [x, q(x, 1)])));
    const many = Array.from({ length: 150 }, (_, i) => `T${i}`);
    await quotesFor([...many, "BAD"], "rth", TODAY);
    expect(h.calls.map((c) => c.length)).toEqual([100, 51]);
    h.advance(FAIL_BACKOFF_MS - 1);
    await quotesFor(["BAD"], "rth", TODAY);
    expect(h.calls).toHaveLength(2);
    h.advance(1);
    await quotesFor(["BAD"], "rth", TODAY);
    expect(h.calls).toHaveLength(3);
    h.advance(MAX_AGE_MS);
    const restoreOld = setTickerCacheDeps({ now: () => h.now(), fetchQuotes: async () => { throw new Error("down"); } });
    seedQuotes(new Map([["OLD", q("OLD", 5)]]), "rth", h.now() - MAX_AGE_MS);
    expect((await quotesFor(["OLD"], "rth", TODAY)).has("OLD")).toBe(false);
    restoreOld();
  });
});

describe("screener resolution", () => {
  const restores: (() => void)[] = [];
  afterEach(() => { while (restores.length) restores.pop()!(); });

  it("top 50 of the export (themes take 25, boards 25 / 50), one run per screener key per hour; Finviz off → null", async () => {
    let runs = 0;
    restores.push(setScreenerDeps({ enabled: () => true, now: () => 0, run: async () => { runs++; return Array.from({ length: 70 }, (_, i) => `S${i}`); } }));
    const a = await resolveScreener({ filters: ["sec_energy"], order: null });
    const b = await resolveScreener({ filters: ["sec_energy"], order: null });
    expect(a!.tickers).toHaveLength(50);
    expect(SCREENER_TOP).toBe(25);
    expect(b).toBe(a);
    expect(runs).toBe(1);
    restores.push(setScreenerDeps({ enabled: () => false }));
    expect(await resolveScreener({ filters: ["sec_energy"], order: null })).toBeNull();
  });
});
