// The rewards chip in the day line: streak, level, points and achievements earned folded; the «Награды» block open
// (level progress, points window, streak, streak freeze, the season bar) — RU and UZ, server-rendered from fixtures.
// Badges are achievement tiers now: no separate badge list in the chip.
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { KEYS } from "@/lib/api/keys";
import type { DisciplineSummary } from "@/lib/daily/types";
import type { GamificationMe } from "@/lib/gamification/types";
import type { QuestsMe } from "@/lib/quests/types";
import { RewardsChip } from "../rewards-chip";
import { DayLineView } from "../day-line";
import { me } from "./fixtures";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;

const discipline: DisciplineSummary = { streak: 4, bestStreak: 7, nextBonus: 4, points30: 120, pointsTotal: 185, windowDays: 30, level: 2, levelFrom: 150, nextLevelAt: 400 };

const quests = { today: "2026-10-16", quests: [], achievements: [], summary: { weekDone: 1, weekTotal: 3, achievementsEarned: 6, achievementsTotal: 14, onboarding: null } } satisfies QuestsMe;
const gami: GamificationMe = {
  season: { key: "2026-10", from: "2026-10-01", to: "2026-10-31", endsInDays: 12, myPoints: 84, myRank: 7, of: 31, top: [] },
  league: null,
  mastery: [],
  freeze: { available: 1, perMonth: 2, usedOn: ["2026-10-14"] },
  titles: [],
  activeTitle: null,
  rewards: { eligible: [], requested: [], granted: [], catalog: [] },
};

function render(el: ReturnType<typeof createElement>, withData = true): string {
  const client = new QueryClient();
  if (withData) {
    client.setQueryData(KEYS.questsMe(), quests);
    client.setQueryData(KEYS.gamificationMe(null), gami);
  }
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(SsrRouter, { ssrPath: "/" }, el)));
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
}

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("rewards chip", () => {
  it("folded: streak, level, points and achievements earned", () => {
    const html = render(createElement(RewardsChip, { discipline }));
    expect(html).toContain("185 очк.");
    expect(html).toContain("Стабильный");
    expect(html).toContain("Достижений получено: 6 из 14");
    expect(html).toContain('aria-expanded="false"');
    // the freeze that saved the streak shows on the streak (tooltip)
    expect(html).toContain("Серию сохранила заморозка: 14 окт");
    expect(html).not.toContain("Сезон октября");
  });

  it("open: level progress, streak, freeze, season bar; no badge list", () => {
    const html = render(createElement(RewardsChip, { discipline, defaultOpen: true }));
    expect(html).toContain("до «Железный» — 215 очк.");
    expect(html).toContain("За 30 торговых дней: +120");
    expect(html).toContain("Контракт соблюдён 4 дня подряд");
    expect(html).toContain("рекорд 7");
    expect(html).toContain("следующий день +4");
    expect(html).toContain("Заморозка серии: 1 из 2 в этом месяце");
    expect(html).toContain("Сезон октября: 84 очка · 7-е место · 12 дней до конца");
    expect(html).toContain('href="/ratings?tab=season"');
    expect(html).not.toContain("Контракт 5 дней подряд");
  });

  it("an older API without quests / gamification: streak, level and points only", () => {
    const html = render(createElement(RewardsChip, { discipline, defaultOpen: true }), false);
    expect(html).toContain("185 очк.");
    expect(html).not.toContain("Сезон");
    expect(html).not.toContain("Заморозка");
    expect(html).not.toContain("Достижений получено");
  });

  it("nothing without a discipline summary (older server)", () => {
    expect(render(createElement(RewardsChip, { discipline: null }))).toBe("");
  });

  it("sits in the day line next to the tier progress", () => {
    const html = render(createElement(DayLineView, { me: me({ discipline }), plan: null }));
    expect(html).toContain("До Джуна: 3 из 5");
    expect(html).toContain("185 очк.");
  });

  it("Uzbek (Latin)", async () => {
    await setLang("uz", { source: "init" });
    const html = render(createElement(RewardsChip, { discipline, defaultOpen: true }));
    expect(html).toContain("Barqaror");
    expect(html).toContain("Oktabr mavsumi");
    expect(html).not.toMatch(/[Ѐ-ӿ]/);
  });
});
