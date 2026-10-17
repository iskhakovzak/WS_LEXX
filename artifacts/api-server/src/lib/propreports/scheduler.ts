/**
 * Optional scheduled sync. OFF unless PROPREPORTS_SYNC_MINUTES (≥ 5) is set together with the API env vars.
 * Pulls the last `lookbackDays` of fills (default 3, so overnight/swing exits are re-matched to their entries)
 * and applies them with the normal idempotent engine; overlapping runs are skipped.
 */
import { logger } from "../logger";
import { getConfiguredClient, isConfigured, syncMinutes } from "./client";
import { buildRoundTrips } from "./round-trips";
import { applySync, planSync } from "./sync";

let timer: NodeJS.Timeout | null = null;
let running = false;
let nextRunAt: number | null = null;
let lastError: string | null = null;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function runScheduledSync(lookbackDays = 3): Promise<void> {
  if (running) { logger.warn("propreports: scheduled sync skipped (previous run still active)"); return; }
  const client = await getConfiguredClient();
  if (!client) return;
  running = true;
  try {
    const to = new Date();
    const from = new Date(to.getTime() - lookbackDays * 86_400_000);
    const { fills } = await client.fills(ymd(from), ymd(to));
    const { trips } = buildRoundTrips(fills);
    const plan = await planSync(trips);
    const res = await applySync(plan, { actor: "scheduler", source: "api", dateFrom: ymd(from), dateTo: ymd(to), details: { scheduled: true, fills: fills.length } });
    lastError = res.errorText;
    logger.info({ inserted: res.inserted, updated: res.updated, conflicts: res.conflicts, errors: res.errors }, "propreports: scheduled sync done");
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    logger.error({ err: lastError }, "propreports: scheduled sync failed");
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  const minutes = syncMinutes();
  if (timer || !minutes || !isConfigured()) return;
  const ms = minutes * 60_000;
  const tick = () => { nextRunAt = Date.now() + ms; void runScheduledSync(); };
  timer = setInterval(tick, ms);
  timer.unref?.();
  nextRunAt = Date.now() + ms;
  logger.info({ minutes }, "propreports: scheduled sync enabled");
}

export function schedulerStatus(): { enabled: boolean; minutes: number | null; nextRunAt: string | null; running: boolean; lastError: string | null } {
  return { enabled: !!timer, minutes: syncMinutes(), nextRunAt: timer && nextRunAt ? new Date(nextRunAt).toISOString() : null, running, lastError };
}
