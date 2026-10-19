import { describe, expect, it } from "vitest";
import {
  aggregateDays,
  buildDayBook as buildDayBookFromCells,
  calendarCoverage,
  categoriesByDate,
  categoryOf,
  cellsFromDayBook,
  cellsFromTrades,
  closedDates,
  earningsEdge as earningsEdgeFromCells,
  edgeByCategory,
  focusDay,
  frequentTickers as frequentTickersFromCells,
  nextTradingDay,
  prevTradingDay,
  welchT,
  type BookTrade,
  type MacroRow,
  type TickerHistory,
} from "./catalyst-math";

// The math takes day cells (server day book); the synthetic books below are raw trades folded the same way.
const buildDayBook = (trades: BookTrade[]) => buildDayBookFromCells(cellsFromTrades(trades));
const frequentTickers = (trades: BookTrade[], limit?: number, min?: number) => frequentTickersFromCells(cellsFromTrades(trades), limit, min);
const earningsEdge = (trades: BookTrade[], h: TickerHistory) => earningsEdgeFromCells(cellsFromTrades(trades), h);

const row = (date: string, type: string, name: string, description: string | null = null, importance = "high"): MacroRow => ({ date, type, name, description, importance });

const CAL: MacroRow[] = [
  row("2026-01-01", "holiday", "New Year's Day", "Market closed"),
  row("2026-01-13", "cpi", "CPI", "8:30am ET — Consumer Price Index"),
  row("2026-01-27", "fomc", "FOMC Meeting", "FOMC begins", "medium"),
  row("2026-01-28", "fomc", "FOMC Meeting (Decision Day)", "Statement 2pm ET, Powell presser 2:30pm ET"),
  row("2026-03-20", "quad_witching", "Quadruple Witching", "all expire"),
  row("2026-07-03", "holiday", "Independence Day (observed)", "Early close 1pm ET"),
];

const tr = (date: string, ticker: string, pnl: number, fees = 1, result?: string): BookTrade => ({
  date, ticker, pnl, fees, result: result ?? (pnl - fees > 0 ? "win" : pnl - fees < 0 ? "loss" : "be"),
});

describe("calendar categories", () => {
  it("maps calendar rows to categories, skipping the first FOMC day and full holidays", () => {
    expect(categoryOf(CAL[0])).toBeNull();
    expect(categoryOf(CAL[1])).toBe("cpi");
    expect(categoryOf(CAL[2])).toBeNull();
    expect(categoryOf(CAL[3])).toBe("fomc");
    expect(categoryOf(CAL[4])).toBe("opex");
    expect(categoryOf(CAL[5])).toBe("short_day");
    const m = categoriesByDate(CAL);
    expect([...m.keys()].sort()).toEqual(["2026-01-13", "2026-01-28", "2026-03-20", "2026-07-03"]);
    expect([...closedDates(CAL)]).toEqual(["2026-01-01"]);
  });

  // ROMAN-02 / ROMAN-15: /api/holidays answers in the reader's language — RU / UZ rows must classify the same.
  it("classifies localised (RU / UZ) calendar rows: FOMC decision days, closures, short days", () => {
    const ru: MacroRow[] = [
      row("2026-01-27", "fomc", "Заседание FOMC", "Начало заседания FOMC", "medium"),
      row("2026-01-28", "fomc", "Заседание FOMC (день решения)", "Заявление в 14:00 ET, пресс-конференция Пауэлла в 14:30 ET"),
      row("2026-07-03", "holiday", "День независимости (перенос)", "Биржа закрыта"),
      row("2026-11-27", "holiday", "День после Дня благодарения", "Сокращённый день, закрытие в 13:00 ET"),
    ];
    expect(ru.map(categoryOf)).toEqual([null, "fomc", null, "short_day"]);
    expect([...closedDates(ru)]).toEqual(["2026-07-03"]);
    const uz: MacroRow[] = [
      row("2026-03-18", "fomc", "FOMC yigʻilishi + SEP (qaror kuni)", "Bayonot 14:00 ET, Pauellning matbuot anjumani 14:30 ET"),
      row("2026-01-01", "holiday", "Yangi yil", "Birja yopiq"),
    ];
    expect(categoryOf(uz[0])).toBe("fomc");
    expect([...closedDates(uz)]).toEqual(["2026-01-01"]);
    // 2026: 8 FOMC meetings → 8 decision days, whatever the language (first days are «medium»).
    const year: MacroRow[] = ["01-28", "03-18", "04-29", "06-17", "07-29", "09-16", "11-04", "12-16"].flatMap((d) => [
      row(`2026-${d}`, "fomc", "Заседание FOMC (день решения)", "Заявление в 14:00 ET"),
      row(`2026-${d.slice(0, 3)}${String(Number(d.slice(3)) - 1).padStart(2, "0")}`, "fomc", "Заседание FOMC", "Начало заседания FOMC", "medium"),
    ]);
    expect([...categoriesByDate(year).values()].filter((s) => s.has("fomc"))).toHaveLength(8);
  });

  it("walks trading days around weekends and closures", () => {
    const closed = closedDates(CAL);
    expect(nextTradingDay("2025-12-31", closed)).toBe("2026-01-02");
    expect(prevTradingDay("2026-01-05", closed)).toBe("2026-01-02");
    // Saturday → Monday; Friday after the close → Monday; Friday morning → Friday.
    expect(focusDay("2026-10-17", 9 * 60, closed)).toBe("2026-10-19");
    expect(focusDay("2026-10-16", 16 * 60 + 5, closed)).toBe("2026-10-19");
    expect(focusDay("2026-10-16", 8 * 60, closed)).toBe("2026-10-16");
  });
});

describe("day book and aggregates", () => {
  const trades: BookTrade[] = [
    tr("2026-01-12", "NVDA", 11), // net +10
    tr("2026-01-12", "MU", -4), // net -5
    tr("2026-01-13", "NVDA", -19), // cpi, net -20
    tr("2026-01-14", "AMD", 21), // net +20
    { date: "2026-01-14", ticker: "AMD", pnl: 50, fees: 0, result: "open" }, // ignored
  ];
  const book = buildDayBook(trades);

  it("uses net money and skips open trades", () => {
    expect(book.get("2026-01-12")?.net).toBe(5);
    expect(book.get("2026-01-12")?.n).toBe(2);
    expect(book.get("2026-01-14")?.n).toBe(1);
    const a = aggregateDays(book, ["2026-01-12", "2026-01-14", "2026-02-02"]);
    expect(a.days).toBe(2);
    expect(a.net).toBe(25);
    expect(a.avgNetDay).toBe(12.5);
    expect(a.greenPct).toBe(100);
    expect(a.winRate).toBe(66.7);
    expect(a.sample).toBe("low");
  });

  it("compares category days with ordinary days", () => {
    const e = edgeByCategory(book, categoriesByDate(CAL), closedDates(CAL));
    expect(e.from).toBe("2026-01-12");
    expect(e.to).toBe("2026-01-14");
    expect(e.baseline.days).toBe(2);
    const cpi = e.rows.find((r) => r.key === "cpi")!;
    expect(cpi.agg.days).toBe(1);
    expect(cpi.agg.net).toBe(-20);
    expect(cpi.delta).toBe(-32.5);
    expect(cpi.verdict).toBe("low");
    // FOMC decision on 01-28 is outside the traded span → not counted.
    expect(e.rows.find((r) => r.key === "fomc")!.calendarDays).toBe(0);
  });

  // ROMAN-03: days before the calendar's first year are unknown, not «ordinary» — the analysis is clipped to it.
  it("clips the comparison to the calendar coverage", () => {
    const cal = [row("2026-01-02", "nfp", "NFP"), row("2026-01-13", "cpi", "CPI")];
    const cov = calendarCoverage(cal, "2023-10-20")!;
    expect(cov).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(calendarCoverage(cal, "2026-01-05")).toEqual({ from: "2026-01-05", to: "2026-12-31" });
    expect(calendarCoverage([], "2026-01-05")).toBeNull();
    const b = buildDayBook([tr("2025-06-03", "NVDA", 101), tr("2026-01-12", "NVDA", 11), tr("2026-01-13", "NVDA", -19)]);
    const e = edgeByCategory(b, categoriesByDate(cal), closedDates(cal), cov);
    expect(e.from).toBe("2026-01-12");
    expect(e.baseline.days).toBe(1); // 2025-06-03 is outside the calendar → not an «ordinary day»
    expect(e.rows.find((r) => r.key === "cpi")!.agg.days).toBe(1);
  });

  it("decodes the server day book and folds trades into the same cells", () => {
    const cells = cellsFromDayBook({ tickers: ["NVDA", "MU"], days: [["2026-01-12", [[0, 2, 1, 1, 5.5], [1, 1, 0, 1, -3]]], ["2026-01-13", [[0, 1, 1, 0, 9]]]] });
    expect(cells).toEqual([
      { date: "2026-01-12", ticker: "NVDA", n: 2, wins: 1, losses: 1, net: 5.5 },
      { date: "2026-01-12", ticker: "MU", n: 1, wins: 0, losses: 1, net: -3 },
      { date: "2026-01-13", ticker: "NVDA", n: 1, wins: 1, losses: 0, net: 9 },
    ]);
    const day = buildDayBookFromCells(cells).get("2026-01-12")!;
    expect(day).toMatchObject({ n: 3, wins: 1, losses: 2, net: 2.5 });
    expect(day.tickers.get("NVDA")).toEqual({ n: 2, net: 5.5 });
    expect(cellsFromDayBook(null)).toEqual([]);
    expect(cellsFromTrades([tr("2026-01-12", "nvda", 11), tr("2026-01-12", "NVDA", -4), { date: "2026-01-12", ticker: "NVDA", pnl: 9, fees: 0, result: "open" }]))
      .toEqual([{ date: "2026-01-12", ticker: "NVDA", n: 2, wins: 1, losses: 1, net: 5 }]);
  });

  it("welch t is null for tiny or flat samples", () => {
    expect(welchT([1], [1, 2])).toBeNull();
    expect(welchT([1, 1], [1, 1])).toBeNull();
    expect(welchT([10, 12, 11], [1, 2, 0])!).toBeGreaterThan(5);
  });
});

describe("tickers and earnings reactions", () => {
  const trades: BookTrade[] = [
    tr("2026-02-26", "NVDA", 41), // reaction day, net +40
    tr("2026-02-26", "NVDA", -9), // reaction day, net -10
    tr("2026-03-02", "NVDA", 6), // other, net +5
    tr("2026-03-03", "MU", 3),
    tr("2026-03-04", "MU", 3),
    tr("2026-03-05", "MU", 3),
  ];

  it("ranks frequent tickers with a minimum", () => {
    expect(frequentTickers(trades, 5, 3).map((t) => t.ticker)).toEqual(["MU", "NVDA"]);
    expect(frequentTickers(trades, 5, 4)).toEqual([]);
  });

  it("splits my ticker trades into reaction days vs other days", () => {
    const e = earningsEdge(trades, {
      ticker: "nvda",
      quarters: [
        { date: "2026-02-25", reactionDate: "2026-02-26", gapPct: -3, rangePct: 6, closePct: 2, beat: true },
        { date: "2025-11-19", reactionDate: "2025-11-20", gapPct: 5, rangePct: 8, closePct: -1, beat: true },
        { date: "2025-08-27", reactionDate: null, gapPct: null, rangePct: null, closePct: null },
      ],
    });
    expect(e.reactions.map((r) => r.date)).toEqual(["2026-02-26", "2025-11-20"]);
    expect(e.avgAbsGap).toBe(4);
    expect(e.avgRange).toBe(7);
    expect(e.upShare).toBe(50);
    expect(e.event).toMatchObject({ days: 1, trades: 2, net: 30, wins: 1, losses: 1, winRate: 50, avgNetTrade: 15 });
    expect(e.other).toMatchObject({ trades: 1, net: 5 });
  });
});
