import { pool } from "@workspace/db";
import { logger } from "../logger";
import { closeDateSql, closedSql, netPnlSql, resultSql, signedRSql, num } from "../tradeMath";
import type { LearningInput, PromoTrade } from "../promotionEngine";

/**
 * Promotion inputs of routes/academy-path.ts readiness report: F1 learning progress, closed trades in the window and
 * violation / error dates. Split out of routes/academy-path.ts (size ratchet).
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * F1 learning progress, probed by table/column names (contract proposed to F1):
 *   academy_lessons(id, archived_at?, required?) · academy_lesson_progress(user_name, lesson_id, completed_at | status)
 *   academy_quiz_attempts(user_name, quiz_id, pct | score_pct | percent) — F1 ships `pct` (0..100); raw `score` is points, never used.
 * Returns null when the lesson tables are absent (criteria are then reported as "not counted").
 */
export async function loadLearning(user: string): Promise<LearningInput | null> {
  try {
    const { rows } = await pool.query<{ t: string; c: string }>(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name IN ('academy_lessons','academy_lesson_progress','academy_quiz_attempts')`,
    );
    const cols = new Map<string, Set<string>>();
    for (const r of rows) (cols.get(r.t) ?? cols.set(r.t, new Set()).get(r.t)!).add(r.c);
    const L = cols.get("academy_lessons"), P = cols.get("academy_lesson_progress"), Q = cols.get("academy_quiz_attempts");
    if (!L || !P || !P.has("user_name") || !P.has("lesson_id")) return null;
    const lessonWhere = [L.has("archived_at") ? "l.archived_at IS NULL" : "TRUE", L.has("draft") ? "NOT l.draft" : "TRUE", L.has("required") ? "COALESCE(l.required, TRUE)" : "TRUE"].join(" AND ");
    const doneCond = P.has("completed_at") ? "p.completed_at IS NOT NULL" : P.has("status") ? "p.status IN ('completed','done','passed')" : "TRUE";
    const { rows: tot } = await pool.query<{ total: string; done: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM academy_lesson_progress p WHERE p.lesson_id = l.id AND p.user_name = $1 AND ${doneCond}))::text AS done
         FROM academy_lessons l WHERE ${lessonWhere}`,
      [user],
    );
    let quizAvg: number | null = null, quizzesTaken = 0;
    const scoreCol = Q ? ["pct", "score_pct", "percent"].find((c) => Q.has(c)) : undefined;
    if (Q && scoreCol && Q.has("user_name") && Q.has("quiz_id")) {
      const { rows: q } = await pool.query<{ avg: string | null; n: string }>(
        `SELECT AVG(best)::text AS avg, COUNT(*)::text AS n FROM (
           SELECT quiz_id, MAX(${scoreCol})::float8 AS best FROM academy_quiz_attempts WHERE user_name = $1 ${Q.has("archived_at") ? "AND archived_at IS NULL" : ""} GROUP BY quiz_id) s`,
        [user],
      );
      quizAvg = num(q[0]?.avg);
      quizzesTaken = Number(q[0]?.n ?? 0);
    }
    return { lessonsTotal: Number(tot[0]?.total ?? 0), lessonsDone: Number(tot[0]?.done ?? 0), quizAvg, quizzesTaken };
  } catch (err) {
    logger.warn({ err }, "academy-path: learning probe failed");
    return null;
  }
}

// ─── promotion input ────────────────────────────────────────────────────────

export async function loadPromoTrades(user: string, from: string, to: string): Promise<PromoTrade[]> {
  const { rows } = await pool.query(
    `SELECT ${closeDateSql("t")} AS d, ${netPnlSql("t")}::float8 AS net, t.pnl::float8 AS gross, ABS(COALESCE(t.fees, 0))::float8 AS fees,
            ${signedRSql("t")}::float8 AS r, ${resultSql("t")} AS result,
            CASE WHEN t.source = 'propreports' OR t.context_snapshot ->> 'source' = 'propreports' THEN 'propreports' ELSE 'manual' END AS source
       FROM trades t
      WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closedSql("t")}
        AND ${closeDateSql("t")} >= $2 AND ${closeDateSql("t")} <= $3`,
    [user, from, to],
  );
  const out: PromoTrade[] = [];
  for (const r of rows) {
    const result = r.result as string | null;
    if (result !== "win" && result !== "loss" && result !== "be") continue;
    const d = String(r.d ?? "").slice(0, 10);
    if (!YMD_RE.test(d)) continue;
    out.push({ date: d, net: num(r.net), gross: num(r.gross), fees: num(r.fees) ?? 0, r: num(r.r), result, source: r.source === "propreports" ? "propreports" : "manual" });
  }
  return out;
}

export async function loadViolationDates(user: string, from: string): Promise<string[]> {
  const out: string[] = [];
  const v = await pool.query(
    `SELECT COALESCE(NULLIF(day, ''), LEFT(occurred_at::text, 10)) AS d FROM rule_violations WHERE trader = $1 AND occurred_at >= $2::date AND archived_at IS NULL`,
    [user, from],
  ).catch(() => pool.query(`SELECT LEFT(occurred_at::text, 10) AS d FROM rule_violations WHERE trader = $1 AND occurred_at >= $2::date`, [user, from]).catch(() => ({ rows: [] as any[] })));
  for (const r of v.rows) out.push(String(r.d));
  const e = await pool.query(`SELECT LEFT(created_at::text, 10) AS d FROM trading_errors WHERE trader = $1 AND created_at >= $2::date`, [user, from]).catch(() => ({ rows: [] as any[] }));
  for (const r of e.rows) out.push(String(r.d));
  return out;
}

