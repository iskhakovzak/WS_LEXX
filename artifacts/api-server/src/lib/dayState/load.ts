/**
 * The day state, DB side: facts for lib/dayState/model resolveState. Every number is read from what already exists —
 *   stop          routes/risk deskSnapshot (the same computeMetrics inputs as GET /risk/me, i.e. the dashboard hero);
 *   trade days    the same snapshot's daily rows (lib/riskData loadDaily: broker rows win, close date);
 *   silence       lib/eodLogic tradingDaysAfter over lib/curatorStore marketClosedDays (the curator's idleTradingDays);
 *   reviews       eod_days.closed_at (the journal's close);
 *   phase         lib/marketDays sessionFor (NYSE holidays and early closes).
 * The only count of its own is the number of closed trades (lib/tradeMath closedSql) for the newcomer path.
 */
import { pool } from "@workspace/db";
import { addDays, nyDate, nyMinutes, OPEN_MIN } from "../tradingDate";
import { sessionFor } from "../marketDays";
import { marketClosedDays } from "../curatorStore";
import { closedSql } from "../tradeMath";
import { setting } from "../settings/registry";
import type { Lang } from "../../i18n";
import { BACKLOG_WINDOW_DAYS, resolveState, type DayPhase, type DayStateCfg, type TraderState } from "./model";

export function dayStateCfg(): DayStateCfg {
  return {
    pausedDays: setting("dayState.pausedDays"),
    newcomerTrades: setting("dayState.newcomerTrades"),
    newcomerMaxDays: setting("dayState.newcomerMaxDays"),
    staleStepDays: setting("dayState.staleStepDays"),
  };
}

/** NY phase of `today` at `now` (early closes end the session at 13:00; weekends / holidays are «closed»). */
export async function phaseOf(today: string, now: Date = new Date()): Promise<DayPhase> {
  const s = await sessionFor(today);
  if (s.closed) return "closed";
  if (today !== nyDate(now)) return "afterclose"; // a past date: its session is over
  const m = nyMinutes(now);
  if (m < OPEN_MIN) return "premarket";
  return m < s.closeMin ? "session" : "afterclose";
}

type Meta = { role: string; ageDays: number | null; closed: number };

async function loadMeta(names: readonly string[]): Promise<Map<string, Meta>> {
  const [users, counts] = await Promise.all([
    pool.query<{ name: string; role: string; age: number | null }>(
      `SELECT name, role, EXTRACT(DAY FROM now() - created_at)::int AS age FROM users WHERE name = ANY($1::text[])`,
      [names],
    ),
    pool.query<{ trader: string; n: number }>(
      `SELECT t.trader, COUNT(*)::int AS n FROM trades t
        WHERE t.deleted_at IS NULL AND t.trader = ANY($1::text[]) AND ${closedSql("t")} GROUP BY t.trader`,
      [names],
    ),
  ]);
  const closed = new Map(counts.rows.map((r) => [String(r.trader), Number(r.n) || 0]));
  return new Map(users.rows.map((u) => [String(u.name), { role: String(u.role), ageDays: u.age == null ? null : Number(u.age), closed: closed.get(String(u.name)) ?? 0 }]));
}

async function loadClosedReviews(names: readonly string[], today: string): Promise<Map<string, Set<string>>> {
  const { rows } = await pool
    .query<{ trader: string; date: string }>(
      `SELECT trader, date FROM eod_days WHERE trader = ANY($1::text[]) AND closed_at IS NOT NULL AND date >= $2`,
      [names, addDays(today, -(BACKLOG_WINDOW_DAYS + 7))],
    )
    .catch(() => ({ rows: [] as { trader: string; date: string }[] }));
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = out.get(r.trader) ?? new Set<string>();
    set.add(String(r.date).slice(0, 10));
    out.set(r.trader, set);
  }
  return out;
}

const isStaff = (role: string | undefined) => role === "admin" || role === "curator";

/**
 * Day states of `names` (one name: the viewer's own; several: a curator's team). Unknown names are skipped.
 * `today` is the NY trading date; `now` decides the phase.
 */
export async function traderStates(names: readonly string[], opts: { today?: string; now?: Date; lang?: Lang } = {}): Promise<TraderState[]> {
  const list = [...new Set(names.filter(Boolean))];
  if (!list.length) return [];
  const now = opts.now ?? new Date();
  const today = opts.today ?? nyDate(now);
  const { deskSnapshot } = await import("../../routes/risk");
  const [snap, meta, reviews, marketClosed, phase] = await Promise.all([
    list.length === 1 ? deskSnapshot(today, list[0], opts.lang ?? "ru") : deskSnapshot(today, null, opts.lang ?? "ru", list),
    loadMeta(list),
    loadClosedReviews(list, today),
    marketClosedDays(today),
    phaseOf(today, now),
  ]);
  const rows = new Map(snap.rows.map((r) => [r.trader, r]));
  const cfg = dayStateCfg();
  const out: TraderState[] = [];
  for (const name of list) {
    const m = meta.get(name);
    if (!m) continue;
    const row = rows.get(name);
    const halted = row?.metrics.stop.halted ?? false;
    out.push(resolveState({
      trader: name,
      today,
      phase,
      staff: isStaff(m.role),
      halted,
      stopState: halted ? (row?.metrics.stop.state ?? "stop") : null,
      closedTrades: m.closed,
      accountAgeDays: m.ageDays,
      tradeDays: (row?.days ?? []).map((d) => ({ date: d.date, trades: d.trades, pnl: d.pnl })),
      closedReviewDays: reviews.get(name) ?? new Set(),
      marketClosed,
    }, cfg));
  }
  return out;
}

/** Active, not banned traders (role trader) — the desk the silence job and the team view look at. */
export async function activeTraders(): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM users WHERE active = true AND role = 'trader' AND COALESCE(banned, false) = false ORDER BY name`,
  );
  return rows.map((r) => r.name);
}
