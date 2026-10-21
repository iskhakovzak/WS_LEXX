/**
 * «Кабинет куратора»: the roster a reader works with (my wards / the whole readable desk) and the per-trader signal
 * shape of /curator/traders. Split out of routes/curator.ts.
 */
import type { Request } from "express";
import { pool } from "@workspace/db";
import { readScope } from "./permissions";
import { groupMembersOf } from "./people/deskGroups";
import type { NextAction, WeekPoint } from "./curatorLogic";

/** Read from an optional module's table: any SQL error (table not created yet) → no rows. */
export async function safe<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const { rows } = await pool.query(sql, params);
    return rows as T[];
  } catch {
    return [];
  }
}

// ─── roster ─────────────────────────────────────────────────────────────────

export type Roster = { traders: string[]; scope: "mine" | "desk"; wards: string[] };

/**
 * «Моя группа / Все» (Волна 1 п. 1.19): `wanted` = mine | group → my people (the traders of the desk groups I lead +
 * the traders assigned to me), desk | all → the whole readable desk; nothing → my people when I have any.
 */
export async function loadRoster(req: Request, wanted: unknown): Promise<Roster> {
  const me = req.authUser!.name;
  const [users, readable, group] = await Promise.all([
    safe<{ name: string; role: string; ac: string | null; am: string | null; ar: string | null }>(
      `SELECT name, role, assigned_curator AS ac, assigned_mentor AS am, assigned_risk_manager AS ar
         FROM users WHERE active = true AND COALESCE(banned, false) = false`,
    ),
    readScope(req, "journal.review"),
    groupMembersOf(me).catch(() => [] as string[]),
  ]);
  let traders = users.filter((u) => u.role === "trader").map((u) => u.name);
  if (readable !== null) traders = traders.filter((t) => readable.includes(t));
  const inGroup = new Set(group);
  const wards = traders.filter((t) => {
    const u = users.find((x) => x.name === t);
    return inGroup.has(t) || (!!u && (u.ac === me || u.am === me || u.ar === me));
  });
  const want = wanted === "group" ? "mine" : wanted === "all" ? "desk" : wanted;
  const scope: "mine" | "desk" = want === "desk" ? "desk" : want === "mine" ? "mine" : wards.length ? "mine" : "desk";
  const list = scope === "mine" && wards.length ? wards : scope === "mine" ? [] : traders;
  return { traders: list.sort((a, b) => a.localeCompare(b, "ru")), scope, wards };
}

// ─── per-trader signals ─────────────────────────────────────────────────────

export type TraderSignal = {
  trader: string;
  stage: { key: string | null; label: string | null; since: string | null };
  tier: string | null;
  tierName: string | null;
  risk: {
    status: string; state: string; label: string; message: string; halted: boolean; nearStop: boolean;
    dailyPct: number | null; weeklyPct: number | null; drawdownPct: number | null;
    todayPnl: number | null; todayTrades: number; weekPnl: number | null; openPositions: number;
    hasLimits: boolean; templateDrift: string[];
  };
  trend: WeekPoint[];
  trendDir: "up" | "down" | "flat" | "none";
  discipline: { value: number | null; eodAvg: number | null; ratingAvg: number | null; n: number };
  /** today: null = no plan; available=false — the game-plan module is not set up on this server (do not flag). */
  plan: { today: "ready" | "draft" | null; available: boolean };
  eod: { prevDay: string; prevTraded: boolean; prevClosed: boolean; todayTraded: boolean; todayClosed: boolean; pending: number; lastClosed: string | null; lastReviewedAt: string | null; lastScore: number | null };
  weekly: { currentStatus: string | null; submittedPending: boolean; lastReviewedWeek: string | null; lastReviewedAt: string | null };
  academy: { openActions: number; overdueActions: number; lastOneOnOne: string | null; daysSinceOneOnOne: number | null; pendingSubmissions: number; activeGoals: number };
  /** week — breach alerts since Monday (NY). */
  breaches: { unreviewed: number; last30: number; week: number; lastDate: string | null };
  lastNote: { body: string; author: string; createdAt: string } | null;
  lastTradeDate: string | null;
  /** Trading days since the last trade day up to `date` (weekends and full-day holidays skipped; Fri → Mon = 1). */
  idleTradingDays: number | null;
  nextAction: NextAction;
  /** users.assigned_curator — the trader's group («Группа» = traders of one curator); null = «Без куратора». */
  curator: string | null;
  /** users.name_latin — optional Latin alias for cross-script search. */
  nameLatin: string | null;
  /** Calendar month to date (NY trading days): net P&L (null = no $ data) and trades. */
  month: { pnl: number | null; trades: number };
  /** Latest sign of life: activity log, closed day, weekly report or trade day (ISO / YYYY-MM-DD). */
  lastActivityAt: string | null;
};
