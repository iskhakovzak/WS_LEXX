/**
 * «Цена джуна до безубытка» view model (pure; model.test.ts): status labels and tones, the «что окупается» sentence,
 * the Kaplan–Meier «больше N дней», the projection lines. Every text from ns juniorCost in the current language.
 */
import type { Tone } from "@/components/ds";
import { fmtDate, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { juniorCostI18n } from "@/i18n/ns/juniorCost";
import type { CohortRow, FactorResult, JuniorStatus, PathBase } from "./api";

const t = juniorCostI18n.t;

/** $ in the trading format: whole dollars from $100, cents below. */
export const usd = (v: number | null | undefined, signed = false) =>
  fmtUsd(v, { signed, decimals: v != null && Math.abs(v) < 100 ? 2 : 0 });

export const tradingDays = (n: number) => commonI18n.t("units.tradingDays", { count: n });
export const calendarDays = (n: number) => commonI18n.t("units.days", { count: n });

export const STATUS_TONE: Record<JuniorStatus, Tone> = { reached: "up", provisional: "accent", below: "warn", stopped: "down", insufficient: "neutral" };

export function statusLabel(p: Pick<PathBase, "status" | "provisionalDays" | "stableDays">): string {
  if (p.status === "provisional") return t("status.provisional", { days: p.provisionalDays, window: tradingDays(p.stableDays) });
  return t(`status.${p.status}`);
}

/** KM median weekdays, or «больше N дней» when fewer than half reached breakeven yet. */
export function kmDays(row: Pick<CohortRow, "medianDays" | "maxTenure">): string {
  return row.medianDays != null ? tradingDays(row.medianDays) : t("desk.open", { days: tradingDays(row.maxTenure) });
}

export function factorLabel(f: Pick<FactorResult, "factor" | "threshold">): string {
  switch (f.factor) {
    case "trainer": return t("attribution.factors.trainer", { n: f.threshold });
    case "plans": return t("attribution.factors.plans", { share: fmtRate(f.threshold) });
    case "exams": return t("attribution.factors.exams");
    case "oneOnOne": return t("attribution.factors.oneOnOne");
  }
}

/** «медиана −$1,200 и −15 торговых дней» / «медиана +$300 дороже» / «разница не ясна» / «мало данных». */
export function factorVerdict(f: FactorResult): string {
  if (f.status === "low") return t("attribution.lowData");
  const c = f.costDiff;
  if (!c || f.verdict === "unclear") return t("attribution.unclear");
  if (f.verdict === "costs") return t("attribution.costs", { cost: usd(c.point, true) });
  const d = f.daysDiff;
  return d && d.point !== 0
    ? t("attribution.pays", { cost: usd(c.point, true), days: `${d.point > 0 ? "+" : "−"}${tradingDays(Math.abs(Math.round(d.point)))}` })
    : t("attribution.paysNoDays", { cost: usd(c.point, true) });
}

/** The projection as one or two lines (null when the junior has none). */
export function projectionLines(p: Pick<PathBase, "projection" | "stableDays">): string[] {
  const pr = p.projection;
  if (!pr) return [];
  if (pr.kind === "insufficient") return [t("projection.insufficient", { n: pr.window })];
  const mean = t("projection.mean", { n: tradingDays(pr.window), mean: usd(pr.meanNet.point, true), lo: usd(pr.meanNet.lo, true), hi: usd(pr.meanNet.hi, true) });
  if (pr.kind === "notImproving") return [t("projection.notImproving", { n: pr.window, mean: usd(pr.meanNet.point, true) })];
  const window = tradingDays(p.stableDays);
  const date = fmtDate(pr.eta.point, "dayMonth");
  const line = pr.days.hi != null && pr.eta.to
    ? t("projection.eta", { point: pr.days.point, lo: pr.days.lo, hi: pr.days.hi, date, from: fmtDate(pr.eta.from, "dayMonth"), to: fmtDate(pr.eta.to, "dayMonth"), window })
    : t("projection.etaOpen", { point: pr.days.point, lo: pr.days.lo, date, window });
  return [line, mean];
}
