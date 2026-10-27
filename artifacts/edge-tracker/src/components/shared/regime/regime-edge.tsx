/**
 * Edge by desk regime (GET /api/market-regime/edge): one row per regime the trader traded in — days, trades, P&L,
 * win rate, expectancy in R, $ / day with the honest status of «Мой edge» («надёжно» / «гипотеза» / «мало данных»:
 * < 5 days or < 10 trades), today's regime highlighted, and one plain sentence for the clearest leak / strength
 * («в боковике ты теряешь −$X в день»). Used on /indicators, in the profile «Характеристика» and the weekly reflection.
 */
import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, Panel, Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtNum, fmtRate, fmtUsd } from "@/lib/format";
import type { RegimeKey } from "@/lib/market-regime";
import { personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { myEdgeI18n } from "@/i18n/ns/myEdge";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import { regimeEdgeQuery, type EdgeStatus, type RegimeEdge, type RegimeEdgeRow } from "./api";
import { REGIME_ICON, regimeName } from "./labels";

const usd = (v: number | null | undefined) => fmtUsd(v, { signed: true, decimals: v != null && Math.abs(v) < 10 ? 2 : 0 });
const tone = (v: number) => (Math.abs(v) < 0.005 ? "text-foreground" : v > 0 ? "text-up" : "text-down");

export function EdgeStatusPill({ status }: { status: EdgeStatus }) {
  const { t } = myEdgeI18n.useT();
  return (
    <Pill tone="neutral" title={t(`statusHint.${status}`)} className={cn(status === "reliable" && "border-foreground/40 text-foreground", status === "low" && "opacity-70")}>
      {status === "reliable" && <span className="h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden="true" />}
      {t(`status.${status}`)}
    </Pill>
  );
}

/** «В режиме «Боковик» ты теряешь −$120 в день (14 торговых дней).» — null when no regime has enough data. */
export function edgeSentence(e: RegimeEdge, self: boolean): { text: string; kind: "leak" | "strength" } | null {
  const t = marketRegimeI18n.t;
  const pick = (k: RegimeKey | null, kind: "leak" | "strength") => {
    const row = k ? e.rows.find((r) => r.regime === k) : undefined;
    if (!row) return null;
    const params = { name: regimeName(row.regime), value: usd(row.perDay.point), days: commonI18n.t("units.tradingDays", { count: row.days }) };
    const text = self
      ? t(kind === "leak" ? "edge.leak" : "edge.strength", params)
      : t(kind === "leak" ? "edge.leakThird" : "edge.strengthThird", { ...params, who: personName(e.trader) });
    return { text, kind };
  };
  return pick(e.leak, "leak") ?? pick(e.strength, "strength");
}

const COLS = "grid grid-cols-[minmax(0,1.6fr)_3rem_3.5rem_5.5rem_3.5rem_4.5rem_minmax(5rem,1fr)] items-center gap-2";

function Row({ r, today }: { r: RegimeEdgeRow; today: boolean }) {
  const { t } = marketRegimeI18n.useT();
  const Icon = REGIME_ICON[r.regime];
  const low = r.status === "low";
  return (
    <div role="row" className={cn(COLS, "rounded-lg px-2 py-1.5 text-sm tabular-nums", today ? "bg-primary/10" : "hover:bg-[var(--tile-hover-bg)]")}>
      <span role="cell" className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={cn("min-w-0 break-words", low && "text-muted-foreground")}>{regimeName(r.regime)}</span>
        {today && <Pill tone="accent">{t("edge.today")}</Pill>}
      </span>
      <span role="cell" className="text-right text-muted-foreground">{r.days}</span>
      <span role="cell" className="text-right text-muted-foreground">{r.trades}</span>
      <span role="cell" className={cn("text-right font-medium", tone(r.net))}>{usd(r.net)}</span>
      <span role="cell" className="text-right text-muted-foreground">{fmtRate(r.winRate)}</span>
      <span role="cell" className="text-right text-muted-foreground" title={r.rTrades ? undefined : t("edge.noR")}>
        {r.expectancyR != null ? `${fmtNum(r.expectancyR, { decimals: 2, signed: true })}R` : "—"}
      </span>
      <span role="cell" className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        <span className={cn("font-medium", low ? "text-muted-foreground" : tone(r.perDay.point))}>{usd(r.perDay.point)}</span>
        <EdgeStatusPill status={r.status} />
      </span>
    </div>
  );
}

export function RegimeEdgeTable({ data, self }: { data: RegimeEdge; self: boolean }) {
  const { t } = marketRegimeI18n.useT();
  if (!data.rows.length) return <EmptyState compact icon={Info} title={t("edge.title")} description={t("edge.empty")} />;
  const sentence = edgeSentence(data, self);
  const SentIcon = sentence?.kind === "leak" ? TrendingDown : TrendingUp;
  return (
    <div className="flex flex-col gap-3">
      {sentence && (
        <p className="flex items-start gap-2 text-sm">
          <SentIcon className={cn("mt-0.5 h-4 w-4 shrink-0", sentence.kind === "leak" ? "text-down" : "text-up")} aria-hidden="true" />
          {sentence.text}
        </p>
      )}
      <div className="overflow-x-auto">
        <div role="table" aria-label={t("edge.title")} className="flex min-w-[38rem] flex-col">
          <div role="row" className={cn(COLS, "px-2 pb-1 text-xs text-muted-foreground")}>
            <span role="columnheader">{t("edge.colRegime")}</span>
            <span role="columnheader" className="text-right">{t("edge.colDays")}</span>
            <span role="columnheader" className="text-right">{t("edge.colTrades")}</span>
            <span role="columnheader" className="text-right">{t("edge.colNet")}</span>
            <span role="columnheader" className="text-right">WR</span>
            <span role="columnheader" className="text-right">{t("edge.colExpectancy")}</span>
            <span role="columnheader" className="text-right">{t("edge.colPerDay")}</span>
          </div>
          {data.rows.map((r) => <Row key={r.regime} r={r} today={data.today === r.regime} />)}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("edge.coverage", { known: data.coverage.known, total: data.coverage.total })}</p>
    </div>
  );
}

/** Loads and renders the table for one trader (null = the viewer). Hidden when the viewer may not see that book. */
export function RegimeEdgeBlock({ trader, self }: { trader: string | null; self: boolean }) {
  const q = useQuery(regimeEdgeQuery(trader));
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!q.data) return null;
  return <RegimeEdgeTable data={q.data} self={self} />;
}

/** `hideEmpty` = render nothing until the trader has trades on days with a desk regime (an optional section). */
export function RegimeEdgePanel({ trader, self, hideEmpty = false, className }: { trader: string | null; self: boolean; hideEmpty?: boolean; className?: string }) {
  const { t } = marketRegimeI18n.useT();
  const q = useQuery(regimeEdgeQuery(trader));
  if (q.isError || (hideEmpty && !q.data?.rows.length)) return null;
  return (
    <Panel title={t("edge.title")} description={t("edge.description")} className={className}>
      {q.data ? <RegimeEdgeTable data={q.data} self={self} /> : <Skeleton className="h-40 w-full" />}
    </Panel>
  );
}
