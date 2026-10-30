/**
 * Risk desk → «Риск-сигналы сессии» (curators / risk managers, risk.read.team): a compact list of today's alerts
 * across the desk (time NY, trader, what happened, severity, whether staff were told) and «Сэкономил деск» — an
 * estimate vs the traders' own history per day / week / month, with the sample size; hidden when the history is
 * too small (the server decides: saved = null).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { Panel, Pill, QueryState, Segmented } from "@/components/ds";
import { fmtTimeNY, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { personName } from "@/i18n";
import { riskSignalsI18n } from "@/i18n/ns/riskSignals";
import { deskAlertsQuery, savedQuery } from "./api";
import { alertKey, alertVars, savedView, type AlertsDay, type SavedPeriod, type SavedSummary } from "./model";
import { ToolHelp } from "@/components/shared/tool-help";

const usd = (v: number) => fmtUsd(v, { decimals: 0 });
const PERIODS: readonly SavedPeriod[] = ["day", "week", "month"];

function AlertList({ d }: { d: AlertsDay }) {
  const { t } = riskSignalsI18n.useT();
  if (!d.enabled && !d.alerts.length) return <p className="text-sm text-muted-foreground">{t("desk.disabled")}</p>;
  if (!d.alerts.length) return <p className="text-sm text-muted-foreground">{t("desk.empty")}</p>;
  return (
    <ul aria-label={t("desk.listAria")} className="divide-y divide-[var(--glass-border)]">
      {d.alerts.slice(0, 40).map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="w-11 shrink-0 tabular-nums text-muted-foreground">{fmtTimeNY(a.triggeredAt)}</span>
            <span className="font-medium text-foreground">{personName(a.trader)}</span>
            <span className="min-w-0 truncate text-muted-foreground">{t(`title.${alertKey(a)}`, alertVars(a, usd))}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Pill tone={a.severity === "critical" ? "down" : "warn"}>{t(`severity.${a.severity}`)}</Pill>
            {a.staffNotified && <Pill>{t("desk.told")}</Pill>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SavedLine({ s }: { s: SavedSummary }) {
  const { t } = riskSignalsI18n.useT();
  const v = savedView(s);
  return (
    <div className="space-y-1.5">
      {v.kind === "value" ? (
        <>
          <p className={cn("text-2xl font-semibold tabular-nums", v.saved >= 0 ? "text-up" : "text-down")}>{fmtUsd(v.saved, { decimals: 0, signed: true })}</p>
          <p className="text-sm text-foreground">{t(v.saved >= 0 ? "saved.better" : "saved.worse", { usd: usd(Math.abs(v.saved)) })}</p>
          <p className="text-xs text-muted-foreground">
            {t("saved.sample", { estimated: s.estimated, cases: s.cases })}
            {s.hidden > 0 && <> {t("saved.hidden", { hidden: s.hidden })}</>}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{v.kind === "pending" ? t("saved.pending") : v.kind === "small" ? t("saved.small", { min: s.minSample }) : t("saved.none")}</p>
      )}
      {s.bySignal.length > 1 && v.kind === "value" && (
        <ul aria-label={t("saved.bySignalAria")} className="flex flex-wrap gap-1.5">
          {s.bySignal.map((b) => (
            <li key={b.signal}>
              <Pill tone={b.saved == null ? "neutral" : b.saved >= 0 ? "up" : "down"}>
                {t(`signals.${b.signal}`)}: {b.saved == null ? "—" : fmtUsd(b.saved, { decimals: 0, signed: true })}
              </Pill>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Saved() {
  const { t } = riskSignalsI18n.useT();
  const [period, setPeriod] = React.useState<SavedPeriod>("week");
  const q = useQuery(savedQuery(period));
  return (
    <section aria-label={t("saved.title")} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">{t("saved.title")}</h3>
        <Segmented size="sm" ariaLabel={t("saved.periodAria")} value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: t(`saved.period.${p}`) }))} />
      </div>
      <QueryState query={q}>{(s) => <SavedLine s={s} />}</QueryState>
      <p className="max-w-prose text-xs text-muted-foreground">{t("saved.method")}</p>
    </section>
  );
}

export function RiskSignalsDeskPanel() {
  const { t } = riskSignalsI18n.useT();
  const q = useQuery(deskAlertsQuery());
  return (
    <Panel title={t("desk.title")} description={t("desk.description")} icon={Radar} actions={<ToolHelp id="riskSignals" />}>
      <div className="space-y-4">
        <QueryState query={q}>{(d) => <AlertList d={d} />}</QueryState>
        <Saved />
      </div>
    </Panel>
  );
}
