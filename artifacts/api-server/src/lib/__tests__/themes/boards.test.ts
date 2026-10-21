/**
 * Personal boards (lib/themes/boards.ts, board.ts) with mocked stores and providers (no DB, no network): columns /
 * sort / order rules, the tickers-board assembly (moves + gap / RVOL / float, the snapshot float fallback, missing
 * tickers), themes boards (pinned shared + own themes), screener boards, the tab fallback, gap / RVOL from providers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { extrasFromFinviz, extrasFromYahoo, type MemberQuote, type ThemeOut, type ThemesResponse } from "../../themes/logic";
import {
  MAX_BOARDS, MAX_BOARD_TICKERS, TICKER_COLUMNS, boardTickers, movePositions, normalizeBoardSort, normalizeColumns, tickerRows,
} from "../../themes/boards";
import { getBoard, getBoardData, setBoardDeps } from "../../themes/board";
import { setScreenerDeps } from "../../themes/screener";
import { detailsFor, seedQuotes, setTickerCacheDeps } from "../../themes/tickerCache";
import { DEFAULT_VIEW } from "../../themes/personal";
import type { BoardRecord } from "../../themes/boardsStore";
import type { PersonalRecord } from "../../themes/personalStore";

const NOW = Date.UTC(2026, 9, 20, 15);
const TODAY = "2026-10-20";
const q = (ticker: string, today: number | null, price: number | null = 10): MemberQuote => ({ ticker, price, today, fromOpen: 1, premarket: 0.5, afterHours: null });
const ex = (gap: number | null, rvol: number | null, float: number | null = null) => ({ gap, rvol, float });
const theme = (id: number, name: string, today: number): ThemeOut => ({ id, name, today, fromOpen: null, premarket: null, afterHours: null, members: [], missing: [] });
const base: ThemesResponse = { asOf: "2026-10-20T15:00:00.000Z", session: "rth", source: "finviz", stale: false, themes: [theme(1, "AI", 2), theme(2, "Banks", -1), theme(3, "Gold", 0.5)] };
const board = (over: Partial<BoardRecord>): BoardRecord => ({
  id: 5, userId: 7, name: "Board", kind: "tickers", position: 0, columns: [...TICKER_COLUMNS], sort: null, pinned: [], source: null,
  resolvedTickers: [], resolvedAt: null, active: true, ...over,
});
const own = (over: Partial<PersonalRecord>): PersonalRecord => ({
  id: 1, userId: 7, boardId: 5, name: "Mine", kind: "tickers", tickers: ["MU", "WDC"], screener: null, resolvedTickers: [], resolvedAt: null, active: true, ...over,
});

describe("board rules", () => {
  it("columns per kind in canonical order (none / junk → all); a sort only on a column of the kind", () => {
    expect(normalizeColumns("tickers", ["float", "today", "gap", "x"])).toEqual(["today", "gap", "float"]);
    expect(normalizeColumns("themes", ["gap"])).toEqual(["premarket", "fromOpen", "today", "afterHours"]);
    expect(normalizeBoardSort("tickers", { col: "rvol", dir: "desc" })).toEqual({ col: "rvol", dir: "desc" });
    expect(normalizeBoardSort("themes", { col: "rvol", dir: "desc" })).toBeNull();
  });

  it("← / → swap with the neighbour and renumber; the ends stay", () => {
    const list = [{ id: 1, position: 0 }, { id: 2, position: 5 }, { id: 3, position: 9 }];
    expect(movePositions(list, 2, "left")).toEqual([{ id: 2, position: 0 }, { id: 1, position: 1 }, { id: 3, position: 2 }]);
    expect(movePositions(list, 3, "right")).toEqual([{ id: 1, position: 0 }, { id: 2, position: 1 }, { id: 3, position: 2 }]);
  });

  it("limits; a board's tickers: its list or the first 25 / 50 of the screener", () => {
    expect([MAX_BOARDS, MAX_BOARD_TICKERS]).toEqual([8, 50]);
    const resolved = Array.from({ length: 50 }, (_, i) => `T${i}`);
    expect(boardTickers({ kind: "screener", screener: { filters: ["sec_energy"], order: null }, top: 25 }, resolved)).toHaveLength(25);
    expect(boardTickers({ kind: "screener", screener: { filters: ["sec_energy"], order: null }, top: 50 }, resolved)).toHaveLength(50);
    expect(boardTickers({ kind: "tickers", tickers: ["MU"] }, resolved)).toEqual(["MU"]);
    expect(boardTickers(null, resolved)).toEqual([]);
  });

  it("ticker rows: moves + extras in board order, the snapshot float as fallback, quote-less tickers missing", () => {
    const details = new Map([
      ["MU", { quote: q("MU", 2), extras: ex(1.5, 2.2, 1.1e9) }],
      ["IONQ", { quote: q("IONQ", -3), extras: ex(null, 0.8) }],
      ["DEAD", { quote: q("DEAD", null, null), extras: ex(null, null) }],
    ]);
    const { rows, missing } = tickerRows(["ionq", "MU", "DEAD", "NONE"], details, new Map([["IONQ", 2.5e8], ["MU", 1]]));
    expect(rows.map((r) => [r.ticker, r.today, r.gap, r.rvol, r.float])).toEqual([["IONQ", -3, null, 0.8, 2.5e8], ["MU", 2, 1.5, 2.2, 1.1e9]]);
    expect(rows[0]).toMatchObject({ price: 10, premarket: 0.5, fromOpen: 1, afterHours: null });
    expect(missing).toEqual(["DEAD", "NONE"]);
  });
});

describe("gap / RVOL / float from the providers", () => {
  const sec = (h: number) => Math.floor(Date.UTC(2026, 9, 20, h + 4) / 1000);
  it("Finviz: its Gap, Rel Volume, Float (no gap before the open)", () => {
    const row = { ticker: "MU", price: 10, changePct: 1, gapPct: 2.345, relVolume: 1.8, float: 1.1e9 };
    expect(extrasFromFinviz(row, "rth")).toEqual({ gap: 2.35, rvol: 1.8, float: 1.1e9 });
    expect(extrasFromFinviz(row, "pre").gap).toBeNull();
  });
  it("Yahoo: open vs previous close, volume / 3-month average; none for a quote of another day or before the open", () => {
    const y = { symbol: "MU", regularMarketPrice: 105, regularMarketOpen: 102, regularMarketPreviousClose: 100, regularMarketTime: sec(11), regularMarketVolume: 3e6, averageDailyVolume3Month: 2e6 };
    expect(extrasFromYahoo(y, "rth", TODAY)).toEqual({ gap: 2, rvol: 1.5, float: null });
    expect(extrasFromYahoo(y, "pre", TODAY)).toEqual({ gap: null, rvol: null, float: null });
    expect(extrasFromYahoo({ ...y, regularMarketTime: sec(-20) }, "rth", TODAY).gap).toBeNull();
  });
  it("the ticker cache keeps the extras next to the quote (seeded by the shared refresh)", async () => {
    const restore = setTickerCacheDeps({ now: () => NOW, fetchQuotes: async () => { throw new Error("no fetch expected"); } });
    seedQuotes(new Map([["MU", q("MU", 1)]]), "rth", NOW, new Map([["MU", ex(1, 2, 3)]]));
    expect((await detailsFor(["MU"], "rth", TODAY)).get("MU")!.extras).toEqual(ex(1, 2, 3));
    restore();
  });
});

describe("board data", () => {
  const restores: (() => void)[] = [];
  afterEach(() => { while (restores.length) restores.pop()!(); });
  const session = async () => ({ session: "rth" as const, today: TODAY, now: NOW });

  it("themes board: pinned shared themes in pinned order + own themes with their own quotes", async () => {
    restores.push(setScreenerDeps({ enabled: () => true }));
    const asked: string[][] = [];
    restores.push(setBoardDeps({
      base: async () => base, session,
      boardById: async () => board({ kind: "themes", pinned: [3, 99, 1], columns: ["today"] }),
      listPersonalOnBoard: async () => [own({})],
      quotesFor: async (t) => { asked.push([...t]); return new Map([["MU", q("MU", 4)]]); },
    }));
    const d = await getBoardData(7, 5);
    if (d?.kind !== "themes") throw new Error("themes board expected");
    expect(d.themes.map((t) => t.name)).toEqual(["Gold", "AI"]);
    expect(d.personal.map((p) => [p.name, p.today, p.missing])).toEqual([["Mine", 4, ["WDC"]]]);
    expect(asked).toEqual([["MU", "WDC"]]);
    expect(d.board.columns).toEqual(["today"]);
  });

  it("tickers board from a screener: a stale resolve runs and is stored, top N shown, floats looked up only where missing", async () => {
    restores.push(setScreenerDeps({ enabled: () => true, now: () => NOW, run: async () => ["AAA", "BBB", "CCC"] }));
    const saved: unknown[] = [];
    const floatAsk: string[][] = [];
    restores.push(setBoardDeps({
      session,
      boardById: async () => board({ source: { kind: "screener", screener: { filters: ["ind_semiconductors"], order: null }, top: 25 } }),
      saveBoardResolved: async (id, t) => { saved.push([id, t]); },
      detailsFor: async (t) => new Map(t.map((x) => [x, { quote: q(x, x === "AAA" ? 3 : 1), extras: ex(null, null, x === "BBB" ? 5e7 : null) }])),
      floatsFor: async (t) => { floatAsk.push([...t]); return new Map([["AAA", 9e7]]); },
    }));
    const d = await getBoardData(7, 5);
    if (d?.kind !== "tickers") throw new Error("tickers board expected");
    expect(saved).toEqual([[5, ["AAA", "BBB", "CCC"]]]);
    expect(floatAsk).toEqual([["AAA", "CCC"]]);
    expect(d.rows.map((r) => [r.ticker, r.float])).toEqual([["AAA", 9e7], ["BBB", 5e7], ["CCC", null]]);
    expect(d.needsFinviz).toBe(false);
  });

  it("Finviz off: a screener board says so and is not resolved; another user's / archived board → null", async () => {
    restores.push(setScreenerDeps({ enabled: () => false }));
    restores.push(setBoardDeps({
      session,
      boardById: async (_u, id) => (id === 5 ? board({ source: { kind: "screener", screener: { filters: ["sec_energy"], order: null }, top: 50 } }) : id === 6 ? board({ id: 6, active: false }) : null),
      saveBoardResolved: async () => { throw new Error("must not resolve"); },
      detailsFor: async () => { throw new Error("no tickers, no quotes"); },
      floatsFor: async () => new Map(),
    }));
    expect(await getBoardData(7, 5)).toMatchObject({ kind: "tickers", needsFinviz: true, rows: [], missing: [] });
    expect(await getBoardData(7, 6)).toBeNull();
    expect(await getBoardData(7, 8)).toBeNull();
  });

  it("GET /api/themes: boards as tabs; a remembered tab of a gone board falls back to the shared one; guests none", async () => {
    restores.push(setScreenerDeps({ enabled: () => false }));
    restores.push(setBoardDeps({
      base: async () => base,
      readView: async () => ({ ...DEFAULT_VIEW, tab: 42 }),
      listBoards: async () => [board({ id: 5, name: "Chips" })],
    }));
    const b = await getBoard(7);
    expect(b.boards.map((x) => [x.id, x.name, x.kind])).toEqual([[5, "Chips", "tickers"]]);
    expect(b.view.tab).toBe("shared");
    expect(await getBoard(null)).toMatchObject({ boards: [], view: DEFAULT_VIEW });
  });
});
