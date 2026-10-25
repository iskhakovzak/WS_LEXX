/**
 * Profile loaders — read-only SQL over stored data (trades, rules, limits, ladder, medals, interventions). No writes,
 * no provider calls. Optional tables (academy_*, curator_interventions, edge_map) read as empty when missing.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { closeDateSql, closedSql, horizonSql, netPnlSql, resultSql } from "../tradeMath";
import type { ProfileTrade, RiskLimits } from "./types";

const CLOSE_DAY = `substring(${closeDateSql("t")} from 1 for 10)`;
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

type Row = Record<string, unknown>;

/** A missing optional table / column is an empty source, never a 500. */
async function optional(label: string, sql: string, params: unknown[]): Promise<Row[]> {
  try {
    return (await pool.query(sql, params)).rows as Row[];
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "42P01" && code !== "42703") logger.warn({ err, label }, "profile: source read failed");
    return [];
  }
}

export type PersonRow = {
  id: number; name: string; nameLatin: string | null; role: string; joinedAt: string | null;
  curator: string | null; mentor: string | null; quoteFavs: string[];
};

const PERSON_COLS = `id, name, name_latin, role, to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS joined,
  assigned_curator, assigned_mentor, settings->'quotes'->'favs' AS favs`;

function personOf(r: Row | undefined): PersonRow | null {
  if (!r) return null;
  const favs = Array.isArray(r.favs) ? (r.favs as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 12) : [];
  return {
    id: Number(r.id), name: String(r.name), nameLatin: (r.name_latin as string | null) ?? null, role: String(r.role),
    joinedAt: (r.joined as string | null) ?? null, curator: (r.assigned_curator as string | null) ?? null,
    mentor: (r.assigned_mentor as string | null) ?? null, quoteFavs: favs,
  };
}

/** An active, not banned member by id. */
export async function personById(id: number): Promise<PersonRow | null> {
  const { rows } = await pool.query(`SELECT ${PERSON_COLS} FROM users WHERE id = $1 AND active = true AND COALESCE(banned, false) = false`, [id]);
  return personOf(rows[0]);
}

export async function personByName(name: string): Promise<PersonRow | null> {
  const { rows } = await pool.query(`SELECT ${PERSON_COLS} FROM users WHERE name = $1 AND active = true AND COALESCE(banned, false) = false`, [name]);
  return personOf(rows[0]);
}

type TradeRow = {
  trader: string; day: string; entry_sec: unknown; day_seq: unknown; net: unknown; result: string; side: string; horizon: string;
  hold_sec: unknown; ticker: string; setup: string | null; entry: unknown;
};

function tradeOf(r: TradeRow): ProfileTrade {
  const entrySec = num(r.entry_sec);
  const result = r.result === "win" || r.result === "loss" ? r.result : "be";
  const horizon = r.horizon === "overnight" || r.horizon === "swing" ? r.horizon : "intraday";
  return {
    day: r.day, seq: entrySec ?? (num(r.day_seq) ?? 0), net: num(r.net) ?? 0, result,
    side: r.side.startsWith("s") ? "short" : r.side.startsWith("l") ? "long" : null, horizon,
    holdSec: num(r.hold_sec), entrySec, ticker: r.ticker, setup: r.setup?.trim() ? r.setup.trim() : null, price: num(r.entry),
  };
}

const TRADE_COLS = `t.trader, ${CLOSE_DAY} AS day, t.entry_sec, t.day_seq, ${netPnlSql("t")}::float8 AS net, ${resultSql("t")} AS result,
  LOWER(TRIM(COALESCE(t.side, ''))) AS side, ${horizonSql("t")} AS horizon, t.hold_sec, UPPER(TRIM(COALESCE(t.ticker, ''))) AS ticker,
  t.setup, t.entry::float8 AS entry`;
const TRADE_WHERE = `t.deleted_at IS NULL AND t.pnl IS NOT NULL AND ${closedSql("t")} AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}'`;

/** Every closed trade of one trader, oldest first. */
export async function careerTrades(trader: string): Promise<ProfileTrade[]> {
  const { rows } = await pool.query<TradeRow>(
    `SELECT ${TRADE_COLS} FROM trades t WHERE t.trader = $1 AND ${TRADE_WHERE} ORDER BY day, t.entry_sec NULLS LAST, t.id`,
    [trader],
  );
  return rows.map(tradeOf);
}

/** Closed trades of every active member in the window [from, today], grouped by trader (the desk comparison). */
export async function deskWindowTrades(from: string): Promise<Map<string, ProfileTrade[]>> {
  const { rows } = await pool.query<TradeRow>(
    `SELECT ${TRADE_COLS} FROM trades t
       JOIN users u ON u.name = t.trader AND u.active = true AND COALESCE(u.banned, false) = false
      WHERE ${TRADE_WHERE} AND ${CLOSE_DAY} >= $1
      ORDER BY t.trader, day, t.entry_sec NULLS LAST, t.id`,
    [from],
  );
  const out = new Map<string, ProfileTrade[]>();
  for (const r of rows) {
    const list = out.get(r.trader) ?? [];
    list.push(tradeOf(r));
    out.set(r.trader, list);
  }
  return out;
}

/** First trade's ticker (the biography's opening line). */
export async function firstTrade(trader: string): Promise<{ day: string; ticker: string } | null> {
  const { rows } = await pool.query<{ day: string; ticker: string }>(
    `SELECT LEFT(t.date, 10) AS day, UPPER(TRIM(COALESCE(t.ticker, ''))) AS ticker FROM trades t
      WHERE t.trader = $1 AND t.deleted_at IS NULL AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}' ORDER BY t.date, t.id LIMIT 1`,
    [trader],
  );
  return rows[0] ?? null;
}

/** Violations (not archived) per trader since `from`; plus the NY days with a violation of `subject` (all time). */
export async function violations(from: string, subject: string): Promise<{ counts: Map<string, number>; subjectDays: Set<string> }> {
  const [counts, days] = await Promise.all([
    optional("violations", `SELECT trader, COUNT(*)::int AS n FROM rule_violations
       WHERE archived_at IS NULL AND COALESCE(day, to_char(occurred_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')) >= $1 GROUP BY trader`, [from]),
    optional("violation days", `SELECT DISTINCT COALESCE(day, to_char(occurred_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')) AS d
       FROM rule_violations WHERE archived_at IS NULL AND trader = $1`, [subject]),
  ]);
  return {
    counts: new Map(counts.map((r) => [String(r.trader), Number(r.n) || 0])),
    subjectDays: new Set(days.map((r) => String(r.d).slice(0, 10))),
  };
}

/** Enabled rules per trader. */
export async function activeRules(): Promise<Map<string, number>> {
  const rows = await optional("rules", `SELECT trader, COUNT(*)::int AS n FROM trading_rules WHERE enabled = true AND deleted_at IS NULL GROUP BY trader`, []);
  return new Map(rows.map((r) => [String(r.trader), Number(r.n) || 0]));
}

/** Daily stop and drawdown limit per trader. */
export async function riskLimits(): Promise<Map<string, RiskLimits>> {
  const rows = await optional("limits", `SELECT trader, daily_loss_limit, max_drawdown FROM trader_risk_limits`, []);
  return new Map(rows.map((r) => [String(r.trader), { dailyLoss: num(r.daily_loss_limit), maxDrawdown: num(r.max_drawdown) }]));
}

export type HistoryRows = {
  stages: { day: string; from: string | null; to: string; action: string }[];
  readiness: { day: string; stage: string }[];
  achievements: { day: string; line: string; tier: string }[];
  rules: { day: string; kind: string; origin: string }[];
  accounts: string[];
};

const NY_DAY = (col: string) => `to_char(${col} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`;

/** The biography's dated sources of one trader. */
export async function history(trader: string): Promise<HistoryRows> {
  const [stages, readiness, achievements, rules, accounts] = await Promise.all([
    optional("stage history", `SELECT ${NY_DAY("created_at")} AS day, from_stage, to_stage, action FROM academy_stage_history
       WHERE user_name = $1 ORDER BY created_at, id`, [trader]),
    optional("readiness", `SELECT ${NY_DAY("notified_at")} AS day, stage FROM academy_readiness_notices WHERE user_name = $1 ORDER BY notified_at`, [trader]),
    optional("achievements", `SELECT earned_on AS day, line, tier FROM trader_achievements WHERE trader = $1 ORDER BY earned_on`, [trader]),
    optional("rules", `SELECT ${NY_DAY("created_at")} AS day, kind, origin FROM trading_rules WHERE trader = $1 AND deleted_at IS NULL ORDER BY created_at`, [trader]),
    optional("accounts", `SELECT COALESCE(NULLIF(account_name, ''), account) AS label FROM propreports_accounts WHERE trader = $1 AND active = true ORDER BY account`, [trader]),
  ]);
  return {
    stages: stages.map((r) => ({ day: String(r.day), from: (r.from_stage as string | null) ?? null, to: String(r.to_stage), action: String(r.action) })),
    readiness: readiness.map((r) => ({ day: String(r.day), stage: String(r.stage) })),
    achievements: achievements.map((r) => ({ day: String(r.day).slice(0, 10), line: String(r.line), tier: String(r.tier) })),
    rules: rules.map((r) => ({ day: String(r.day), kind: String(r.kind), origin: String(r.origin) })),
    accounts: accounts.map((r) => String(r.label)),
  };
}

/** Curator-authored interventions (detector rows excluded) — staff views only. */
export async function curatorSteps(trader: string): Promise<{ day: string; kind: string; trigger: string }[]> {
  const rows = await optional("interventions", `SELECT to_char(started_on, 'YYYY-MM-DD') AS day, kind, trigger FROM curator_interventions
     WHERE trader = $1 AND author IS NOT NULL AND author <> 'system' AND author <> trader ORDER BY started_on DESC, id DESC LIMIT 50`, [trader]);
  return rows.map((r) => ({ day: String(r.day), kind: String(r.kind), trigger: String(r.trigger) }));
}

/** Ids of members by name (the peer link). */
export async function idsOf(names: readonly string[]): Promise<Map<string, number>> {
  if (!names.length) return new Map();
  const { rows } = await pool.query<{ id: number; name: string }>(`SELECT id, name FROM users WHERE name = ANY($1::text[])`, [names]);
  return new Map(rows.map((r) => [r.name, Number(r.id)]));
}
