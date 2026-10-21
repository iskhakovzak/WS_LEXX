// One evening form (Волна 1, items 1.5 / 1.8 / 1.9): «Закрыть день» is the evening summary — its fields (what went
// well / what to fix / focus tomorrow) are optional and never block the close; the suggested own rule is one tap; after
// the close the journal hands the evening on to «Задача дня» while its ranked window is open.
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { CloseBar } from "../day-journal-close";
import { dailyTaskWaiting } from "../daily-task-card";
import { RuleSuggestion } from "@/components/shared/own-rule-field";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;
const ssr = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(SsrRouter, { ssrPath: "/journal" }, el)).replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

const bar = (over: Partial<Parameters<typeof CloseBar>[0]> = {}) => ssr(createElement(CloseBar, {
  eod: { status: "open" }, blocking: [], editable: true, hasTrades: true, reviewFilled: false, progress: 0, untaggedIds: [],
  closing: false, reopening: false, onClose: () => {}, onReopen: () => {}, showNote: true, ...over,
}));

describe("CloseBar — the summary is optional (1.5)", () => {
  it("an empty summary does not disable «Закрыть день»; the hint says the fields are optional", () => {
    const html = bar();
    expect(html).toContain("Закрыть день");
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Закрыть день/);
    expect(html).toContain("Итог дня — по желанию: что получилось, что исправить и фокус на завтра.");
  });

  it("filled → no hint; still blocked before the market close", () => {
    expect(bar({ reviewFilled: true })).not.toContain("по желанию");
    const early = bar({ eod: { status: "open", closeOpensAt: "16:00" } });
    expect(early).toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Закрыть день/);
    expect(early).toContain("с 16:00 NY");
  });

  it("EN / UZ", async () => {
    await setLang("en", { source: "init" });
    expect(bar()).toContain("The day summary is optional");
    await setLang("uz", { source: "init" });
    expect(bar()).toContain("Kun yakuni — ixtiyoriy");
  });
});

describe("RuleSuggestion (1.9)", () => {
  const rule = { mistake: "behavior:fatigue", costNet: -240.9, count: 40, days: 6, window: { from: "2026-10-07", to: "2026-10-20" } };
  it("names the pattern and its cost, one tap to accept", () => {
    const html = ssr(createElement(RuleSuggestion, { rule, accepted: false, onAccept: () => {}, label: "В фокус" }));
    expect(html).toContain("Предложено правило дня");
    expect(html).toContain("Сделки на усталости: −$241 за 2 недели · 40 раз");
    expect(html).toContain("В фокус");
  });
  it("accepted → disabled «Принято»", () => {
    const html = ssr(createElement(RuleSuggestion, { rule, accepted: true, onAccept: () => {} }));
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>.*Принято/);
  });
});

describe("dailyTaskWaiting (1.8)", () => {
  const w = (open: boolean) => ({ from: { date: "2026-10-20", time: "16:00" }, until: { date: "2026-10-21", time: "08:30" }, open });
  const base = { date: "2026-10-20", revealed: null, played: false, activeGameId: null, my: null, ranking: [], streak: 0 };
  it("waits while the ranked window is open and the viewer has not played", () => {
    expect(dailyTaskWaiting({ ...base, window: w(true) })).toBe(true);
    expect(dailyTaskWaiting({ ...base, window: w(false) })).toBe(false);
    expect(dailyTaskWaiting({ ...base, played: true, window: w(true) })).toBe(false);
    expect(dailyTaskWaiting(null)).toBe(false);
  });
});
