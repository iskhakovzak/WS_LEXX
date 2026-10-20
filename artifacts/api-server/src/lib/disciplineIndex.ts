/**
 * «Индекс дисциплины» — THE single definition of the discipline score in every progress answer (IMPROVEMENT_PLAN 2.7).
 *
 * The score of a window = the mean of the behaviour engine's daily discipline index (lib/behaviorEngine
 * `report.discipline[].score`, 0–100: 100 minus pattern penalties plus the day-contract delta) over the trading days of
 * the window [from, to]. The scaling engine (lib/scalingEngine metric `discipline`) and the academy path
 * (lib/promotionEngine metric `discipline_index`) both call disciplineIndexOf, so the same days give the same number.
 * The days come from lib/disciplineDays.ts (loadDisciplineDays). Curators' weekly «discipline» grades (trader_ratings,
 * 1–10) are a separate input and no longer a «discipline score» of the ladder.
 *
 * Pure: no I/O.
 */
import type { Rule } from "./scalingEngine";
import { LEGACY_DISCIPLINE_LABELS } from "./scalingSeed";

/** One trading day of the behaviour engine's discipline index. */
export interface DisciplineDay {
  date: string;
  /** 0–100. */
  score: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Mean daily discipline index (0–100) over [from, to] (inclusive, YYYY-MM-DD). `value` is not rounded (callers round
 * for display); null when no day of the window has an index or the engine is unavailable (`days` null ⇒ `days: 0`).
 */
export function disciplineIndexOf(days: readonly DisciplineDay[] | null | undefined, from: string, to: string): { value: number | null; days: number } {
  if (!days) return { value: null, days: 0 };
  let sum = 0, n = 0;
  for (const d of days) {
    if (!YMD.test(d.date) || d.date < from || d.date > to || !Number.isFinite(d.score)) continue;
    sum += d.score;
    n++;
  }
  return { value: n ? sum / n : null, days: n };
}

/**
 * Rules stored before 2.7 compared the discipline metric on the curators' 1–10 scale (seed: promote ≥ 7, demote < 4).
 * The metric is now 0–100, so an absolute discipline threshold ≤ this value is a legacy 0–10 threshold and is read ×10
 * (7 → 70, 4 → 40). No migration: stored rows stay as they are until a curator saves the rule set again.
 * The old seeded labels («… ниже 4») are dropped too, so the reader sees the metric label instead.
 */
export const DISCIPLINE_LEGACY_MAX = 10;

/** A rule with a legacy 0–10 discipline threshold read on the 0–100 scale (other rules unchanged). */
export function normalizeDisciplineRule<T extends Pick<Rule, "metric" | "unit" | "value"> & { label?: string | null }>(rule: T): T {
  if (rule.metric !== "discipline") return rule;
  const legacyValue = rule.unit === "abs" && rule.value > 0 && rule.value <= DISCIPLINE_LEGACY_MAX;
  const legacyLabel = rule.label != null && LEGACY_DISCIPLINE_LABELS.includes(rule.label.trim());
  if (!legacyValue && !legacyLabel) return rule;
  return { ...rule, ...(legacyValue ? { value: Math.round(rule.value * 10 * 100) / 100 } : {}), ...(legacyLabel ? { label: null } : {}) };
}

/** True when an enabled rule reads the discipline metric (then /scaling loads the behaviour engine's days). */
export function rulesNeedDiscipline(rules: readonly Pick<Rule, "metric" | "enabled">[]): boolean {
  return rules.some((r) => r.enabled && r.metric === "discipline");
}

/**
 * The curators' weekly «discipline» grade (trader_ratings, 1–10), averaged over the weeks touching [from, to] — a
 * separate input (the path's optional `rating_discipline` criterion), NOT the discipline score above.
 */
export function curatorDisciplineGradeOf(ratings: readonly { week: string; discipline: number | null }[], from: string, to: string): { value: number | null; weeks: number } {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const weekFrom = d.toISOString().slice(0, 10);
  const xs = ratings.filter((r) => YMD.test(r.week) && r.week >= weekFrom && r.week <= to && r.discipline != null && Number.isFinite(r.discipline)).map((r) => r.discipline as number);
  return { value: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, weeks: xs.length };
}
