import type { Tone } from "@/components/ds";
import type { Action, MetricUnit, Op, RuleStatus, Tier, Unit } from "./use-scaling";

export function fmtUsd(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const s = opts.compact && abs >= 1000
    ? `${(abs / 1000).toLocaleString("ru-RU", { maximumFractionDigits: abs >= 100_000 ? 0 : 1 })}k`
    : abs.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  return `${v < 0 ? "−" : ""}$${s}`;
}

export function fmtMetric(unit: MetricUnit, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "usd": return fmtUsd(v);
    case "r": return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`;
    case "pct": return `${v.toFixed(0)}%`;
    case "x": return `${v.toFixed(2)}×`;
    case "score": return `${v.toFixed(1)}/10`;
    default: return v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  }
}

export const OP_LABEL: Record<Op, string> = { ">=": "≥", ">": ">", "<=": "≤", "<": "<", "=": "=" };

export function fmtThreshold(unit: MetricUnit, raw: number, ruleUnit: Unit, resolved: number | null): string {
  if (ruleUnit === "x_daily_limit") return `${raw}× дневной лимит${resolved != null ? ` (${fmtUsd(resolved)})` : ""}`;
  if (ruleUnit === "pct_account") return `${raw}% счёта${resolved != null ? ` (${fmtUsd(resolved)})` : ""}`;
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

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
  return kind === "usd" ? fmtUsd(Number(v)) : String(v);
}
