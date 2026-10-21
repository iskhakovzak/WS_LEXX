/**
 * «Дошли ли мои сделки» for a trader (wave 1, 1.13): GET /api/propreports/my-freshness → the /integrations header line
 * «Сделки за пн, 19 окт.: ✓ 48 · сверено с брокером · синхронизация 16:02».
 *
 *   day        the last finished trading day (lib/marketDays: weekends / full-day holidays skipped; today counts from
 *              30 min after its close — 16:30, 13:30 on an early close — when the post-close sync has run)
 *   trades     the trader's broker trades (source propreports) closed that day — the same rows /propreports/daily counts
 *   broker     the nightly PropReports «Summary by Date» comparison of that day (propreports_reconcile_days, all the
 *              trader's accounts): ok / mismatch / missing_ours / missing_broker, Σ diff; null before the first check
 *   state      ok        broker summary agrees (or nothing to compare and the last sync is after the day's close)
 *              mismatch  the broker summary disagrees (not acknowledged by staff)
 *              behind    no sync since the day's close — the trades of that day may not be in yet
 *              no_account no PropReports account is linked to the trader (a curator links it on /integrations)
 */
import { pool } from "@workspace/db";
import { addDays, nyDate, nyMinutes } from "../tradingDate";
import { sessionFor } from "../marketDays";
import { closeDateSql, closedSql } from "../tradeMath";

export type FreshnessState = "ok" | "mismatch" | "behind" | "no_account";
export type BrokerCheck = { status: "ok" | "mismatch" | "missing_ours" | "missing_broker"; diff: number; checkedAt: string | null };
export type MyFreshness = {
  day: string;
  trades: number;
  lastTradeDate: string | null;
  lastSyncedAt: string | null;
  accounts: number;
  broker: BrokerCheck | null;
  state: FreshnessState;
};

/** Minutes after the close before today counts as «the last trading day» (the post-close sync has run). */
export const SETTLE_MIN = 30;

/** The last finished trading day at `now` (async: the calendar). */
export async function lastFinishedDay(now: Date = new Date()): Promise<string> {
  const today = nyDate(now);
  const s = await sessionFor(today);
  if (!s.closed && nyMinutes(now) >= s.closeMin + SETTLE_MIN) return today;
  let d = addDays(today, -1);
  for (let i = 0; i < 14 && (await sessionFor(d)).closed; i++) d = addDays(d, -1);
  return d;
}

/** UTC instant of NY wall time `minutes` on `date` (DST-aware: NY offset at noon of that day). */
export function nyInstant(date: string, minutes: number): Date {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const nyNoon = nyMinutes(noonUtc); // 12:00 UTC is 07:00 / 08:00 in New York
  const offsetMin = 12 * 60 - nyNoon;
  return new Date(Date.parse(`${date}T00:00:00Z`) + (minutes + offsetMin) * 60_000);
}

/** Pure: the state of the header line from the facts. */
export function freshnessState(f: { accounts: number; broker: BrokerCheck | null; lastSyncedAt: string | null; dayClosedAt: Date }): FreshnessState {
  if (f.accounts === 0) return "no_account";
  if (f.broker && f.broker.status !== "ok") return "mismatch";
  if (f.broker?.status === "ok") return "ok";
  if (!f.lastSyncedAt || Date.parse(f.lastSyncedAt) < f.dayClosedAt.getTime()) return "behind";
  return "ok";
}

const STATUS_RANK: Record<BrokerCheck["status"], number> = { ok: 0, missing_broker: 1, mismatch: 2, missing_ours: 3 };

/** Pure: one check over the trader's accounts (the worst status; acknowledged rows count as ok). */
export function mergeBrokerRows(rows: Array<{ status: string; diff: unknown; acknowledged: boolean; checked_at: unknown }>): BrokerCheck | null {
  if (!rows.length) return null;
  let status: BrokerCheck["status"] = "ok";
  let diff = 0;
  let checkedAt: string | null = null;
  for (const r of rows) {
    const st = (r.acknowledged ? "ok" : r.status) as BrokerCheck["status"];
    if ((STATUS_RANK[st] ?? 0) > STATUS_RANK[status]) status = st;
    if (!r.acknowledged) diff += Number(r.diff) || 0;
    const at = r.checked_at ? new Date(String(r.checked_at)).toISOString() : null;
    if (at && (!checkedAt || at > checkedAt)) checkedAt = at;
  }
  return { status, diff: Math.round(diff * 100) / 100, checkedAt };
}

export async function myFreshness(trader: string, now: Date = new Date()): Promise<MyFreshness> {
  const day = await lastFinishedDay(now);
  const close = closeDateSql("t");
  const [acc, trades, recon] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n, MAX(last_synced_at) AS last FROM propreports_accounts WHERE trader = $1 AND active IS NOT FALSE`, [trader]),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE ${close} = $2)::int AS n, MAX(${close}) AS last_day, MAX(t.synced_at) AS last_sync
         FROM trades t
        WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closedSql("t")}
          AND (t.source = 'propreports' OR t.context_snapshot ->> 'source' = 'propreports')`,
      [trader, day],
    ),
    pool.query(
      `SELECT status, diff, acknowledged_at IS NOT NULL AS acknowledged, checked_at FROM propreports_reconcile_days WHERE trader = $1 AND date = $2`,
      [trader, day],
    ).catch(() => ({ rows: [] as any[] })),
  ]);
  const a = acc.rows[0] ?? {};
  const t = trades.rows[0] ?? {};
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  const syncs = [iso(a.last), iso(t.last_sync)].filter((x): x is string => !!x).sort();
  const lastSyncedAt = syncs.length ? syncs[syncs.length - 1]! : null;
  const broker = mergeBrokerRows(recon.rows as any[]);
  const accounts = Number(a.n) || 0;
  const s = await sessionFor(day);
  return {
    day,
    trades: Number(t.n) || 0,
    lastTradeDate: t.last_day ? String(t.last_day).slice(0, 10) : null,
    lastSyncedAt,
    accounts,
    broker,
    state: freshnessState({ accounts, broker, lastSyncedAt, dayClosedAt: nyInstant(day, s.closeMin) }),
  };
}
