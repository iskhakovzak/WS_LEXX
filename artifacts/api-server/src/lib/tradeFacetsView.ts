/**
 * The viewer's «Фильтры» panel (/trades, /stats) and «Исключить IMX» switch — users.settings.tradesFacetView, like
 * themesView: follows the user across devices. Shape (normalized, unknown keys dropped):
 *   { off: { <dim>: excluded keys }, excludeImx: boolean (default off), open: boolean (panel expanded) }
 */
import { pool } from "@workspace/db";
import { FACET_DIMS, FACET_MAX_KEYS, FACET_MAX_KEY_LEN, type FacetDim } from "./tradeFacetsSql";

type Queryable = { query: (typeof pool)["query"] };

export interface TradesFacetView { off: Partial<Record<FacetDim, string[]>>; excludeImx: boolean; open: boolean }

export const DEFAULT_FACET_VIEW: TradesFacetView = { off: {}, excludeImx: false, open: false };

export function normalizeFacetView(v: unknown): TradesFacetView {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const rawOff = o.off && typeof o.off === "object" ? (o.off as Record<string, unknown>) : {};
  const off: Partial<Record<FacetDim, string[]>> = {};
  for (const d of FACET_DIMS) {
    const list = Array.isArray(rawOff[d]) ? (rawOff[d] as unknown[]) : [];
    const keys = [...new Set(list.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter((k) => k && k.length <= FACET_MAX_KEY_LEN))];
    if (keys.length) off[d] = keys.slice(0, FACET_MAX_KEYS);
  }
  return { off, excludeImx: o.excludeImx === true, open: o.open === true };
}

export async function readFacetView(userId: number, q: Queryable = pool): Promise<TradesFacetView> {
  const { rows } = await q.query<{ v: unknown }>(`SELECT settings->'tradesFacetView' AS v FROM users WHERE id = $1`, [userId]);
  return normalizeFacetView(rows[0]?.v);
}

export async function writeFacetView(userId: number, view: TradesFacetView, q: Queryable = pool): Promise<TradesFacetView> {
  const { rows } = await q.query<{ v: unknown }>(
    `UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('tradesFacetView', $2::jsonb)
      WHERE id = $1 RETURNING settings->'tradesFacetView' AS v`,
    [userId, JSON.stringify(normalizeFacetView(view))],
  );
  return normalizeFacetView(rows[0]?.v);
}
