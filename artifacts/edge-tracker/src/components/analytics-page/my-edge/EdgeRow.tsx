/**
 * One «Мой edge» row: the bucket, $ / day with its 80 % interval as an inline range bar on a scale shared by the
 * block, the honest status, the 3-block persistence and — on hover / focus — every number behind it. Actions: the
 * exact trades in /trades and, for a leak with a faithful rule, «Проверить в Что если».
 */
import { Link } from "wouter";
import { FlaskConical, ListFilter } from "lucide-react";
import { Pill, toneOf, toneText } from "@/components/ds";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fmtNum, fmtRate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { myEdgeI18n } from "@/i18n/ns/myEdge";
import type { AnalyticsFilters } from "../metrics";
import { whatIfHref } from "../WhatIfTab";
import type { MeRow, MeStatus } from "./api";
import { bucketLabel, dimLabel, money, pctOn, tradesHref, whatIfRule } from "./model";


export function StatusPill({ status }: { status: MeStatus }) {
  const { t } = myEdgeI18n.useT();
  return (
    <Pill tone="neutral" title={t(`statusHint.${status}`)} className={cn(status === "reliable" && "border-foreground/40 text-foreground", status === "low" && "opacity-70")}>
      {status === "reliable" && <span className="h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden="true" />}
      {t(`status.${status}`)}
    </Pill>
  );
}

/** Three blocks of the period: a filled dot = the block's sign (green / red), an empty ring = fewer than 3 trades. */
export function PersistDots({ row }: { row: MeRow }) {
  const { t } = myEdgeI18n.useT();
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={t("persist", { n: row.persist })} title={`${t("persist", { n: row.persist })}. ${t("persistHint")}`}>
      {row.blocks.map((b, i) => (
        <span
          key={i}
          className={cn("h-2 w-2 rounded-full", b.sign > 0 ? "bg-up" : b.sign < 0 ? "bg-down" : "border border-muted-foreground/50")}
        />
      ))}
    </span>
  );
}

export function RangeBar({ row, scale, className }: { row: MeRow; scale: { min: number; max: number }; className?: string }) {
  const lo = pctOn(row.perDay.lo, scale);
  const hi = pctOn(row.perDay.hi, scale);
  const pt = pctOn(row.perDay.point, scale);
  const zero = pctOn(0, scale);
  return (
    <div className={cn("relative h-4 w-full", className)} aria-hidden="true">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-muted-foreground/25" />
      <div className="absolute top-0.5 bottom-0.5 w-px bg-muted-foreground/60" style={{ left: `${zero}%` }} />
      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/25" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
      <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-[var(--glass-bg,transparent)]" style={{ left: `${pt}%` }} />
    </div>
  );
}

function Detail({ row }: { row: MeRow }) {
  const { t } = myEdgeI18n.useT();
  const line = (k: string, v: string) => (
    <div className="flex justify-between gap-4"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></div>
  );
  return (
    <div className="flex min-w-[14rem] flex-col gap-1">
      <div className="font-medium">{dimLabel(row.dim)}: {bucketLabel(row.dim, row.key)}</div>
      {line(t("detail.interval"), `${money(row.perDay.lo)} … ${money(row.perDay.hi)}`)}
      {line(t("detail.perTrade"), `${money(row.perTrade.point)} (${money(row.perTrade.lo)} … ${money(row.perTrade.hi)})`)}
      {line(t("detail.net"), money(row.net))}
      {line(t("detail.winRate"), fmtRate(row.winRate))}
      {line(t("detail.days"), fmtNum(row.days, 0))}
      {line(t("detail.q"), row.q == null ? "—" : fmtNum(row.q, 3))}
      <div className="pt-1 text-muted-foreground">{t(`statusHint.${row.status}`)}</div>
      {row.outcome && <div className="text-muted-foreground">{t("outcomeHint")}</div>}
    </div>
  );
}

const LINK = "inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors duration-200 hover:bg-[var(--glass-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EdgeRow({
  row, scale, filters, typicalDay, eod = false, actions = true, showDim = true,
}: {
  row: MeRow;
  scale: { min: number; max: number };
  filters: AnalyticsFilters;
  typicalDay: number | null;
  eod?: boolean;
  actions?: boolean;
  /** The dimension name above the bucket (off inside a card that already names it). */
  showDim?: boolean;
}) {
  const { t } = myEdgeI18n.useT();
  const href = actions ? tradesHref(row, filters) : null;
  const rule = actions ? whatIfRule(row, typicalDay) : null;
  const tone = row.status === "low" ? "neutral" : toneOf(row.perDay.point);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-2.5">
      <div className="min-w-0">
        {showDim && <div className="truncate text-[11px] text-muted-foreground">{dimLabel(row.dim)}</div>}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 break-words text-sm font-medium text-foreground">{bucketLabel(row.dim, row.key)}</span>
          {row.outcome && <Pill tone="neutral" title={t("outcomeHint")}>{t("outcome")}</Pill>}
          {eod && <Pill tone="neutral" title={t("eodHint")}>{t("eod")}</Pill>}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {t("tradesDays", { trades: commonI18n.t("units.trades", { count: row.trades }), days: commonI18n.t("units.tradingDays", { count: row.days }) })}
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="cursor-help rounded-md text-right outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className={cn("block text-sm font-semibold tabular-nums", toneText(tone))}>{t("perDay", { value: money(row.perDay.point) })}</span>
            <span className="block text-[11px] tabular-nums text-muted-foreground">{t("interval", { lo: money(row.perDay.lo), hi: money(row.perDay.hi) })}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top"><Detail row={row} /></TooltipContent>
      </Tooltip>
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <RangeBar row={row} scale={scale} className="min-w-[6rem] flex-1" />
        <span className="inline-flex items-center gap-2">
          <StatusPill status={row.status} />
          <PersistDots row={row} />
        </span>
        {(href || rule) && (
          <span className="-mr-2 inline-flex items-center">
            {href && (
              <Link href={href} className={LINK}>
                <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
                {row.idsTruncated ? t("actions.tradesTruncated") : t("actions.trades")}
              </Link>
            )}
            {rule && (
              <Link href={whatIfHref(filters, [rule])} className={LINK} title={t("actions.whatIf")} aria-label={t("actions.whatIf")}>
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                {t("actions.whatIfShort")}
              </Link>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
