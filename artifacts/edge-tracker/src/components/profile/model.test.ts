/**
 * components/profile/model — sentences from server codes (RU source dictionary), the honesty of low-sample values,
 * radar geometry, the year heat grid, quote picking and the person id parser.
 */
import { describe, expect, it } from "vitest";
import type { Attribute, ProfileSummary, TimelineEvent } from "./api";
import {
  attrExplain, attrValueText, eventText, heatGrid, holdText, orderedAttributes, parsePersonId, radarPath, radarPoint,
  sampleText, styleGroups, summaryText, themeQuoteIds,
} from "./model";

const attr = (over: Partial<Attribute> = {}): Attribute => ({
  key: "discipline", score: 80, sample: 40, minSample: 10, unit: "days", low: false, basis: "violations",
  inputs: { violations: 2, perDay: 0.05, rules: 3 }, deskMedian: 70, ...over,
});

describe("summaryText", () => {
  const s = (over: Partial<ProfileSummary>): ProfileSummary => ({ archetype: "daytrader", top: [], weak: null, lowData: false, ...over });
  it("two strengths and a growth area", () => {
    expect(summaryText(s({ top: ["discipline", "edge"], weak: "execution" }))).toBe("Интрадей-трейдер. Сильные стороны — дисциплина и edge, зона роста — исполнение.");
  });
  it("variants without strengths / weak spot, and the low-data note", () => {
    expect(summaryText(s({ top: ["risk"] }))).toBe("Интрадей-трейдер. Сильная сторона — риск-контроль.");
    expect(summaryText(s({ weak: "patience" }))).toContain("зона роста — терпение");
    expect(summaryText(s({ archetype: "newcomer", lowData: true }))).toBe("Новичок деска. Характеристика соберётся по мере торговли. Данных пока мало — часть оценок предварительная.");
  });
});

describe("attributes", () => {
  it("a low sample never shows a number", () => {
    expect(attrValueText(attr())).toBe("80");
    expect(attrValueText(attr({ low: true }))).toBe("мало данных");
    expect(attrValueText(attr({ score: null }))).toBe("мало данных");
  });
  it("sample and explanation texts", () => {
    expect(sampleText(attr())).toBe("выборка 40 дн., нужно от 10");
    expect(attrExplain(attr())).toBe("Нарушений правил: 2 за 40 торговых дн. (0.05 в день).");
    expect(attrExplain(attr({ basis: "noRules" }))).toContain("Правил пока нет");
    expect(attrExplain(attr({ key: "edge", basis: "bootstrap", unit: "trades", inputs: { expectancy: 1.5, lo80: -2, hi80: 4.25 } }))).toBe("Ожидание на сделку +$1.50, 80%-интервал −$2.00 … +$4.25.");
    expect(attrExplain(attr({ key: "patience", basis: "frequency", inputs: { tradesPerDay: 3.2, deskTradesPerDay: null, overtradeShare: 0.1 } }))).toBe("3.20 сделки в день; дней перегруза 10%.");
  });
  it("orders the card and fills missing keys as low", () => {
    const list = orderedAttributes([attr({ key: "growth" })]);
    expect(list.map((a) => a.key)).toEqual(["discipline", "risk", "stability", "edge", "patience", "execution", "recovery", "growth"]);
    expect(list[0]!.low).toBe(true);
    expect(list[7]!.score).toBe(80);
  });
});

describe("biography sentences", () => {
  const ev = (kind: TimelineEvent["kind"], params: TimelineEvent["params"] = {}): TimelineEvent => ({ kind, day: "2026-03-02", params });
  it("turns codes into plain sentences", () => {
    expect(eventText(ev("first_trade", { ticker: "ORCL" }))).toBe("Первая сделка — ORCL.");
    expect(eventText(ev("milestone_trades", { count: 100 }))).toBe("Сыграна 100-я сделка.");
    expect(eventText(ev("stage_change", { from: "junior", to: "trader" }))).toBe("Переход со ступени «Джун» на «Трейдер».");
    expect(eventText(ev("stage_change", { from: null, to: "junior" }))).toBe("Переход на ступень «Джун».");
    expect(eventText(ev("best_day", { net: 144.09, trades: 5 }))).toBe("Лучший день: +$144.09, 5 сделок.");
    expect(eventText(ev("rule_adopted", { origin: "desk" }))).toBe("Подключено правило деска.");
    expect(eventText(ev("intervention", { kind: "one_on_one", trigger: "scheduled" }))).toBe("Шаг куратора: Встреча 1:1 (по плану).");
    expect(eventText(ev("achievement", { line: "clean_month", tier: "silver" }))).toContain("Серебро");
  });
});

describe("radar and heat", () => {
  it("axis 0 points up; 100 lands on the radius", () => {
    expect(radarPoint(0, 8, 100, 100, 150, 150)).toEqual([150, 50]);
    expect(radarPoint(2, 8, 50, 100, 150, 150)).toEqual([200, 150]);
    expect(radarPoint(0, 8, 140, 100, 150, 150)).toEqual([150, 50]);
    expect(radarPath([0, 0, 0], 10, 0, 0)).toBe("M0 0 L0 0 L0 0 Z");
  });
  it("53 Monday-weeks of 5 weekdays, ending with the current week; future days flagged", () => {
    const g = heatGrid([{ day: "2026-10-20", net: 50, trades: 3 }, { day: "2026-09-01", net: -80, trades: 2 }], "2026-10-21");
    expect(g.weeks).toHaveLength(53);
    expect(g.weeks.at(-1)!.key).toBe("2026-10-19");
    const last = g.weeks.at(-1)!.cells;
    expect(last.map((c) => c.day)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(last[1]).toMatchObject({ net: 50, trades: 3, future: false });
    expect(last[3]!.future).toBe(true);
    expect(g.max).toBe(80);
    expect(g.months[0]!.col).toBe(0);
  });
});

describe("misc", () => {
  it("hold time text", () => {
    expect(holdText(35)).toBe("35 с");
    expect(holdText(240)).toBe("4 мин");
    expect(holdText(5400)).toBe("1,5 ч"); // count follows the language grouping
    expect(holdText(null)).toBe("—");
  });
  it("style groups keep every bucket", () => {
    const g = styleGroups({
      trades: 10, horizon: { intraday: 1, overnight: 0, swing: 0 }, side: { long: 0.4, short: 0.6 },
      price: { lt5: 0, "5to20": 0.5, "20to100": 0.5, gt100: 0 }, hold: { lt1m: 0.2, "1to5m": 0.8, "5to30m": 0, "30mto2h": 0, gt2h: 0, multiday: 0 },
      medianHoldSec: 120, tradesPerDay: 2,
    });
    expect(g.map((x) => x.key)).toEqual(["horizon", "side", "price", "hold"]);
    expect(g[1]!.rows).toEqual([{ key: "long", label: "Лонг", share: 0.4 }, { key: "short", label: "Шорт", share: 0.6 }]);
  });
  it("quotes on the theme, stable per seed, falling back to all", () => {
    const q = [{ id: "a", tags: ["patience"] }, { id: "b", tags: ["risk"] }, { id: "c", tags: ["patience", "focus"] }];
    const ids = themeQuoteIds(q, "patience", "144:2026-10-21");
    expect([...ids].sort()).toEqual(["a", "c"]);
    expect(themeQuoteIds(q, "patience", "144:2026-10-21")).toEqual(ids);
    expect(themeQuoteIds(q, "unknown", "x")).toHaveLength(3);
  });
  it("person id from the path", () => {
    expect(parsePersonId("144")).toBe(144);
    expect(parsePersonId("0")).toBeNull();
    expect(parsePersonId("abc")).toBeNull();
    expect(parsePersonId(undefined)).toBeNull();
  });
});
