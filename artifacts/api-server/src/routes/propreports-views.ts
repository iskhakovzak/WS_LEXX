import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  summarizeTrips, feeLabel, orderedFeeKeys, type IntegrationSettings, type ConnectionState, type RoundTrip, type SyncPlan,
} from "../lib/propreports";
import type { SyncCounts } from "../lib/notifyEventsCore";
import { enqueueOutbox, kickOutbox } from "../lib/propreports/tick/outbox";
import type { Lang } from "../i18n";
import { propreportsT } from "../i18n/ns";

/**
 * Response views of routes/propreports.ts (plan / trip / fee columns / connection / sync runs) and the post-sync
 * notice. Split out of routes/propreports.ts (size ratchet); the router re-exports FeeColumnView.
 */

/**
 * After a real (non-dry) import / API sync: the `sync` receipt to the actor and `sync_unmatched` when broker accounts are
 * not mapped — as an outbox row ("notify.sync", lib/propreports/sideEffects.ts), so a Vercel function frozen after the
 * response cannot lose it; drained right away (kickOutbox) or by the next tick. Never delays or fails the response.
 */
export function notifySyncOutcome(opts: { actor: string; actorIsStaff: boolean; kind: "import" | "sync"; context: string | null; result: SyncCounts & { runId: number }; unmapped: string[] }): void {
  const result = { runId: opts.result.runId, inserted: opts.result.inserted, updated: opts.result.updated, unchanged: opts.result.unchanged, skipped: opts.result.skipped, conflicts: opts.result.conflicts, errors: opts.result.errors };
  void enqueueOutbox("notify.sync", { actor: opts.actor, actorIsStaff: opts.actorIsStaff, kind: opts.kind, context: opts.context, result, unmapped: opts.unmapped })
    .then(() => kickOutbox())
    .catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "propreports: could not enqueue the sync notice"));
}

/** Compact, JSON-safe preview of a plan (full trips are large; the UI shows executions on expand). */
export function serializePlan(plan: SyncPlan, extra: Record<string, unknown>) {
  const trips = plan.items.map((i) => i.trip);
  return {
    ...extra,
    counts: plan.counts,
    unmappedAccounts: plan.unmappedAccounts,
    inactiveAccounts: plan.inactiveAccounts,
    dateFrom: plan.dateFrom,
    dateTo: plan.dateTo,
    feeColumns: plan.feeColumns,
    resolvedAccounts: plan.resolvedAccounts,
    summary: summarizeTrips(trips),
    items: plan.items.slice(0, 3000).map((i) => ({
      externalId: i.externalId,
      action: i.action,
      reason: i.reason ?? null,
      trader: i.trader,
      account: i.account,
      tradeId: i.tradeId,
      pendingId: i.pendingId,
      changes: i.changes,
      candidates: i.candidates,
      trip: tripView(i.trip),
    })),
    truncated: plan.items.length > 3000,
  };
}

export function tripView(t: RoundTrip) {
  return {
    symbol: t.symbol, side: t.side, date: t.date, exitDate: t.exitDate, openedAt: t.openedAt, closedAt: t.closedAt,
    horizon: t.horizon, session: t.session, qty: t.qty, openQty: t.openQty, avgEntry: t.avgEntry, avgExit: t.avgExit,
    grossPnl: t.grossPnl, fees: t.fees, totalFees: t.totalFees, netPnl: t.netPnl, result: t.result, holdTime: t.holdTime,
    fillCount: t.fillCount, open: t.open, fromReport: !!t.fromReport, executions: t.executions,
  };
}

export interface FeeColumnView { key: string; header: string | null; label: string; known: boolean; heuristic: boolean; include: boolean; lastSeenAt: string | null; customLabel: string | null }

/** Connection state with our own error text re-rendered in `lang` (upstream texts stay as received). */
export function connectionView<T extends ConnectionState>(conn: T, lang: Lang): T {
  if (!conn.errorKey || lang === "ru") return conn;
  return { ...conn, error: propreportsT.tryFor(lang, conn.errorKey, conn.errorParams) ?? conn.error };
}

/** Union of detected and configured fee columns, in canonical order, for the «Комиссии» block. */
export function feeColumnsView(settings: IntegrationSettings, lang: Lang = "ru"): FeeColumnView[] {
  const keys = new Set<string>([...settings.fees.detected.map((c) => c.key), ...Object.keys(settings.fees.columns)]);
  return orderedFeeKeys(keys).map((key) => {
    const d = settings.fees.detected.find((c) => c.key === key);
    const c = settings.fees.columns[key];
    return {
      key,
      header: c?.header ?? d?.header ?? null,
      label: c?.label || feeLabel(key, settings.fees, lang),
      known: c?.known ?? d?.known ?? false,
      heuristic: c?.heuristic ?? d?.heuristic ?? false,
      include: c?.include !== false,
      lastSeenAt: c?.lastSeenAt ?? null,
      customLabel: c?.label ?? null,
    };
  });
}

export async function lastRun() {
  const { rows } = await pool.query(`SELECT * FROM propreports_sync_runs ORDER BY started_at DESC LIMIT 1`);
  return rows[0] ? runView(rows[0]) : null;
}

export function runView(r: any) {
  return {
    id: Number(r.id),
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    source: r.source,
    status: r.status,
    fileName: r.file_name ?? null,
    dateFrom: r.date_from ?? null,
    dateTo: r.date_to ?? null,
    inserted: Number(r.inserted ?? 0),
    updated: Number(r.updated ?? 0),
    unchanged: Number(r.unchanged ?? 0),
    skipped: Number(r.skipped ?? 0),
    conflicts: Number(r.conflicts ?? 0),
    errors: Number(r.errors ?? 0),
    errorText: r.error_text ?? null,
    actor: r.actor ?? null,
    details: r.details ?? null,
  };
}

