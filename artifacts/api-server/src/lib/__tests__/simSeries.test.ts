/**
 * «Тренажёр 2» service flows on an in-memory store: 1m base bars for free games, the event jump, the daily context,
 * series (prepared next game, next / skip / no-trade / finish), one active game per user, skip rules.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// Trainer eligibility (lib/trainer/eligibility): no close-auction ticker-days in these fixtures.
vi.mock("../trainer/eligibilityStore", () => ({ blockedTickerDays: vi.fn(async () => new Set<string>()), _resetEligibilityMemo: vi.fn() }));
// Day rule (lib/sim/catalyst.ts): the fixture day gapped with a catalyst; no DB.
vi.mock("../sim/catalystStore", async (orig) => {
  const real = await orig<typeof import("../sim/catalystStore")>();
  return {
    ...real,
    catalystKeys: vi.fn(async (keys: { ticker: string; day: string }[]) => new Set(keys.map((k) => `${k.ticker}:${k.day}`))),
    archivedGaps: vi.fn(async (keys: { ticker: string; day: string }[]) => new Map(keys.map((k) => [`${k.ticker}:${k.day}`, 9.4]))),
    catalystsOf: vi.fn(async () => [
      { kind: "news", source: "news", timing: "pre", at: "2026-10-16T11:00:00.000Z", headline: "ZZ Top Holdings (ZZTOP) jumps on record 2026 guidance", publisher: "Wire", url: "https://news.example/zztop-2026-10-16" },
      { kind: "earnings", source: "earnings", timing: "prevAfter", at: "2026-10-15", headline: null, publisher: "Finviz", url: null },
    ]),
    fundamentalsOf: vi.fn(async () => ({ names: ["ZZ Top Holdings Inc"], shares: 50_000_000, floatShares: 41_234_567, capNow: 2.2e9 })),
  };
});
import type { SimBar } from "../sim/engine";

const DAY = "2026-10-16";
const TICKER = "ZZTOP";
const ny = (date: string, hh: number, mm: number) => Date.parse(`${date}T${String(hh + 4).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`) / 1000;
function minuteBars(date: string, fromMin: number, toMin: number, price: number): SimBar[] {
  const out: SimBar[] = [];
  let p = price;
  for (let m = fromMin; m < toMin; m++) {
    const o = p; p = Math.round((p + Math.sin(m / 7) * 0.2) * 100) / 100;
    out.push({ t: ny(date, Math.floor(m / 60), m % 60), o, h: Math.max(o, p) + 0.03, l: Math.min(o, p) - 0.03, c: p, v: 500 + m });
  }
  return out;
}
const DAY_BARS = [...minuteBars(DAY, 240, 570, 41.1), ...minuteBars(DAY, 570, 960, 42.3)];
const PREV_BARS = minuteBars("2026-10-15", 570, 960, 40.2);

type Row = import("../sim/store").GameRow;
type SRow = import("../sim/seriesStore").SeriesRow;
const games = new Map<number, Row>();
const series = new Map<number, SRow>();
let nextId = 1;
let nextSeries = 1;

vi.mock("../sim/store", async (orig) => {
  const real = await orig<typeof import("../sim/store")>();
  const save = (id: number, patch: Partial<Row>) => Object.assign(games.get(id)!, structuredClone(patch));
  return {
    ...real,
    intradayCandidates: vi.fn(async () => [{ ticker: TICKER, day: DAY, tf: "1m", desk: 3, gapPct: 9.4, rangePct: 3.4, prevClose: 41 }]),
    loadDailySeries: vi.fn(async () => ({ bars: [], dates: [] })),
    swingCandidates: vi.fn(async () => []),
    loadDayBars: vi.fn(async () => ({ bars: DAY_BARS, tf: "1m", prevClose: 41 })),
    loadPrevDay: vi.fn(async () => ({ bars: PREV_BARS, levels: { h: 41, l: 40, c: PREV_BARS[PREV_BARS.length - 1].c } })),
    loadDailyBefore: vi.fn(async () => [
      { date: "2026-10-14", o: 39, h: 40.5, l: 38.8, c: 40, v: 1e6 },
      { date: "2026-10-15", o: 40, h: 41, l: 40, c: 40.9, v: 1.2e6 },
    ]),
    recentScenarioKeys: vi.fn(async () => new Set<string>()),
    recentDailyKeys: vi.fn(async () => new Set<string>()),
    deskFeePerShare: vi.fn(async () => 0.0048),
    oneRUsdOf: vi.fn(async () => 100),
    insertGame: vi.fn(async (g: import("../sim/store").NewGame) => {
      const row: Row = { ...g, id: nextId++, status: g.status ?? "active", seriesId: g.seriesId ?? null, result: null, events: [], createdAt: new Date().toISOString(), finishedAt: null };
      games.set(row.id, structuredClone(row));
      return structuredClone(row);
    }),
    loadGame: vi.fn(async (id: number) => (games.has(id) ? structuredClone(games.get(id)!) : null)),
    activeGameId: vi.fn(async (uid: number) => [...games.values()].find((g) => g.userId === uid && g.status === "active")?.id ?? null),
    saveProgress: vi.fn(async (id: number, cursor: number, events: Row["events"]) => { save(id, { cursor, events }); }),
    saveFinished: vi.fn(async (id: number, cursor: number, events: Row["events"], result: Row["result"]) => { save(id, { cursor, events, result, status: "finished" }); }),
    markAbandoned: vi.fn(async (id: number) => { if (games.get(id)!.status === "active") games.get(id)!.status = "abandoned"; }),
    markSkipped: vi.fn(async (id: number, cursor: number) => { if (games.get(id)!.status === "active") save(id, { status: "skipped", cursor }); }),
    activatePrepared: vi.fn(async (id: number) => {
      const g = games.get(id);
      if (!g || g.status !== "prepared") return false;
      g.status = "active";
      return true;
    }),
    dropPrepared: vi.fn(async (sid: number) => { for (const g of games.values()) if (g.seriesId === sid && g.status === "prepared") g.status = "abandoned"; }),
    deskTradesForDay: vi.fn(async () => []),
    deskTradesForRange: vi.fn(async () => []),
    deskIntradayCount: vi.fn(async () => 0),
    longNameOf: vi.fn(async () => "ZZ Top Holdings"),
  };
});

vi.mock("../sim/seriesStore", async (orig) => {
  const real = await orig<typeof import("../sim/seriesStore")>();
  const gamesOf = (sid: number) => [...games.values()].filter((g) => g.seriesId === sid).map((g) => ({
    id: g.id, index: g.params.series?.index ?? 0, status: g.status, r: g.result?.r ?? 0, trades: g.result?.trades ?? 0,
    correct: (g.result as { noTrade?: { correct: boolean } } | null)?.noTrade?.correct ?? null,
  }));
  return {
    ...real,
    insertSeries: vi.fn(async (s: Omit<SRow, "id" | "idx" | "status">) => { const row: SRow = { ...s, id: nextSeries++, idx: 0, status: "active" }; series.set(row.id, row); return { ...row }; }),
    loadSeries: vi.fn(async (id: number) => (series.has(id) ? { ...series.get(id)! } : null)),
    activeSeriesId: vi.fn(async (uid: number) => [...series.values()].reverse().find((s) => s.userId === uid && s.status === "active")?.id ?? null),
    setSeriesIdx: vi.fn(async (id: number, idx: number) => { series.get(id)!.idx = idx; }),
    closeSeries: vi.fn(async (id: number, status: "finished" | "abandoned") => { const s = series.get(id)!; if (s.status === "active") s.status = status; }),
    seriesGames: vi.fn(async (sid: number) => gamesOf(sid)),
    preparedGameId: vi.fn(async (sid: number, index: number) => [...games.values()].find((g) => g.seriesId === sid && g.status === "prepared" && g.params.series?.index === index)?.id ?? null),
    seriesStateOf: vi.fn(async (id: number) => (series.has(id) ? real.stateOf(series.get(id)!, gamesOf(id)) : null)),
  };
});

const sim = await import("../sim/service");
const ser = await import("../sim/series");
const dec = await import("../sim/decisions");
const ctx = await import("../sim/context");
const me = { id: 1, name: "Закир", staff: false };
const activeCount = () => [...games.values()].filter((g) => g.userId === me.id && g.status === "active").length;

beforeEach(() => { games.clear(); series.clear(); nextId = 1; nextSeries = 1; sim._resetSimCache(); ser._resetSeries(); });

describe("free games on 1m base bars", () => {
  it("a 5m game is stored on 1m bars: baseTf 1m, displayTfs, the session window in base bars", async () => {
    const g = await sim.createGame(me, "intraday", "easy", () => 0.3, "5m");
    expect(g.tf).toBe("5m");
    expect(g.baseTf).toBe("1m");
    expect(g.displayTfs).toEqual(["1m", "2m", "5m", "15m"]);
    expect(g.endIdx - g.startIdx).toBe(390);
    expect(g.bars).toHaveLength(g.cursor + 1);
    expect(g.series).toBeNull();
    expect(g.noTrade).toBeNull();
    expect(games.get(g.id)!.params.intrabar).toBe(true);
  });

  it("an older game (no baseTf in params) reports baseTf = tf", async () => {
    const g = await sim.createGame(me, "intraday", "medium", () => 0.3);
    const row = games.get(g.id)!;
    delete row.params.baseTf;
    delete row.params.intrabar;
    sim._resetSimCache();
    const s = await sim.gameSnapshot(me, g.id);
    expect(s.baseTf).toBe("1m");
    expect(s.tf).toBe("1m");
  });

  it("step until event: stops at the event bar (≤ advance), shows only bars up to it", async () => {
    const g = await sim.createGame(me, "intraday", "medium", () => 0.3);
    const s = await sim.step(me, g.id, { advance: 90, until: "event" });
    expect(s.event).not.toBeNull();
    expect(s.event!.idx).toBe(s.cursor);
    expect(s.cursor).toBeLessThanOrEqual(g.cursor + 90);
    expect(s.bars).toHaveLength(s.cursor - g.cursor);
    const plain = await sim.step(me, g.id, { advance: 1 });
    expect(plain.event).toBeNull();
  });

  it("step until event stops at a bracket fill", async () => {
    const g = await sim.createGame(me, "intraday", "medium", () => 0.3);
    const px = g.bars[g.cursor][4];
    const out = await sim.step(me, g.id, { order: { kind: "buy", qty: 10 }, bracket: { stop: Math.round((px - 0.05) * 100) / 100, target: Math.round((px + 0.05) * 100) / 100 }, advance: 90, until: "event" });
    const exit = out.state.fills.find((f) => f.reason === "stop" || f.reason === "target")!;
    expect(out.event).toMatchObject({ kind: "fill", idx: exit.idx });
    expect(out.cursor).toBe(exit.idx);
    expect(out.state.pos).toBe(0);
    expect(exit.reason).toBe("target"); // the 9:30 bar gaps up through the target: filled at the open
  });

  it("context: daily bars with fake dates before the reveal, never the ticker or real dates", async () => {
    const g = await sim.createGame(me, "intraday", "medium", () => 0.3);
    const c = await ctx.gameContext(me, g.id);
    const json = JSON.stringify(c);
    expect(json).not.toContain("2026");
    expect(json).not.toContain(TICKER);
    expect(c.daily).toHaveLength(2);
    expect(c.daily.every((b) => new Date(b[0] * 1000).getUTCFullYear() === 2001)).toBe(true);
    expect(c.levels.atr14).not.toBeNull();
    expect(c.levels.gapPct).not.toBeNull();
    // «Контекст дня» before the reveal (the API DTO): masked catalyst, no ticker / company / date / link anywhere.
    expect(json).not.toMatch(/ZZ ?Top|zztop|news.example|https?:/i);
    expect(c.day?.catalysts.map((x) => x.kind)).toEqual(["news", "earnings"]);
    expect(c.day?.catalysts[0].headline).toContain("jumps on record");
    expect(c.day?.catalysts.every((x) => x.full === null)).toBe(true);
    expect(c.day?.cap).toMatchObject({ basis: "day" });
    expect(c.day?.floatShares).toBe(41_000_000);
    expect(c.day?.pmVolume).toBeGreaterThan(0);
    expect(c.day?.minGapPct).toBe(7);
    await sim.finish(me, g.id);
    const after = await ctx.gameContext(me, g.id);
    expect(new Date(after.daily[1][0] * 1000).toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(after.day?.catalysts[0].full?.headline).toBe("ZZ Top Holdings (ZZTOP) jumps on record 2026 guidance");
    expect(after.day?.gapAt).toBe("open");
  });
});

describe("skip and no-trade", () => {
  it("skip before any order: status skipped, no reveal; after an order: finished and counted", async () => {
    const a = await sim.createGame(me, "intraday", "medium", () => 0.3);
    const s = await dec.skipGame(me, a.id);
    expect(s.outcome).toBe("skipped");
    expect(s.snapshot.status).toBe("skipped");
    expect(s.snapshot.reveal).toBeNull();
    expect(games.get(a.id)!.status).toBe("skipped");
    await expect(dec.skipGame(me, a.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const b = await sim.createGame(me, "intraday", "medium", () => 0.3);
    await sim.step(me, b.id, { order: { kind: "buy", qty: 10 }, advance: 2 });
    const f = await dec.skipGame(me, b.id);
    expect(f.outcome).toBe("finished");
    expect(f.snapshot.reveal).not.toBeNull();
    expect(games.get(b.id)!.result!.trades).toBe(1);
  });

  it("«Задача дня» and own replays cannot be skipped", async () => {
    const g = await sim.createGame(me, "intraday", "medium", () => 0.3);
    games.get(g.id)!.params.daily = { date: DAY };
    sim._resetSimCache();
    await expect(dec.skipGame(me, g.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(games.get(g.id)!.status).toBe("active");
  });

  it("no-trade: only while flat with no order; finishes with the verdict and the reveal", async () => {
    const g = await sim.createGame(me, "intraday", "medium", () => 0.3);
    await sim.step(me, g.id, { advance: 5 });
    const out = await dec.noTrade(me, g.id);
    expect(out.verdict.decisionIdx).toBe(g.cursor + 5);
    expect(["noTrade.correct", "noTrade.missedLong", "noTrade.missedShort"]).toContain(out.verdict.reasonKey);
    expect(out.verdict.correct).toBe(out.verdict.bestR < 1.5);
    expect(out.snapshot.status).toBe("finished");
    expect(out.snapshot.reveal).not.toBeNull();
    expect(out.snapshot.noTrade).toEqual(out.verdict);
    expect(games.get(g.id)!.result!.trades).toBe(0);
    const h = await sim.createGame(me, "intraday", "medium", () => 0.3);
    await sim.step(me, h.id, { order: { kind: "buy", qty: 10 }, advance: 1 });
    await sim.step(me, h.id, { order: { kind: "flat" }, advance: 1 });
    await expect(dec.noTrade(me, h.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("series", () => {
  it("start: game 0 active, game 1 prepared in the background and invisible until «next»", async () => {
    const out = await ser.startSeries(me, "intraday", "medium", null, 3, () => 0.3);
    await ser._settlePreparations();
    expect(out.game.series).toEqual({ id: out.series.id, index: 0, size: 3 });
    expect(out.series).toMatchObject({ size: 3, index: 0, finished: false, currentGameId: out.game.id, results: [] });
    const prepared = [...games.values()].find((g) => g.status === "prepared")!;
    expect(prepared.params.series).toEqual({ id: out.series.id, index: 1, size: 3 });
    expect(activeCount()).toBe(1);
    expect((await sim.activeSnapshot(me))!.id).toBe(out.game.id);
    await expect(sim.gameSnapshot(me, prepared.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sim.step(me, prepared.id, { advance: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lifecycle: no-trade → next (prepared) → trade + skip → next → skip → next = finished", async () => {
    const start = await ser.startSeries(me, "intraday", "medium", null, 3, () => 0.3);
    const sid = start.series.id;
    await ser._settlePreparations();
    const prepared1 = [...games.values()].find((g) => g.status === "prepared")!.id;

    const nt = await dec.noTrade(me, start.game.id);
    expect(nt.series!.results).toEqual([{ gameId: start.game.id, outcome: "no_trade", r: 0, correct: nt.verdict.correct }]);

    const n1 = await ser.nextGame(me, sid, () => 0.3);
    expect(n1.game!.id).toBe(prepared1);
    expect(n1.game!.status).toBe("active");
    expect(n1.series.index).toBe(1);
    expect(activeCount()).toBe(1);
    await ser._settlePreparations();

    await sim.step(me, n1.game!.id, { order: { kind: "buy", qty: 10 }, advance: 3 });
    const sk = await dec.skipGame(me, n1.game!.id);
    expect(sk.outcome).toBe("finished");
    expect(sk.series!.results[1]).toMatchObject({ gameId: n1.game!.id, outcome: "traded" });

    const n2 = await ser.nextGame(me, sid, () => 0.3);
    expect(n2.series.index).toBe(2);
    expect(n2.game!.series).toEqual({ id: sid, index: 2, size: 3 });
    await ser._settlePreparations();
    expect([...games.values()].filter((g) => g.status === "prepared")).toHaveLength(0); // nothing past the end
    await dec.skipGame(me, n2.game!.id);

    const end = await ser.nextGame(me, sid, () => 0.3);
    expect(end.game).toBeNull();
    expect(end.series.finished).toBe(true);
    expect(end.series.currentGameId).toBeNull();
    expect(end.series.totals).toMatchObject({ traded: 1, noTrade: 1, skipped: 1, correctNoTrade: nt.verdict.correct ? 1 : 0 });
    expect(activeCount()).toBe(0);
    // «next» on a finished series is idempotent.
    expect((await ser.nextGame(me, sid)).game).toBeNull();
  });

  it("«next» over an untouched game skips it; over a traded one plays it out and counts it", async () => {
    const start = await ser.startSeries(me, "intraday", "medium", null, 5, () => 0.3);
    const n1 = await ser.nextGame(me, start.series.id, () => 0.3);
    expect(games.get(start.game.id)!.status).toBe("skipped");
    await sim.step(me, n1.game!.id, { order: { kind: "sell", qty: 10 }, advance: 2 });
    const n2 = await ser.nextGame(me, start.series.id, () => 0.3);
    expect(games.get(n1.game!.id)!.status).toBe("finished");
    expect(n2.series.results.map((r) => r.outcome)).toEqual(["skipped", "traded"]);
    expect(activeCount()).toBe(1);
  });

  it("a new series abandons the old one and its prepared game; a lone game settles the series game", async () => {
    const a = await ser.startSeries(me, "intraday", "medium", null, 4, () => 0.3);
    await ser._settlePreparations();
    const b = await ser.startSeries(me, "intraday", "easy", "5m", 4, () => 0.3);
    await ser._settlePreparations();
    expect(series.get(a.series.id)!.status).toBe("abandoned");
    expect([...games.values()].filter((g) => g.seriesId === a.series.id && g.status === "prepared")).toHaveLength(0);
    expect(games.get(a.game.id)!.status).toBe("skipped");
    expect(b.game.baseTf).toBe("1m");
    expect(b.series.tf).toBe("5m");
    expect((await ser.activeSeries(me)).series!.id).toBe(b.series.id);
    await sim.createGame(me, "intraday", "medium", () => 0.3);
    expect(games.get(b.game.id)!.status).toBe("skipped");
    expect(activeCount()).toBe(1);
    // «next» deals the prepared game and settles the lone one: still one active game.
    const n = await ser.nextGame(me, b.series.id, () => 0.3);
    expect(n.game!.status).toBe("active");
    expect(activeCount()).toBe(1);
    await expect(ser.getSeries({ id: 2, name: "X", staff: false }, b.series.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
