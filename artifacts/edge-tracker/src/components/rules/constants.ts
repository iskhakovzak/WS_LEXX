import type { SeverityMeta } from "./types";
import { selectPlural } from "@/i18n/core";

export const SEVERITY: Record<string, SeverityMeta> = {
  low: { label: "Низкая", tone: "neutral", bar: "bg-muted-foreground/50" },
  medium: { label: "Средняя", tone: "warn", bar: "bg-[hsl(var(--chart-3))]" },
  high: { label: "Высокая", tone: "down", bar: "bg-down/70" },
  critical: { label: "Критичная", tone: "down", bar: "bg-down" },
};
export const SEVERITY_ORDER = ["low", "medium", "high", "critical"] as const;

export function severityMeta(s: string | null | undefined): SeverityMeta {
  return SEVERITY[s ?? "medium"] ?? SEVERITY.medium;
}

/** Common day-trading mistakes — one tap in the quick-log dialog. Stored as the label (readable in CSV). */
export const MISTAKE_CATEGORIES: { label: string; hint: string; severity: "low" | "medium" | "high" | "critical" }[] = [
  { label: "FOMO / погоня", hint: "Вошёл в уже ушедшее движение", severity: "medium" },
  { label: "Вход не по плану", hint: "Сетапа нет в плейбуке или плане дня", severity: "high" },
  { label: "Ранний вход", hint: "Не дождался подтверждения", severity: "medium" },
  { label: "Сдвинул стоп", hint: "Отодвинул стоп от цены", severity: "high" },
  { label: "Без стопа", hint: "Позиция без защитного стопа", severity: "critical" },
  { label: "Усреднение убытка", hint: "Добирал против позиции", severity: "critical" },
  { label: "Завышенный размер", hint: "Риск больше нормы", severity: "high" },
  { label: "Переторговка", hint: "Лишние сделки без сетапа", severity: "medium" },
  { label: "Отыгрыш после убытка", hint: "Revenge-trade", severity: "high" },
  { label: "Ранний выход из прибыли", hint: "Закрыл до цели без причины", severity: "low" },
  { label: "Пересидел убыток", hint: "Не вышел по стопу/плану", severity: "high" },
  { label: "Проигнорировал новости", hint: "Отчёт, оффер, макро-событие", severity: "medium" },
];

/** Status of a violation in the acknowledge → resolve workflow. */
export const VIOLATION_STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "up" | "down" | "accent" }> = {
  open: { label: "Новое", tone: "warn" },
  acknowledged: { label: "Принято", tone: "accent" },
  resolved: { label: "Решено", tone: "neutral" },
};
export const VIOLATION_RESOLUTION: Record<string, { label: string; tone: "up" | "down" }> = {
  upheld: { label: "Подтверждено", tone: "down" },
  dismissed: { label: "Снято", tone: "up" },
};

/** Muted badge for archived violations (kept with comments, out of counts). */
export const VIOLATION_ARCHIVE: Record<string, { label: string; hint: string }> = {
  rule_disabled: { label: "правило выключено", hint: "Правило выключено — нарушение сохранено с комментариями, но не учитывается в статистике. Включите правило, чтобы вернуть его." },
  rule_deleted: { label: "правило удалено", hint: "Правило удалено — нарушение сохранено в архиве с комментариями и не учитывается в статистике." },
  stale: { label: "неактуально", hint: "Проверка больше не находит это нарушение (например, сделку исправили). Сохранено, потому что к нему есть комментарий или решение." },
};

export const PERIODS = [
  { value: "30", label: "30 дн" },
  { value: "90", label: "90 дн" },
  { value: "180", label: "180 дн" },
] as const;
export type PeriodValue = (typeof PERIODS)[number]["value"];

export const RULE_PREFIX = "Правило: ";

export const LS_KEYS = {
  tab: "rules.tab.v2",
  period: "rules.period",
  trader: "rules.trader",
  showArchive: "rules.violations.archive",
} as const;

export const ORIGIN_LABEL = {
  desk: { label: "Весь деск", tone: "purple", hint: "Правило офиса для всех трейдеров" },
  office: { label: "Офис", tone: "accent", hint: "Правило задал куратор" },
  personal: { label: "Моё", tone: "neutral", hint: "Личное правило трейдера" },
} as const;

export function originOf(r: { desk?: boolean; origin?: string | null }): keyof typeof ORIGIN_LABEL {
  return r.desk ? "desk" : r.origin === "office" ? "office" : "personal";
}

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function fmtR(r: number | null | undefined, digits = 1): string {
  if (r == null || !Number.isFinite(r)) return "—";
  const s = Math.abs(r).toFixed(digits);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${s}R`;
}
const USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const USD2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Signed net $: «+$1,234» / «−$56»; under $100 — with cents. */
export function fmtUsd(v: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a < 100 && a !== Math.round(a) ? USD2.format(a) : USD.format(a);
  const sign = opts.sign === false ? (v < 0 ? "−" : "") : v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}$${s}`;
}
/** 0..1 → «87%». */
export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}
export function fmtDay(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(`${d.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/**
 * Russian plural form: 1 нарушение, 2 нарушения, 5 нарушений (11–14 → many); fractions (1,5) take the `few` form.
 * @deprecated Thin wrapper over the i18n plural API, kept so old call sites compile. New code: a plural entry in
 * a dictionary (`t("units.trades", { count })`), which also works in EN/UZ.
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  return selectPlural("ru", { one, few, many, other: few }, n);
}
export const violationsWord = (n: number) => pluralRu(n, "нарушение", "нарушения", "нарушений");
