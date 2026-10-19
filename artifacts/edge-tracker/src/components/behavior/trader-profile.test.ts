// Behaviour profile (MAKSIM-16/17, DENIS-33, cross-area note 3): a habit cost is never a green «+$», the monthly bars
// carry month names, the weakest hour shows even when it is green, and «setup» coverage names the broker strategy.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { TraderProfilePanel } from "./trader-profile";
import type { BehaviorReport, TraderProfile } from "./api";

const hour = (label: string, net: number, n = 60) => ({ label, n, net, avgNet: net / n, winRate: 0.55 });

function profile(over: Partial<TraderProfile["habits"]> = {}): TraderProfile {
  return {
    style: { key: "intraday", label: "Интрадей", description: "", medianHoldMin: 12, tradesPerDay: 9, scalpShare: 0.2, carryShare: 0 },
    hours: { best: hour("10", 483), worst: hour("13", 6), minN: 24 },
    setups: { best: hour("ORB", 600, 87), worst: null, coverage: 1, autoShare: 0, minN: 5, rows: [] },
    habits: {
      total: 2.15, sumOfCosts: -501.29, trades: 394, days: 59, baselineAvg: 2.04,
      byPattern: [{ key: "martingale", title: "Рост размера после убытка", cost: -277.42 }],
      monthly: [{ month: "2026-09", cost: -14.69, n: 86 }, { month: "2026-10", cost: 94.98, n: 54 }],
      ...over,
    },
    discipline: { avg: 80, recent: 82, prior: 78, delta: 4, direction: "better" },
  };
}

const render = (p: TraderProfile) => renderToStaticMarkup(createElement(TraderProfilePanel, {
  report: { profile: p, summary: { net: 1600 } } as unknown as BehaviorReport,
})).replace(/<!-- -->/g, "");

afterEach(async () => { await setLang("ru", { source: "init" }); });

describe("behaviour profile", () => {
  it("a positive union total shows $0 (not green) and explains the separate pattern costs", async () => {
    await setLang("ru", { source: "init" });
    const html = render(profile());
    expect(html).toMatch(/tracking-tight text-muted-foreground">\$0</);
    expect(html).not.toMatch(/tracking-tight[^"]*">\+\$/);
    expect(html).toContain("не хуже «чистых»");
    expect(html).toContain("Минус — сколько привычки стоили");
  });

  it("a negative total stays a red minus", async () => {
    await setLang("ru", { source: "init" });
    const html = render(profile({ total: -151 }));
    expect(html).toMatch(/text-down[^"]*">−\$151/);
  });

  it("monthly bars are labelled with month names, not initials", async () => {
    await setLang("en", { source: "init" });
    const html = render(profile());
    expect(html).toMatch(/>Sep\.?</);
    expect(html).toMatch(/>Oct\.?</);
  });

  it("the weakest hour is shown even when every hour is green; coverage names the broker strategy", async () => {
    await setLang("ru", { source: "init" });
    const html = render(profile());
    expect(html).toContain("13:00–14:00");
    expect(html).toContain("название стратегии брокера");
  });
});
