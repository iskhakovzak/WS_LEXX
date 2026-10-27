// «Контекст дня» and the long daily chart (owner 2026-10-25): the card renders the gap, the catalyst (masked text or a
// generic line, full text only after the reveal), the cap bucket, float and premarket volume; the daily axis counts
// trading days back. Server-rendered, RU and EN.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { simI18n } from "@/i18n/ns/simulator";
import type { TrainerDayContext } from "@/lib/trainer/types";
import { DayContextCard, capLine, catalystLine } from "../day-context";
import { dailyAxisTicks, spreadLabels } from "../daily-chart";

const day: TrainerDayContext = {
  gapPct: 12.4, gapAt: "pre", minGapPct: 7,
  catalysts: [
    { kind: "earnings", source: "earnings", timing: "prevAfter", headline: null, publisher: "Finviz", analyst: null, full: null },
    { kind: "news", source: "news", timing: "pre", headline: "*** wins a big contract", publisher: "Wire", analyst: null, full: null },
    { kind: "news", source: "analyst", timing: "pre", headline: null, publisher: "Firm", analyst: { action: "up", firm: "Firm", from: "Hold", to: "Buy" }, full: null },
  ],
  cap: { usd: 1_200_000_000, bucket: "small", basis: "day" },
  floatShares: 41_000_000,
  pmVolume: 1_250_000,
};

afterEach(async () => { await setLang("ru"); });

describe("day context card", () => {
  it("before the reveal: gap, report / news, masked headline, cap bucket, float, premarket volume (RU)", async () => {
    await setLang("ru");
    const html = renderToStaticMarkup(createElement(DayContextCard, { day, revealed: false }));
    expect(html).toContain("Контекст дня");
    expect(html).toContain("+12.4%");
    expect(html).toContain("Отчёт");
    expect(html).toContain("Новость");
    expect(html).toContain("*** wins a big contract");
    expect(html).toContain("$1.2B · смолл-кэп");
    expect(html).toContain("41M");
    expect(html).toContain("1.3M");
    expect(html).toContain("Название компании скрыто");
    expect(html).not.toContain("href=");
  });

  it("after the reveal: the full headline and the link (EN)", async () => {
    await setLang("en");
    const revealed: TrainerDayContext = {
      ...day,
      catalysts: [{ ...day.catalysts[1], headline: "Quizworks wins a big contract", full: { headline: "Quizworks wins a big contract", at: "2026-10-08T11:30:00.000Z", url: "https://x.example/a" } }],
    };
    const html = renderToStaticMarkup(createElement(DayContextCard, { day: revealed, revealed: true }));
    expect(html).toContain("Quizworks wins a big contract");
    expect(html).toContain("https://x.example/a");
    expect(html).toContain("Day context");
  });

  it("generic lines and a held-back mega cap", async () => {
    await setLang("ru");
    const t = simI18n.t;
    expect(catalystLine(day.catalysts[0], t)).toBe("Квартальный отчёт компании");
    expect(catalystLine({ ...day.catalysts[1], headline: null, timing: "session" }, t)).toContain("во время сессии");
    expect(catalystLine(day.catalysts[2], t)).toBe("Повышение рейтинга · Firm · Hold → Buy");
    expect(catalystLine({ ...day.catalysts[2], analyst: { action: "targets", firm: null, from: null, to: null, firms: 5 } }, t)).toContain("5 аналитиков");
    expect(capLine({ usd: null, bucket: "mega", basis: "day" }, t)).toBe("мега-кэп");
  });
});

describe("daily chart axis", () => {
  it("counts trading days back from the play day, only existing bars", () => {
    expect(dailyAxisTicks(251, true)).toEqual([
      { idx: 0, back: 250 }, { idx: 50, back: 200 }, { idx: 100, back: 150 }, { idx: 150, back: 100 }, { idx: 200, back: 50 }, { idx: 230, back: 20 }, { idx: 250, back: 0 },
    ]);
    expect(dailyAxisTicks(60, false).map((x) => x.back)).toEqual([50, 20]);
    expect(dailyAxisTicks(0, false)).toEqual([]);
  });

  it("level labels never overlap (PDC next to the 52-week low) and stay inside the plot", () => {
    expect(spreadLabels([100, 300, 305], 24, 10, 400)).toEqual([100, 300, 324]);
    expect(spreadLabels([395, 398], 24, 10, 400)).toEqual([376, 400]);
    expect(spreadLabels([5], 24, 10, 400)).toEqual([10]);
  });
});
