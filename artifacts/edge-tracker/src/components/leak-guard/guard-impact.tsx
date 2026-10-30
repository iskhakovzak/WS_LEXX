/**
 * «Мой риск» → «Защита от утечек»: what the guard watches for this trader (only the patterns that cost them money, with
 * the $ figure), what it saved (estimate: complied × their own expected cost) and lost (actual: trades taken in a
 * pause), compliance, the data latency and the recent events. Staff open it for any trader (?trader=).
 */
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Panel, Pill, QueryState, StatCard, StatGrid, type Tone } from "@/components/ds";
import { fmtDate, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { leakGuardI18n } from "@/i18n/ns/leakGuard";
import { guardImpactQuery } from "./api";
import { statusOf, type GuardEvent, type GuardImpact, type PatternStat } from "./model";
import { ToolHelp } from "@/components/shared/tool-help";

const STATUS_TONE: Record<ReturnType<typeof statusOf>, Tone> = {
  complied: "up", ignored: "down", late: "neutral", no_trades: "neutral", unknown: "neutral", open: "warn",
};

function PatternRow({ p }: { p: PatternStat }) {
  const { t } = leakGuardI18n.useT();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-sm text-foreground">{t(`patterns.${p.pattern}`)}</span>
      {p.costly ? (
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums text-down">{t("impact.perTrade", { usd: fmtUsd(p.costPerTrade, { decimals: 0 }) })}</span>
          <span>{t("impact.samples", { count: p.atRisk })}</span>
          <Pill tone="accent">{t("impact.watched")}</Pill>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{t("impact.notCostly")}</span>
      )}
    </li>
  );
}

function EventRow({ e }: { e: GuardEvent }) {
  const { t } = leakGuardI18n.useT();
  const status = statusOf(e);
  const money = e.saved ? `+${fmtUsd(e.saved, { decimals: 0 })}` : e.lost ? `−${fmtUsd(e.lost, { decimals: 0 })}` : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
      <span className="min-w-0 text-foreground">
        <span className="tabular-nums text-muted-foreground">{fmtDate(e.day, "dayMonth")}</span> · {t(`patterns.${e.pattern}`)}
      </span>
      <span className="flex items-center gap-2">
        {money && <span className={e.saved ? "tabular-nums text-up" : "tabular-nums text-down"}>{money}</span>}
        <Pill tone={STATUS_TONE[status]}>{t(`impact.outcome.${status}`)}</Pill>
      </span>
    </li>
  );
}

function Body({ d }: { d: GuardImpact }) {
  const { t } = leakGuardI18n.useT();
  const s = d.summary;
  const lagMin = s.medianLagSec != null ? Math.max(1, Math.round(s.medianLagSec / 60)) : null;
  const shownEvents = d.recent.filter((e) => !e.silentReason || e.outcome);
  return (
    <div className="space-y-4">
      {!d.enabled && <p className="text-sm text-muted-foreground">{t("impact.disabled")}</p>}
      <StatGrid cols={4}>
        <StatCard label={t("impact.saved")} value={fmtUsd(s.saved, { decimals: 0 })} tone={s.saved > 0 ? "up" : "neutral"} hint={t("impact.savedHint")} />
        <StatCard label={t("impact.lost")} value={fmtUsd(s.lost, { decimals: 0 })} tone={s.lost > 0 ? "down" : "neutral"} hint={t("impact.lostHint")} />
        <StatCard label={t("impact.compliance")} value={s.compliance == null ? "—" : fmtRate(s.compliance)} hint={t("impact.complianceHint")} />
        <StatCard label={t("impact.events")} value={String(s.events)} hint={s.late ? t("impact.late", { count: s.late }) : undefined} />
      </StatGrid>
      <p className="text-xs text-muted-foreground">
        {t("impact.level", { level: t(`levels.${d.level.effective}`) })} · {d.level.override ? t("impact.levelOverride") : t("impact.levelByStage")}
        {lagMin != null && <> · {t("impact.lag", { time: commonI18n.t("units.minutes", { count: lagMin }) })}</>}
      </p>
      {d.patterns.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground">{t("impact.patternsTitle")}</h3>
          <ul className="divide-y divide-[var(--glass-border)]">{d.patterns.map((p) => <PatternRow key={p.pattern} p={p} />)}</ul>
        </section>
      )}
      <section>
        <h3 className="text-sm font-semibold text-muted-foreground">{t("impact.recentTitle")}</h3>
        {shownEvents.length ? (
          <ul className="divide-y divide-[var(--glass-border)]">{shownEvents.slice(0, 8).map((e) => <EventRow key={e.id} e={e} />)}</ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{t("impact.empty")}</p>
        )}
      </section>
    </div>
  );
}

export function GuardImpactPanel({ trader }: { trader: string | null }) {
  const { t } = leakGuardI18n.useT();
  const q = useQuery(guardImpactQuery(trader));
  return (
    <Panel title={t("impact.title")} description={t("impact.description")} icon={ShieldCheck} actions={<ToolHelp id="leakGuard" />}>
      <QueryState query={q}>{(d) => <Body d={d} />}</QueryState>
    </Panel>
  );
}
