// «Что важно сейчас» decisions from the persona walkthrough (2026-10-19), server-rendered from fixtures:
// a halt is not repeated under the hero (DENIS-38), old days are not «the next step» and a trainee without recent
// trades starts with plan → trainer → lesson (UMID-05), weekend violations name their day and tickers repeat once
// (OWNER-21), recent trades show the office setup or «без сетапа» (OWNER-35).
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { AttentionPanel, staleDay, uniqueTickers, violationsTitle } from "../attention-panel";
import { setupLabel } from "../recent-trades-panel";
import type { DashboardToday, EodStatus, RecentTrade, RiskMe } from "../use-dashboard";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

function today(over: { weekend?: boolean; violations?: DashboardToday["attention"]["violations"] } = {}): DashboardToday {
  return {
    date: over.weekend ? "2026-10-18" : "2026-10-19",
    scope: "me",
    viewer: { name: "Умид", staff: false },
    market: { nyDate: "2026-10-19", nyMinutes: 8 * 60, session: "pre", weekend: !!over.weekend, holidayToday: null, holidays: [] },
    week: { days: [] },
    gamePlan: null,
    myTickers: [],
    positions: [],
    attention: {
      openTrades: { count: 0, items: [] },
      unreviewed: { count: 0, items: [] },
      checkin: { done: true },
      draftIdeas: { count: 0 },
      ideasToReview: { count: 0, items: [] },
      violations: over.violations ?? { count: 0, items: [] },
      curatorQueue: null,
    },
  } as unknown as DashboardToday;
}

function render(props: Partial<Parameters<typeof AttentionPanel>[0]>): string {
  const html = renderToStaticMarkup(
    createElement(SsrRouter, { ssrPath: "/" }, createElement(AttentionPanel, {
      data: today(), risk: null, desk: null, eod: null, lastDayEod: null, lastDay: null, recent: [], events: null, marketEvents: [],
      unread: undefined, isLoading: false, onCheckin: () => undefined, ...props,
    })),
  );
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
}

const oldTrade = { id: 1, ticker: "AAL", closeDate: "2026-04-09", date: "2026-04-09", result: "loss" } as unknown as RecentTrade;

describe("next step for a new trainee (UMID-05)", () => {
  it("an unclosed April day is not offered; plan → trainer → lesson is", () => {
    const eod = { date: "2026-04-09", today: "2026-10-19", traders: [{ trader: "Умид", status: "open", trades: 2, missing: [] }] } as unknown as EodStatus;
    const html = render({ recent: [oldTrade], lastDay: "2026-04-09", lastDayEod: eod });
    expect(html).not.toContain("2026-04-09");
    expect(html).not.toContain("9 апр");
    expect(html).toContain("Сегодня: план → тренажёр → урок");
    expect(html).toContain("/game-plan?view=my&date=2026-10-19");
    expect(html).toContain("/trainer");
  });
  it("staleDay: more than 30 calendar days", () => {
    expect(staleDay("2026-04-09", "2026-10-19")).toBe(true);
    expect(staleDay("2026-10-16", "2026-10-19")).toBe(false);
  });
});

describe("a halt is shown once (DENIS-38)", () => {
  it("the hero carries the stop; the panel has no risk row for it", () => {
    const risk = { trader: "Илья Ш.", halted: true, alerts: [], stop: { label: "Стоп по просадке", message: "Торговля остановлена до разбора" } } as unknown as RiskMe;
    const html = render({ risk, recent: [{ ...oldTrade, closeDate: "2026-10-16" }] });
    expect(html).not.toContain("Стоп по просадке");
  });
});

describe("violations on a weekend (OWNER-21)", () => {
  const v = {
    count: 18, window: { from: "2026-10-16", to: "2026-10-18" }, tickers: ["SOXL", "AAPL", "JPM"],
    items: [{ id: 1, trader: "x", severity: "warn", message: "Пауза", tradeId: 1, ruleName: null, ticker: "SOXL" }],
  };
  it("names the trading day and lists each ticker once", () => {
    expect(violationsTitle(v, false)).toBe("18 нарушений правил за пт, 16 окт");
    expect(violationsTitle(v, true)).toBe("18 нарушений правил за сутки");
    const html = render({ data: today({ weekend: true, violations: v }), recent: [{ ...oldTrade, closeDate: "2026-10-16" }] });
    expect(html).toContain("за пт, 16 окт");
    expect(html).toContain("SOXL, AAPL, JPM");
  });
  it("uniqueTickers keeps the first occurrence", () => {
    expect(uniqueTickers([{ ticker: "SOXL" }, { ticker: "aapl" }, { ticker: "JPM" }, { ticker: "JPM" }, { ticker: "AAPL" }])).toEqual(["SOXL", "AAPL", "JPM"]);
  });
});

describe("«План на день»: one next step (composed dashboard, 2026-10-25)", () => {
  const fresh = [{ ...oldTrade, closeDate: "2026-10-16" }];
  it("the daily «Напиши план» is the next step, with the day frame and the progress row in the card", () => {
    const html = render({
      recent: fresh,
      dailyStep: { kind: "plan", date: "2026-10-19", href: "/game-plan?view=my&date=2026-10-19" },
      dailyToday: "2026-10-19",
      frame: "FRAME",
      progress: "PROGRESS",
      recommended: "RECOMMENDED",
    });
    expect(html).toContain("Напиши план на сегодня");
    expect(html.indexOf("Напиши план на сегодня")).toBeLessThan(html.indexOf("RECOMMENDED"));
    expect(html.indexOf("RECOMMENDED")).toBeLessThan(html.indexOf("FRAME"));
    expect(html).toContain("PROGRESS");
  });
  it("«Закрой день» is not repeated when the journal row for that day is already a task", () => {
    const eod = { date: "2026-10-16", today: "2026-10-19", traders: [{ trader: "Умид", status: "open", trades: 5, missing: [] }] } as unknown as EodStatus;
    const html = render({
      recent: fresh,
      lastDay: "2026-10-16",
      lastDayEod: eod,
      dailyStep: { kind: "close", date: "2026-10-16", href: "/journal?date=2026-10-16" },
    });
    expect(html).not.toContain("Закрой день");
    expect(html).toContain("Заполнить разбор вчерашнего дня");
    expect(html).toContain("1 задача");
  });
});

describe("recent trades setup label (OWNER-35)", () => {
  it("office setup, «без сетапа», or the broker strategy on an older server", () => {
    expect(setupLabel({ setup: "Power Hour Momentum", playbookSetup: "Gap & Go" }, "без сетапа")).toBe(" · Gap & Go");
    expect(setupLabel({ setup: "Power Hour Momentum", playbookSetup: null }, "без сетапа")).toBe(" · без сетапа");
    expect(setupLabel({ setup: "Power Hour Momentum" }, "без сетапа")).toBe(" · Power Hour Momentum");
  });
});
