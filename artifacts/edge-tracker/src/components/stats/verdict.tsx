/**
 * /stats — the one-line answer under the header (design audit, wave 2B): «+$1,240 нетто за 90 дней · на 23%
 * лучше прошлых 90 дней». The figure is the report's total in the chosen metric; the comparison is against the equally
 * long previous window (the same numbers the KPI deltas use). A percentage only when both totals are positive (a % of
 * a loss reads backwards); otherwise the difference itself. The colour says good or bad (the sign of the total).
 */
import { cn } from "@/lib/utils";
import { statsI18n } from "@/i18n/ns/stats";
import { fmtRate } from "@/lib/format";
import { rich } from "@/i18n/rich";
import { commonI18n } from "@/i18n/ns/common";
import { fmtValue, type Kpis, type Metric, type StatsPeriod } from "./metrics";

const PRESET_PREV = new Set(["week", "month", "quarter", "year"]);

export function verdictParts(o: {
  net: number | null; prev: number | null; metric: Metric;
}): { kind: "pct" | "abs" | "same"; better: boolean; pct: number | null; delta: number } | null {
  const { net, prev } = o;
  if (net == null || prev == null || !Number.isFinite(net) || !Number.isFinite(prev)) return null;
  const delta = net - prev;
  const eps = o.metric === "r" ? 0.05 : 1;
  if (Math.abs(delta) < eps) return { kind: "same", better: false, pct: null, delta: 0 };
  const pct = net > 0 && prev > 0 ? Math.abs(delta) / prev : null;
  return pct != null && pct < 10 ? { kind: "pct", better: delta > 0, pct, delta } : { kind: "abs", better: delta > 0, pct: null, delta };
}

export function StatsVerdict({ k, prev, prevLoading, metric, period, curRange, prevRange, className }: {
  k: Kpis; prev: Kpis | null; prevLoading: boolean; metric: Metric; period: StatsPeriod;
  /** «3 окт — 21 окт» of the window (a custom period names it). */
  curRange: string;
  /** «22 июн — 21 июл» of the previous window (custom comparisons). */
  prevRange: string | null;
  className?: string;
}) {
  const { t } = statsI18n.useT();
  const net = k.valued > 0 ? k.net : null;
  const periodText = period === "custom" ? t("verdict.period.custom", { range: curRange }) : t(`verdict.period.${period}`);
  const tone = net == null || net === 0 ? "text-foreground" : net > 0 ? "text-up" : "text-down";
  const head = net == null
    ? t("verdict.noValue", { trades: commonI18n.t("units.trades", { count: k.total }), period: periodText })
    : rich(t("verdict.head", { value: "{value}", metric: t(`verdict.metric.${metric}`), period: periodText }), {
      value: <span className={cn("font-semibold tabular-nums", tone)}>{fmtValue(net, metric)}</span>,
    });
  const preset = PRESET_PREV.has(period) ? (period as "week" | "month" | "quarter" | "year") : null;
  const prevName = preset ? t(`verdict.prev.${preset}`) : prevRange;
  const p = prev && prev.total > 0 && prev.valued > 0 ? verdictParts({ net, prev: prev.net, metric }) : null;
  let tail: string | null = null;
  if (prevName && !prevLoading && net != null) {
    if (!prev || prev.total === 0) tail = t("verdict.prevEmpty");
    else if (p?.kind === "same") tail = preset ? t("verdict.same", { prev: prevName }) : t("verdict.sameRange", { prev: prevName });
    else if (p) {
      const amount = p.kind === "pct" ? fmtRate(p.pct) : fmtValue(Math.abs(p.delta), metric, { sign: false });
      const key = `${p.better ? "better" : "worse"}${preset ? "" : "Range"}` as "better" | "worse" | "betterRange" | "worseRange";
      tail = t(`verdict.${key}`, { amount, prev: prevName });
    }
  }
  return (
    <p className={cn("text-base font-medium text-foreground sm:text-lg", className)} data-testid="stats-verdict">
      <span>{head}</span>
      {tail && <span className="font-normal text-muted-foreground"> · {tail}</span>}
    </p>
  );
}
