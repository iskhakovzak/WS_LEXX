/**
 * Red-day risk alerts: the payload, its claim and its delivery (outbox kind `risk.alert`, lib/propreports/tick/outbox).
 *
 * Flow: a producer (the risk routes on a read — lib/riskAlertQueue recordStopAlerts — or the PropReports positions tick
 * — scanLiveAlerts) builds a RiskAlertPayload from the metrics, claims (trader, trading date, threshold) once in
 * risk_live_alerts (migration 0221) and enqueues the payload. The handler below writes the risk_alert_log row (breach
 * records + «Разбор нарушения» queue) and notifies: trader + assigned staff (stop: every curator when nobody is
 * assigned), a repeat breach within 7 days → head of desk. Telegram only when a bot token is configured.
 *
 * Idempotent: risk_alert_log is UNIQUE (trader, date, kind) and every notification has its own once-only claim
 * (notification_dedup: one risk_warn / risk_breach per trader per day, one repeat-breach escalation per day).
 */
import { pool } from "@workspace/db";
import { config } from "../config";
import { nyDate, addDays } from "./tradingDate";
import { assignedStaffOf, notifyUser } from "./notifyUtils";
import { notifLinks } from "./notificationCore";
import { claimOnce, staffOrFallback } from "./notifyEvents";
import { riskDedupKey, riskNotice, uniqueRecipients } from "./notifyEventsCore";
import { breachStats, repeatBreachKey } from "./curatorLogic";
import { ensureTables } from "./riskData";
import { WARN_PCT, computeStop, round2, type Limits, type Metrics, type StopState } from "./riskMetrics";

export const RISK_ALERT_KIND = "risk.alert";

/** Alerting thresholds = stop states that say something (ok / no_limits never alert). */
export type RiskThreshold = Exclude<StopState, "ok" | "no_limits">;
const THRESHOLDS: readonly RiskThreshold[] = ["warn", "stop", "weekly", "drawdown"];

export type RiskAlertPayload = {
  trader: string;
  /** Trading date (NY) the numbers belong to. */
  date: string;
  state: RiskThreshold;
  halted: boolean;
  /** Amount of the limit that tripped (positive) and the limit; the RU text is the alert-log fallback. */
  used: number;
  limit: number | null;
  message: string;
  todayLoss: number;
  weekLoss: number;
  currentDd: number;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  maxDrawdown: number | null;
  dailyPct: number | null;
  weeklyPct: number | null;
  drawdownPct: number | null;
  /** Live unrealized counted in today's P&L (null = realized only). */
  unrealized: number | null;
};

/**
 * Pure: the alert for a trader's metrics (null when the stop state is ok / no limits). The stop is recomputed in RU from
 * the metrics' numbers — `m` may have been rendered in the reader's language; the alert log stores the RU text.
 */
export function stopAlertOf(m: Metrics, limits: Limits | null, date: string): RiskAlertPayload | null {
  const todayLoss = Math.max(0, -(m.today.pnlNet ?? 0));
  const weekLoss = Math.max(0, -(m.week.pnlNet ?? 0));
  const currentDd = m.drawdown.currentUsd;
  const s = computeStop({ todayLoss, weekLoss, currentDd, limits }, "ru");
  if (s.state === "ok" || s.state === "no_limits") return null;
  const limit = s.state === "weekly" ? limits?.weeklyLossLimit : s.state === "drawdown" ? limits?.maxDrawdown : limits?.dailyLossLimit;
  const used = s.state === "weekly" ? weekLoss : s.state === "drawdown" ? currentDd : todayLoss;
  return {
    trader: m.trader, date, state: s.state, halted: s.halted,
    used: round2(used), limit: limit ?? null, message: s.message,
    todayLoss: round2(todayLoss), weekLoss: round2(weekLoss), currentDd: round2(currentDd),
    dailyLimit: limits?.dailyLossLimit ?? null, weeklyLimit: limits?.weeklyLossLimit ?? null, maxDrawdown: limits?.maxDrawdown ?? null,
    dailyPct: s.dailyPct, weeklyPct: s.weeklyPct, drawdownPct: s.drawdownPct,
    unrealized: m.today.unrealizedUsd ?? null,
  };
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Pure: a stored outbox payload back to a RiskAlertPayload (null when malformed — the row is then dropped). */
export function parseRiskAlertPayload(raw: unknown): RiskAlertPayload | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return null;
  if (typeof p.trader !== "string" || !p.trader || typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return null;
  if (!THRESHOLDS.includes(p.state as RiskThreshold)) return null;
  return {
    trader: p.trader, date: p.date, state: p.state as RiskThreshold, halted: p.halted === true,
    used: numOrNull(p.used) ?? 0, limit: numOrNull(p.limit), message: typeof p.message === "string" ? p.message : "",
    todayLoss: numOrNull(p.todayLoss) ?? 0, weekLoss: numOrNull(p.weekLoss) ?? 0, currentDd: numOrNull(p.currentDd) ?? 0,
    dailyLimit: numOrNull(p.dailyLimit), weeklyLimit: numOrNull(p.weeklyLimit), maxDrawdown: numOrNull(p.maxDrawdown),
    dailyPct: numOrNull(p.dailyPct), weeklyPct: numOrNull(p.weeklyPct), drawdownPct: numOrNull(p.drawdownPct),
    unrealized: numOrNull(p.unrealized),
  };
}

/** Breach / warn record (UNIQUE trader, date, kind). True when this call inserted it. */
export async function logStopAlert(p: RiskAlertPayload): Promise<boolean> {
  await ensureTables();
  const { rows } = await pool.query(
    `INSERT INTO risk_alert_log (trader, date, kind, level, used, "limit", message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (trader, date, kind) DO NOTHING
     RETURNING id`,
    [p.trader, p.date, p.state, p.halted ? "breach" : "warn", p.used, p.limit, p.message],
  );
  return rows.length > 0;
}

const telegramOn = (): boolean => !!config.telegram.botToken;

/**
 * Outbox handler of `risk.alert`. Throws on a DB failure (the outbox retries); notifications are once-only claims, so a
 * re-run never sends twice. A payload of an earlier trading day (late drain) is logged but nobody is notified.
 */
export async function riskAlertHandler(raw: unknown): Promise<void> {
  const p = parseRiskAlertPayload(raw);
  if (!p) return;
  await logStopAlert(p);
  if (p.date !== nyDate()) return;
  if (p.halted && p.limit != null) await escalateRepeatBreach(p.trader, p.date, { state: p.state, used: p.used, limit: p.limit });
  const notice = riskNotice({
    trader: p.trader, state: p.state, halted: p.halted,
    todayLoss: p.todayLoss, weekLoss: p.weekLoss, currentDd: p.currentDd,
    dailyLimit: p.dailyLimit, weeklyLimit: p.weeklyLimit, maxDrawdown: p.maxDrawdown,
    dailyPct: p.dailyPct, weeklyPct: p.weeklyPct, drawdownPct: p.drawdownPct, warnPct: WARN_PCT, unrealized: p.unrealized,
  });
  if (!notice) return;
  // At most one notification per type (risk_warn / risk_breach) per trader per trading day.
  if (!(await claimOnce(riskDedupKey(notice.type, p.trader, p.date)))) return;
  const telegram = telegramOn();
  const common = { type: notice.type, link: notifLinks.risk(p.trader), entityType: "risk", entityId: `${p.trader}:${p.date}`, source: "risk", telegram } as const;
  await notifyUser({ ...common, userName: p.trader, params: { ...notice.params, variant: "trader" } });
  // Warn → assigned staff only; stop (100%) → assigned staff, or every curator when nobody is assigned.
  const staff = uniqueRecipients(p.halted ? await staffOrFallback(p.trader) : await assignedStaffOf(p.trader), p.trader);
  for (const name of staff) await notifyUser({ ...common, userName: name, params: { ...notice.params, variant: "staff" } });
}

/** Heads of desk: active admins; when the desk has none — every active curator. The trader is never included. */
async function headsOfDesk(trader: string): Promise<string[]> {
  const { rows } = await pool.query<{ name: string; role: string }>(
    `SELECT name, role FROM users WHERE active = true AND role IN ('admin', 'curator') AND COALESCE(banned, false) = false`,
  ).catch(() => ({ rows: [] as { name: string; role: string }[] }));
  const admins = rows.filter((r) => r.role === "admin").map((r) => r.name);
  return uniqueRecipients(admins.length ? admins : rows.map((r) => r.name), trader);
}

/** Second (or later) breach day within 7 calendar days → one critical notification to the head of desk per day. */
async function escalateRepeatBreach(trader: string, date: string, stop: { state: string; used: number; limit: number }): Promise<void> {
  const from = addDays(date, -6);
  const { rows } = await pool.query<{ date: string }>(
    `SELECT DISTINCT date FROM risk_alert_log WHERE trader = $1 AND level = 'breach' AND date BETWEEN $2 AND $3`,
    [trader, from, date],
  );
  const stats = breachStats(rows.map((r) => String(r.date)), date);
  if (!stats.repeat) return;
  if (!(await claimOnce(repeatBreachKey(trader, date)))) return;
  const heads = await headsOfDesk(trader);
  for (const name of heads) {
    await notifyUser({
      userName: name, type: "risk_repeat_breach", severity: "critical", source: "risk", telegram: telegramOn(),
      params: { trader, days: stats.days7, prior: stats.prior.join(", "), state: stop.state, used: stop.used, limit: stop.limit },
      link: `/curator?trader=${encodeURIComponent(trader)}&tab=risk`, entityType: "risk", entityId: `${trader}:${date}:repeat`,
    });
  }
}
