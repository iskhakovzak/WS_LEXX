import type { SeverityMeta } from "./types";
import { pluralRu } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { rulesI18n } from "@/i18n/ns/rules";
import { ERROR_VOCAB, errorCodeOf, errorHint, errorLabel } from "@/components/shared/error-vocab";

// Labels are getters: read in render with the current language (never translate at module scope).
export const SEVERITY: Record<string, SeverityMeta> = {
  low: { get label() { return rulesI18n.t("severity.low"); }, tone: "neutral", bar: "bg-muted-foreground/50" },
  medium: { get label() { return rulesI18n.t("severity.medium"); }, tone: "warn", bar: "bg-[hsl(var(--chart-3))]" },
  high: { get label() { return rulesI18n.t("severity.high"); }, tone: "down", bar: "bg-down/70" },
  critical: { get label() { return rulesI18n.t("severity.critical"); }, tone: "down", bar: "bg-down" },
};
export const SEVERITY_ORDER = ["low", "medium", "high", "critical"] as const;

export function severityMeta(s: string | null | undefined): SeverityMeta {
  return SEVERITY[s ?? "medium"] ?? SEVERITY.medium;
}

/**
 * Day-trading mistakes — one tap in the quick-log dialog: the desk's one mistakes vocabulary (components/shared/
 * error-vocab, Волна 2 п. 2.8 — the same list as key M on /trades and the journal review). `value` is what gets stored
 * (the canonical word: readable in CSV, matched by the server) — it is data, never shown; `label` / `hint` are the display
 * in the current language.
 */
export const MISTAKE_CATEGORIES = ERROR_VOCAB.map((e) => ({
  code: e.code,
  value: e.canonical,
  severity: e.severity,
  get label() { return errorLabel(e.code); },
  get hint() { return errorHint(e.code); },
}));

/** Stored prefix of a mistake logged from a rule violation («Правило: <rule name>») — data, see mistakeLabel(). */
export const RULE_PREFIX = "Правило: "; // i18n-ignore

/** Display text of a stored mistake category: built-in ones (any spelling) are translated, a rule-based one keeps the rule name, custom text stays as typed. */
export function mistakeLabel(stored: string): string {
  const code = errorCodeOf(stored);
  if (code) return errorLabel(code);
  if (stored.startsWith(RULE_PREFIX)) return rulesI18n.t("rulePrefixed", { name: stored.slice(RULE_PREFIX.length) });
  return stored;
}

/** Status of a violation in the acknowledge → resolve workflow. */
export const VIOLATION_STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "up" | "down" | "accent" }> = {
  open: { get label() { return rulesI18n.t("status.open"); }, tone: "warn" },
  acknowledged: { get label() { return rulesI18n.t("status.acknowledged"); }, tone: "accent" },
  resolved: { get label() { return rulesI18n.t("status.resolved"); }, tone: "neutral" },
};
export const VIOLATION_RESOLUTION: Record<string, { label: string; tone: "up" | "down" }> = {
  upheld: { get label() { return rulesI18n.t("resolution.upheld"); }, tone: "down" },
  dismissed: { get label() { return rulesI18n.t("resolution.dismissed"); }, tone: "up" },
};

/** Muted badge for archived violations (kept with comments, out of counts). */
type ArchiveReason = "rule_disabled" | "rule_deleted" | "stale";
const archived = (r: ArchiveReason) => ({
  get label() { return rulesI18n.t(`archive.${r}.label`); },
  get hint() { return rulesI18n.t(`archive.${r}.hint`); },
});
export const VIOLATION_ARCHIVE: Record<string, { label: string; hint: string }> = {
  rule_disabled: archived("rule_disabled"),
  rule_deleted: archived("rule_deleted"),
  stale: archived("stale"),
};

const period = <V extends string>(value: V) => ({ value, get label() { return commonI18n.t("time.daysShort", { count: Number(value) }); } });
export const PERIODS = [period("30"), period("90"), period("180")] as const;
export type PeriodValue = (typeof PERIODS)[number]["value"];

export const LS_KEYS = {
  tab: "rules.tab.v2",
  period: "rules.period",
  trader: "rules.trader",
  showArchive: "rules.violations.archive",
} as const;

type Origin = "desk" | "office" | "personal";
const origin = <T extends string>(o: Origin, tone: T) => ({
  tone,
  get label() { return rulesI18n.t(`origin.${o}.label`); },
  get hint() { return rulesI18n.t(`origin.${o}.hint`); },
});
export const ORIGIN_LABEL = {
  desk: origin("desk", "purple" as const),
  office: origin("office", "accent" as const),
  personal: origin("personal", "neutral" as const),
};

/** «Для: Джуны» — the ladder stage of a desk rule (Волна 2 п. 2.6), or null for a rule of every trader. */
export function stageChip(stage: string | null | undefined): { label: string; hint: string } | null {
  if (stage !== "junior" && stage !== "trader" && stage !== "senior") return null;
  return { label: rulesI18n.t("stage.chip", { stage: rulesI18n.t(`stage.${stage}`) }), hint: rulesI18n.t("stage.chipHint") };
}

export function originOf(r: { desk?: boolean; origin?: string | null }): keyof typeof ORIGIN_LABEL {
  return r.desk ? "desk" : r.origin === "office" ? "office" : "personal";
}

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

/** @deprecated Compatibility export (RU only) — rules screens use the `preview.violations` plural entry. */
export const violationsWord = (n: number) => pluralRu(n, "нарушение", "нарушения", "нарушений"); // i18n-ignore
