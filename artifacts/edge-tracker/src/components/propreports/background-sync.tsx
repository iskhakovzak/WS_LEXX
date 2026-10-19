/**
 * «Фоновая синхронизация»: the tick that keeps PropReports in sync without anyone pressing a button (every 5 min in the
 * session, hourly otherwise — the server's job scheduler or the HTTP heartbeat), and the resumable history backfill
 * (7-day windows, progress bar, stop). Staff read it; starting / stopping needs propreports.sync.
 */
import * as React from "react";
import { AlertTriangle, CheckCircle2, History, Loader2, PlayCircle, Square, Timer } from "lucide-react";
import { EmptyState, Panel, Pill, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { localDateString } from "@/lib/local-date";
import { fmtCount } from "@/lib/format";
import { propreportsI18n } from "@/i18n/ns/propreports";
import { agoText, useBackfills, useCancelBackfill, useRunTick, useStartBackfill, useTick, type Backfill, type TickStepState } from "./api";

const BACKFILL_TONE: Record<Backfill["status"], Tone> = { running: "accent", done: "up", cancelled: "neutral", error: "down" };

const stepLabel = (name: string) => propreportsI18n.tryT(`bg.step.${name.replace(/\./g, "_")}`) ?? name;

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return localDateString(d);
}

function StepRow({ s }: { s: TickStepState }) {
  const { t } = propreportsI18n.useT();
  const tone: Tone = s.lastError ? "down" : s.lastDone === false ? "accent" : s.lastRunAt ? "up" : "neutral";
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
      <span className="flex items-center gap-2 text-sm">
        <Pill tone={tone} dot>{stepLabel(s.name)}</Pill>
        <span className="text-xs text-muted-foreground">{s.lastRunAt ? agoText(s.lastRunAt) : t("bg.neverRan")}</span>
      </span>
      <span className={`min-w-0 max-w-full truncate text-xs ${s.lastError ? "text-down" : "text-muted-foreground"}`} title={s.lastError ?? s.lastNote ?? undefined}>
        {s.lastError ?? s.lastNote ?? ""}
      </span>
    </li>
  );
}

function BackfillProgress({ b, canSync }: { b: Backfill; canSync: boolean }) {
  const { t } = propreportsI18n.useT();
  const cancel = useCancelBackfill();
  return (
    <div className="space-y-2 rounded-xl border border-[var(--glass-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Pill tone={BACKFILL_TONE[b.status]} dot>{t(`bg.status.${b.status}`)}</Pill>
          {t("bg.range", { from: b.dateFrom, to: b.dateTo })}
        </span>
        {b.status === "running" && canSync && (
          <Button size="sm" variant="outline" onClick={() => cancel.mutate(b.id)} disabled={cancel.isPending}>
            <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t("bg.stop")}
          </Button>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={b.percent} aria-label={t("bg.progressAria")}>
        <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${b.percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("bg.progress", { percent: b.percent, done: b.windowsDone, total: b.windowsTotal })}
        {" · "}{t("bg.counts", { inserted: fmtCount(b.inserted), updated: fmtCount(b.updated), fills: fmtCount(b.fills) })}
        {b.status === "running" ? <> · {t("bg.next", { date: b.cursor })}</> : null}
      </p>
      {b.lastError && <p className="text-xs text-down">{b.lastError}</p>}
    </div>
  );
}

export function BackgroundSync({ canSync, apiConfigured }: { canSync: boolean; apiConfigured: boolean }) {
  const { t } = propreportsI18n.useT();
  const { toast } = useToast();
  const tick = useTick();
  const backfills = useBackfills();
  const runTick = useRunTick();
  const start = useStartBackfill();
  const [from, setFrom] = React.useState(() => monthsAgo(3));
  const [to, setTo] = React.useState(() => localDateString());
  const active = backfills.data?.active ?? null;
  const last = backfills.data?.items.find((b) => b.status !== "running") ?? null;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const lastTick = tick.data?.last ?? null;

  const onRun = async () => {
    try {
      const s = await runTick.mutateAsync();
      toast({ title: s.skipped === "lease" ? t("bg.busy") : t("bg.ranTitle"), description: t("bg.ranText", { steps: s.steps.filter((x) => x.ran).length, outbox: s.outbox.processed }) });
    } catch (e) { toast({ title: t("bg.runFailed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };
  const onStart = async () => {
    try {
      await start.mutateAsync({ from, to });
      toast({ title: t("bg.startedTitle"), description: t("bg.startedText") });
    } catch (e) { toast({ title: t("bg.startFailed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  return (
    <Panel
      title={t("bg.title")}
      description={t("bg.description")}
      icon={Timer}
      actions={canSync && apiConfigured ? (
        <Button size="sm" variant="outline" onClick={onRun} disabled={runTick.isPending}>
          {runTick.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {t("bg.runNow")}
        </Button>
      ) : undefined}
    >
      {!apiConfigured ? (
        <EmptyState icon={Timer} title={t("bg.offTitle")} description={t("bg.offText")} />
      ) : (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {lastTick && !lastTick.skipped && lastTick.ok
              ? <CheckCircle2 className="h-4 w-4 text-up" aria-hidden="true" />
              : <AlertTriangle className="h-4 w-4 text-[hsl(var(--chart-3))]" aria-hidden="true" />}
            {lastTick ? t("bg.lastTick", { ago: agoText(lastTick.startedAt) }) : t("bg.noTick")}
            {tick.data && tick.data.outbox.pending > 0 && <Pill tone="accent">{t("bg.outboxPending", { count: tick.data.outbox.pending })}</Pill>}
            {tick.data && tick.data.outbox.failed > 0 && <Pill tone="down">{t("bg.outboxFailed", { count: tick.data.outbox.failed })}</Pill>}
          </p>
          {!!tick.data?.steps.length && <ul className="divide-y divide-[var(--glass-border)]">{tick.data.steps.map((s) => <StepRow key={s.name} s={s} />)}</ul>}

          <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" aria-hidden="true" />{t("bg.backfillTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("bg.backfillText")}</p>
            {active ? <BackfillProgress b={active} canSync={canSync} /> : canSync && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1"><Label htmlFor="pr-bf-from" className="text-xs text-muted-foreground">{t("runDialog.from")}</Label><Input id="pr-bf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
                <div className="grid gap-1"><Label htmlFor="pr-bf-to" className="text-xs text-muted-foreground">{t("runDialog.to")}</Label><Input id="pr-bf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
                <Button onClick={onStart} disabled={!valid || start.isPending}>
                  {start.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{t("bg.start")}
                </Button>
              </div>
            )}
            {!active && last && <BackfillProgress b={last} canSync={canSync} />}
          </div>
        </div>
      )}
    </Panel>
  );
}
