/**
 * Office section «Цена джуна» (staff only; the page mounts it for curators and partners): how much it costs to bring a
 * junior to breakeven — the desk summary, where the money went, cohorts (academy cohort / start month / curator) and
 * «что окупается» (trainer, exams, 1:1, plans) with honest small-sample markers, then the juniors the viewer may read.
 * Definitions: api lib/juniorCost/path.ts. The seat cost is a desk setting (Админка → Настройки → Академия).
 */
import { useQuery } from "@tanstack/react-query";
import { Coins, GraduationCap, Sparkles, Users } from "lucide-react";
import { BentoGrid, EmptyState, Panel, QueryState, Segmented, StatCard, StatGrid, StatRow, usePersistentState } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtRate } from "@/lib/format";
import { juniorCostI18n } from "@/i18n/ns/juniorCost";
import { deskJuniorCostQuery, EXPOSURE_DAYS, STOP_DAYS, type DeskJuniorCost, type GroupBy } from "@/components/shared/junior-cost/api";
import { kmDays, tradingDays, usd } from "@/components/shared/junior-cost/model";
import { AttributionList, CohortTable, JuniorsTable } from "./junior-cost-parts";
import { ToolHelp } from "@/components/shared/tool-help";

function Summary({ d }: { d: DeskJuniorCost }) {
  const { t } = juniorCostI18n.useT();
  const desk = d.cohorts.cohort.desk;
  return (
    <StatGrid min="10rem">
      <StatCard label={t("desk.juniors")} value={desk.juniors} hint={d.counts.truncated ? t("desk.juniorsHint", { count: d.counts.truncated }) : undefined} />
      <StatCard label={t("desk.reached")} value={`${desk.reached} · ${fmtRate(desk.reachedShare)}`} />
      <StatCard label={t("desk.medianCost")} value={usd(desk.medianCost)} hint={t("desk.medianCostHint")} />
      <StatCard label={t("desk.medianDays")} value={desk.juniors ? kmDays(desk) : "—"} hint={t("desk.medianDaysHint")} />
      <StatCard label={t("desk.spent")} value={usd(desk.money.total)} hint={d.settings.seatUsdMonth > 0 ? t("desk.seat", { usd: usd(d.settings.seatUsdMonth) }) : t("desk.seatNone")} />
    </StatGrid>
  );
}

function MoneyPanel({ d }: { d: DeskJuniorCost }) {
  const { t } = juniorCostI18n.useT();
  const m = d.cohorts.cohort.desk.money;
  return (
    <Panel title={t("money.title")} icon={Coins} description={t("money.formula")} className="lg:col-span-4" fill actions={<ToolHelp id="juniorCost" />}>
      <div className="flex flex-col">
        <StatRow label={t("money.fees")} value={usd(m.fees)} />
        <StatRow label={t("money.gross")} value={usd(m.gross, true)} tone={m.gross < 0 ? "down" : m.gross > 0 ? "up" : "neutral"} />
        {m.seat > 0 && <StatRow label={t("money.seat")} value={usd(m.seat)} />}
        <div className="my-2 border-t border-[var(--glass-border)]" />
        <StatRow label={t("money.reached")} value={usd(m.reached)} />
        <StatRow label={t("money.onTheWay")} value={usd(m.onTheWay)} />
        <StatRow label={t("money.stopped")} value={usd(m.stopped)} tone={m.stopped > 0 ? "down" : "neutral"} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground" title={t("desk.seatHint")}>
        {d.settings.seatUsdMonth > 0 ? t("desk.seat", { usd: usd(d.settings.seatUsdMonth) }) : t("desk.seatNone")} · {t("desk.seatHint")}
      </p>
    </Panel>
  );
}

function CohortsPanel({ d }: { d: DeskJuniorCost }) {
  const { t } = juniorCostI18n.useT();
  const [by, setBy] = usePersistentState<GroupBy>("office-stats.junior-cost.by", "cohort");
  const table = d.cohorts[by] ?? d.cohorts.cohort;
  return (
    <Panel
      title={t("cohorts.title")}
      icon={Users}
      className="lg:col-span-8"
      fill
      actions={
        <Segmented<GroupBy>
          ariaLabel={t("cohorts.by")}
          size="sm"
          value={by}
          onChange={setBy}
          options={[{ value: "cohort", label: t("cohorts.byCohort") }, { value: "month", label: t("cohorts.byMonth") }, { value: "curator", label: t("cohorts.byCurator") }]}
        />
      }
    >
      <CohortTable rows={table.rows} desk={table.desk} by={by} />
    </Panel>
  );
}

function Method({ d }: { d: DeskJuniorCost }) {
  const { t } = juniorCostI18n.useT();
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none hover:text-foreground">{t("desk.methodButton")}</summary>
      <p className="mt-1 max-w-3xl">{t("desk.method", { days: tradingDays(d.settings.stableDays), stop: STOP_DAYS })}</p>
    </details>
  );
}

function Body({ d }: { d: DeskJuniorCost }) {
  const { t } = juniorCostI18n.useT();
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <Summary d={d} />
      <Method d={d} />
      <BentoGrid>
        <CohortsPanel d={d} />
        <MoneyPanel d={d} />
      </BentoGrid>
      <Panel title={t("attribution.title")} icon={Sparkles} description={t("attribution.hint")} footer={<span>{t("attribution.caveat", { days: EXPOSURE_DAYS })}</span>}>
        <AttributionList factors={d.attribution} />
      </Panel>
      {d.juniors.length > 0 && (
        <Panel title={t("list.title")} icon={GraduationCap}>
          <JuniorsTable juniors={d.juniors} />
        </Panel>
      )}
    </div>
  );
}

export function JuniorCostDesk() {
  const { t } = juniorCostI18n.useT();
  const q = useQuery(deskJuniorCostQuery());
  return (
    <QueryState
      query={q}
      skeleton={<div className="flex flex-col gap-[var(--grid-gap)]" aria-busy="true" aria-label={t("desk.loading")}><Skeleton className="h-24 w-full rounded-2xl" /><Skeleton className="h-72 w-full rounded-2xl" /></div>}
      errorTitle={t("desk.loadFailed")}
      isEmpty={(d) => d.counts.juniors === 0}
      empty={<Panel><EmptyState icon={GraduationCap} title={t("desk.emptyTitle")} description={t("desk.emptyDesc")} /></Panel>}
    >
      {(d) => <Body d={d} />}
    </QueryState>
  );
}
