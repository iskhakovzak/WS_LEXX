/**
 * Speed rules of the slow market routes over a fake upstream (global fetch stubbed — no NASDAQ / SEC / Yahoo call
 * leaves the process; no DB): every upstream answer takes LAT ms.
 *   GET /offerings/watch   one upstream build per day however many widgets ask at once; the NASDAQ month feed is
 *                          fetched once for a whole week; a stored-but-old payload is answered at once and its refresh
 *                          starts server-side, so the page's `revalidate=1` call joins it.
 *   GET /earnings/watch    the AMC day is picked from the calendars (read in parallel) — only one past day is priced;
 *                          ≤ 20 Yahoo calls in flight; an expired entry is answered at once and refreshed behind.
 *   GET /stockdata/quote   one Yahoo call per symbol for concurrent requests; 60 s – 3 min old → answered at once.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const db = vi.hoisted(() => ({ stored: [] as Array<{ ticker: string; payload: unknown; fetched_at: Date }> }));
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM offering_ticker_cache/.test(sql) && params?.[0] === "watch_day") return { rows: db.stored, rowCount: db.stored.length };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("../../lib/marketDataService", async (orig) => ({ ...(await orig<object>()), fetchYahooWithSession: vi.fn(async () => null) }));
vi.mock("../../lib/candles/market", async (orig) => ({ ...(await orig<object>()), fetchDailyRange: vi.fn(async () => null) }));
vi.mock("../../lib/finviz/fundamentals", async (orig) => ({ ...(await orig<object>()), overlaySnapshots: vi.fn(async () => new Set<string>()) }));

const LAT = 120;
const NOW = Date.parse("2026-10-21T15:00:00Z"); // Wed 11:00 NY
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Upstream call log: host-ish label per call, and the peak of concurrent Yahoo calls. */
const up = { calls: [] as string[], yActive: 0, yPeak: 0 };
const count = (label: string) => up.calls.filter((c) => c === label).length;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const usDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;

/** Earnings calendar: 30 notable BMO names every day; Tuesday also 5 AMC names (so Tuesday is the AMC day). */
function earningsRows(date: string) {
  const rows = Array.from({ length: 30 }, (_, i) => ({ symbol: `B${i}`, name: `B${i}`, time: "time-pre-market", marketCap: `$${(i + 1) * 1000}`, eps: "", epsForecast: "$1.00" }));
  if (date === "2026-10-20") for (let i = 0; i < 5; i++) rows.push({ symbol: `A${i}`, name: `A${i}`, time: "time-after-hours", marketCap: "$50000", eps: "", epsForecast: "$1.00" });
  return { data: { rows } };
}

async function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.nasdaq.com/api/ipo/calendar")) {
    up.calls.push("nasdaq-ipo");
    await sleep(LAT);
    return json({ data: { priced: { rows: [{ proposedTickerSymbol: "NEWC", companyName: "New Co", pricedDate: usDate("2026-10-21"), proposedSharePrice: "10.00", sharesOffered: "1,000,000" }] }, upcoming: { upcomingTable: { rows: [] } }, withdrawn: { rows: [] }, filed: { rows: [] } } });
  }
  if (url.includes("efts.sec.gov")) {
    up.calls.push("efts");
    await sleep(LAT);
    return json({ hits: { hits: [] } });
  }
  if (url.includes("api.nasdaq.com/api/calendar/earnings")) {
    up.calls.push("nasdaq-earnings");
    await sleep(LAT);
    return json(earningsRows(new URL(url).searchParams.get("date") ?? ""));
  }
  if (url.includes("finance.yahoo.com/v8/finance/chart/")) {
    up.calls.push("yahoo");
    up.yActive++; up.yPeak = Math.max(up.yPeak, up.yActive);
    try {
      await sleep(LAT);
      const t = Math.floor(NOW / 1000);
      return json({ chart: { result: [{ meta: { regularMarketPrice: 12, regularMarketTime: t }, timestamp: [t - 86400, t], indicators: { quote: [{ open: [10, 11], high: [11, 12], low: [9, 10], close: [10, 12], volume: [1000, 900] }] } }] } });
    } finally { up.yActive--; }
  }
  up.calls.push("other");
  return new Response("not found", { status: 404 });
}

let server: http.Server;
let base = "";
beforeAll(async () => {
  vi.stubGlobal("fetch", fakeFetch);
  const [{ default: offerings }, { default: earnings }, { default: stockdata }, { errorMiddleware }] = await Promise.all([
    import("../offerings"), import("../earnings"), import("../stockdata"), import("../../lib/http"),
  ]);
  const app = express();
  app.use("/api", offerings, earnings, stockdata);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  up.calls = []; up.yActive = 0; up.yPeak = 0;
  db.stored = [];
});
afterEach(() => { vi.useRealTimers(); });

async function get(path: string): Promise<{ status: number; body: any; ms: number }> {
  const t0 = performance.now();
  const r = await realFetch(base + path);
  const body = await r.json();
  return { status: r.status, body, ms: Math.round(performance.now() - t0) };
}
/** Let background refreshes finish (real timers): no Yahoo call in flight for two looks in a row. */
async function settle(): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 100 && quiet < 2; i++) { await sleep(LAT); quiet = up.yActive === 0 ? quiet + 1 : 0; }
}

describe("GET /offerings/watch", () => {
  it("seven widgets asking for a cold day at once → one upstream build", async () => {
    const res = await Promise.all(Array.from({ length: 7 }, () => get("/api/offerings/watch?day=2026-10-21")));
    console.info(`[speed] offerings ×7 cold: ${Math.max(...res.map((r) => r.ms))} ms, nasdaq ${count("nasdaq-ipo")}, efts ${count("efts")}`);
    expect(res.every((r) => r.status === 200 && r.body.day === "2026-10-21")).toBe(true);
    expect(res[0].body.offerings.map((o: { ticker: string }) => o.ticker)).toEqual(["NEWC"]);
    expect(count("nasdaq-ipo")).toBe(1);
    expect(count("efts")).toBe(2); // two EFTS pages of one build
  });

  it("the week view (five days of one month at once) fetches the NASDAQ month feed once", async () => {
    const days = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
    const res = await Promise.all(days.map((d) => get(`/api/offerings/watch?day=${d}`)));
    console.info(`[speed] offerings week cold: ${Math.max(...res.map((r) => r.ms))} ms, nasdaq ${count("nasdaq-ipo")}`);
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(count("nasdaq-ipo")).toBe(1);
  });

  it("an old stored payload is answered at once; the refresh starts server-side and revalidate=1 joins it", async () => {
    const day = "2026-10-14"; // stored during that day → stale (not «fresh» as a finished past day)
    const fetchedAt = Date.parse("2026-10-14T15:00:00Z");
    db.stored = [{ ticker: day, payload: { day, fetchedAt, count: 0, offerings: [], ipoCalendar: [], sources: { nasdaq: true, edgar: true, market: true }, enrichment: { complete: true } }, fetched_at: new Date(fetchedAt) }];
    const first = await get(`/api/offerings/watch?day=${day}`);
    expect(first.body.stale).toBe(true);
    expect(first.ms).toBeLessThan(LAT); // no upstream on the critical path
    expect(count("nasdaq-ipo") + count("efts")).toBeGreaterThan(0); // background refresh already running
    const again = await get(`/api/offerings/watch?day=${day}&revalidate=1`);
    console.info(`[speed] offerings stale: first ${first.ms} ms, revalidate ${again.ms} ms, nasdaq ${count("nasdaq-ipo")}`);
    expect(again.body.stale).toBeUndefined();
    expect(again.body.fetchedAt).toBeGreaterThan(fetchedAt);
    expect(count("nasdaq-ipo")).toBeLessThanOrEqual(1); // joined (or month feed cached), never a second build
    expect(count("efts")).toBe(2);
  });
});

describe("GET /earnings/watch", () => {
  it("prices today + the one AMC day only, ≤ 20 Yahoo calls in flight; an expired entry is answered at once", async () => {
    const cold = await get("/api/earnings/watch");
    console.info(`[speed] earnings cold: ${cold.ms} ms, yahoo ${count("yahoo")} (peak ${up.yPeak}), calendars ${count("nasdaq-earnings")}`);
    expect(cold.status).toBe(200);
    expect(cold.body.amcDate).toBe("2026-10-20");
    expect(cold.body.amc).toHaveLength(5);
    expect(count("yahoo")).toBe(30 + 30); // today's 30 + Tuesday's top 30 — Monday / Friday are never priced
    expect(up.yPeak).toBeLessThanOrEqual(20);

    vi.setSystemTime(NOW + 16 * 60_000); // past the 15 min TTL
    up.calls = [];
    const warm = await get("/api/earnings/watch");
    console.info(`[speed] earnings after TTL: ${warm.ms} ms (refresh in background)`);
    expect(warm.ms).toBeLessThan(LAT);
    expect(warm.body.bmo.length).toBe(30);
    await settle();
    expect(count("yahoo")).toBe(60); // the refresh ran behind the answer (calendars still cached)
  });
});

describe("GET /stockdata/quote", () => {
  const syms = Array.from({ length: 10 }, (_, i) => `Q${i}`).join(",");
  it("two pages asking for the same symbols at once → one Yahoo call per symbol", async () => {
    const [a, b] = await Promise.all([get(`/api/stockdata/quote?symbols=${syms}`), get(`/api/stockdata/quote?symbols=${syms}`)]);
    console.info(`[speed] quotes ×2 cold: ${Math.max(a.ms, b.ms)} ms, yahoo ${count("yahoo")}`);
    expect(Object.keys(a.body)).toHaveLength(10);
    expect(b.body.Q3.price).toBe(12);
    expect(count("yahoo")).toBe(10);
  });

  it("60 s – 3 min old → answered at once and refreshed behind; older → fetched", async () => {
    await get("/api/stockdata/quote?symbol=ZZ");
    vi.setSystemTime(NOW + 90_000);
    up.calls = [];
    const stale = await get("/api/stockdata/quote?symbol=ZZ");
    expect(stale.body).toMatchObject({ symbol: "ZZ", price: 12 });
    expect(stale.ms).toBeLessThan(LAT);
    await settle();
    expect(count("yahoo")).toBe(1);
    vi.setSystemTime(NOW + 90_000 + 4 * 60_000);
    const old = await get("/api/stockdata/quote?symbol=ZZ");
    console.info(`[speed] quote stale ${stale.ms} ms vs expired ${old.ms} ms`);
    expect(old.ms).toBeGreaterThanOrEqual(LAT - 10);
  });
});
