/**
 * I/O of «Цена джуна до безубытка»: loads the juniors (members with the role trader — deactivated ones too, survival
 * needs the ones who stopped), their daily net / fees / gross, the academy enrolment (start, cohort, mentor, dropped),
 * and the practices of «что окупается» (trainer sessions, passed exams, 1:1 meetings, «по плану» answers); runs the pure
 * builders and caches the desk result for CACHE_MS per (NY day, settings). GET never writes.
 *
 * Settings (Админка → Настройки → Академия): academy.juniorCost.seatUsdMonth (desk cost of a seat per month, default 0)
 * and academy.juniorCost.stableDays (the breakeven window, default 20 own trading days).
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { closeDateSql, netPnlSql } from "../tradeMath";
import { nyDate } from "../tradingDate";
import type { Activity } from "./attribution";
import type { GroupKeys } from "./cohorts";
import { buildDesk, type DeskJuniorInput, type DeskResult } from "./desk";
import { juniorPath, type DayPnl, type JuniorPath } from "./path";

const CACHE_MS = 15 * 60_000;
const FIRST_DAY_MS = 60 * 60_000;

type Row = Record<string, unknown>;
const soft = async (sql: string, params: unknown[] = []): Promise<Row[]> => {
  try {
    return (await pool.query(sql, params)).rows as Row[];
  } catch (err) {
    logger.warn({ err }, "junior-cost: optional source failed");
    return [];
  }
};
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const NY = (col: string) => `to_char(${col} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`;

export function juniorCostSettings(): { seatUsdMonth: number; stableDays: number } {
  return { seatUsdMonth: setting("academy.juniorCost.seatUsdMonth"), stableDays: setting("academy.juniorCost.stableDays") };
}

let firstDay: { at: number; value: Promise<string | null> } | null = null;
/** The desk's first closed trade day in the database (the truncation reference). */
function deskFirstDay(): Promise<string | null> {
  if (!firstDay || Date.now() - firstDay.at > FIRST_DAY_MS) {
    const value = soft(`SELECT MIN(LEFT(${closeDateSql("t")}, 10)) AS d FROM trades t WHERE t.deleted_at IS NULL AND t.pnl IS NOT NULL`).then((r) => str(r[0]?.d));
    firstDay = { at: Date.now(), value };
  }
  return firstDay.value;
}

async function dailyRows(names: readonly string[] | null, asOf: string): Promise<Map<string, DayPnl[]>> {
  const rows = await soft(
    `SELECT t.trader, LEFT(${closeDateSql("t")}, 10) AS day,
            SUM(${netPnlSql("t")})::float8 AS net, SUM(ABS(COALESCE(t.fees, 0)))::float8 AS fees, SUM(t.pnl)::float8 AS gross
       FROM trades t
      WHERE t.deleted_at IS NULL AND t.pnl IS NOT NULL AND LOWER(TRIM(t.result)) <> 'open'
        AND LEFT(${closeDateSql("t")}, 10) <= $1 ${names ? "AND t.trader = ANY($2::text[])" : ""}
      GROUP BY 1, 2`,
    names ? [asOf, names] : [asOf],
  );
  const out = new Map<string, DayPnl[]>();
  for (const r of rows) {
    const k = String(r.trader);
    out.set(k, [...(out.get(k) ?? []), { day: String(r.day), net: Number(r.net), fees: Number(r.fees), gross: Number(r.gross) }]);
  }
  return out;
}

type Enrolment = { cohort: string | null; start: string | null; mentor: string | null; dropped: boolean };
/** The earliest live enrolment per member: academy start = GREATEST(cohort start, joined_on) — a late joiner starts when they joined. */
async function enrolments(names: readonly string[] | null): Promise<Map<string, Enrolment>> {
  const rows = await soft(
    `SELECT e.user_name, c.name AS cohort, NULLIF(TRIM(c.mentor), '') AS mentor,
            to_char(GREATEST(COALESCE(c.starts_on, e.joined_on), e.joined_on), 'YYYY-MM-DD') AS start,
            BOOL_AND(e.status = 'dropped') OVER (PARTITION BY e.user_name) AS dropped,
            ROW_NUMBER() OVER (PARTITION BY e.user_name ORDER BY GREATEST(COALESCE(c.starts_on, e.joined_on), e.joined_on), e.id) AS rn
       FROM academy_enrollments e JOIN academy_cohorts c ON c.id = e.cohort_id
      WHERE e.archived_at IS NULL ${names ? "AND e.user_name = ANY($1::text[])" : ""}`,
    names ? [names] : [],
  );
  const out = new Map<string, Enrolment>();
  for (const r of rows) if (Number(r.rn) === 1) out.set(String(r.user_name), { cohort: str(r.cohort), start: str(r.start), mentor: str(r.mentor), dropped: r.dropped === true });
  return out;
}

type Person = { name: string; deactivated: boolean; curator: string | null };
async function people(names: readonly string[] | null): Promise<Person[]> {
  const rows = await soft(
    `SELECT name, (NOT active OR COALESCE(banned, false)) AS off,
            COALESCE(NULLIF(TRIM(assigned_curator), ''), NULLIF(TRIM(assigned_mentor), '')) AS curator
       FROM users WHERE ${names ? "name = ANY($1::text[])" : "role = 'trader'"}`,
    names ? [names] : [],
  );
  return rows.map((r) => ({ name: String(r.name), deactivated: r.off === true, curator: str(r.curator) }));
}

/** Practices of «что окупается» for every member (dates are NY days). */
async function activities(): Promise<Map<string, Activity>> {
  const [trainer, exams, meets, plans] = await Promise.all([
    soft(`SELECT u.name, ${NY("g.finished_at")} AS day FROM sim_games g JOIN users u ON u.id = g.user_id
           WHERE g.status = 'finished' AND g.finished_at IS NOT NULL
          UNION ALL
          SELECT d.trader AS name, d.day FROM (SELECT DISTINCT trader, ${NY("created_at")} AS day FROM trainer_drill_attempts) d`),
    soft(`SELECT user_name AS name, ${NY("MIN(submitted_at)")} AS day FROM academy_quiz_attempts WHERE passed GROUP BY user_name, quiz_id`),
    soft(`SELECT student AS name, ${NY("met_at")} AS day FROM academy_one_on_ones WHERE archived_at IS NULL`),
    soft(`SELECT trader AS name, to_char(day, 'YYYY-MM-DD') AS day, followed_plan AS followed FROM journal_days WHERE followed_plan IS NOT NULL
          UNION ALL
          SELECT r.trader AS name, LEFT(${closeDateSql("t")}, 10) AS day, r.followed_plan AS followed
            FROM eod_trade_reviews r JOIN trades t ON t.id = r.trade_id WHERE r.followed_plan IS NOT NULL AND t.deleted_at IS NULL`),
  ]);
  const out = new Map<string, { trainer: string[]; exams: string[]; oneOnOnes: string[]; plans: { day: string; followed: boolean }[] }>();
  const of = (n: unknown) => {
    const k = String(n);
    let a = out.get(k);
    if (!a) { a = { trainer: [], exams: [], oneOnOnes: [], plans: [] }; out.set(k, a); }
    return a;
  };
  for (const r of trainer) if (r.day) of(r.name).trainer.push(String(r.day));
  for (const r of exams) if (r.day) of(r.name).exams.push(String(r.day));
  for (const r of meets) if (r.day) of(r.name).oneOnOnes.push(String(r.day));
  for (const r of plans) if (r.day) of(r.name).plans.push({ day: String(r.day), followed: r.followed === true });
  return out;
}

const EMPTY: Activity = { trainer: [], exams: [], oneOnOnes: [], plans: [] };

async function buildNow(asOf: string, s: { seatUsdMonth: number; stableDays: number }): Promise<DeskResult> {
  const t0 = Date.now();
  const [persons, daily, enr, acts, first] = await Promise.all([people(null), dailyRows(null, asOf), enrolments(null), activities(), deskFirstDay()]);
  const juniors: DeskJuniorInput[] = [];
  for (const p of persons) {
    const e = enr.get(p.name);
    const days = daily.get(p.name) ?? [];
    if (!days.length && !e) continue;
    const keys: GroupKeys = { cohort: e?.cohort ?? null, month: null, curator: p.curator ?? e?.mentor ?? null };
    juniors.push({ input: { name: p.name, days, academyStart: e?.start ?? null, deactivated: p.deactivated || !!e?.dropped }, keys, activity: acts.get(p.name) ?? EMPTY });
  }
  const res = buildDesk({ asOf, deskFirstDay: first, ...s, juniors });
  logger.info({ ms: Date.now() - t0, juniors: res.counts.juniors }, "junior-cost: built");
  return res;
}

let cache: { key: string; at: number; value: Promise<DeskResult> } | null = null;

/** The desk result (every junior, every $) — scope it per viewer before sending (desk.ts scopeDesk). */
export function deskJuniorCost(now = Date.now()): Promise<DeskResult> {
  const asOf = nyDate();
  const s = juniorCostSettings();
  const key = `${asOf}|${s.seatUsdMonth}|${s.stableDays}`;
  if (cache && cache.key === key && now - cache.at < CACHE_MS) return cache.value;
  const entry = { key, at: now, value: buildNow(asOf, s) };
  cache = entry;
  entry.value.catch(() => { if (cache === entry) cache = null; });
  return entry.value;
}

/** One member's path with its curve (any role: staff trade too). */
export async function traderJuniorCost(name: string): Promise<JuniorPath> {
  const asOf = nyDate();
  const s = juniorCostSettings();
  const [persons, daily, enr, first] = await Promise.all([people([name]), dailyRows([name], asOf), enrolments([name]), deskFirstDay()]);
  const e = enr.get(name);
  return juniorPath(
    { name, days: daily.get(name) ?? [], academyStart: e?.start ?? null, deactivated: (persons[0]?.deactivated ?? false) || !!e?.dropped },
    { asOf, ...s, deskFirstDay: first },
  );
}
