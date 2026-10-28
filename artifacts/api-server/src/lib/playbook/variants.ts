/**
 * Trade variants of a setup side by side (GET /playbook/:id/stats → `variants`): a setup is the pattern, its child
 * setups («варианты», playbook.parent_id) are the different entries on it — breakout → continuation vs rubber band back
 * to VWAP. Each variant's $ block comes from the trades already tagged with it (trades.playbook_id = the child); trades
 * tagged with the setup itself are «unspecified». No new input on trades: the existing setup tag decides.
 * The caller passes its own $ redaction (`usdOf`: the viewer's money rules), so this module never decides privacy.
 */
import { pool } from "@workspace/db";
import { visibleSql, type PlaybookViewer } from "../playbookAccess";
import type { UsdStats } from "../playbookEdge";
import type { Queryable } from "../interventions/log";

export type VariantTrade = { playbookId: number; trader: string | null; result: unknown; pnl: unknown; fees: unknown };
export type VariantRow = UsdStats & { id: number; name: string };
export type SetupVariants = { variants: VariantRow[]; unspecified: UsdStats };

/** The visible child setups of `setupId` with their trades' $ blocks; null when the setup has no variants. */
export async function setupVariants(
  setupId: number,
  scope: string | null,
  v: PlaybookViewer,
  usdOf: (list: VariantTrade[]) => UsdStats,
  unspecified: UsdStats,
  db: Queryable = pool,
): Promise<SetupVariants | null> {
  const params: unknown[] = [setupId];
  const vis = visibleSql(v, params, "p");
  const { rows: kids } = await db.query(`SELECT p.id, p.name FROM playbook p WHERE p.parent_id = $1 AND p.deleted_at IS NULL AND ${vis} ORDER BY p.created_at`, params);
  if (!kids.length) return null;
  const ids = kids.map((k) => Number(k.id));
  const tp: unknown[] = [ids];
  if (scope) tp.push(scope);
  const { rows } = await db.query(
    `SELECT t.playbook_id, t.trader, t.result, t.pnl, t.fees FROM trades t
      WHERE t.playbook_id = ANY($1::int[]) AND t.deleted_at IS NULL ${scope ? "AND t.trader = $2" : ""}`,
    tp,
  );
  const by = new Map<number, VariantTrade[]>(ids.map((id) => [id, []]));
  for (const r of rows) by.get(Number(r.playbook_id))?.push({ playbookId: Number(r.playbook_id), trader: r.trader ?? null, result: r.result, pnl: r.pnl, fees: r.fees });
  const variants = kids
    .map((k) => ({ id: Number(k.id), name: String(k.name), ...usdOf(by.get(Number(k.id)) ?? []) }))
    .sort((a, b) => b.n - a.n || (b.net ?? 0) - (a.net ?? 0) || a.id - b.id);
  return { variants, unspecified };
}
