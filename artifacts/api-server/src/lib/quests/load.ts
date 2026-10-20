/**
 * Quests and achievements — DB loaders: everything the pure rules (achievements.ts, catalog.ts) read for one trader.
 * Also serves the discipline badges' old inputs (reviewed days, focus verdicts, stop days, own replays) — the daily
 * rewards (lib/daily/rewards.ts) evaluate through lib/quests/service.ts now.
 *
 * Every optional source (academy tables created by their routes, quest_events) degrades to «no data» instead of failing.
 */
import { pool } from "@workspace/db";
import { loadBehaviorRows, rowToBehaviorTrade } from "../../routes/behavior";
import { fetchRiskLimits } from "../rulesEngine";
import { addDays, isWeekend, nyDate, nyMinutes } from "../tradingDate";
import { netPnlSql } from "../tradeMath";
import { setting } from "../settings/registry";
import { dayPath, windowDays } from "../daily/detectors";
import { disciplineSummary, lastFinishedDay, loadPlanContracts, planContractOf, type LedgerDay } from "../daily/discipline";
import type { FocusDay, OwnGame, ReviewDay, StopDay } from "../daily/badges";
import type { DisciplineSummary } from "../daily/types";
import type { AchievementInput } from "./achievements";
import type { QuestData } from "./catalog";
import { tagDays } from "../playbookToday/untagged";
import { viewerTier } from "../playbookToday/tier";

const none = <T>() => ({ rows: [] as T[] });
const loadTradesOf = (trader: string) => async (from: string, to: string) => (await loadBehaviorRows(trader, from, to)).map(rowToBehaviorTrade);

/** Scaling ladder rank above the trainee (tier_up line): 1 Джун, 2 Трейдер, 3 Сеньор (lead counts as above). */
export const TIER_RANK: Readonly<Record<string, number>> = { trainee: 0, junior: 1, trader: 2, senior: 3, lead: 4 };

const TRADED_DAYS = `SELECT DISTINCT substring(date, 1, 10) AS d FROM trades WHERE trader = $1 AND deleted_at IS NULL AND substring(date, 1, 10) <= $2`;

/**
 * Traded days (all time) with the NY day each was closed. «Closed» is the one rule of lib/daily/service isDayClosed
 * (ILYA-06): the dashboard evening card marked reviewed (daily_reviews.reviewed_at) OR the journal «Закрыть день»
 * (eod_days.closed_at) — whichever came first, because «on time» needs the day. eod_days is created by its route: on a
 * database without it the review rows alone are read.
 */
export async function reviewDays(trader: string, asOf: string): Promise<ReviewDay[]> {
  const ny = (col: string) => `to_char(${col} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`;
  const withJournal = `
    SELECT t.d, ${ny("LEAST(r.reviewed_at, e.closed_at)")} AS reviewed_on
      FROM (${TRADED_DAYS}) t
      LEFT JOIN daily_reviews r ON r.trader = $1 AND r.date = t.d
      LEFT JOIN (SELECT date, MIN(closed_at) AS closed_at FROM eod_days WHERE trader = $1 AND closed_at IS NOT NULL GROUP BY date) e ON e.date = t.d
     ORDER BY t.d`;
  const reviewsOnly = `
    SELECT t.d, ${ny("r.reviewed_at")} AS reviewed_on FROM (${TRADED_DAYS}) t
      LEFT JOIN daily_reviews r ON r.trader = $1 AND r.date = t.d ORDER BY t.d`;
  const { rows } = await pool
    .query<{ d: string; reviewed_on: string | null }>(withJournal, [trader, asOf])
    .catch((err) => {
      if ((err as { code?: string })?.code !== "42P01") throw err; // eod_days missing → reviews only
      return pool.query<{ d: string; reviewed_on: string | null }>(reviewsOnly, [trader, asOf]);
    });
  return rows.map((r) => ({ date: String(r.d), reviewedOn: r.reviewed_on }));
}

export async function focusDays(trader: string, asOf: string): Promise<FocusDay[]> {
  const { rows } = await pool.query<{ date: string; status: string | null; disputed: boolean }>(
    `SELECT date, verdict #>> '{focus,status}' AS status, disputed FROM daily_reviews
      WHERE trader = $1 AND date <= $2 AND verdict #>> '{focus,status}' IS NOT NULL ORDER BY date`,
    [trader, asOf],
  );
  return rows.map((r) => ({ date: String(r.date), status: String(r.status), disputed: !!r.disputed }));
}

/** Traded days of [from, asOf]: worst running net and the daily stop (the day's plan, else the risk limit). */
export async function stopDays(trader: string, from: string, asOf: string): Promise<{ days: StopDay[]; stopKnown: boolean }> {
  const plansFrom = addDays(asOf, -40) < from ? addDays(asOf, -40) : from;
  const [trades, plans, limits] = await Promise.all([loadTradesOf(trader)(from, asOf), loadPlanContracts(trader, plansFrom, asOf), fetchRiskLimits(trader)]);
  const days: StopDay[] = [];
  for (const [date, list] of windowDays(trades, from, asOf)) {
    const plan = plans.get(date)?.maxLossUsd ?? null;
    const limit = plan != null && plan > 0 ? plan : (limits.dailyLossLimit ?? null);
    days.push({ date, trough: dayPath(list).trough, limit: limit != null && limit > 0 ? limit : null });
  }
  const recentPlanStop = [...plans].some(([d, c]) => d >= addDays(asOf, -40) && (c.maxLossUsd ?? 0) > 0);
  return { days, stopKnown: (limits.dailyLossLimit ?? 0) > 0 || recentPlanStop };
}

export async function ownGames(trader: string): Promise<OwnGame[]> {
  const { rows } = await pool
    .query<{ finished_on: string; verdict: string | null }>(
      `SELECT to_char(g.finished_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS finished_on, g.result #>> '{own,verdict}' AS verdict
         FROM sim_games g JOIN users u ON u.id = g.user_id
        WHERE u.name = $1 AND g.params ? 'own' AND g.status = 'finished' AND g.finished_at IS NOT NULL`,
      [trader],
    )
    .catch(() => none<{ finished_on: string; verdict: string | null }>());
  return rows.map((r) => ({ finishedOn: String(r.finished_on), verdict: r.verdict }));
}

type PlanFlags = { beforeOpen: boolean; stop: boolean; ownRule: boolean; contract: boolean };

/** A plan counts as made when it holds a contract field or any written content. */
function planHasContent(doc: unknown): boolean {
  const c = planContractOf(doc);
  if (c.maxLossUsd != null || c.maxTrades != null || c.ownRule != null) return true;
  const d = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  return text(d.focus) || text(d.marketView) || text(d.riskNotes) || (Array.isArray(d.inPlay) && d.inPlay.length > 0);
}

export async function planFlags(trader: string): Promise<Map<string, PlanFlags>> {
  const { rows } = await pool.query<{ date: string; doc: unknown; before_open: boolean }>(
    `SELECT date, doc, created_at < ((date || ' 09:30')::timestamp AT TIME ZONE 'America/New_York') AS before_open
       FROM trader_plans WHERE trader = $1 AND deleted_at IS NULL AND date ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    [trader],
  );
  const out = new Map<string, PlanFlags>();
  for (const r of rows) {
    const c = planContractOf(r.doc);
    out.set(String(r.date), {
      beforeOpen: !!r.before_open && !isWeekend(String(r.date)) && planHasContent(r.doc),
      stop: (c.maxLossUsd ?? 0) > 0,
      ownRule: c.ownRule != null,
      contract: c.maxLossUsd != null || c.maxTrades != null || c.ownRule != null,
    });
  }
  return out;
}

async function promotions(trader: string): Promise<{ date: string; rank: number }[]> {
  const { rows } = await pool
    .query<{ d: string; from_tier: string | null; to_tier: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d, from_tier, to_tier FROM scaling_history WHERE trader = $1 ORDER BY created_at`,
      [trader],
    )
    .catch(() => none<{ d: string; from_tier: string | null; to_tier: string }>());
  // A real promotion only: from a known tier to a higher one (a first assignment is not earned).
  return rows
    .filter((r) => r.from_tier != null && (TIER_RANK[r.to_tier] ?? 0) > (TIER_RANK[r.from_tier] ?? 0))
    .map((r) => ({ date: String(r.d), rank: TIER_RANK[r.to_tier] ?? 0 }));
}

/** NY days of «Найди вход» drill answers since `from` (one entry per answer; table from migration 0211). */
async function drillDays(trader: string, from: string): Promise<string[]> {
  const { rows } = await pool
    .query<{ d: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d FROM trainer_drill_attempts
        WHERE trader = $1 AND created_at >= ($2::date)::timestamp AT TIME ZONE 'America/New_York'`,
      [trader, from],
    )
    .catch(() => none<{ d: string }>());
  return rows.map((r) => String(r.d));
}

/** Challenge dates of the finished «Задача дня» games since `from` (sim_games marked params.daily — lib/trainer/dailyStore). */
async function dailyTaskDays(trader: string, from: string): Promise<string[]> {
  const { rows } = await pool
    .query<{ d: string }>(
      `SELECT DISTINCT g.params #>> '{daily,date}' AS d
         FROM sim_games g JOIN users u ON u.id = g.user_id
        WHERE u.name = $1 AND g.params ? 'daily' AND g.status = 'finished' AND g.params #>> '{daily,date}' >= $2`,
      [trader, from],
    )
    .catch(() => none<{ d: string }>());
  return rows.map((r) => String(r.d)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

async function academy(trader: string): Promise<{ lessons: string[]; exams: string[]; academy: boolean }> {
  const q = (sql: string) => pool.query<{ d: string }>(sql, [trader]).catch(() => none<{ d: string }>());
  const [lessons, exams, enrolled, anyChallenge] = await Promise.all([
    q(`SELECT to_char(completed_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d FROM academy_lesson_progress WHERE user_name = $1 AND completed_at IS NOT NULL`),
    q(`SELECT COALESCE(summary ->> 'passedOn', to_char(updated_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')) AS d FROM academy_challenges WHERE user_name = $1 AND status = 'passed' AND archived_at IS NULL`),
    q(`SELECT '1' AS d FROM academy_enrollments WHERE user_name = $1 LIMIT 1`),
    q(`SELECT '1' AS d FROM academy_challenges WHERE user_name = $1 LIMIT 1`),
  ]);
  return {
    lessons: lessons.rows.map((r) => String(r.d)),
    exams: exams.rows.map((r) => String(r.d).slice(0, 10)),
    academy: lessons.rows.length > 0 || enrolled.rows.length > 0 || anyChallenge.rows.length > 0,
  };
}

async function gamePlans(trader: string, from: string): Promise<{ date: string; readOn: string | null }[]> {
  const { rows } = await pool
    .query<{ date: string; read_on: string | null }>(
      `SELECT gp.date, to_char(MIN(r.read_at) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS read_on
         FROM game_plans gp LEFT JOIN game_plan_reads r ON r.plan_id = gp.id AND r.trader = $1
        WHERE gp.deleted_at IS NULL AND gp.date >= $2 GROUP BY gp.date`,
      [trader, from],
    )
    .catch(() => none<{ date: string; read_on: string | null }>());
  return rows.map((r) => ({ date: String(r.date), readOn: r.read_on }));
}

/** Days the trader opened «Деск на тикере» for a ticker-day they traded (quest_events, ref "TICKER|YYYY-MM-DD"). */
async function deskDayOpens(trader: string): Promise<string[]> {
  const { rows } = await pool
    .query<{ day: string }>(
      `SELECT e.day FROM quest_events e
        WHERE e.trader = $1 AND e.kind = 'desk_day_open'
          AND EXISTS (SELECT 1 FROM trades t WHERE t.trader = e.trader AND t.deleted_at IS NULL
                       AND upper(t.ticker) = split_part(e.ref, '|', 1) AND substring(t.date, 1, 10) = split_part(e.ref, '|', 2))`,
      [trader],
    )
    .catch(() => none<{ day: string }>());
  return rows.map((r) => String(r.day));
}

async function linkPrefill(trader: string, today: string): Promise<{ lastTickerDay: QuestData["lastTickerDay"]; replayTradeId: number | null }> {
  const [last, worst] = await Promise.all([
    pool.query<{ d: string; ticker: string }>(
      `SELECT substring(date, 1, 10) AS d, upper(ticker) AS ticker FROM trades
        WHERE trader = $1 AND deleted_at IS NULL AND ticker IS NOT NULL GROUP BY 1, 2 ORDER BY 1 DESC, count(*) DESC LIMIT 1`,
      [trader],
    ).catch(() => none<{ d: string; ticker: string }>()),
    pool.query<{ id: number }>(
      `SELECT t.id FROM trades t WHERE t.trader = $1 AND t.deleted_at IS NULL AND substring(t.date, 1, 10) >= $2
          AND ${netPnlSql("t")} < 0 ORDER BY ${netPnlSql("t")} ASC LIMIT 1`,
      [trader, addDays(today, -30)],
    ).catch(() => none<{ id: number }>()),
  ]);
  const l = last.rows[0];
  return { lastTickerDay: l ? { ticker: String(l.ticker), date: String(l.d) } : null, replayTradeId: worst.rows[0] ? Number(worst.rows[0].id) : null };
}

async function isHoliday(date: string): Promise<boolean> {
  const { rows } = await pool
    .query(`SELECT 1 FROM holiday_calendar WHERE date = $1 AND type = 'holiday' AND description ILIKE 'Market closed%' LIMIT 1`, [date])
    .catch(() => none<unknown>());
  return rows.length > 0;
}

/** Users flags. must_change_secret NULL = no change required (UMID-10: NULL read as «must change» kept «Сменить PIN» open). */
export function mustChangeOf(v: boolean | null | undefined): boolean {
  return v === true;
}

async function userFlags(trader: string): Promise<{ mustChangeSecret: boolean; telegram: boolean; role: string | null }> {
  const { rows } = await pool
    .query<{ m: boolean | null; tg: boolean; role: string }>(
      `SELECT must_change_secret AS m, telegram_chat_id IS NOT NULL AS tg, role FROM users WHERE name = $1`,
      [trader],
    )
    .catch(() => none<{ m: boolean | null; tg: boolean; role: string }>());
  const r = rows[0];
  return { mustChangeSecret: mustChangeOf(r?.m), telegram: !!r?.tg, role: r?.role ?? null };
}

/**
 * A learner gets the practice quests: a Джун — the entry stage since «Стажёр» left the ladder (Волна 1 п. 1.21; a stored
 * legacy «trainee» counts too) — or a trader without a tier who has not traded in the last 30 days (a newcomer before
 * the first trades). Трейдер and above are never learners.
 */
export function isLearner(tier: string | null, reviews: readonly { date: string }[], today: string): boolean {
  if (tier === "trainee" || tier === "junior") return true;
  if (tier && (TIER_RANK[tier] ?? 0) > 0) return false;
  return !reviews.some((r) => r.date >= addDays(today, -30));
}


export type TraderInputs = {
  asOf: string;
  role: string | null;
  /** Ladder tier (lib/playbookToday/tier); null for staff / unknown. */
  tier: string | null;
  summary: DisciplineSummary;
  ledger: LedgerDay[];
  achievements: Omit<AchievementInput, "onboarding">;
  quests: QuestData;
};

/**
 * One load for both engines. `fullStops`: the clean-month line still has tiers to earn — load the whole stop history
 * (otherwise only this month, for the monthly quest).
 */
export async function loadTraderInputs(trader: string, now: Date, o: { fullStops: boolean }): Promise<TraderInputs> {
  const asOf = lastFinishedDay(now);
  const today = nyDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const stopsFrom = o.fullStops ? "2000-01-01" : (monthStart < asOf ? monthStart : asOf);
  const [{ summary, ledger }, reviews, focus, stops, games, plans, user, promo, acad, gp, opens, prefill, holiday, tags, tier, drills, dailyTasks] = await Promise.all([
    disciplineSummary(trader, { loadTrades: loadTradesOf(trader), now }),
    reviewDays(trader, today).catch(() => [] as ReviewDay[]),
    focusDays(trader, asOf).catch(() => [] as FocusDay[]),
    stopDays(trader, stopsFrom, asOf).catch(() => ({ days: [] as StopDay[], stopKnown: false })),
    ownGames(trader),
    planFlags(trader).catch(() => new Map<string, PlanFlags>()),
    userFlags(trader),
    promotions(trader),
    academy(trader),
    gamePlans(trader, addDays(today, -100)),
    deskDayOpens(trader),
    linkPrefill(trader, today),
    isHoliday(today),
    tagDays(trader, addDays(today, -14), today).catch(() => new Map<string, { trades: number; tagged: number }>()),
    viewerTier(trader).catch(() => null),
    drillDays(trader, addDays(today, -40)),
    dailyTaskDays(trader, addDays(today, -40)),
  ]);
  const plansBeforeOpen = [...plans].filter(([d, p]) => p.beforeOpen && d <= today).map(([d]) => d);
  return {
    asOf, role: user.role, tier, summary, ledger,
    achievements: {
      asOf, ledger, reviews: reviews.filter((r) => r.date <= asOf), focus, stops: stops.days, cleanMonthMinDays: setting("rewards.cleanMonthMinDays"),
      games, plansBeforeOpen, promotions: promo, lessons: acad.lessons, exams: acad.exams, academy: acad.academy,
    },
    quests: {
      today, minutes: nyMinutes(now), lastFinished: asOf, tradingDay: !isWeekend(today) && !holiday,
      user: { mustChangeSecret: user.mustChangeSecret, telegram: user.telegram },
      plans, ledger, reviews, focus, games, gamePlans: gp, deskDayOpens: opens,
      monthStops: stops.days.filter((s) => s.date >= monthStart), stopKnown: stops.stopKnown,
      ...prefill, tagDays: tags,
      learner: isLearner(tier, reviews, today), academy: acad.academy, drillDays: drills, dailyTaskDays: dailyTasks, lessonDays: acad.lessons,
    },
  };
}
