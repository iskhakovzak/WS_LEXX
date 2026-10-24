/**
 * «Сегодняшний рынок → что это значит для вас» — one line for the dashboard: what is known about today's market
 * from the cache (SPY's gap when today's session is there, else the last session's volatility) and the trader's
 * historical $ / day in that bucket with its 80 % interval (GET /api/my-edge/today). Honest «мало данных».
 */
import { Link } from "wouter";
import { ArrowRight, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtPct } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { myEdgeI18n } from "@/i18n/ns/myEdge";
import { useTodayEdge, type TodayData } from "./api";
import { bucketLabel, money } from "./model";

export function todaySentence(d: TodayData): string {
  const ns = myEdgeI18n;
  const b = d.basis;
  if (!b.basis) return ns.t("today.none");
  const row = d.row;
  if (!row) return ns.t("today.noHistory");
  const common = {
    value: money(row.perDay.point),
    interval: ns.t("interval", { lo: money(row.perDay.lo), hi: money(row.perDay.hi) }),
    days: commonI18n.t("units.tradingDays", { count: row.days }),
  };
  const text = b.basis === "gap"
    ? ns.t("today.gap", { ...common, bucket: bucketLabel("spyGap", b.key), pct: fmtPct(b.gapPct, { decimals: 2 }) })
    : ns.t("today.prevVol", { ...common, bucket: bucketLabel("spyPrevVol", b.key), date: fmtDate(`${b.asOf}T12:00:00`, "dayMonth") });
  if (row.status === "low") return `${text} ${ns.t("today.lowData")}`;
  return row.perDay.lo < 0 && row.perDay.hi > 0 ? `${text} ${ns.t("today.noise")}` : text;
}

export function TodayEdgeLine({ trader, className }: { trader?: string | null; className?: string }) {
  const { t } = myEdgeI18n.useT();
  const q = useTodayEdge(trader);
  if (q.isError || (!q.isLoading && !q.data)) return null;
  return (
    <section className={cn("glass-panel flex flex-col gap-1 rounded-2xl px-[var(--panel-p)] py-3 sm:flex-row sm:items-center sm:gap-3", className)} aria-label={t("today.title")}>
      <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Compass className="h-4 w-4" aria-hidden="true" />
        {t("today.title")}
      </span>
      <p className="min-w-0 flex-1 text-sm text-foreground text-pretty" aria-busy={q.isLoading}>
        {q.isLoading ? <span className="inline-block h-4 w-2/3 animate-pulse rounded bg-[var(--glass-bg)]" /> : todaySentence(q.data!)}
      </p>
      <Link
        href="/analytics?tab=myedge"
        className="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 self-start rounded-md px-2 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
      >
        {t("actions.openAnalytics")}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}
