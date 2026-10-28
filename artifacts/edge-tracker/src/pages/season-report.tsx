/**
 * «Отчёт за сезон» (/season-report) — the season level of the weekly review: one trader's season (the current or the
 * previous earnings season of the desk calendar, or any period) built from PropReports trades by the api
 * (lib/deskPulse/seasonReport). The trader writes only the conclusions; they are saved into his Playbook as a note.
 * Staff are traders too: their own report first, then any trader or «Группа» (their group's reports — whose
 * conclusions are written) in the picker. Route: /season-report?season=current|previous&from=&to=&trader=.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Users } from "lucide-react";
import { EmptyState, ErrorState, Page, PageHeader, Panel, PanelSkeleton, QueryState, StatGridSkeleton, TableScroll, toneText } from "@/components/ds";
import { PeriodPicker, CUSTOM_PERIOD } from "@/components/shared/period/PeriodPicker";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { TEAM } from "@/components/people/staff-scope";
import { useTradesBookFacets } from "@/hooks/use-trades-window";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { fmtDate, fmtRate, fmtUsd } from "@/lib/format";
import { nyDate } from "@/lib/trading-date";
import type { DayRange } from "@/lib/period-range";
import { personName } from "@/i18n";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";
import { groupReportQuery, seasonReportQuery, type ReportPeriod, type SeasonPeriod } from "@/components/shared/desk-pulse/report-api";
import { BestWorst, Conclusions, FlowAndTiers, SetupTiming, Totals, WhereMoney } from "@/components/shared/desk-pulse/report-sections";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function readParams(): { period: ReportPeriod; trader: string | null } {
  const p = new URLSearchParams(window.location.search);
  const from = p.get("from"), to = p.get("to");
  const period: ReportPeriod = from && to && YMD.test(from) && YMD.test(to) && from <= to ? { from, to } : { season: p.get("season") === "previous" ? "previous" : "current" };
  return { period, trader: p.get("trader") };
}

function writeParams(period: ReportPeriod, trader: string | null) {
  const p = new URLSearchParams();
  if ("season" in period) { if (period.season !== "current") p.set("season", period.season); } else { p.set("from", period.from); p.set("to", period.to); }
  if (trader) p.set("trader", trader);
  const qs = p.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : ""));
}

function GroupTable({ period, onOpen }: { period: ReportPeriod; onOpen: (name: string) => void }) {
  const { t } = deskPulseI18n.useT();
  const q = useQuery(groupReportQuery(period));
  return (
    <Panel title={t("report.group.title")} icon={Users} description={t("report.group.hint")}>
      <QueryState query={q} errorCompact errorTitle={t("report.loadFailed")}>
        {(g) => !g.rows.length ? <p className="text-sm text-muted-foreground">{t("report.group.empty")}</p> : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground [&_th]:py-1 [&_th]:font-medium">
                  <th className="text-left">{t("report.group.trader")}</th>
                  <th className="text-right">{t("report.group.trades")}</th>
                  <th className="text-right">{t("report.group.winRate")}</th>
                  <th className="text-right">{t("report.group.net")}</th>
                  <th className="text-right">{t("report.group.exTop3")}</th>
                  <th className="text-right">{t("report.group.written")}</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.trader} className={cn("border-t border-border/40", !r.totals.n && "opacity-60")}>
                    <td className="py-1.5"><button type="button" className="font-medium hover:underline" onClick={() => onOpen(r.trader)}>{personName(r.trader)}</button></td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{r.totals.n}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtRate(r.totals.winrate)}</td>
                    <td className={cn("py-1.5 text-right tabular-nums font-medium", toneText((r.totals.net ?? 0) > 0 ? "up" : (r.totals.net ?? 0) < 0 ? "down" : "neutral"))}>{fmtUsd(r.totals.net, { signed: true, decimals: 0 })}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.netExTop3, { signed: true, decimals: 0 })}</td>
                    <td className={cn("py-1.5 text-right", r.written ? "text-up" : "text-muted-foreground")}>{r.written ? t("report.group.yes") : t("report.group.no")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </QueryState>
    </Panel>
  );
}

function Report({ trader, period, own }: { trader: string | null; period: ReportPeriod; own: boolean }) {
  const { t } = deskPulseI18n.useT();
  const q = useQuery(seasonReportQuery(trader, period));
  if (q.isError && !q.data) return <ErrorState title={t("report.loadFailed")} error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r) return <div className="flex flex-col gap-4" aria-busy="true"><StatGridSkeleton /><PanelSkeleton /><PanelSkeleton /></div>;
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      {r.totals.n === 0 ? (
        <Panel><EmptyState icon={CalendarRange} title={t("report.empty")} /></Panel>
      ) : (
        <>
          <Totals r={r} />
          <SetupTiming r={r} />
          <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-2">
            <WhereMoney r={r} />
            <BestWorst r={r} />
          </div>
          <FlowAndTiers r={r} />
        </>
      )}
      {/* Closure: the report ends with the one thing the trader writes. */}
      <Conclusions key={`${r.trader}|${r.from}|${r.to}`} r={r} own={own} period={period} />
    </div>
  );
}

export default function SeasonReportPage() {
  const { t } = deskPulseI18n.useT();
  const { user, isCurator, can } = useAuth();
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;
  const staff = isCurator || can("trades.read.team");
  const initial = React.useMemo(readParams, []);
  const [period, setPeriod] = React.useState<ReportPeriod>(initial.period);
  const [picked, setPicked] = React.useState<string | null>(staff ? initial.trader : null);
  React.useEffect(() => writeParams(period, picked), [period, picked]);
  const facets = useTradesBookFacets({ enabled: staff });
  const team = picked === TEAM;
  const trader = !picked || picked === me ? null : picked;
  const value: SeasonPeriod | typeof CUSTOM_PERIOD = "season" in period ? period.season : CUSTOM_PERIOD;
  const custom: DayRange | null = "season" in period ? null : period;
  const head = useQuery({ ...seasonReportQuery(trader, period), enabled: !team });
  const range = head.data ? t("report.periodLine", { from: fmtDate(head.data.from, "short"), to: fmtDate(head.data.to, "short") }) : null;
  return (
    <Page>
      <PageHeader
        title={t("report.title")}
        icon={CalendarRange}
        description={range ? `${t("report.description")} · ${range}` : t("report.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker<SeasonPeriod>
              compact
              ariaLabel={t("report.period.aria")}
              options={[{ value: "current", label: t("report.period.current") }, { value: "previous", label: t("report.period.previous") }]}
              value={value}
              custom={custom}
              onPreset={(s) => setPeriod({ season: s })}
              onCustom={(r) => setPeriod({ from: r.from, to: r.to })}
              presetRange={head.data ? { from: head.data.from, to: head.data.to } : null}
              today={nyDate()}
            />
            {staff && (
              <StaffTraderPicker
                value={picked ?? me ?? ""} onChange={(v) => setPicked(v === me ? null : v)} me={me} names={facets.data?.traders ?? []}
                teamLabel={t("report.team")} ariaLabel={t("report.picker")} className="w-auto min-w-[13rem] max-w-[18rem]"
              />
            )}
          </div>
        }
      />
      {team ? (
        <GroupTable period={period} onOpen={(name) => setPicked(name === me ? null : name)} />
      ) : (
        <Report trader={trader} period={period} own={!trader} />
      )}
    </Page>
  );
}
