import type { Tone } from "@/components/ds";
import type { Action, MetricUnit, Op, RuleStatus, Tier, Unit } from "./use-scaling";
import { fmtCount, fmtNum, fmtPct, fmtR, fmtUsd } from "@/lib/format";

export function fmtMetric(unit: MetricUnit, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "usd": return fmtUsd(v, { decimals: 0 });
    case "r": return fmtR(v);
    case "pct": return fmtPct(v, { decimals: 0, signed: false });
    case "x": return fmtNum(v, { suffix: "×" });
    case "score": return fmtNum(v, { decimals: 1, suffix: "/10" });
    default: return fmtCount(Math.round(v));
  }
}

export const OP_LABEL: Record<Op, string> = { ">=": "≥", ">": ">", "<=": "≤", "<": "<", "=": "=" };

export function fmtThreshold(unit: MetricUnit, raw: number, ruleUnit: Unit, resolved: number | null): string {
  if (ruleUnit === "x_daily_limit") return `${String(raw).replace("-", "−")}× дневной лимит${resolved != null ? ` (${fmtUsd(resolved, { decimals: 0 })})` : ""}`;
  if (ruleUnit === "pct_account") return `${raw}% счёта${resolved != null ? ` (${fmtUsd(resolved, { decimals: 0 })})` : ""}`;
  return fmtMetric(unit, raw);
}

export const ACTION_META: Record<Action, { label: string; tone: Tone; verb: string }> = {
  promote: { label: "Повышение", tone: "up", verb: "Повысить" },
  demote: { label: "Понижение", tone: "down", verb: "Понизить" },
  assign: { label: "Назначить тир", tone: "accent", verb: "Назначить" },
  hold: { label: "Удержание", tone: "neutral", verb: "Оставить" },
};

export const STATUS_META: Record<RuleStatus, { label: string; tone: Tone }> = {
  pass: { label: "выполнено", tone: "up" },
  fail: { label: "не выполнено", tone: "down" },
  na: { label: "нет данных", tone: "neutral" },
};

export const PROPOSAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "на рассмотрении", tone: "warn" },
  approved: { label: "одобрено", tone: "up" },
  rejected: { label: "отклонено", tone: "down" },
};

export function tierName(tiers: Tier[], key: string | null | undefined): string {
  if (!key) return "Без тира";
  return tiers.find((t) => t.key === key)?.name ?? key;
}

/** Rows for the limits comparison (current tier → next tier). */
export const TIER_FIELDS: { key: keyof Tier; label: string; kind: "usd" | "int" | "bool" }[] = [
  { key: "accountSize", label: "Buying power", kind: "usd" },
  { key: "dailyLossLimit", label: "Дневной лимит убытка", kind: "usd" },
  { key: "weeklyLossLimit", label: "Недельный лимит убытка", kind: "usd" },
  { key: "maxDrawdown", label: "Макс. просадка", kind: "usd" },
  { key: "maxRiskPerTrade", label: "Риск на сделку", kind: "usd" },
  { key: "maxPositionUsd", label: "Макс. позиция", kind: "usd" },
  { key: "maxOvernightExposure", label: "Овернайт-экспозиция", kind: "usd" },
  { key: "maxOpenPositions", label: "Открытых позиций", kind: "int" },
  { key: "allowOvernight", label: "Овернайт", kind: "bool" },
  { key: "allowSwing", label: "Свинг", kind: "bool" },
];

export function fmtTierField(kind: "usd" | "int" | "bool", v: unknown): string {
  if (kind === "bool") return v ? "разрешён" : "запрещён";
  if (v == null || v === "") return "—";
  return kind === "usd" ? fmtUsd(Number(v), { decimals: 0 }) : String(v);
}
