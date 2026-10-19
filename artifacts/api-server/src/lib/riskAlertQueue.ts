/**
 * Producers of `risk.alert` outbox rows (handler + payload: lib/riskAlerts.ts).
 *
 *   recordStopAlerts(m, limits, date)   risk routes, on every read of a trader's metrics (/risk/me, /risk/desk, curator
 *                                       snapshot): claim once per trader / day / threshold, enqueue, kick a drain.
 *   scanLiveAlerts(date, now)           PropReports positions tick: every trader with a positions snapshot of the day,
 *                                       with the live unrealized in the stop — so a stop reached on open positions alerts
 *                                       even when nobody has the page open.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { isMarketClosed } from "./marketDays";
import { nyDate } from "./tradingDate";
import { enqueueOutbox, kickOutbox } from "./propreports/tick/outbox";
import { RISK_ALERT_KIND, logStopAlert, riskAlertHandler, stopAlertOf, type RiskAlertPayload } from "./riskAlerts";
import { loadDaily, loadDdResets, loadLimits, loadLiveSnapshots } from "./riskData";
import { computeMetrics, drawdownSince, liveRisk, type DayRow, type Limits, type Metrics } from "./riskMetrics";

/** In-process memo of claimed (trader|date|threshold) keys: a poll every minute should not hit the DB each time. */
const seen = new Set<string>();
const remember = (key: string) => {
  if (seen.size > 5_000) seen.clear();
  seen.add(key);
};

/**
 * Claims (trader, date, threshold) in risk_live_alerts and enqueues the `risk.alert` row in ONE transaction: true when
 * this call was the first today. A failure rolls both back and throws (nothing is claimed without a queued row).
 */
export async function claimAndQueue(p: RiskAlertPayload): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO risk_live_alerts (trader, date, threshold, pnl_net, unrealized) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (trader, date, threshold) DO NOTHING RETURNING id`,
      [p.trader, p.date, p.state, -p.todayLoss, p.unrealized],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return false;
    }
    await enqueueOutbox(RISK_ALERT_KIND, p, client);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Request path (fire-and-forget, never throws). A ?date= back-test only records the breach row (no notification);
 * the live trading day goes through the outbox. If the outbox cannot take the row (table missing on an old schema),
 * the handler runs inline so the alert is not lost.
 */
export async function recordStopAlerts(m: Metrics, limits: Limits | null, date: string): Promise<void> {
  try {
    const p = stopAlertOf(m, limits, date);
    if (!p) return;
    const key = `${p.trader}|${p.date}|${p.state}`;
    if (seen.has(key)) return;
    // Breaches belong to trading days: a lasting state (drawdown, weekly) on a weekend / holiday is not a new breach.
    if (await isMarketClosed(date)) return;
    if (date !== nyDate()) {
      await logStopAlert(p);
      remember(key);
      return;
    }
    let first: boolean;
    try {
      first = await claimAndQueue(p);
    } catch (err) {
      // Old schema (no outbox / claim table yet): deliver inline — its writes and notices are once-only anyway.
      logger.warn({ err, trader: p.trader }, "risk: alert queue unavailable, delivering inline");
      await riskAlertHandler(p);
      remember(key);
      return;
    }
    remember(key);
    if (first) kickOutbox();
  } catch (err) {
    logger.warn({ err, trader: m.trader }, "risk: stop alert failed");
  }
}

/**
 * Tick path: evaluate every trader with a positions snapshot of `date` (limits required) and enqueue the thresholds
 * crossed for the first time today. Returns counts for the step note.
 */
export async function scanLiveAlerts(date: string, now: Date): Promise<{ checked: number; queued: number }> {
  const live = await loadLiveSnapshots(date);
  const names = [...live.keys()];
  if (!names.length) return { checked: 0, queued: 0 };
  const [limitsMap, days, resets] = await Promise.all([loadLimits(null), loadDaily(null, date, names), loadDdResets(null, names)]);
  const daysBy = new Map<string, DayRow[]>();
  for (const d of days) daysBy.set(d.trader, [...(daysBy.get(d.trader) ?? []), d]);
  let checked = 0;
  let queued = 0;
  for (const name of names) {
    const limits = limitsMap.get(name) ?? null;
    if (!limits) continue;
    checked++;
    const m = computeMetrics(name, daysBy.get(name) ?? [], [], limits, date, "ru", drawdownSince(resets.get(name), date), liveRisk(live.get(name), date, now));
    const p = stopAlertOf(m, limits, date);
    if (!p || !(await claimAndQueue(p))) continue;
    remember(`${p.trader}|${p.date}|${p.state}`);
    queued++;
  }
  return { checked, queued };
}
