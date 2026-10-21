/**
 * analyst_actions_cache writes of lib/marketDataService (one row per ticker + graded_at + firm + action).
 *
 *   ANALYST_UPDATE_GUARD   the DO UPDATE ... WHERE of every upsert there: a conflicting row is rewritten only when the SET
 *                          would change it (no dead tuple / WAL / index churn for the hundreds of unchanged rows a re-scan
 *                          of Yahoo's upgradeDowngradeHistory re-sends every run). rowCount = inserted + changed rows.
 *   upsertYahooAnalystRows one ticker's Yahoo rows in ONE statement (unnest) instead of a query per row; duplicates of a
 *                          key in the batch are merged as the row-by-row upserts did; a failed batch falls back to rows.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import type { AnalystActionRow } from "./marketDataService";

const T = "analyst_actions_cache";

/** WHERE for `DO UPDATE SET source_url = ..., [source = ...,] price_target = ..., price_target_from = ...` (same expressions). */
export function analystUpdateGuard(set: { sourceUrl: string; source?: string; priceTargets?: boolean }): string {
  const cur = [`${T}.source_url`];
  const next = [set.sourceUrl];
  if (set.source) { cur.push(`${T}.source`); next.push(set.source); }
  if (set.priceTargets !== false) {
    cur.push(`${T}.price_target`, `${T}.price_target_from`);
    next.push(`COALESCE(EXCLUDED.price_target, ${T}.price_target)`, `COALESCE(EXCLUDED.price_target_from, ${T}.price_target_from)`);
  }
  return `WHERE (${cur.join(", ")}) IS DISTINCT FROM (${next.join(", ")})`;
}

const KEEP_URL = `COALESCE(${T}.source_url, EXCLUDED.source_url)`;
const YAHOO_SET = `SET source_url = ${KEEP_URL},
                       price_target = COALESCE(EXCLUDED.price_target, ${T}.price_target),
                       price_target_from = COALESCE(EXCLUDED.price_target_from, ${T}.price_target_from)
                   ${analystUpdateGuard({ sourceUrl: KEEP_URL })}`;

/**
 * Rows of one key merged like the row-by-row upserts: the first row is inserted (grades), each later one only fills
 * the price targets (COALESCE(new, old)), so the last non-null target wins.
 */
export function mergeAnalystDuplicates(rows: readonly AnalystActionRow[]): AnalystActionRow[] {
  const byKey = new Map<string, AnalystActionRow>();
  for (const r of rows) {
    const k = `${r.gradedAt.toISOString()}|${r.firm}|${r.action}`;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...r }); continue; }
    if (r.priceTarget != null) prev.priceTarget = r.priceTarget;
    if (r.priceTargetFrom != null) prev.priceTargetFrom = r.priceTargetFrom;
  }
  return [...byKey.values()];
}

/** Upsert one ticker's Yahoo rows; returns rows inserted or changed. */
export async function upsertYahooAnalystRows(ticker: string, sourceUrl: string, rows: readonly AnalystActionRow[]): Promise<number> {
  if (!rows.length) return 0;
  const list = mergeAnalystDuplicates(rows);
  try {
    const res = await pool.query(
      `INSERT INTO ${T} (ticker, graded_at, firm, action, to_grade, from_grade, source, source_url, price_target, price_target_from)
       SELECT $1, u.graded_at, u.firm, u.action, u.to_grade, u.from_grade, 'yahoo', $2, u.price_target, u.price_target_from
         FROM unnest($3::timestamptz[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
              AS u(graded_at, firm, action, to_grade, from_grade, price_target, price_target_from)
       ON CONFLICT (ticker, graded_at, firm, action) DO UPDATE
         ${YAHOO_SET}`,
      [
        ticker, sourceUrl,
        list.map((r) => r.gradedAt.toISOString()),
        list.map((r) => r.firm),
        list.map((r) => r.action),
        list.map((r) => r.toGrade),
        list.map((r) => r.fromGrade),
        list.map((r) => (r.priceTarget == null ? null : String(r.priceTarget))),
        list.map((r) => (r.priceTargetFrom == null ? null : String(r.priceTargetFrom))),
      ],
    );
    return res.rowCount || 0;
  } catch (e: any) {
    logger.warn({ error: e?.message, ticker, rows: list.length }, "analyst actions batch upsert failed; row by row");
  }
  let n = 0;
  for (const r of rows) {
    try {
      const ins = await pool.query(
        `INSERT INTO ${T} (ticker, graded_at, firm, action, to_grade, from_grade, source, source_url, price_target, price_target_from)
         VALUES ($1, $2, $3, $4, $5, $6, 'yahoo', $7, $8, $9)
         ON CONFLICT (ticker, graded_at, firm, action) DO UPDATE
           ${YAHOO_SET}`,
        [ticker, r.gradedAt.toISOString(), r.firm, r.action, r.toGrade, r.fromGrade, sourceUrl, r.priceTarget, r.priceTargetFrom],
      );
      n += ins.rowCount || 0;
    } catch (e: any) {
      logger.warn({ error: e?.message, ticker, firm: r.firm }, "analyst action insert failed");
    }
  }
  return n;
}
