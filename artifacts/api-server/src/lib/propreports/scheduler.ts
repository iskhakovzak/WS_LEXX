/**
 * Schedule of the PropReports tick (lib/propreports/tick/runner.ts).
 *
 *   classic server (dist/index.mjs, JOBS_ENABLED on — the default): the job registry runs the SAME tick as
 *     POST /api/cron/tick — "propreports.sync" every 5 min in New York RTH (syncCron(): "*\/5 9-16 * * 1-5", or
 *     PROPREPORTS_SYNC_MINUTES when set) and "propreports.tick-hourly" every hour otherwise (OFF_HOURS_CRON). Nothing
 *     depends on Supabase pg_cron. Both jobs are on whenever the PropReports env (domain + token) is set.
 *   Vercel: no in-process scheduler — the heartbeat (docs/PROPREPORTS_CRON.sql, optional) calls POST /api/cron/tick.
 * All paths share the DB lease, so ticks never overlap; each step keeps its own cadence (tick/due.ts).
 *
 * fetchStartFor() is used by the tick's fills step: the window reaches back to the oldest still-open broker trade
 * (≤ MAX_CARRY_DAYS), so overnight / swing exits pair with their entries.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { isConfigured, syncMinutes } from "./client";
import { nextCronRun, parseCron } from "../../jobs/cron";
import { config } from "../../config";

let running = false;
let lastError: string | null = null;

/** Cron for an interval in minutes: divisors of 60 → every N minutes; ≥ 60 → every round(N/60) hours. */
export function intervalCron(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.max(1, Math.min(23, Math.round(minutes / 60)));
    return h === 1 ? "0 * * * *" : `0 */${h} * * *`;
  }
  const step = [5, 6, 10, 12, 15, 20, 30].reduce((best, d) => (Math.abs(d - minutes) < Math.abs(best - minutes) ? d : best), 5);
  return `*/${step} * * * *`;
}

/** NY wall-clock (jobs/cron.ts): every 5 minutes 09:00–16:55, Monday–Friday. */
export const DESK_TICK_CRON = "*/5 9-16 * * 1-5";
/** Every hour (outside RTH the desk job is silent; at :00 in RTH both fire and the lease / in-process guard skips one). */
export const OFF_HOURS_CRON = "0 * * * *";

/**
 * The registry cron of the desk-hours tick, or null when the PropReports API is not configured. Non-null also means
 * "intraday broker sync is on" for its readers (telegram contract alerts, daily service).
 */
export function syncCron(): string | null {
  if (!isConfigured()) return null;
  const minutes = syncMinutes();
  return minutes ? intervalCron(minutes) : DESK_TICK_CRON;
}

/** The hourly tick, or null when the API is not configured. */
export function offHoursCron(): string | null {
  return isConfigured() ? OFF_HOURS_CRON : null;
}

/** Max days a run reaches back for an open position: one forgotten open trade must not make every run of the whole
 * desk fetch months of fills (older carries are fixed by a manual sync / backfill of that range). */
const MAX_CARRY_DAYS = 10;

/** `from`, moved back to the session of the oldest open PropReports trade (at most MAX_CARRY_DAYS ago). */
export async function fetchStartFor(from: Date, now = new Date()): Promise<Date> {
  try {
    const { rows } = await pool.query(
      `SELECT MIN(date)::text AS d FROM trades WHERE source = 'propreports' AND deleted_at IS NULL AND LOWER(COALESCE(result, '')) = 'open'`,
    );
    const d = rows[0]?.d as string | null | undefined;
    if (!d) return from;
    const open = new Date(`${d.slice(0, 10)}T00:00:00Z`);
    const floor = new Date(now.getTime() - MAX_CARRY_DAYS * 86_400_000);
    return open < from ? (open < floor ? floor : open) : from;
  } catch {
    return from;
  }
}

/**
 * One tick on the classic server (steps + outbox), with a longer budget than a Vercel function has. Overlapping runs
 * in this process are skipped; another process / the HTTP tick is kept out by the DB lease.
 */
export async function runScheduledSync(budgetMs = 4 * 60_000): Promise<Record<string, unknown>> {
  if (running) { logger.warn("propreports: scheduled tick skipped (previous run still active)"); return { skipped: "running" }; }
  running = true;
  try {
    const { runTick } = await import("./tick/runner");
    const summary = await runTick({ trigger: "scheduler", budgetMs });
    lastError = summary.steps.find((s) => s.error)?.error ?? null;
    logger.info({ skipped: summary.skipped, steps: summary.steps.filter((s) => s.ran).map((s) => s.name), outbox: summary.outbox }, "propreports: scheduled tick done");
    return { skipped: summary.skipped ?? null, steps: summary.steps, outbox: summary.outbox, ms: summary.ms };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    logger.error({ err: lastError }, "propreports: scheduled tick failed");
    throw e;
  } finally {
    running = false;
  }
}

/**
 * In-process schedule (the API's job scheduler). `enabled` is false with JOBS_ENABLED=false — then only the HTTP
 * heartbeat (/api/cron/tick) drives the tick; `minutes` = the desk-hours cadence; `nextRunAt` = the earlier of the two
 * jobs' next run.
 */
export function schedulerStatus(): { enabled: boolean; minutes: number | null; nextRunAt: string | null; running: boolean; lastError: string | null } {
  const desk = syncCron();
  const off = offHoursCron();
  const inProcess = config.jobsEnabled;
  const now = new Date();
  const next = [desk, off].filter((c): c is string => !!c).map((c) => nextCronRun(parseCron(c), now)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return { enabled: inProcess && !!desk, minutes: desk ? syncMinutes() ?? 5 : null, nextRunAt: inProcess && next ? next.toISOString() : null, running, lastError };
}
