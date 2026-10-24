/**
 * «Сравнение с собой» — this period vs the previous one of the same length, per key metric, each with its 80 %
 * interval; «изменилось» only when the interval of the difference excludes zero.
 */
import { History } from "lucide-react";
import { Panel, Pill, toneOf, toneText } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtNum, fmtPct, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { myEdgeI18n } from "@/i18n/ns/myEdge";
import type { CompareData, CompareMetric, CompareRow, MeInterval } from "./api";
import { changedRows } from "./model";

/** Higher is better for every metric except fees share (lower) and the neutral pace ones. */
const BETTER: Record<CompareMetric, 1 | -1 | 0> = { expectancy: 1, winRate: 1, payoff: 1, feesShare: -1, tradesPerDay: 0, holdMin: 0 };

export function fmtMetric(m: CompareMetric, v: number | null | undefined, signed = false): string {
  if (v == null) return "—";
  switch (m) {
    case "expectancy": return fmtUsd(v, { signed: true, decimals: 2 });
    case "winRate":
    case "feesShare": return signed ? fmtPct(v * 100, { decimals: 1 }) : fmtRate(v, 1);
    case "payoff": return signed ? fmtNum(v, { decimals: 2, signed: true }) : fmtNum(v, 2);
    case "tradesPerDay":
    case "holdMin": return signed ? fmtNum(v, { decimals: 1, signed: true }) : fmtNum(v, 1);
  }
}

function Cell({ m, i, signed = false, className }: { m: CompareMetric; i: MeInterval | null; signed?: boolean; className?: string }) {
  if (!i) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex flex-col items-end tabular-nums", className)}>
      <span className="text-sm font-medium">{fmtMetric(m, i.point, signed)}</span>
      <span className="text-[11px] text-muted-foreground">{fmtMetric(m, i.lo, signed)} … {fmtMetric(m, i.hi, signed)}</span>
    </span>
  );
}

function Verdict({ rows }: { rows: CompareRow[] }) {
  const { t } = myEdgeI18n.useT();
  const changed = changedRows(rows);
  const text = changed.length
    ? t("compare.verdictChanged", {
      list: changed.map((r) => t(r.diff!.point > 0 ? "compare.up" : "compare.down", { metric: t(`metric.${r.metric}`).toLowerCase() })).join(", "),
    })
    : t("compare.verdictSame");
  return <p className="text-base font-medium leading-snug text-foreground text-pretty">{text}</p>;
}

export function CompareBlock({ data, isLoading, isError, hasPeriod }: { data: CompareData | undefined; isLoading: boolean; isError: boolean; hasPeriod: boolean }) {
  const { t } = myEdgeI18n.useT();
  return (
    <Panel
      icon={History}
      title={t("compare.title")}
      description={t("compare.description")}
      footer={data ? (
        <span className="tabular-nums">
          {t("compare.days", {
            current: commonI18n.t("units.tradingDays", { count: data.days.current }),
            previous: commonI18n.t("units.tradingDays", { count: data.days.previous }),
          })}
        </span>
      ) : undefined}
    >
      {!hasPeriod ? (
        <p className="text-sm text-muted-foreground">{t("compare.noPrevious")}</p>
      ) : isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-40" /></div>
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Verdict rows={data.rows} />
          <ul className="@container divide-y divide-[var(--glass-border)]">
            <li className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_10rem] gap-x-4 gap-y-3 pb-2 text-right text-[11px] uppercase tracking-wide text-muted-foreground @xl:grid">
              <span className="text-left">&nbsp;</span><span>{t("compare.current")}</span><span>{t("compare.previous")}</span><span>{t("compare.diff")}</span><span />
            </li>
            {data.rows.map((r) => {
              const better = BETTER[r.metric];
              const tone = r.changed && r.diff && better ? toneOf(r.diff.point * better) : "neutral";
              return (
                <li key={r.metric} className="grid grid-cols-3 items-center gap-x-3 gap-y-1 py-2.5 @xl:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_10rem] @xl:gap-x-4">
                  <span className="col-span-2 text-sm text-foreground @xl:col-span-1">{t(`metric.${r.metric}`)}</span>
                  <span className="justify-self-end whitespace-nowrap @xl:order-last @xl:pl-2">
                    <Pill tone="neutral" className={cn(r.changed && "border-foreground/40 text-foreground")}>{r.changed ? t("compare.changed") : t("compare.noise")}</Pill>
                  </span>
                  <span className="flex flex-col items-start @xl:items-end">
                    <span className="text-[11px] text-muted-foreground @xl:hidden">{t("compare.current")}</span>
                    <Cell m={r.metric} i={r.current} className="items-start @xl:items-end" />
                  </span>
                  <span className="flex flex-col items-start @xl:items-end">
                    <span className="text-[11px] text-muted-foreground @xl:hidden">{t("compare.previous")}</span>
                    <Cell m={r.metric} i={r.previous} className="items-start @xl:items-end" />
                  </span>
                  <span className="flex flex-col items-start @xl:items-end">
                    <span className="text-[11px] text-muted-foreground @xl:hidden">{t("compare.diff")}</span>
                    <Cell m={r.metric} i={r.diff} signed className={cn("items-start @xl:items-end", toneText(tone))} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}
