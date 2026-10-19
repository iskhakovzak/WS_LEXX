/**
 * Curator review queue of closed days (routes/eod.ts): whose days a reader sees (OLGA-05) and the eod_overdue sweep
 * with the trading-hours SLA clock (OLGA-07). Split out of routes/eod.ts.
 */
import type { Request } from "express";
import { pool } from "@workspace/db";
import { nyDate } from "./tradingDate";
import { REVIEW_SLA_HOURS, tradingHoursBetween } from "./eodLogic";
import { marketClosedDays } from "./curatorStore";
import { readScope } from "./permissions";
import { notifyUsers } from "./notifyUtils";
import { notifLinks } from "./notificationCore";
import { claimOnce, inBackground } from "./notifyEvents";
import { eodOverdueKey } from "./notifyEventsCore";

const SLA_HOURS = REVIEW_SLA_HOURS;

// ─── queue scope (OLGA-05) ───────────────────────────────────────────────────

export type QueueScope = "mine" | "desk" | "unassigned";

/**
 * Which traders' days the reader's queue shows: `traders` = null → every trader (desk scope of an unrestricted reader).
 * mine = traders assigned to the reader (curator / mentor / risk manager — the /curator roster); the default when the
 * reader has wards, else desk. unassigned = traders without a curator. Always within readScope(journal.review).
 */
export async function queueRoster(req: Request, wanted: unknown): Promise<{ scope: QueueScope; traders: string[] | null; wards: number }> {
  const me = req.authUser!.name;
  const [{ rows: users }, readable] = await Promise.all([
    pool.query<{ name: string; ac: string | null; am: string | null; ar: string | null }>(
      `SELECT name, assigned_curator AS ac, assigned_mentor AS am, assigned_risk_manager AS ar
         FROM users WHERE active = true AND COALESCE(banned, false) = false AND role = 'trader'`,
    ),
    readScope(req, "journal.review"),
  ]);
  const visible = readable === null ? users : users.filter((u) => readable.includes(u.name));
  const wards = visible.filter((u) => u.ac === me || u.am === me || u.ar === me).map((u) => u.name);
  const scope: QueueScope = wanted === "desk" || wanted === "unassigned" || wanted === "mine" ? wanted : wards.length ? "mine" : "desk";
  if (scope === "mine") return { scope, traders: wards, wards: wards.length };
  if (scope === "unassigned") return { scope, traders: visible.filter((u) => !u.ac).map((u) => u.name), wards: wards.length };
  return { scope, traders: readable === null ? null : visible.map((u) => u.name), wards: wards.length };
}

/** Recipients of eod_overdue: the trader's assigned curator; no curator (or an inactive one) → the admins. */
export async function overdueRecipients(trader: string): Promise<string[]> {
  try {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT c.name FROM users t JOIN users c ON c.name = t.assigned_curator AND c.active = true AND COALESCE(c.banned, false) = false
        WHERE t.name = $1`,
      [trader],
    );
    if (rows.length) return rows.map((r) => r.name).filter((n) => n !== trader);
    const { rows: admins } = await pool.query<{ name: string }>(
      `SELECT name FROM users WHERE active = true AND role = 'admin' AND COALESCE(banned, false) = false`,
    );
    return admins.map((r) => r.name).filter((n) => n && n !== trader);
  } catch {
    return [];
  }
}

/**
 * eod_overdue: closed days waiting > SLA trading hours → the trader's assigned curator only (fallback: the admins,
 * never every curator — OLGA-05), once per closed day (dedup key = day id + closed_at, atomic across processes). There
 * is no scheduler for this yet, so the sweep piggybacks on the curator queue reads (badge polling), throttled to once
 * per 5 minutes per process and always run in the background.
 */
const OVERDUE_SWEEP_MS = 5 * 60 * 1000;
let lastOverdueSweep = 0;
export function sweepOverdue(): void {
  const now = Date.now();
  if (now - lastOverdueSweep < OVERDUE_SWEEP_MS) return;
  lastOverdueSweep = now;
  inBackground("eod.overdue", async () => {
    const { rows } = await pool.query<{ id: number; trader: string; date: string; closedAt: Date; reviewedAt: Date | null }>(
      `SELECT d.id, d.trader, d.date, d.closed_at AS "closedAt", d.reviewed_at AS "reviewedAt"
         FROM eod_days d
        WHERE d.closed_at IS NOT NULL AND d.reviewed_at IS NULL AND d.closed_at < NOW() - INTERVAL '${SLA_HOURS} hours'
          AND d.closed_at > NOW() - INTERVAL '14 days' -- an old backlog must not flood inboxes on first run
        ORDER BY d.closed_at ASC LIMIT 200`,
    );
    const closed = await marketClosedDays(nyDate(), 30);
    const due = rows
      .map((d) => ({ ...d, hoursWaiting: Math.floor(tradingHoursBetween(d.closedAt, now, closed)) }))
      .filter((d) => !d.reviewedAt && d.hoursWaiting > SLA_HOURS)
      .sort((a, b) => b.hoursWaiting - a.hoursWaiting);
    for (const d of due) {
      if (!(await claimOnce(eodOverdueKey(d.id, d.closedAt)))) continue;
      await notifyUsers(await overdueRecipients(d.trader), {
        type: "eod_overdue", source: "eod",
        params: { trader: d.trader, date: d.date, hours: d.hoursWaiting, sla: SLA_HOURS },
        link: notifLinks.journalDay(d.date, d.trader), entityType: "eod_day", entityId: d.id,
      }, d.trader);
    }
  });
}
