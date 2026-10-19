// The trader's leaderboard holds only their own row: no «#1 of 1», no podium, no «команды» totals, a translated empty
// text without a raw period key (UMID-15, ILYA-21, DENIS-23, MAKSIM-27, ROMAN-11).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { ratingsI18n } from "@/i18n/ns/ratings";
import { SelfRow, isSelfOnly, type RankedEntry } from "../leaderboard-tab";

const row: RankedEntry = {
  trader: "Илья Ш.", totalTrades: 178, wins: 80, losses: 90, breakevens: 8, winrate: 47, totalPnl: -216, avgPnl: -1.2, pnlCount: 178,
  totalR: null, avgR: null, bestTrade: 120, worstTrade: -90, expectancy: -1.2, currentStreak: 1, bestStreak: 4, worstStreak: -5,
  lastTradeDate: "2026-10-16", rank: 1, rankDelta: null, isNew: true,
};

function render(el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el)).replace(/<!-- -->/g, "");
}

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("trader's own row", () => {
  it("self-only: a trader with just their row; never staff, never a desk", () => {
    expect(isSelfOnly([row], "Илья Ш.", false)).toBe(true);
    expect(isSelfOnly([row], "Илья Ш.", true)).toBe(false);
    expect(isSelfOnly([row, { ...row, trader: "Денис Ф." }], "Илья Ш.", false)).toBe(false);
    expect(isSelfOnly([], "Илья Ш.", false)).toBe(false);
  });

  it("no rank, no team wording; the period in words", () => {
    const html = render(createElement(SelfRow, { row, metric: "pnl", periodFor: ratingsI18n.t("leaderboard.periodFor.p30"), titles: {} }));
    expect(html).toContain("Ваша строка");
    expect(html).toContain("за 30 дней");
    expect(html).not.toContain("#1");
    expect(html).not.toContain("команд");
  });

  it("empty text: no raw period key in UZ / RU", async () => {
    await setLang("uz", { source: "init" });
    expect(ratingsI18n.t("leaderboard.emptyPeriod", { period: ratingsI18n.t("leaderboard.periodFor.p30") })).toBe("Savdolar yoʻq — soʻnggi 30 kunda");
    await setLang("ru", { source: "init" });
    expect(ratingsI18n.t("leaderboard.emptyPeriod", { period: ratingsI18n.t("leaderboard.periodFor.p30") })).toBe("Нет сделок за 30 дней");
  });
});
