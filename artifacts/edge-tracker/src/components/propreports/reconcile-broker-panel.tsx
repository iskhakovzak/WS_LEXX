/**
 * «Сверка с отчётом брокера»: the nightly per-account per-day comparison of our net with the PropReports report.
 * Lists differences over $1 (open by default); staff with propreports.sync can acknowledge one (it re-opens by itself
 * when the difference moves). Used by reconcile-broker.tsx (the one-line mount for /integrations and admin «Данные»).
 */
import { Check, Loader2, Scale } from "lucide-react";
import { DataTable, EmptyState, ErrorState, Panel, Pill, Segmented, TableSkeleton, usePersistentState, type Tone } from "@/components/ds";
import { VirtualRows } from "@/components/ds/virtual";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtDate, fmtRelative, fmtUsd } from "@/lib/format";
import { personName } from "@/i18n";
import { propreportsAccuracyI18n } from "@/i18n/ns/propreportsAccuracy";
import { useAcknowledgeReconcile, useReconcileBroker, type ReconcileDayRow, type ReconcileStatus, type ReconcileView } from "./reconcile-broker-api";

const STATUS_TONE: Record<ReconcileStatus, Tone> = { ok: "up", mismatch: "down", missing_ours: "warn", missing_broker: "warn" };

function Row({ r, canAcknowledge }: { r: ReconcileDayRow; canAcknowledge: boolean }) {
  const { t } = propreportsAccuracyI18n.useT();
  const { toast } = useToast();
  const ack = useAcknowledgeReconcile();
  const onAck = async () => {
    try { await ack.mutateAsync({ id: r.id }); toast({ title: t("reconcile.acknowledgedToast") }); }
    catch (e) { toast({ title: t("reconcile.failed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };
  return (
    <tr>
      <td className="whitespace-nowrap">{fmtDate(r.date, "short")}</td>
      <td className="whitespace-nowrap">{r.account}</td>
      <td className="whitespace-nowrap">{r.trader ? personName(r.trader) : "—"}</td>
      <td className="text-right tabular-nums">{fmtUsd(r.oursNet, { signed: true })}</td>
      <td className="text-right tabular-nums">{fmtUsd(r.brokerNet, { signed: true })}</td>
      <td className={`text-right font-medium tabular-nums ${Math.abs(r.diff) > 1 ? "text-down" : ""}`}>{fmtUsd(r.diff, { signed: true })}</td>
      <td>
        <div className="flex flex-wrap items-center gap-1">
          <Pill tone={STATUS_TONE[r.status]}>{t(`reconcile.status.${r.status}`)}</Pill>
          {r.carry && <span title={t("reconcile.carryHint")}><Pill tone="neutral">{t("reconcile.carry")}</Pill></span>}
          {r.adjDiff != null && Math.abs(r.adjDiff) > 1 && <Pill tone="warn">{t("reconcile.adjDiff", { value: fmtUsd(r.adjDiff, { signed: true }) })}</Pill>}
          {r.transferDiff != null && Math.abs(r.transferDiff) > 1 && <Pill tone="warn">{t("reconcile.transferDiff", { value: fmtUsd(r.transferDiff, { signed: true }) })}</Pill>}
        </div>
      </td>
      <td className="whitespace-nowrap text-right">
        {r.acknowledgedAt ? (
          <span className="text-2xs text-muted-foreground">{t("reconcile.acknowledged", { who: r.acknowledgedBy ? personName(r.acknowledgedBy) : "—" })}</span>
        ) : canAcknowledge && r.status !== "ok" ? (
          <Button size="sm" variant="ghost" disabled={ack.isPending} onClick={onAck}>
            {ack.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}{t("reconcile.acknowledge")}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

export function BrokerReconcileDays({ canAcknowledge = false, trader = null }: { canAcknowledge?: boolean; trader?: string | null }) {
  const { t } = propreportsAccuracyI18n.useT();
  const [view, setView] = usePersistentState<ReconcileView>("integrations.reconcile.view", "open");
  const q = useReconcileBroker(view, trader);
  const data = q.data;
  const run = data?.run;
  const running = run && !run.finishedAt;
  const meta = running
    ? t("reconcile.running", { done: run.done.length, total: run.total ?? run.done.length })
    : data?.lastCheckedAt ? t("reconcile.lastChecked", { when: fmtRelative(data.lastCheckedAt) }) : t("reconcile.neverChecked");
  return (
    <Panel
      title={t("reconcile.title")}
      description={t("reconcile.description")}
      icon={Scale}
      actions={data?.openCount ? <Pill tone="warn" dot>{t("reconcile.openCount", { count: data.openCount })}</Pill> : undefined}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented<ReconcileView>
          size="sm"
          ariaLabel={t("reconcile.viewAria")}
          value={view}
          onChange={setView}
          options={(["open", "all", "everything"] as const).map((v) => ({ value: v, label: t(`reconcile.view.${v}`) }))}
        />
        <span className="text-2xs text-muted-foreground">{meta}</span>
      </div>
      {q.isError && !data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} inset />
      ) : q.isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : !data?.rows.length ? (
        <EmptyState icon={Scale} title={t("reconcile.empty")} description={t("reconcile.emptyHint")} />
      ) : (
        <DataTable maxHeight="60vh" ariaLabel={t("reconcile.title")} className={cn("[&_tbody_td]:px-2 [&_thead_th]:px-2", q.isPlaceholderData && "opacity-70")}>
          <table>
            <thead>
              <tr>
                <th className="text-left">{t("reconcile.col.date")}</th>
                <th className="text-left">{t("reconcile.col.account")}</th>
                <th className="text-left">{t("reconcile.col.trader")}</th>
                <th className="text-right">{t("reconcile.col.ours")}</th>
                <th className="text-right">{t("reconcile.col.broker")}</th>
                <th className="text-right">{t("reconcile.col.diff")}</th>
                <th className="text-left">{t("reconcile.col.status")}</th>
                <th />
              </tr>
            </thead>
            <VirtualRows rows={data.rows} colSpan={8} estimateSize={45} getKey={(r) => r.id} renderRow={(r) => <Row key={r.id} r={r} canAcknowledge={canAcknowledge} />} />
          </table>
        </DataTable>
      )}
    </Panel>
  );
}
