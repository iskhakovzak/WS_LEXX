/**
 * lib/themes/quotes.ts + service.ts with mocked providers (never finviz.com / yahoo.com): provider order and
 * fallback, Yahoo batching, the Finviz export through the real client with a fake fetch, the cache (TTL, single-flight,
 * stale numbers kept on failure).
 */
import { afterEach, describe, expect, it } from "vitest";
import { fetchTickers, setFinvizClientDeps } from "../../finviz/client";
import type { MemberQuote, YahooQuoteLike } from "../../themes/logic";
import { _resetPremarketHold, fetchThemeQuotes, YAHOO_BATCH, type QuoteDeps } from "../../themes/quotes";
import { FAIL_BACKOFF_MS, getThemes, setThemeServiceDeps } from "../../themes/service";

const TODAY = "2026-10-20";
/** 2026-10-20 11:00 New York — regular session. */
const RTH_NOON = Date.UTC(2026, 9, 20, 15, 0);
const sec = (ms: number) => Math.floor(ms / 1000);

function yahooRow(symbol: string, price: number, prev: number, open: number): YahooQuoteLike {
  return { symbol, regularMarketPrice: price, regularMarketPreviousClose: prev, regularMarketOpen: open, regularMarketTime: sec(RTH_NOON) };
}

const noFinviz: Pick<QuoteDeps, "finvizOn" | "finviz"> = {
  finvizOn: () => false,
  finviz: async () => { throw new Error("finviz must not be called"); },
};

describe("fetchThemeQuotes", () => {
  let restoreFinviz: (() => void) | null = null;
  afterEach(() => { restoreFinviz?.(); restoreFinviz = null; _resetPremarketHold(); });

  it("Yahoo when Finviz is off: batches of ≤ 50 symbols, rows → moves", async () => {
    const tickers = Array.from({ length: 120 }, (_, i) => `T${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    const calls: string[][] = [];
    const res = await fetchThemeQuotes(tickers, "rth", TODAY, {
      ...noFinviz,
      yahooBatch: async (symbols) => {
        calls.push([...symbols]);
        return symbols.map((s) => yahooRow(s, 102, 100, 101));
      },
    });
    expect(calls.map((c) => c.length)).toEqual([YAHOO_BATCH, YAHOO_BATCH, 20]);
    expect(res.source).toBe("yahoo");
    expect(res.quotes.size).toBe(120);
    expect(res.quotes.get(tickers[0]!)).toEqual({ ticker: tickers[0], price: 102, today: 2, fromOpen: 0.99, premarket: null, afterHours: null });
  });

  it("a failed Yahoo batch only drops its symbols; nothing at all → throws", async () => {
    const tickers = Array.from({ length: 60 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    let n = 0;
    const res = await fetchThemeQuotes(tickers, "rth", TODAY, {
      ...noFinviz,
      yahooBatch: async (symbols) => (n++ === 0 ? null : symbols.map((s) => yahooRow(s, 1, 1, 1))),
    });
    expect(res.quotes.size).toBe(10);
    await expect(fetchThemeQuotes(["MU"], "rth", TODAY, { ...noFinviz, yahooBatch: async () => null })).rejects.toThrow(/no quotes/);
  });

  it("Finviz first (real client, fake fetch): Change / Gap → today / fromOpen; Yahoo only fills pre / post", async () => {
    const urls: string[] = [];
    const yahooCalls: string[][] = [];
    let clock = 1_000_000;
    restoreFinviz = setFinvizClientDeps({
      token: () => "TEST-TOKEN",
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      fetch: async (url) => {
        urls.push(url);
        const body = [
          '"No.","Ticker","Gap","Price","Change"',
          '"1","MU","5.00%","110.00","10.00%"',
          '"2","WDC","","50.00","-1.00%"',
        ].join("\n");
        return { ok: true, status: 200, text: async () => body };
      },
    });
    const res = await fetchThemeQuotes(["MU", "WDC", "STX"], "rth", TODAY, {
      finvizOn: () => true,
      finviz: (t, d) => fetchTickers(t, d),
      // Only the premarket / after-hours fill: Finviz's today / fromOpen win over Yahoo's.
      yahooBatch: async (symbols) => {
        yahooCalls.push([...symbols]);
        return [{ ...yahooRow("MU", 999, 100, 100), preMarketPrice: 101.2, preMarketTime: sec(RTH_NOON) - 3 * 3600 }];
      },
    });
    expect(yahooCalls).toEqual([["MU", "WDC"]]);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]!).searchParams.get("t")).toBe("MU,WDC,STX");
    expect(res.source).toBe("finviz");
    expect(res.quotes.get("MU")).toEqual({ ticker: "MU", price: 110, today: 10, fromOpen: 4.76, premarket: 1.2, afterHours: null });
    expect(res.quotes.get("WDC")).toEqual({ ticker: "WDC", price: 50, today: -1, fromOpen: null, premarket: null, afterHours: null });
    expect(res.quotes.has("STX")).toBe(false);
  });

  it("Finviz with Yahoo down: pre / post stay null, Finviz values kept", async () => {
    const res = await fetchThemeQuotes(["MU"], "rth", TODAY, {
      finvizOn: () => true,
      finviz: async () => ({ rows: [{ ticker: "MU", price: 10, changePct: 1, gapPct: 0 }], errors: [] }),
      yahooBatch: async () => { throw new Error("down"); },
    });
    expect(res.source).toBe("finviz");
    expect(res.quotes.get("MU")).toEqual({ ticker: "MU", price: 10, today: 1, fromOpen: 1, premarket: null, afterHours: null });
  });

  it("Finviz on but empty / failing → Yahoo", async () => {
    const res = await fetchThemeQuotes(["MU"], "rth", TODAY, {
      finvizOn: () => true,
      finviz: async () => ({ rows: [], errors: ["finviz: HTTP 500"] }),
      yahooBatch: async (s) => s.map((x) => yahooRow(x, 2, 1, 1)),
    });
    expect(res.source).toBe("yahoo");
    expect(res.quotes.get("MU")!.today).toBe(100);
  });
});

describe("premarket of the day is held after 09:30 (audit 2026-10-20: 0 of 358 tickers had it at 11:08 NY)", () => {
  afterEach(() => { _resetPremarketHold(); });
  /** 2026-10-20 08:00 NY — premarket. */
  const PRE_8 = Date.UTC(2026, 9, 20, 12, 0);
  const preRow = (s: string): YahooQuoteLike => ({
    symbol: s, regularMarketPrice: 100, regularMarketPreviousClose: 99, regularMarketTime: sec(Date.UTC(2026, 9, 19, 20, 0)),
    preMarketPrice: 101.5, preMarketTime: sec(PRE_8),
  });
  // After the open Yahoo sends no premarket fields at all.
  const rthRow = (s: string): YahooQuoteLike => yahooRow(s, 103, 100, 102);

  it("Yahoo path: the 08:00 print (+1,5 %) is still answered at 11:00; another day starts empty", async () => {
    const pre = await fetchThemeQuotes(["MU"], "pre", TODAY, { ...noFinviz, yahooBatch: async (s) => s.map(preRow) });
    expect(pre.quotes.get("MU")!.premarket).toBe(1.5);
    const rth = await fetchThemeQuotes(["MU"], "rth", TODAY, { ...noFinviz, yahooBatch: async (s) => s.map(rthRow) });
    expect(rth.quotes.get("MU")).toMatchObject({ today: 3, premarket: 1.5 });
    const post = await fetchThemeQuotes(["MU"], "post", TODAY, { ...noFinviz, yahooBatch: async (s) => s.map(rthRow) });
    expect(post.quotes.get("MU")!.premarket).toBe(1.5);
    const next = await fetchThemeQuotes(["MU"], "rth", "2026-10-21", { ...noFinviz, yahooBatch: async (s) => s.map(rthRow) });
    expect(next.quotes.get("MU")!.premarket).toBeNull();
  });

  it("Finviz path: premarket filled from the Yahoo extended fetch before the open, held after it", async () => {
    const finviz = async () => ({ rows: [{ ticker: "MU", price: 103, changePct: 3, gapPct: 2 }], errors: [] });
    const pre = await fetchThemeQuotes(["MU"], "pre", TODAY, { finvizOn: () => true, finviz, yahooBatch: async (s) => s.map(preRow) });
    expect(pre.source).toBe("finviz");
    expect(pre.quotes.get("MU")!.premarket).toBe(1.5);
    const rth = await fetchThemeQuotes(["MU"], "rth", TODAY, { finvizOn: () => true, finviz, yahooBatch: async (s) => s.map(rthRow) });
    expect(rth.quotes.get("MU")).toMatchObject({ today: 3, premarket: 1.5 });
    // Yahoo down after the open: still held.
    const down = await fetchThemeQuotes(["MU"], "rth", TODAY, { finvizOn: () => true, finviz, yahooBatch: async () => null });
    expect(down.quotes.get("MU")!.premarket).toBe(1.5);
  });
});

describe("getThemes cache", () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  const THEMES = [
    { id: 1, name: "Memory", tickers: ["MU", "WDC"] },
    { id: 2, name: "Steel", tickers: ["NUE"] },
  ];
  const quotes = (v: number) =>
    new Map<string, MemberQuote>(["MU", "WDC", "NUE"].map((t) => [t, { ticker: t, price: 10, today: v, fromOpen: v / 2, premarket: null, afterHours: null }]));

  function setup(fetchQuotes: () => Promise<{ source: "yahoo" | "finviz"; quotes: Map<string, MemberQuote> }>) {
    let now = RTH_NOON;
    let calls = 0;
    restore = setThemeServiceDeps({
      now: () => now,
      loadThemes: async () => THEMES,
      isClosed: async () => false,
      fetchQuotes: async () => { calls++; return fetchQuotes(); },
    });
    return { advance: (ms: number) => { now += ms; }, calls: () => calls };
  }

  it("first request waits for quotes; within the TTL answers from cache; after it refreshes", async () => {
    let v = 1;
    const h = setup(async () => ({ source: "yahoo", quotes: quotes(v) }));
    const a = await getThemes();
    expect(a).toMatchObject({ session: "rth", source: "yahoo", stale: false, asOf: new Date(RTH_NOON).toISOString() });
    expect(a.themes.map((t) => [t.name, t.today, t.fromOpen])).toEqual([["Memory", 1, 0.5], ["Steel", 1, 0.5]]);
    v = 2;
    h.advance(10_000);
    expect((await getThemes()).themes[0]!.today).toBe(1);
    expect(h.calls()).toBe(1);
    h.advance(25_000);
    expect((await getThemes()).themes[0]!.today).toBe(2);
    expect(h.calls()).toBe(2);
  });

  it("single-flight: concurrent requests share one refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = setup(async () => { await gate; return { source: "finviz", quotes: quotes(3) }; });
    const p = Promise.all([getThemes(), getThemes(), getThemes()]);
    await new Promise((r) => setTimeout(r, 5));
    release();
    const out = await p;
    expect(h.calls()).toBe(1);
    expect(out.every((r) => r.source === "finviz" && r.themes[0]!.today === 3)).toBe(true);
  });

  it("a failed refresh keeps the last numbers, marks them stale, backs off", async () => {
    let fail = false;
    const h = setup(async () => { if (fail) throw new Error("down"); return { source: "yahoo", quotes: quotes(1) }; });
    await getThemes();
    fail = true;
    h.advance(31_000);
    const r = await getThemes();
    expect(r.stale).toBe(true);
    expect(r.themes[0]!.today).toBe(1);
    expect(h.calls()).toBe(2);
    h.advance(FAIL_BACKOFF_MS - 1_000);
    await getThemes();
    expect(h.calls()).toBe(2);
  });

  it("nothing ever fetched → source null, every ticker missing", async () => {
    setup(async () => { throw new Error("down"); });
    const r = await getThemes();
    expect(r).toMatchObject({ source: null, asOf: null, stale: false });
    expect(r.themes[0]!.missing).toEqual(["MU", "WDC"]);
  });
});
