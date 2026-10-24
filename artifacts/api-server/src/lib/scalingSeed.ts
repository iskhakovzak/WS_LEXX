/**
 * «План масштабирования» seed data (written to the DB once, curator-editable afterwards): tier names, descriptions and
 * rule labels are stored user content, not UI text. Readers in other languages see the metric label for a seeded rule
 * label (lib/scalingEngine ruleLabel) and the tier name by key (web scaling/format tierLabel).
 */
import type { Rule, Tier } from "./scalingEngine";
import { setting } from "./settings/registry";

/** The promote-by-discipline seed reads its threshold from one desk setting (roadmap R3; promotion has its own key). */
function disciplineSeed(row: Omit<Rule, "id">): Omit<Rule, "id"> {
  return Object.defineProperty({ ...row }, "value", { get: () => setting("discipline.scalingMinIndex"), enumerable: true });
}

export const DEFAULT_TIERS: Tier[] = [
  { key: "junior", name: "Джун", order: 2, accountSize: 25_000, dailyLossLimit: 300, weeklyLossLimit: 900, maxDrawdown: 2_000, maxRiskPerTrade: 100, maxPositionUsd: 25_000, maxOvernightExposure: 5_000, maxOpenPositions: 3, allowOvernight: false, allowSwing: false, description: "Интрадей, малый лот" }, // i18n-ignore (seed data)
  { key: "trader", name: "Трейдер", order: 3, accountSize: 50_000, dailyLossLimit: 600, weeklyLossLimit: 1_800, maxDrawdown: 4_000, maxRiskPerTrade: 200, maxPositionUsd: 50_000, maxOvernightExposure: 20_000, maxOpenPositions: 5, allowOvernight: true, allowSwing: false, description: "Интрадей + овернайт" }, // i18n-ignore (seed data)
  { key: "senior", name: "Сеньор", order: 4, accountSize: 100_000, dailyLossLimit: 1_200, weeklyLossLimit: 3_500, maxDrawdown: 8_000, maxRiskPerTrade: 400, maxPositionUsd: 100_000, maxOvernightExposure: 50_000, maxOpenPositions: 8, allowOvernight: true, allowSwing: true, description: "Полный BP, свинг" }, // i18n-ignore (seed data)
  { key: "lead", name: "Лид", order: 5, accountSize: 250_000, dailyLossLimit: 2_500, weeklyLossLimit: 7_000, maxDrawdown: 15_000, maxRiskPerTrade: 800, maxPositionUsd: 250_000, maxOvernightExposure: 120_000, maxOpenPositions: 12, allowOvernight: true, allowSwing: true, description: "Максимальный BP, менторство" }, // i18n-ignore (seed data)
];

export const DEFAULT_RULES: Omit<Rule, "id">[] = [
  { kind: "promote", metric: "trades", op: ">=", value: 40, unit: "abs", windowDays: 20, tierKey: null, label: "Минимум сделок за 20 дней", enabled: true }, // i18n-ignore (seed data)
  { kind: "promote", metric: "green_weeks", op: ">=", value: 3, unit: "abs", windowDays: 20, tierKey: null, label: "Зелёных недель подряд", enabled: true }, // i18n-ignore (seed data)
  { kind: "promote", metric: "net_pnl", op: ">=", value: 5, unit: "x_daily_limit", windowDays: 20, tierKey: null, label: "P&L нетто ≥ 5 дневных лимитов", enabled: true }, // i18n-ignore (seed data)
  { kind: "promote", metric: "profit_factor", op: ">=", value: 1.3, unit: "abs", windowDays: 20, tierKey: null, label: "Profit factor", enabled: true }, // i18n-ignore (seed data)
  { kind: "promote", metric: "max_dd_pct", op: "<", value: 50, unit: "abs", windowDays: 20, tierKey: null, label: "Просадка меньше половины лимита", enabled: true }, // i18n-ignore (seed data)
  { kind: "promote", metric: "limit_breaches", op: "=", value: 0, unit: "abs", windowDays: 20, tierKey: null, label: "Без нарушений лимитов", enabled: true }, // i18n-ignore (seed data)
  disciplineSeed({ kind: "promote", metric: "discipline", op: ">=", value: 70, unit: "abs", windowDays: 20, tierKey: null, label: "Индекс дисциплины", enabled: true }), // i18n-ignore (seed data)
  { kind: "demote", metric: "limit_breaches", op: ">=", value: 3, unit: "abs", windowDays: 20, tierKey: null, label: "Три и более нарушений лимитов", enabled: true }, // i18n-ignore (seed data)
  { kind: "demote", metric: "max_dd_pct", op: ">=", value: 100, unit: "abs", windowDays: 20, tierKey: null, label: "Просадка достигла лимита", enabled: true }, // i18n-ignore (seed data)
  { kind: "demote", metric: "net_pnl", op: "<=", value: -3, unit: "x_daily_limit", windowDays: 20, tierKey: null, label: "Убыток ≥ 3 дневных лимитов", enabled: true }, // i18n-ignore (seed data)
  { kind: "demote", metric: "discipline", op: "<", value: 40, unit: "abs", windowDays: 20, tierKey: null, label: "Индекс дисциплины ниже 40", enabled: true }, // i18n-ignore (seed data)
  { kind: "demote", metric: "red_streak", op: ">=", value: 5, unit: "abs", windowDays: 20, tierKey: null, label: "Пять красных дней подряд", enabled: true }, // i18n-ignore (seed data)
];

/**
 * Seeded labels of the discipline rules before 2.7 (curators' 1–10 grade: «≥ 7», «below 4»). Stored rows may still carry
 * them; on the 0–100 index they would mislead, so lib/disciplineIndex normalizeDisciplineRule drops them (the reader
 * then sees the metric label in their language).
 */
export const LEGACY_DISCIPLINE_LABELS: readonly string[] = ["Оценка дисциплины", "Дисциплина ниже 4"]; // i18n-ignore (seed data)
