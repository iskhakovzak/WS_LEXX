/**
 * «Застряли» on the curator «Сегодня» (roadmap R6): traders below the stage's pace at the latest plateau check — tenure,
 * a pace bar (mean daily net with its 80% interval against the target), the main blocker, the costliest leak, and ONE
 * action: «Назначить разбор 1:1 по шаблону» (a 1:1 with the diagnosis-pack agenda + an intervention row). Staff-only;
 * the trader never sees «застрял».
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Hourglass } from "lucide-react";
import { EmptyState, Panel, Pill, QueryState, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtDate, fmtUsd } from "@/lib/format";
import { personName } from "@/i18n";
import { coachI18n } from "@/i18n/ns/coach";
import { sliceLabel } from "@/components/shared/edge-map/model";
import { coachKeys, scheduleReview, useStuck, type StuckItem } from "./coach-api";
import { curatorKeys, type Scope } from "./api";

const VISIBLE = 5;
const SEVERITY_TONE: Record<StuckItem["severity"], Tone> = { slow: "neutral", stuck: "warn", stuck_long: "down" };

export function StuckPanel({ scope, onOpenTrader, className }: { scope: Scope | "auto"; onOpenTrader: (trader: string) => void; className?: string }) {
  const { t } = coachI18n.useT();
  const q = useStuck(scope);
  const [all, setAll] = React.useState(false);
  return (
    <Panel className={className} fill title={t("stuck.title")} icon={Hourglass} description={t("stuck.description")}>
      <QueryState query={q} errorCompact errorTitle={t("stuck.loadFailed")} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact icon={Hourglass} title={t("stuck.empty")} />}>
        {(d) => (
          <ul className="flex flex-col gap-2">
            {(all ? d.items : d.items.slice(0, VISIBLE)).map((x) => <StuckRow key={x.trader} x={x} onOpenTrader={onOpenTrader} />)}
            {d.items.length > VISIBLE && !all && (
              <li>
                <button type="button" onClick={() => setAll(true)} className="inline-flex min-h-8 items-center px-1 text-xs text-primary hover:underline">
                  {t("stuck.showMore", { count: d.items.length - VISIBLE })}
                </button>
              </li>
            )}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

function StuckRow({ x, onOpenTrader }: { x: StuckItem; onOpenTrader: (trader: string) => void }) {
  const { t } = coachI18n.useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const book = useMutation({
    mutationFn: () => scheduleReview(x.trader),
    onSuccess: (r) => {
      toast({ title: t("stuck.scheduled", { date: fmtDate(r.metAt.slice(0, 10), "dayMonth") }) });
      void qc.invalidateQueries({ queryKey: coachKeys.all });
      void qc.invalidateQueries({ queryKey: curatorKeys.all });
    },
    onError: (e) => toast({ title: t("stuck.scheduleFailed"), description: (e as Error).message, variant: "destructive" }),
  });
  const leak = x.diagnosis.edge.leaks[0];
  return (
    <li className={cn("tile flex flex-col gap-2 px-3 py-2", x.escalationOpen && "ring-1 ring-warn/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onOpenTrader(x.trader)} className="min-w-0 truncate text-left text-sm font-medium text-foreground hover:text-primary" title={personName(x.trader)}>
          {personName(x.trader)}
        </button>
        <Pill tone={SEVERITY_TONE[x.severity]} dot>{t(`stuck.severity.${x.severity}`)}</Pill>
        {x.escalated && !x.reviewedOn && <Pill tone="warn">{t("stuck.escalated")}</Pill>}
        {x.adminEscalated && <Pill tone="down">{t("stuck.adminEscalated")}</Pill>}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{t("stuck.tenure", { count: x.tenure })}</span>
      </div>
      <PaceBar x={x} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t("stuck.binding")}</span>
        {leak && <span className="min-w-0 truncate">{t("stuck.topLeak", { slice: sliceLabel(leak.sliceKey) })}</span>}
        {x.diagnosis.feeSharePct != null && <span>{t("stuck.fees", { pct: x.diagnosis.feeSharePct })}</span>}
        {x.reviewedOn && <span>{t("stuck.reviewed", { date: fmtDate(x.reviewedOn, "dayMonth") })}</span>}
      </div>
      <Button type="button" size="sm" variant={x.escalationOpen ? "default" : "outline"} className="self-start" disabled={book.isPending} onClick={() => book.mutate()}>
        <CalendarPlus className="h-3.5 w-3.5" /> {t("stuck.schedule")}
      </Button>
    </li>
  );
}

/** Mean daily net with its 80% interval against the stage's target pace (one scale from the lowest value to the target). */
function PaceBar({ x }: { x: StuckItem }) {
  const { t } = coachI18n.useT();
  if (x.mean == null || x.lo80 == null || x.hi80 == null || x.pace == null) return null;
  const lo = Math.min(0, x.lo80);
  const hi = Math.max(x.pace, x.hi80) * 1.1;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const usd = (v: number) => fmtUsd(v, { signed: true, decimals: 0 });
  return (
    <div className="flex flex-col gap-1" aria-label={t("stuck.paceAria", { mean: usd(x.mean), pace: fmtUsd(x.pace, { decimals: 0 }) })}>
      <div className="relative h-2 rounded-full bg-muted">
        <div className="absolute inset-y-0 rounded-full bg-warn/40" style={{ left: pos(x.lo80), width: `calc(${pos(x.hi80)} - ${pos(x.lo80)})` }} />
        <div className="absolute inset-y-[-2px] w-0.5 rounded bg-warn" style={{ left: pos(x.mean) }} />
        <div className="absolute inset-y-[-4px] w-0.5 bg-up" style={{ left: pos(x.pace) }} />
      </div>
      <div className="flex justify-between gap-2 text-xs tabular-nums text-muted-foreground">
        <span>{t("stuck.pace", { mean: usd(x.mean), lo: usd(x.lo80), hi: usd(x.hi80) })}</span>
        <span className="text-up">{t("stuck.target", { pace: fmtUsd(x.pace, { decimals: 2 }) })}</span>
      </div>
    </div>
  );
}
