/**
 * Post-sync side effects as outbox handlers (registry: tick/outbox.ts OUTBOX_HANDLERS). They used to be fire-and-forget
 * promises after applySync / the import route — lost whenever a Vercel function froze after its response. Now applySync
 * enqueues them inside its transaction and a drainer runs them (tick, classic job, or kickOutbox right after the write).
 * Every handler is idempotent and throws to be retried. Heavy modules are imported lazily.
 */
import { z } from "zod";
import { logger } from "../logger";

const traders = z.object({ traders: z.array(z.string().min(1)).max(2000) });
const tradeIds = z.object({ tradeIds: z.array(z.number().int().positive()).max(5000) });

/** Errors of individual traders are collected; the row fails (and is retried) when any trader failed. */
async function perTrader(list: string[], label: string, fn: (t: string) => Promise<unknown>): Promise<void> {
  const failed: string[] = [];
  for (const t of list) {
    try { await fn(t); } catch (e) {
      failed.push(t);
      logger.warn({ err: e instanceof Error ? e.message : String(e), trader: t }, `propreports: ${label} failed`);
    }
  }
  if (failed.length) throw new Error(`${label} failed for ${failed.length} trader(s)`);
}

export async function rulesScanHandler(payload: unknown): Promise<void> {
  const { traders: list } = traders.parse(payload);
  const { scanRulesForTrader } = await import("../rulesEngine");
  await perTrader(list, "rule scan", (t) => scanRulesForTrader(t));
}

export async function ideasRelinkHandler(payload: unknown): Promise<void> {
  const { traders: list } = traders.parse(payload);
  if (!list.length) return;
  const { relinkIdeasForTraders } = await import("../ideaTradeMatch");
  await relinkIdeasForTraders(list);
}

export async function challengesRefreshHandler(payload: unknown): Promise<void> {
  const { traders: list } = traders.parse(payload);
  if (!list.length) return;
  const { refreshChallenges } = await import("../../routes/academy-path");
  await refreshChallenges(list);
}

export async function structuresRefreshHandler(payload: unknown): Promise<void> {
  const { tradeIds: ids } = tradeIds.parse(payload);
  if (!ids.length) return;
  const { refreshTradeStructures } = await import("../tradeStructureStore");
  await refreshTradeStructures([...new Set(ids)]);
}

const notifyPayload = z.object({
  actor: z.string().min(1),
  actorIsStaff: z.boolean(),
  kind: z.enum(["import", "sync"]),
  context: z.string().nullable(),
  result: z.object({ runId: z.number(), inserted: z.number(), updated: z.number(), unchanged: z.number(), skipped: z.number(), conflicts: z.number(), errors: z.number(), errorText: z.string().nullable().optional() }),
  unmapped: z.array(z.string()),
});
export type SyncNotifyPayload = z.infer<typeof notifyPayload>;

/**
 * After a real (non-dry) import / API sync: `sync` summary to the actor who ran it and `sync_unmatched` when broker
 * accounts are not mapped to a trader — to the actor, plus the trader's staff when the actor is a trader importing their
 * own file. Re-running a row may repeat the receipt (acceptable: it is a receipt, not an alert).
 */
export async function syncNotifyHandler(payload: unknown): Promise<void> {
  const p = notifyPayload.parse(payload);
  const [{ notifyUser, notifyUsers }, { notifLinks }, { staffOrFallback }, { syncNotice, unmatchedNotice }] = await Promise.all([
    import("../notifyUtils"), import("../notificationCore"), import("../notifyEvents"), import("../notifyEventsCore"),
  ]);
  const n = syncNotice(p.result, p.kind, p.context);
  await notifyUser({
    userName: p.actor, type: "sync", source: "propreports", severity: n.severity,
    params: n.params, link: notifLinks.integrations(), entityType: "propreports_run", entityId: p.result.runId || null,
  });
  const u = unmatchedNotice(p.unmapped);
  if (u) {
    const recipients = p.actorIsStaff ? [p.actor] : [p.actor, ...(await staffOrFallback(p.actor))];
    await notifyUsers(recipients, {
      type: "sync_unmatched", source: "propreports", actor: p.actorIsStaff ? null : p.actor,
      params: u.params, link: notifLinks.integrations(), entityType: "propreports_run", entityId: p.result.runId || null,
    });
  }
}

const syncedPayload = z.object({ traders: z.array(z.string()).default([]) }).passthrough();

/**
 * "propreports.synced": with the job scheduler registered, the registry's listeners run (evening cards, contract
 * alerts, readiness, candle archive). Without it (a process that never
 * registered the jobs, e.g. a one-off script) the light, per-trader listeners run here directly.
 */
export async function syncedEventHandler(payload: unknown): Promise<void> {
  const p = syncedPayload.parse(payload ?? {});
  const { listJobs, emitJobEvent } = await import("../../jobs/registry");
  if (listJobs().length > 0) {
    emitJobEvent("propreports.synced", p);
    return;
  }
  if (p.traders.length) {
    const { refreshReadinessNotices } = await import("../../routes/academy-path");
    await refreshReadinessNotices(p.traders);
  }
  const [{ intradayAlertsEnabled }, { contractAlertsEnabled }] = await Promise.all([import("../daily/telegramGuard"), import("../daily/telegramSchedule")]);
  if (intradayAlertsEnabled() && contractAlertsEnabled()) {
    const { runContractAlerts } = await import("../daily/telegramJobs");
    await runContractAlerts({});
  }
}
