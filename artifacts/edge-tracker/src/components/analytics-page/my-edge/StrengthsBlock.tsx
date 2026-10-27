/**
 * «Что у меня работает лучше всего» — the ranked strengths and leaks of the pre-trade buckets (one verdict sentence on
 * top), and every slice on demand, grouped by dimension.
 */
import { useMemo, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import { Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtUsd } from "@/lib/format";
import { myEdgeI18n } from "@/i18n/ns/myEdge";
import type { AnalyticsFilters } from "../metrics";
import type { MeRow, StrengthsData } from "./api";
import { EdgeRow } from "./EdgeRow";
import { dimLabel, money, rowName, scaleOf } from "./model";

const DIM_ORDER = ["time", "seq", "prev", "dayPnl", "price", "strategy", "setup", "familiarity", "side", "sizeRel", "hold"];

function Verdict({ data }: { data: StrengthsData }) {
  const { t } = myEdgeI18n.useT();
  const best = data.strengths[0];
  const leak = data.leaks[0];
  const text = best && leak
    ? t("strengths.verdictBoth", { best: rowName(best), bestValue: money(best.perDay.point), leak: rowName(leak), leakValue: money(leak.perDay.point) })
    : best ? t("strengths.verdictBest", { best: rowName(best), bestValue: money(best.perDay.point) })
      : leak ? t("strengths.verdictLeak", { leak: rowName(leak), leakValue: money(leak.perDay.point) })
        : t("strengths.verdictNone");
  const hypotheses = (best || leak) && ![best, leak].some((r) => r?.status === "reliable");
  return (
    <p className="text-base font-medium leading-snug text-foreground text-pretty">
      {text}
      {hypotheses && <span className="block pt-1 text-sm font-normal text-muted-foreground">{t("strengths.allHypotheses")}</span>}
    </p>
  );
}

function RowList({ rows, empty, scale, filters, typicalDay }: { rows: MeRow[]; empty: string; scale: { min: number; max: number }; filters: AnalyticsFilters; typicalDay: number | null }) {
  if (!rows.length) return <p className="py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="@container divide-y divide-[var(--glass-border)]">
      {rows.map((r) => <EdgeRow key={`${r.dim}|${r.key}`} row={r} scale={scale} filters={filters} typicalDay={typicalDay} />)}
    </ul>
  );
}

function AllSlices({ data, filters }: { data: StrengthsData; filters: AnalyticsFilters }) {
  const groups = useMemo(() => {
    const dims = [...new Set([...DIM_ORDER, ...data.rows.map((r) => r.dim)])];
    return dims
      .map((dim) => ({ dim, rows: data.rows.filter((r) => r.dim === dim).sort((a, b) => b.perDay.point - a.perDay.point) }))
      .filter((g) => g.rows.length);
  }, [data.rows]);
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
      {groups.map((g) => {
        const scale = scaleOf(g.rows);
        return (
          <section key={g.dim} className="min-w-0">
            <h3 className="text-xs font-semibold text-muted-foreground">{dimLabel(g.dim)}</h3>
            <ul className="@container divide-y divide-[var(--glass-border)]">
              {g.rows.map((r) => <EdgeRow key={r.key} row={r} scale={scale} filters={filters} typicalDay={data.typicalDay} showDim={false} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function StrengthsBlock({ data, isLoading, isError, filters }: { data: StrengthsData | undefined; isLoading: boolean; isError: boolean; filters: AnalyticsFilters }) {
  const { t } = myEdgeI18n.useT();
  const [all, setAll] = useState(false);
  const scale = useMemo(() => scaleOf([...(data?.strengths ?? []), ...(data?.leaks ?? [])]), [data]);
  return (
    <Panel
      icon={Trophy}
      title={t("strengths.title")}
      description={t("strengths.description")}
      footer={data ? (
        <>
          <span>{data.typicalDay ? t("strengths.typicalDay", { value: fmtUsd(data.typicalDay, { decimals: 0 }) }) : null}</span>
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${all ? "rotate-180" : ""}`} aria-hidden="true" />
            {all ? t("actions.hideAll") : t("actions.showAll")}
          </Button>
        </>
      ) : undefined}
    >
      {isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-40" /></div>
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Verdict data={data} />
          {all ? (
            <AllSlices data={data} filters={filters} />
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 xl:grid-cols-2">
              <section className="min-w-0">
                <h3 className="text-xs font-semibold text-muted-foreground">{t("strengths.best")}</h3>
                <RowList rows={data.strengths} empty={t("strengths.emptyBest")} scale={scale} filters={filters} typicalDay={data.typicalDay} />
              </section>
              <section className="min-w-0">
                <h3 className="text-xs font-semibold text-muted-foreground">{t("strengths.leaks")}</h3>
                <RowList rows={data.leaks} empty={t("strengths.emptyLeaks")} scale={scale} filters={filters} typicalDay={data.typicalDay} />
              </section>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
