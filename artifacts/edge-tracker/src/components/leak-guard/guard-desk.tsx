/**
 * Risk desk → «Защита от утечек» (curators / risk managers, risk.read.team): who is on pause right now (firm / hard),
 * whether they confirmed it and whether the risk manager was told, «Снять паузу»; the desk's saved / lost over the
 * period and, behind one toggle, the per-trader table with the ladder level (risk.limits.edit changes it, audited).
 * PropReports cannot block orders: the note says where the real restriction is set.
 */
import { cn } from "@/lib/utils";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { OctagonPause, ShieldCheck } from "lucide-react";
import { Panel, Pill, QueryState, TableScroll } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { PendingIcon } from "@/components/ui/pending-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { fmtRate, fmtTimeNY, fmtUsd } from "@/lib/format";
import { personName } from "@/i18n";
import { leakGuardI18n } from "@/i18n/ns/leakGuard";
import { guardDeskQuery, useReleaseGuard, useSetGuardLevel } from "./api";
import { LEVEL_CHOICES, needsAck, type GuardDesk, type LevelChoice } from "./model";

const DAYS = 30;
const DEFAULT = "default";

function ActivePauses({ d, canEdit }: { d: GuardDesk; canEdit: boolean }) {
  const { t } = leakGuardI18n.useT();
  const { toast } = useToast();
  const release = useReleaseGuard();
  if (!d.active.length) return <p className="text-sm text-muted-foreground">{t("desk.noActive")}</p>;
  return (
    <ul className="divide-y divide-[var(--glass-border)]">
      {d.active.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <OctagonPause className={e.level === "hard" ? "h-4 w-4 shrink-0 text-down" : "h-4 w-4 shrink-0 text-warn"} aria-hidden="true" />
            <span className="font-medium text-foreground">{personName(e.trader)}</span>
            <span className="text-muted-foreground">{t(`patterns.${e.pattern}`)}</span>
            <span className="tabular-nums text-muted-foreground">{e.pauseUntil ? t("desk.until", { time: fmtTimeNY(e.pauseUntil) }) : t("desk.untilFirst")}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={e.level === "hard" ? "down" : "warn"}>{t(`levels.${e.level}`)}</Pill>
            <Pill tone={needsAck(e) ? "warn" : "up"}>{needsAck(e) ? t("desk.notAcked") : t("desk.acked")}</Pill>
            {e.riskNotifiedAt && <Pill>{t("desk.riskTold")}</Pill>}
            {canEdit && (
              <Button size="sm" variant="outline" disabled={release.isPending} aria-busy={release.isPending && release.variables === e.id}
                onClick={() => release.mutate(e.id, {
                  onSuccess: () => toast({ title: t("desk.released"), description: personName(e.trader) }),
                  onError: () => toast({ title: t("desk.releaseFailed"), variant: "destructive" }),
                })}>
                <PendingIcon pending={release.isPending && release.variables === e.id} />
                {t("desk.release")}
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LevelSelect({ trader, override, stageDefault, disabled }: { trader: string; override: LevelChoice | null; stageDefault: LevelChoice; disabled: boolean }) {
  const { t } = leakGuardI18n.useT();
  const { toast } = useToast();
  const set = useSetGuardLevel();
  return (
    <Select
      value={override ?? DEFAULT}
      disabled={disabled || set.isPending}
      onValueChange={(v) => set.mutate({ trader, level: v === DEFAULT ? null : (v as LevelChoice) }, {
        onSuccess: () => toast({ title: t("desk.levelSaved"), description: personName(trader) }),
        onError: () => toast({ title: t("desk.levelFailed"), variant: "destructive" }),
      })}
    >
      <SelectTrigger className="h-8 w-44" aria-label={t("desk.levelAria", { trader: personName(trader) })}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>{t("desk.levelDefault", { level: t(`levels.${stageDefault}`) })}</SelectItem>
        {LEVEL_CHOICES.map((l) => <SelectItem key={l} value={l} title={t(`levelHints.${l}`)}>{t(`levels.${l}`)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function TradersTable({ d, canEdit }: { d: GuardDesk; canEdit: boolean }) {
  const { t } = leakGuardI18n.useT();
  if (!d.traders.length) return <p className="text-sm text-muted-foreground">{t("desk.empty")}</p>;
  return (
    <TableScroll>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-3 font-medium">{t("desk.columns.trader")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("desk.columns.level")}</th>
            <th className="py-1.5 pr-3 text-right font-medium">{t("desk.columns.today")}</th>
            <th className="py-1.5 pr-3 text-right font-medium">{t("desk.columns.compliance")}</th>
            <th className="py-1.5 pr-3 text-right font-medium">{t("desk.columns.saved")}</th>
            <th className="py-1.5 text-right font-medium">{t("desk.columns.lost")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-border)]">
          {d.traders.map((r) => (
            <tr key={r.trader}>
              <td className="py-1.5 pr-3 text-foreground">{personName(r.trader)}</td>
              <td className="py-1.5 pr-3">
                <LevelSelect trader={r.trader} override={r.override} stageDefault={d.levelByStage[r.stage]} disabled={!canEdit} />
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.today}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.summary.compliance == null ? "—" : fmtRate(r.summary.compliance)}</td>
              <td className={cn("py-1.5 pr-3 text-right tabular-nums", r.summary.saved ? "text-up" : "text-muted-foreground")}>{fmtUsd(r.summary.saved, { decimals: 0 })}</td>
              <td className={cn("py-1.5 text-right tabular-nums", r.summary.lost ? "text-down" : "text-muted-foreground")}>{fmtUsd(r.summary.lost, { decimals: 0 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function Body({ d, canEdit }: { d: GuardDesk; canEdit: boolean }) {
  const { t } = leakGuardI18n.useT();
  const [open, setOpen] = React.useState(false);
  const s = d.desk;
  return (
    <div className="space-y-3">
      <section aria-label={t("desk.activeTitle")}>
        <h3 className="text-sm font-semibold text-muted-foreground">{t("desk.activeTitle")}</h3>
        <ActivePauses d={d} canEdit={canEdit} />
      </section>
      <p className="text-xs text-muted-foreground">
        {t("desk.totals", {
          days: DAYS, saved: fmtUsd(s.saved, { decimals: 0 }), lost: fmtUsd(s.lost, { decimals: 0 }),
          compliance: s.compliance == null ? "—" : fmtRate(s.compliance),
        })}
      </p>
      <p className="text-xs text-muted-foreground">{t("desk.blockNote")}</p>
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? t("desk.hideTable") : t("desk.showTable", { count: d.traders.length })}
      </Button>
      {open && <TradersTable d={d} canEdit={canEdit} />}
    </div>
  );
}

/** `canEdit`: the viewer may change levels and end pauses (risk.limits.edit; curators and admins by default). */
export function GuardDeskPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = leakGuardI18n.useT();
  const q = useQuery(guardDeskQuery(DAYS));
  return (
    <Panel title={t("desk.title")} description={t("desk.description")} icon={ShieldCheck}>
      <QueryState query={q}>{(d) => <Body d={d} canEdit={canEdit} />}</QueryState>
    </Panel>
  );
}
