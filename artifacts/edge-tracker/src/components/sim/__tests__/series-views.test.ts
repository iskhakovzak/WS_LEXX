// «Серия из 10» views, server-rendered: the home card's main entry and resume, the result column inside a series
// (progress, «Следующий» / «Итоги серии», the no-trade verdict instead of the money), «Дальше: серия из 10» after
// «Задача дня» and «Мои дни», the series summary (totals, best / worst with replay) — RU and UZ.
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { TrainerCards, type HomeActions } from "../trainer-home";
import { ResultSummary } from "../result";
import { OwnResultSummary } from "../own-result";
import { SeriesProvider, type SeriesCtx } from "../series-context";
import { NoTradeVerdictCard, SeriesSummary } from "../series-summary";
import { totalsOf, type NoTradeVerdict, type SeriesResult, type SeriesState } from "../series-api";
import type { GameView } from "../use-sim-game";
import { home } from "./trainer-fixtures";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;
function render(el: ReturnType<typeof createElement>): string {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SsrRouter, { ssrPath: "/trainer" }, el)));
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, "");
}
const noop = () => {};
afterEach(async () => { await setLang("ru", { source: "init" }); });

const res = (gameId: number, outcome: SeriesResult["outcome"], r: number | null, correct: boolean | null = null): SeriesResult => ({ gameId, outcome, r, correct });
const series = (over: Partial<SeriesState> = {}): SeriesState => {
  const results = over.results ?? [res(1, "traded", 1.2), res(2, "skipped", null)];
  return { id: 7, size: 10, index: 2, finished: false, results, totals: totalsOf(results), gameId: 50, ...over };
};
const result = { net: 0, gross: 0, fees: 0, pct: 0, r: 0, trades: 0, wins: 0, bh: { entry: 10, exit: 11, qty: 100, net: 100, pct: 10 }, vsBh: -10, beatBh: false, maxDrawdown: 0, mistakes: [], equity: [] };
const game = (id = 50, meta: Record<string, unknown> = {}): GameView => ({
  meta: { id, mode: "intraday", difficulty: "easy", tf: "5m", own: null, trainer: null, ...meta },
  reveal: { ticker: "NVDA", longName: null, day: "2026-09-24", dayTo: null, realTimes: [], result, desk: { traders: [], outside: 0, intradayCount: null }, own: null },
  state: { pos: 0, trades: [], fills: [] }, done: true, cursor: 10,
} as unknown as GameView);
const ctx = (over: Partial<SeriesCtx> = {}): SeriesCtx => ({ series: series(), verdictOf: () => null, startSeries: noop, starting: false, ...over });
const withCtx = (c: SeriesCtx | null, el: ReturnType<typeof createElement>) => (c ? createElement(SeriesProvider, { value: c }, el) : el);
const summary = (g: GameView, c: SeriesCtx | null, noAgain = false) =>
  render(withCtx(c, createElement(ResultSummary, { game: g, onAgain: noop, onStart: noop, starting: false, noAgain })));

const actions = (over: Partial<HomeActions> = {}): HomeActions => ({
  starting: false, active: null, onDaily: noop, onOpenGame: noop, onResume: noop, onMyDays: noop, onFindEntry: noop, onFree: noop, ...over,
});
const cards = (a: HomeActions) => render(createElement(TrainerCards, { home: home(), loading: false, error: null, onRetry: noop, a }));

describe("home: «Серия из 10» is the main free-play entry", () => {
  it("series button + the quiet single game; level / bar size stay", () => {
    const html = cards(actions({ onSeries: noop }));
    expect(html).toContain("Серия из 10");
    expect(html).toContain("Одна игра");
    expect(html).toContain("Дневки");
    expect(html).toContain("10 случайных графиков подряд");
  });
  it("without the series action: the single game as before", () => {
    const html = cards(actions());
    expect(html).not.toContain("Серия из 10");
    expect(html).toContain("Случайный реальный график");
  });
  it("an unfinished series game is active → «Продолжить серию · 3 / 10»", () => {
    const active = { id: 50, own: null, trainer: null, cursor: 30, startIdx: 10, endIdx: 100 } as never;
    expect(cards(actions({ onSeries: noop, active, series: { n: 3, size: 10 } }))).toContain("Продолжить серию · 3 / 10");
  });
});

describe("result column inside a series", () => {
  it("progress + big «Следующий» with Enter", () => {
    const html = summary(game(), ctx());
    expect(html).toContain("Игра 3 из 10");
    expect(html).toContain("Следующий");
    expect(html).toContain("Enter");
    expect(html).not.toContain("Ещё раз");
  });
  it("the last game → «Итоги серии»; a reviewed game of a finished series → «К итогам серии»", () => {
    expect(summary(game(), ctx({ series: series({ index: 9 }) }))).toContain("Итоги серии");
    expect(summary(game(1), ctx({ series: series({ finished: true, gameId: null }) }))).toContain("К итогам серии");
  });
  it("a game outside the series keeps «again»", () => {
    const html = summary(game(999), ctx());
    expect(html).not.toContain("Следующий");
    expect(html).not.toContain("Игра 3 из 10");
  });
  it("«не торгую»: the verdict replaces the money tile", () => {
    const v: NoTradeVerdict = { correct: false, bestR: 2.3, reasonKey: "noTrade.missedLong", missed: { side: "long", entry: 12.4, extreme: 12.95, r: 2.3 } };
    const html = summary(game(), ctx({ verdictOf: () => v }));
    expect(html).toContain("Решение: не торгую");
    expect(html).toContain("Упущен лонг: цена прошла 2.3R вверх раньше, чем 1R против");
    expect(html).toContain("12.40 → 12.95");
    expect(html).not.toContain("Результат");
  });
  it("correct no-trade in one line", () => {
    const html = render(createElement(NoTradeVerdictCard, { verdict: { correct: true, bestR: 0.8, reasonKey: "noTrade.correct", missed: null } }));
    expect(html).toContain("Верно: чистого сетапа не было — лучший ход 0.8R");
    expect(html).not.toContain("Упущенное движение");
  });
});

describe("closure: «Дальше: серия из 10»", () => {
  it("after «Задача дня» (one attempt) the main button leads on to a series", () => {
    const html = summary(game(5, { trainer: { mode: "daily", date: "2026-10-16" } }), ctx({ series: null }), true);
    expect(html).toContain("Дальше: серия из 10");
    expect(html).toContain("К тренажёру");
  });
  it("without the provider (other pages) — unchanged", () => {
    expect(summary(game(5), null, true)).not.toContain("Дальше: серия из 10");
  });
  it("after «Мои дни»", () => {
    const own = {
      tradeId: 1, pick: "worst", ticker: "AMD", date: "2026-09-24", decisionIdx: 5, riskSource: "trade", side: "long", entryIdx: 5, exitIdx: 9,
      realNet: -120, realGross: -110, realFees: 10, maxQty: 100, avgEntry: 10, avgExit: 9, stop: null, riskUsd: 100, legs: [], mistakes: [],
      compare: { realNet: -120, realR: -1.2, simNet: 40, simR: 0.4, diff: 160, riskUsd: 100, verdict: "better" },
    };
    const g = game(5, { own: { tradeId: 1 } });
    (g.reveal as unknown as { own: unknown }).own = own;
    const html = render(withCtx(ctx({ series: null }), createElement(OwnResultSummary, { game: g, onAgain: noop, onStart: noop, starting: false })));
    expect(html).toContain("Дальше: серия из 10");
  });
});

describe("series summary", () => {
  const done = series({
    finished: true, gameId: null, index: 9,
    results: [res(1, "traded", 2.4), res(2, "no_trade", 0, true), res(3, "skipped", null), res(4, "traded", -1.1), res(5, "no_trade", 0, false)],
  });
  it("totals, net R, best and worst with replay, one big «again»", () => {
    const html = render(createElement(SeriesSummary, { series: done, onReplay: noop, onAgain: noop, onHome: noop, starting: false }));
    expect(html).toContain("Итоги серии");
    expect(html).toContain("+1.30R");
    expect(html).toContain("Сделки");
    expect(html).toContain("1 из 2");
    expect(html).toContain("Пропущено");
    expect(html).toContain("Лучшее решение · игра 1");
    expect(html).toContain("Сделка +2.40R");
    expect(html).toContain("Худшее решение · игра 4");
    expect(html).toContain("Разобрать");
    expect(html).toContain("Ещё серия из 10");
    expect(html).toContain("верных решений 50%");
  });
  it("UZ: Latin labels", async () => {
    await setLang("uz", { source: "init" });
    const html = render(createElement(SeriesSummary, { series: done, onReplay: noop, onAgain: noop, onHome: noop, starting: false }));
    expect(html).toContain("Seriya yakuni");
    expect(html).toContain("Eng yaxshi qaror");
    expect(html).not.toMatch(/[А-Яа-яЁё]/);
  });
});
