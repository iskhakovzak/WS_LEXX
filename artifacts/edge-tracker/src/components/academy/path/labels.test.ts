import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ChallengeRules, ChallengeTemplate, StageMeta } from "./api";
import {
  challengeName, criterionLabel, criterionLabelByText, describeRules, headlineText, noteText, stageDescription, stageName, templateName,
} from "./labels";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

const stages: StageMeta[] = [
  { key: "junior", name: "Джун", order: 1, description: "Капитал фирмы, малый лот, только интрадей", scalingTier: "junior" },
  { key: "trader", name: "Опытный трейдер", order: 2, description: "Своё описание", scalingTier: "trader" },
];

const rules: ChallengeRules = {
  accountSize: 50000, profitTarget: 1500, dailyLossLimit: 500, maxDrawdown: 1125, drawdownMode: "trailing", trailingStopsAtStart: true,
  consistencyPct: 40, minTradingDays: 10, maxPositionQty: null, maxPositionUsd: 50000, tradingWindow: { start: 240, end: 960 }, tradingWindowStrict: false,
};
const capital: ChallengeTemplate = {
  key: "junior_to_trader", name: "Перевод Джун → Трейдер (капитал $50k)", description: "…", forStage: "junior", toStage: "trader",
  scalingTier: "trader", durationTradingDays: 20, rules,
};

describe("academy path labels", () => {
  it("keeps Russian as the server sends it", () => {
    expect(stageName(stages, "junior")).toBe("Джун");
    expect(stageName(stages, null)).toBe("не назначена");
    expect(criterionLabel("Минимум 30 торговых дней из 40", "trading_days", "junior")).toBe("Минимум 30 торговых дней из 40");
    expect(headlineText({ stage: "Джун", next: "Трейдер", passed: 3, total: 13, ready: false })).toBe("Готов к переводу: 3 из 13 критериев");
    expect(templateName(capital)).toBe("Перевод Джун → Трейдер (капитал $50k)");
    expect(describeRules(rules, 20)).toBe(
      "счёт $50,000, цель +$1,500 за 20 торг. дн., дневной лимит убытка $500, трейлинг-просадка $1,125 (фиксируется на стартовом балансе), " +
      "лучший день ≤ 40% прибыли, мин. 10 торговых дней, позиция ≤ $50,000, входы 04:00–15:59 NY (вход вне окна — нарушение, экзамен не останавливается)",
    );
  });

  it("translates server defaults by code and keeps staff-written text", async () => {
    await setLang("en", { source: "init" });
    expect(stageName(stages, "junior")).toBe("Junior");
    expect(stageName(stages, "trader")).toBe("Опытный трейдер"); // renamed by staff
    expect(stageName(stages, "senior")).toBe("Senior"); // not in config → tier name
    expect(stageDescription(stages[0])).toBe("Firm capital, small size, intraday only");
    expect(stageDescription(stages[1])).toBe("Своё описание");
    expect(criterionLabel("Минимум 30 торговых дней из 40", "trading_days", "junior")).toBe("At least 30 trading days out of 40");
    expect(criterionLabel("P&L нетто", "net_pnl", "junior")).toBe("Net P&L");
    expect(criterionLabel("Мой критерий", "net_pnl", "junior")).toBe("Мой критерий");
    expect(criterionLabelByText("Доля комиссий", "trader")).toBe("Fee share");
    expect(noteText("нет данных по $")).toBe("no $ data");
    expect(noteText("3 из 10")).toBe("3 из 10");
    expect(headlineText({ stage: "Junior", next: "Trader", passed: 1, total: 1, ready: true })).toBe("Ready for promotion to “Trader”: 1 of 1 criterion");
    expect(templateName(capital)).toBe("Promotion Junior → Trader ($50k capital)");
    expect(challengeName({ name: capital.name, templateKey: capital.key }, [capital])).toBe("Promotion Junior → Trader ($50k capital)");
    expect(challengeName({ name: "Особый экзамен", templateKey: capital.key }, [capital])).toBe("Особый экзамен");
    await setLang("uz", { source: "init" });
    expect(stageName(stages, "junior")).toBe("Junior");
    expect(headlineText({ stage: "Junior", next: "Treyder", passed: 3, total: 13, ready: false })).toBe("Koʻtarilishga tayyorlik: 13 tadan 3 ta mezon");
  });
});
