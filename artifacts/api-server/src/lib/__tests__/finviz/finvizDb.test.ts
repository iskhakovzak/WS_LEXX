/**
 * Finviz end to end against a scratch Postgres built from the repository migrations (0223 included), with a mocked
 * fetch (fixtures; never finviz.com): screener runs + slots, ticker snapshot (desk tickers, pending requests,
 * not-found), earnings calendar (supersede, «today / tomorrow before the open»), snapshot-first fundamentals for the
 * watchlist score and GET /stockdata/fundamentals. Skipped when the local Postgres is down.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrationFiles } from "../../../db/runner";
import { createScratchDb, pgAvailable } from "../../../db/__tests__/scratchDb";

const closedDays = vi.hoisted(() => new Set<string>());
vi.mock("../../marketDays", () => ({ isMarketClosed: async (d: string) => closedDays.has(d) }));

const { setFinvizClientDeps } = await import("../../finviz/client");
const { setFinvizDb, requestTicker } = await import("../../finviz/store");
const { readEarnings, readEarningsSoon, readScreener, readSnapshot, readStatus } = await import("../../finviz/read");
const { runEarnings, runScreener, runSnapshot, runSnapshotPending } = await import("../../finviz/jobs");
const { freshSnapshot } = await import("../../finviz/fundamentals");
const { __loadSettingsCache } = await import("../../settings/registry");

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fx = (f: string) => readFileSync(path.join(dir, f), "utf8");
const HEADER = fx("screener-gappers.csv").split("\n")[0];
const csvOf = (lines: string[]) => [HEADER, ...lines].join("\n");

/** URL → CSV body (or an HTTP status). Records every call. */
let answer: (u: URL) => { status: number; body: string } = () => ({ status: 200, body: fx("screener-gappers.csv") });
const calls: URL[] = [];
const MON_0800 = new Date("2026-10-19T08:00:00-04:00");

describe.skipIf(!available)("finviz on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let restoreDb: () => void;
  let restoreClient: () => void;
  beforeAll(async () => {
    db = await createScratchDb("finviz");
    await runMigrationFiles({ pool: db.pool, logger: silent });
    restoreDb = setFinvizDb(db.pool);
  }, 120_000);
  afterAll(async () => { restoreDb?.(); await db?.drop(); });
  beforeEach(() => {
    calls.length = 0;
    answer = () => ({ status: 200, body: fx("screener-gappers.csv") });
    restoreClient = setFinvizClientDeps({
      token: () => "TOKEN",
      gapMs: 0,
      sleep: async () => undefined,
      fetch: async (url) => {
        const u = new URL(url);
        calls.push(u);
        const r = answer(u);
        return { ok: r.status === 200, status: r.status, text: async () => r.body };
      },
    });
  });
  afterEach(() => { restoreClient(); __loadSettingsCache({}); closedDays.clear(); });

  it("status before any run: enabled, nothing yet; screener answers empty", async () => {
    expect(await readStatus(true)).toEqual({ enabled: true, lastScreenAt: null, lastSnapshotAt: null, lastEarningsAt: null });
    expect(await readScreener("gappers")).toEqual({ asOf: null, preset: "gappers", rows: [] });
  });

  it("scheduled screener: only in its slots, on trading days, never while disabled", async () => {
    expect(await runScreener({ now: new Date("2026-10-19T08:03:00-04:00") })).toEqual({ skipped: "outside screener slots" });
    closedDays.add("2026-10-19");
    expect(await runScreener({ now: MON_0800 })).toEqual({ skipped: "market closed" });
    closedDays.clear();
    __loadSettingsCache({ "finviz.enabled": false });
    expect(await runScreener({ now: MON_0800 })).toEqual({ skipped: "finviz disabled" });
    expect(calls).toHaveLength(0);
  });

  it("a run stores every preset ranked its own way, the snapshot and the earnings dates", async () => {
    const r = await runScreener({ now: MON_0800 });
    expect(r).toMatchObject({ day: "2026-10-19", results: [{ preset: "gappers", rows: 4 }, { preset: "relvol", rows: 4 }, { preset: "earnings_today", rows: 4 }] });
    expect(calls.map((u) => u.searchParams.get("o"))).toEqual(["-gap", "-relativevolume", "-marketcap"]);
    expect(calls[0].searchParams.get("f")).toBe("geo_usa,sh_price_o2,sh_avgvol_o500,ta_gap_u4");

    const g = await readScreener("gappers");
    expect(g.asOf).not.toBeNull();
    expect(g.rows.map((x) => x.ticker)).toEqual(["ABCD", "SMCI", "XYZW", "TINY"]);
    expect(g.rows[1]).toEqual({
      ticker: "SMCI", company: "Super Micro Computer, Inc.", sector: "Technology", price: 48.75, changePct: 15.2, gapPct: 12.35,
      relVolume: 4.21, volume: 61_234_567, avgVolume: 38_500_000, float: 540_100_000, shortFloatPct: 18.4, atr: 3.12,
      marketCap: 25_800_000_000, earningsDate: "2026-11-04", earningsTiming: "amc",
    });
    expect((await readScreener("relvol")).rows.map((x) => x.ticker)).toEqual(["ABCD", "SMCI", "XYZW", "TINY"]);
    expect((await readScreener("earnings_today")).rows.map((x) => x.ticker)).toEqual(["SMCI", "TINY", "ABCD", "XYZW"]);

    const snap = await readSnapshot("SMCI");
    expect(snap).toMatchObject({ ticker: "SMCI", industry: "Computer Hardware", country: "USA", shortRatio: 1.25, beta: 1.45 });
    expect(typeof snap!.asOf).toBe("string");
    expect(await readEarnings("2026-10-19", "2026-11-05")).toEqual([
      { ticker: "ABCD", date: "2026-10-19", timing: "bmo", company: "Abcd Therapeutics Inc", marketCap: 45_300_000 },
      { ticker: "TINY", date: "2026-10-21", timing: "amc", company: "Tiny Corp", marketCap: 812_550_000 },
      { ticker: "SMCI", date: "2026-11-04", timing: "amc", company: "Super Micro Computer, Inc.", marketCap: 25_800_000_000 },
    ]);
    expect((await readStatus(true)).lastScreenAt).not.toBeNull();
  });

  it("a failed preset keeps serving its previous good run; an empty cell does not erase the snapshot", async () => {
    const before = await readScreener("relvol");
    answer = (u) => (u.searchParams.get("o") === "-relativevolume"
      ? { status: 500, body: "" }
      : { status: 200, body: csvOf(['"1","SMCI","Super Micro Computer, Inc.","Technology","Computer Hardware","USA","","","","","","","","9.00%","","","","",""," "']) });
    const r = await runScreener({ trigger: "manual" });
    expect(r.results).toEqual([{ preset: "gappers", rows: 1 }, { preset: "relvol", error: "finviz: HTTP 500" }, { preset: "earnings_today", rows: 1 }]);
    expect(await readScreener("relvol")).toEqual(before);
    expect((await readScreener("gappers")).rows.map((x) => x.ticker)).toEqual(["SMCI"]);
    expect(await readSnapshot("SMCI")).toMatchObject({ float: 540_100_000, marketCap: 25_800_000_000, earningsDate: null });
    const { rows } = await db.pool.query(`SELECT status, error FROM finviz_runs WHERE preset = 'relvol' ORDER BY id DESC LIMIT 1`);
    expect(rows[0]).toEqual({ status: "error", error: "finviz: HTTP 500" });
  });

  it("daily snapshot: desk tickers in batches; unknown tickers marked not found", async () => {
    await db.pool.query(`INSERT INTO trades (ticker, date, result) VALUES ('nvda', '2026-10-10', 'win'), ('OLD', '2026-01-02', 'loss')`);
    await db.pool.query(`INSERT INTO watchlist (ticker) VALUES ('ABCD')`);
    await db.pool.query(`INSERT INTO game_plans (date, author, in_play) VALUES ('2026-10-16', 'Ольга Н.', '[{"ticker":"TINY"},{"ticker":"QQQ"}]')`);
    answer = () => ({ status: 200, body: csvOf([
      '"1","NVDA","NVIDIA Corporation","Technology","Semiconductors","USA","4.40T","24.3B","23.4B","1.10%","1.30","1.70","5.10","0.50%","180.2M","0.95","181.00","0.30%","150000000","11/19/2026 4:20:00 PM"',
      '"2","TINY","Tiny Corp","Technology","Software - Application","USA","900","40.2","31.7","7.50%","3.40","2.10","0.60","","245.6","1.10","4.30","1.00%","300000","Oct 21/a"',
    ]) });
    const r = await runSnapshot({ now: MON_0800 });
    expect(r).toMatchObject({ tickers: 4, stored: 2, batches: 1, failed: 0 });
    expect(calls[0].searchParams.get("t")).toBe("ABCD,NVDA,QQQ,TINY"); // OLD: older than 30 days
    expect(await readSnapshot("NVDA")).toMatchObject({ marketCap: 4_400_000_000_000, float: 23_400_000_000, earningsDate: "2026-11-19" });
    const { rows } = await db.pool.query(`SELECT ticker FROM finviz_ticker_snapshot WHERE not_found_at IS NOT NULL ORDER BY ticker`);
    expect(rows.map((x) => x.ticker)).toEqual(["ABCD", "QQQ"]); // ABCD had a row: marked, its data kept
    expect(await readSnapshot("ABCD")).not.toBeNull();
    expect((await readStatus(true)).lastSnapshotAt).not.toBeNull();
  });

  it("a GET miss queues the ticker; the pending job fills it once", async () => {
    await requestTicker("AMD");
    expect(await readSnapshot("AMD")).toBeNull();
    answer = () => ({ status: 200, body: csvOf(['"1","AMD","Advanced Micro Devices, Inc.","Technology","Semiconductors","USA","380.5B","1.62B","1.61B","2.30%","1.10","1.90","7.20","","42.1M","1.40","235.00","2.00%","51000000","Nov 04/a"']) });
    expect(await runSnapshotPending({ now: MON_0800 })).toMatchObject({ tickers: 1, stored: 1 });
    expect(await readSnapshot("AMD")).toMatchObject({ company: "Advanced Micro Devices, Inc.", earningsDate: "2026-11-04", earningsTiming: "amc" });
    expect(await runSnapshotPending({ now: MON_0800 })).toEqual({ skipped: "nothing pending" });
  });

  it("earnings calendar: two weeks, moved reports superseded, today / next-day-bmo lookup", async () => {
    await db.pool.query(`INSERT INTO finviz_earnings (ticker, date, timing) VALUES ('MOVED', '2026-10-23', 'bmo'), ('PAST', '2026-10-12', 'amc')`);
    answer = (u) => ({ status: 200, body: fx(u.searchParams.get("f")!.includes("earningsdate_nextweek") ? "earnings-nextweek.csv" : "earnings-week.csv") });
    const r = await runEarnings({ now: MON_0800 });
    expect(r).toMatchObject({ day: "2026-10-19", rows: 4, superseded: 1, errors: 0 });
    expect(calls.map((u) => u.searchParams.get("f"))).toEqual(["sh_avgvol_o100,earningsdate_thisweek", "sh_avgvol_o100,earningsdate_nextweek"]);
    const week = await readEarnings("2026-10-20", "2026-10-31");
    expect(week.map((e) => `${e.date} ${e.ticker} ${e.timing}`)).toEqual([
      "2026-10-21 KO bmo", "2026-10-21 TSLA amc", "2026-10-21 TINY amc", "2026-10-22 NOTM null", "2026-10-29 AAPL amc",
    ]); // MOVED superseded; TINY kept: its own fresh snapshot still says 10-21
    expect(week.find((e) => e.ticker === "TSLA")).toEqual({ ticker: "TSLA", date: "2026-10-21", timing: "amc", company: "Tesla, Inc.", marketCap: 1_420_000_000_000 });
    expect((await readEarnings("2026-10-12", "2026-10-12")).map((e) => e.ticker)).toEqual(["PAST"]); // before today: untouched

    await db.pool.query(`INSERT INTO finviz_earnings (ticker, date, timing) VALUES ('NXT', '2026-10-22', 'bmo')`);
    const soon = await readEarningsSoon(["KO", "TSLA", "NOTM", "NXT", "AAPL"], "2026-10-21", "2026-10-22");
    expect(soon.map((e) => e.ticker)).toEqual(["KO", "TSLA", "NXT"]);
    expect((await readStatus(true)).lastEarningsAt).not.toBeNull();
  });

  it("an earnings fetch failure never supersedes", async () => {
    answer = (u) => (u.searchParams.get("f")!.includes("nextweek") ? { status: 503, body: "" } : { status: 200, body: fx("earnings-week.csv") });
    await db.pool.query(`UPDATE finviz_earnings SET superseded_at = NULL WHERE ticker = 'MOVED'`);
    const r = await runEarnings({ now: MON_0800 });
    expect(r).toMatchObject({ superseded: 0, errors: 1 });
    expect((await readEarnings("2026-10-23", "2026-10-23")).map((e) => e.ticker)).toEqual(["MOVED"]);
  });

  it("item 4: fresh snapshot first, stale ⇒ old source", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error("no external calls in tests"); }) as never;
    try {
      const { getTickerFundamentals } = await import("../../marketDataService");
      const f = await getTickerFundamentals("smci");
      expect(f).toMatchObject({ ticker: "SMCI", marketCap: "25.80B", float: "540.10M", shortInterest: 18.4, sector: "Technology", longName: "Super Micro Computer, Inc." });
      const { calcWatchlistScore } = await import("../../scoreEngine");
      const score = await calcWatchlistScore({ ticker: "SMCI" });
      expect(score.components.float.reasonCode).toBe("float.veryHigh"); // 540M float from the snapshot
      expect(score.components.liquidity.reasonCode).toBe("liquidity.good"); // 38.5M average volume
      expect(globalThis.fetch).not.toHaveBeenCalled();

      await db.pool.query(`UPDATE finviz_ticker_snapshot SET as_of = now() - interval '5 days' WHERE ticker = 'SMCI'`);
      expect(await freshSnapshot("SMCI")).toBeNull();
      __loadSettingsCache({ "finviz.snapshotMaxAgeDays": 7 });
      expect(await freshSnapshot("SMCI")).not.toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
