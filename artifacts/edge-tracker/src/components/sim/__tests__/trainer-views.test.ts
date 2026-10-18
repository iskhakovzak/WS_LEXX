// «Тренажёр» views, server-rendered from contract fixtures: the home cards (daily not played / played with the
// ranking, «Мои дни», «Найди вход» with mastery, «Свободная игра» with resume), the 30-day line, the daily ranking
// (aliases, names, the viewer's row after a gap), the drill answer / run summary, the /simulator redirect — RU and UZ.
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { TrainerCards, TrainerStatsLine, type HomeActions } from "../trainer-home";
import { DailyRanking, DailyReveal, rankRows } from "../daily-reveal";
import { trainerKeys } from "../trainer-api";
import type { GameView } from "../use-sim-game";
import { AnswerPanel, RunSummary } from "../find-entry-run";
import { simulatorTarget, aliasOf } from "../trainer-api";
import { OWN_CANDIDATES_KEY } from "@/components/shared/replay-own-day";
import type { Snapshot } from "../api";
import { answer, daily, home, playedDaily } from "./trainer-fixtures";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;

function render(el: ReturnType<typeof createElement>, client = new QueryClient()): string {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(SsrRouter, { ssrPath: "/trainer" }, el)));
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, "");
}

const noop = () => {};
const actions = (over: Partial<HomeActions> = {}): HomeActions => ({
  starting: false, active: null, onDaily: noop, onOpenGame: noop, onResume: noop, onMyDays: noop, onFindEntry: noop, onFree: noop, ...over,
});
const cards = (h = home(), a = actions(), client?: QueryClient) =>
  render(createElement(TrainerCards, { home: h, loading: false, error: null, onRetry: noop, a }), client);

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("trainer home", () => {
  it("four modes; daily not played → one play button, ticker hidden", () => {
    const html = cards();
    for (const s of ["Задача дня", "Мои дни", "Найди вход", "Свободная игра"]) expect(html).toContain(s);
    expect(html).toContain("Играть задачу дня");
    expect(html).not.toContain("AMD");
  });

  it("daily played: ticker/date, R, place, streak, ranking top 3 + me, review button", () => {
    const html = cards(home({ daily: playedDaily() }));
    expect(html).toContain("AMD · 24 сент.");
    expect(html).toContain("Твоё место: 7 из 12");
    expect(html).toContain("3 дня подряд");
    expect(html).toContain("Трейдер 4");
    expect(html).toContain("Ольга Н.");
    expect(html).toContain("Ты");
    expect(html).toContain("Разбор: мои сделки на графике");
    expect(html).not.toContain("Играть задачу дня");
  });

  it("daily started but not finished → continue", () => {
    expect(cards(home({ daily: daily({ activeGameId: 9 }) }))).toContain("Продолжить задачу дня");
  });

  it("find entry: setups with drills only, mastery chip, mixed run", () => {
    const html = cards();
    expect(html).toContain("ORB");
    expect(html).toContain("VWAP Hold");
    expect(html).not.toContain("Parabolic");
    expect(html).toContain("24 задачи");
    expect(html).toContain("10 задач по всем сетапам");
    expect(html).toMatch(/role="img"[^>]*aria-label="[^"]+"/); // MasteryChip
  });

  it("my days: worst candidate prefilled; active own game → continue", () => {
    const qc = new QueryClient();
    qc.setQueryData(OWN_CANDIDATES_KEY, { trades: [{ tradeId: 5, ticker: "TSLA", date: "2026-10-09", side: "long", net: -412, r: -1.2, mistakes: [], played: false }], worst: 5, windowDays: 30 });
    expect(cards(home(), actions(), qc)).toContain("Худший: TSLA");
    expect(cards(home({ myDays: { candidates: 4, active: { gameId: 3, ticker: "META" } } }))).toContain("Продолжить META");
  });

  it("free game: level + bar size with daily bars; resume an unfinished free game", () => {
    const active = { id: 8, own: null, trainer: null, cursor: 30, startIdx: 10, endIdx: 100 } as unknown as Snapshot;
    const html = cards(home(), actions({ active }));
    expect(html).toContain("Дневки");
    expect(html).toContain("2m");
    expect(html).toContain("Сыграно 20 из 90");
  });

  it("30-day line", () => {
    const html = render(createElement(TrainerStatsLine, { stats: home().stats }));
    expect(html).toContain("30 дней: 21 попытка");
    expect(html).toContain("точность входа 72%");
    expect(html).toContain("3 раза лучше реала");
  });

  it("UZ: Latin labels", async () => {
    await setLang("uz", { source: "init" });
    const html = cards(home({ daily: playedDaily() }));
    expect(html).toContain("Kun vazifasi");
    expect(html).toContain("Treyder 4");
    expect(html).toContain("Kirishni top");
    expect(html).not.toMatch(/Задача|Найди|Трейдер/);
  });
});

describe("daily ranking", () => {
  it("places, the viewer's own row after a gap", () => {
    const d = playedDaily();
    const rows = rankRows(d);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 7]);
    expect(rows[3].gap).toBe(true);
    expect(rows[1].gap).toBe(false);
    const html = render(createElement(DailyRanking, { d }));
    expect(html).toContain("…");
    expect(html).toContain("+1.40R");
  });

  it("alias labels", () => {
    expect(aliasOf("t12")).toBe(12);
    expect(aliasOf("Ольга Н.")).toBeNull();
  });
});

describe("find entry answer + summary", () => {
  it("score, server explanation, reveal, mastery, next", () => {
    const html = render(createElement(AnswerPanel, { answer: answer(), last: false, onNext: noop, fine: true }));
    expect(html).toContain("82");
    expect(html).toContain("Поздно: лучшая цена уже ушла — на 2 бар. позже эталона");
    expect(html).toContain("Это был NVDA");
    expect(html).toContain("пример из плейбука");
    expect(html).toContain("Мастерство сетапа +1");
    expect(html).toContain("Следующая");
  });

  it("unknown explanation key → client fallback (late by 2 bars)", () => {
    const html = render(createElement(AnswerPanel, { answer: answer({ explanation: { key: "trainer.findEntry.verdict.someNewKind" } }), last: true, onNext: noop, fine: false }));
    expect(html).toContain("Поздно на 2 бара");
    expect(html).toContain("Итог серии");
  });

  it("run summary: accuracy, hits, mastery change", () => {
    const results = [
      { drillId: 1, setupName: "ORB", score: 90, masteryDelta: 1 },
      { drillId: 2, setupName: "ORB", score: 40, masteryDelta: 0 },
      { drillId: 3, setupName: "VWAP Hold", score: 71, masteryDelta: 0.5 },
    ];
    const html = render(createElement(RunSummary, { results, onAgain: noop, onExit: noop }));
    expect(html).toContain("Точность");
    expect(html).toContain(">67<");
    expect(html).toContain("2/3");
    expect(html).toContain("+1.5");
    expect(html).toContain("Ещё 10 задач");
  });
});

describe("/simulator → /trainer", () => {
  it("keeps the query; old what-if links go to /what-if", () => {
    expect(simulatorTarget("", "")).toBe("/trainer");
    expect(simulatorTarget("?game=12", "")).toBe("/trainer?game=12");
    expect(simulatorTarget("own=5", "")).toBe("/trainer?own=5");
    expect(simulatorTarget("?r=1", "")).toBe("/what-if?r=1");
    expect(simulatorTarget("", "#fees")).toBe("/what-if#fees");
  });
});

describe("daily closed without playing", () => {
  it("shows the reveal and no play button", () => {
    const html = cards(home({ daily: daily({ revealed: { ticker: "GOOGL", barsDate: "2026-10-14" } }) }));
    expect(html).toContain("GOOGL · 14 окт.");
    expect(html).toContain("новая появится утром");
    expect(html).not.toContain("Играть задачу дня");
  });
});

describe("daily reveal after the game", () => {
  it("real ticker/date, place, ranking, desk-day and discussion links", () => {
    const qc = new QueryClient();
    qc.setQueryData(trainerKeys.daily(), playedDaily());
    const game = { meta: { trainer: { mode: "daily", date: "2026-10-16" } }, reveal: { ticker: "AMD", day: "2026-09-24" } } as unknown as GameView;
    const html = render(createElement(DailyReveal, { game }), qc);
    expect(html).toContain("Задача дня · 16 окт.");
    expect(html).toContain("Это был AMD, 24 сент. 2026 г.");
    expect(html).toContain("Твоё место: 7 из 12");
    expect(html).toContain("Трейдер 9");
    expect(html).toContain('href="/desk-day?ticker=AMD&date=2026-09-24"');
    expect(html).toContain('href="/discussions?new=1&ticker=AMD"');
  });
});
