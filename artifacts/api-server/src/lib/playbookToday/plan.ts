/**
 * Today's picks live in the personal plan (trader_plans.doc.setups, routes/gameplan.ts) — the plan, the dashboard day row
 * and the playbook read the same list. Plan fields owned here:
 *   setups           ≤ 3 playbook setup ids picked for the day («Сегодня торгую»);
 *   riskPerTradeUsd  1R in $ for the size calculator (PlaybookToday.oneR, source "plan"; else the risk limits).
 * The plan editor may not know them: a save without the key keeps the stored value (keepPlanPicks), null clears it.
 */
import { z } from "zod";
import { pool } from "@workspace/db";

export const PLAN_MAX_PICKS = 3;

/** Spread into routes/gameplan.ts TraderPlanBody. */
export const PlanPicksFields = {
  setups: z.array(z.number().int().positive()).max(PLAN_MAX_PICKS).transform((a) => [...new Set(a)]).optional(),
  riskPerTradeUsd: z.number().finite().positive().lt(1e6).nullable().optional(),
};

type Extras = { setups?: unknown; riskPerTradeUsd?: unknown };

/** A plan save that leaves out setups / riskPerTradeUsd keeps the stored ones. */
export function keepPlanPicks<T extends object>(doc: T, stored: unknown): T {
  if (!stored || typeof stored !== "object") return doc;
  const before = stored as Extras;
  const out = { ...doc } as T & Extras;
  if (out.setups === undefined && Array.isArray(before.setups)) out.setups = before.setups;
  if (out.riskPerTradeUsd === undefined && typeof before.riskPerTradeUsd === "number") out.riskPerTradeUsd = before.riskPerTradeUsd;
  return out;
}

/**
 * Writes doc.setups of the trader's plan for `date`, creating the plan row when missing (the rest of the doc stays
 * empty: it does not count as a written plan for the quests — lib/quests/load planHasContent). A soft-deleted plan comes
 * back empty with only the picks.
 */
export async function savePicks(trader: string, date: string, ids: readonly number[]): Promise<number[]> {
  const json = JSON.stringify(ids);
  const { rows } = await pool.query<{ setups: unknown }>(
    `INSERT INTO trader_plans (trader, date, doc, status) VALUES ($1, $2, jsonb_build_object('setups', $3::jsonb), 'draft')
     ON CONFLICT (trader, date) DO UPDATE SET
       doc = CASE WHEN trader_plans.deleted_at IS NULL
                  THEN jsonb_set(COALESCE(trader_plans.doc, '{}'::jsonb), '{setups}', $3::jsonb)
                  ELSE jsonb_build_object('setups', $3::jsonb) END,
       status = CASE WHEN trader_plans.deleted_at IS NULL THEN trader_plans.status ELSE 'draft' END,
       updated_at = NOW(), deleted_at = NULL
     RETURNING doc -> 'setups' AS setups`,
    [trader, date, json],
  );
  const v = rows[0]?.setups;
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n)) : [...ids];
}
