/**
 * Parts of the office «Цена джуна» section (junior-cost-desk.tsx): the cohort table, «что окупается» and the junior
 * list. Data: GET /api/junior-cost/desk (staff; junior rows only of the viewer's scope).
 */
import * as React from "react";
import { DataTable, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNum, fmtRate } from "@/lib/format";
import { personName } from "@/i18n";
import { juniorCostI18n } from "@/i18n/ns/juniorCost";
import { PersonLink } from "@/components/shared/person-link";
import type { CohortRow, FactorResult, GroupBy, JuniorRow } from "@/components/shared/junior-cost/api";
import { STATUS_TONE, factorLabel, factorVerdict, kmDays, statusLabel, tradingDays, usd } from "@/components/shared/junior-cost/model";

const LIST_PREVIEW = 12;

function groupLabel(key: string | null, by: GroupBy): string {
  if (key == null) return juniorCostI18n.t("cohorts.none");
  if (by === "month") return fmtDate(`${key}-01`, "monthYear");
  if (by === "curator") return personName(key);
  return key;
}

function CohortTr({ r, by, total = false }: { r: CohortRow; by: GroupBy; total?: boolean }) {
  const { t } = juniorCostI18n.useT();
  return (
    <tr className={cn(total && "font-medium")}>
      <td className="max-w-[14rem] truncate">{total ? t("cohorts.total") : groupLabel(r.key, by)}</td>
      <td className="text-right">{r.juniors}</td>
      <td className="text-right">{r.reached} <span className="text-xs text-muted-foreground">({fmtRate(r.reachedShare)})</span></td>
      <td className="text-right">{r.onTheWay}</td>
      <td className={cn("text-right", r.stopped > 0 && "text-down")}>{r.stopped}</td>
      <td className="text-right">{usd(r.medianCost)}</td>
      <td className="text-right whitespace-nowrap">{r.juniors ? kmDays(r) : "—"}</td>
      <td className="text-right">{usd(r.money.total)}</td>
    </tr>
  );
}

export function CohortTable({ rows, desk, by }: { rows: readonly CohortRow[]; desk: CohortRow; by: GroupBy }) {
  const { t } = juniorCostI18n.useT();
  return (
    <DataTable ariaLabel={t("cohorts.title")}>
      <table>
        <thead>
          <tr>
            <th>{t("cohorts.colGroup")}</th>
            <th className="text-right">{t("cohorts.colJuniors")}</th>
            <th className="text-right">{t("cohorts.colReached")}</th>
            <th className="text-right">{t("cohorts.colOnTheWay")}</th>
            <th className="text-right">{t("cohorts.colStopped")}</th>
            <th className="text-right">{t("cohorts.colCost")}</th>
            <th className="text-right" title={t("desk.medianDaysHint")}>{t("cohorts.colDays")}</th>
            <th className="text-right">{t("cohorts.colSpent")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <CohortTr key={r.key ?? "\u0000none"} r={r} by={by} />)}
          {rows.length > 1 && <CohortTr r={desk} by={by} total />}
        </tbody>
      </table>
    </DataTable>
  );
}

function ReliabilityPill({ status }: { status: FactorResult["status"] }) {
  const { t } = juniorCostI18n.useT();
  return (
    <Pill tone={status === "reliable" ? "accent" : "neutral"} title={t(`reliability.${status}Hint`)} className={cn(status === "low" && "opacity-70")}>
      {t(`reliability.${status}`)}
    </Pill>
  );
}

function FactorItem({ f }: { f: FactorResult }) {
  const { t } = juniorCostI18n.useT();
  const low = f.status === "low";
  const tone = low || f.verdict === "unclear" ? "text-muted-foreground" : f.verdict === "pays" ? "text-up" : "text-down";
  return (
    <li className={cn("flex flex-col gap-1 rounded-xl px-3 py-2.5", f.verdict === "pays" && !low && "bg-up/5")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("text-sm font-medium", low ? "text-muted-foreground" : "text-foreground")}>{factorLabel(f)}</span>
        <span className="text-sm text-muted-foreground">—</span>
        <span className={cn("text-sm font-medium tabular-nums", tone)}>{factorVerdict(f)}</span>
        <span className="ml-auto"><ReliabilityPill status={f.status} /></span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
        <span>{t("attribution.groups", { yes: t("juniorsCount", { count: f.yes.juniors }), no: f.no.juniors })}</span>
        <span>{t("attribution.reachedShare", { yes: fmtRate(f.yes.reachedShare), no: fmtRate(f.no.reachedShare) })}</span>
        {f.costDiff && <span>{t("attribution.cost")} {t("attribution.interval", { lo: usd(f.costDiff.lo, true), hi: usd(f.costDiff.hi, true) })}</span>}
        {f.daysDiff && <span>{t("attribution.days")} {t("attribution.interval", { lo: fmtNum(f.daysDiff.lo, { decimals: 0, signed: true }), hi: fmtNum(f.daysDiff.hi, { decimals: 0, signed: true }) })}</span>}
        {f.excluded > 0 && <span>{t("attribution.excluded", { count: f.excluded })}</span>}
      </div>
    </li>
  );
}

export function AttributionList({ factors }: { factors: readonly FactorResult[] }) {
  const { t } = juniorCostI18n.useT();
  // Paying practices first, then the rest; «мало данных» last.
  const rank = (f: FactorResult) => (f.status === "low" ? 3 : f.verdict === "pays" ? 0 : f.verdict === "costs" ? 1 : 2);
  const sorted = [...factors].sort((a, b) => rank(a) - rank(b) || (a.costDiff?.point ?? 0) - (b.costDiff?.point ?? 0));
  if (!sorted.some((f) => f.yes.juniors + f.no.juniors > 0)) return <p className="text-sm text-muted-foreground">{t("attribution.empty")}</p>;
  return <ul className="flex flex-col gap-1.5">{sorted.map((f) => <FactorItem key={f.factor} f={f} />)}</ul>;
}

function daysCell(j: JuniorRow): string {
  if (j.breakeven) return tradingDays(j.breakeven.tradingDays);
  return juniorCostI18n.t("list.onTheWay", { days: tradingDays(j.tenureTradingDays) });
}

function forecastCell(j: JuniorRow): string {
  const p = j.projection;
  if (!p || p.kind === "insufficient") return juniorCostI18n.t("list.noForecast");
  if (p.kind === "notImproving") return juniorCostI18n.t("list.notImproving");
  return juniorCostI18n.t("list.eta", { date: fmtDate(p.eta.point, "dayMonth") });
}

export function JuniorsTable({ juniors }: { juniors: readonly JuniorRow[] }) {
  const { t } = juniorCostI18n.useT();
  const [all, setAll] = React.useState(false);
  const shown = all ? juniors : juniors.slice(0, LIST_PREVIEW);
  return (
    <div className="flex flex-col gap-2">
      <DataTable ariaLabel={t("list.title")} stickyFirstCol>
        <table>
          <thead>
            <tr>
              <th>{t("list.colName")}</th>
              <th>{t("list.colStatus")}</th>
              <th className="text-right">{t("list.colStart")}</th>
              <th className="text-right">{t("list.colCost")}</th>
              <th className="text-right">{t("list.colDays")}</th>
              <th className="text-right">{t("list.colForecast")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((j) => (
              <tr key={j.name} className={cn(j.truncated && "text-muted-foreground")}>
                <td><PersonLink name={j.name} className="font-medium" /></td>
                <td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={STATUS_TONE[j.status]}>{statusLabel(j)}</Pill>
                    {j.truncated && <span className="text-xs">{t("list.truncated")}</span>}
                  </span>
                </td>
                <td className="text-right whitespace-nowrap">{j.start ? fmtDate(j.start, "medium") : "—"}</td>
                <td className="text-right">{usd(j.cost.total)}</td>
                <td className="text-right whitespace-nowrap">{daysCell(j)}</td>
                <td className="text-right whitespace-nowrap">{forecastCell(j)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
      {juniors.length > LIST_PREVIEW && (
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setAll((v) => !v)}>
          {all ? t("list.collapse") : t("list.showAll", { count: juniors.length })}
        </Button>
      )}
    </div>
  );
}
