/**
 * GET /trades/facets (routes/trade-facets.ts) — the buckets of the «Фильтры» panel. Pure SQL builder + row folding.
 *
 * One statement: the rows of the current filter (every /trades/page filter, scope included) with each column's key
 * computed once, then per column the buckets {key, count, net} over the trades that pass every OTHER column (the
 * column's own exclusion is ignored, so an unchecked bucket keeps its numbers), plus the totals of the full selection
 * and the IMX part of it (strategy MOC — computed even when «Исключить IMX» is on, for the «из них IMX» line).
 * With 16 scalar columns the per-column scans are folded into one GROUPING SETS pass (see buildFacetsQuery).
 */
import { netPnlSql } from "./tradeMath";
import { FACET_DIMS, NONE_KEY, facetKeySql, tagsSql, type FacetDim, type FacetFilters } from "./tradeFacetsSql";
import { ENTRY_KEYS, EXIT_KEYS, HOLD_ORDER, PREV_KEYS, PRICE_BUCKETS, RESULT_KEYS, SEQ_BUCKETS, SIZE_BUCKETS, type Bucket } from "./tradeFacetBuckets";
import { Params, buildFrom, buildWhere, hasQualityFilters, type TradesPageFilters } from "./tradesPageQuery";

export interface FacetBucketRow { dim: string; key: string; n: number | string; net: number | string | null }

const SCALAR_DIMS = FACET_DIMS.filter((d): d is Exclude<FacetDim, "gtags" | "ptags"> => d !== "gtags" && d !== "ptags");

/**
 * Rows `dim, key, n, net`: one per bucket of each column, then dim '_total' (the full selection) and '_imx' (its IMX part).
 * `f.facets` drives both the pass flags and the exclusions; scope / date / other page filters go to the base WHERE.
 */
export function buildFacetsQuery(f: TradesPageFilters, quality: boolean): { sql: string; params: unknown[] } {
  const p = new Params();
  const facets = f.facets;
  const base: TradesPageFilters = { ...f, facets: undefined };
  const join = quality && hasQualityFilters(base);
  const where = buildWhere(base, p, { quality });
  const deskP = p.add((facets?.deskTags ?? []).map((t) => t.toLowerCase()));
  const keyCols = SCALAR_DIMS.map((d) => `${facetKeySql(d, "t")} AS k_${d}`).join(", ");
  const tagCols = `${tagsSql("gtags", deskP, "t")} AS k_gtags, ${tagsSql("ptags", deskP, "t")} AS k_ptags`;
  // pass_<dim>: the row passes that column's exclusion (TRUE when nothing is excluded there).
  const pass = (d: FacetDim): string => {
    const off = facets?.off[d];
    if (!off?.length) return "TRUE";
    const offP = p.add([...off]);
    if (d === "gtags" || d === "ptags") {
      return `(EXISTS (SELECT 1 FROM unnest(x.k_${d}) g(v) WHERE NOT (g.v = ANY(${offP}::text[])))
        OR (cardinality(x.k_${d}) = 0 AND NOT ('${NONE_KEY}' = ANY(${offP}::text[]))))`;
    }
    return `NOT (x.k_${d} = ANY(${offP}::text[]))`;
  };
  const passCols = FACET_DIMS.map((d) => `${pass(d)} AS p_${d}`).join(", ");
  // nf = how many columns the row fails. A column's buckets count the rows that pass every OTHER column: nf = 0, or
  // nf = 1 with the failed column being this one — so all scalar columns come from ONE scan (a VALUES unpivot) instead
  // of one scan per column.
  const excluded = FACET_DIMS.filter((d) => (facets?.off[d]?.length ?? 0) > 0);
  const nf = excluded.length ? excluded.map((d) => `(NOT y.p_${d})::int`).join(" + ") : "0";
  const passesBut = (p: string) => `(z.nf = 0 OR (z.nf = 1 AND NOT ${p}))`;
  const imxOff = facets?.excludeImx ? `AND NOT z.imx` : "";
  const unpivot = SCALAR_DIMS.map((d) => `('${d}', z.k_${d}, z.p_${d})`).join(", ");
  // Scalar columns: the rows passing everything in one GROUPING SETS pass (one hash table per column, keys are never
  // NULL), plus the few rows failing exactly one column, unpivoted for that column only; summed per bucket.
  const dimOfSet = `CASE ${SCALAR_DIMS.map((d) => `WHEN GROUPING(z.k_${d}) = 0 THEN '${d}'`).join(" ")} END`;
  const parts: string[] = [
    `SELECT s.dim, s.key, SUM(s.n)::int AS n, SUM(s.net) AS net FROM (
       SELECT ${dimOfSet} AS dim, COALESCE(${SCALAR_DIMS.map((d) => `z.k_${d}`).join(", ")}) AS key, COUNT(*) AS n, SUM(z.net) AS net
         FROM z WHERE z.nf = 0 ${imxOff}
        GROUP BY GROUPING SETS (${SCALAR_DIMS.map((d) => `(z.k_${d})`).join(", ")})
       UNION ALL
       SELECT v.dim, v.key, COUNT(*), SUM(z.net)
         FROM z CROSS JOIN LATERAL (VALUES ${unpivot}) v(dim, key, p)
        WHERE z.nf = 1 AND NOT v.p ${imxOff} GROUP BY 1, 2
     ) s GROUP BY 1, 2`,
  ];
  for (const d of ["gtags", "ptags"] as const) {
    parts.push(`SELECT '${d}', k.v, COUNT(*)::int, SUM(z.net)
       FROM z CROSS JOIN LATERAL unnest(CASE WHEN cardinality(z.k_${d}) = 0 THEN ARRAY['${NONE_KEY}'] ELSE z.k_${d} END) k(v)
      WHERE ${passesBut(`z.p_${d}`)} ${imxOff} GROUP BY 2`);
  }
  parts.push(`SELECT '_total', '', COUNT(*)::int, SUM(z.net) FROM z WHERE z.nf = 0 ${imxOff}`);
  parts.push(`SELECT '_imx', '', COUNT(*)::int, SUM(z.net) FROM z WHERE z.nf = 0 AND z.imx`);
  const sql = `WITH x AS MATERIALIZED (
      SELECT ${netPnlSql("t")} AS net, COALESCE(t.strategy, '') = 'MOC' AS imx, ${keyCols}, ${tagCols}
      ${buildFrom(join)} WHERE ${where}
    ), y AS (SELECT x.*, ${passCols} FROM x),
    z AS MATERIALIZED (SELECT y.*, ${nf} AS nf FROM y)
    ${parts.join("\n    UNION ALL ")}`;
  return { sql, params: p.list };
}

export interface FacetBucket { key: string; label: string; count: number; net: number | null }
export interface FacetsAnswer {
  dims: Record<FacetDim, FacetBucket[]>;
  total: { count: number; net: number | null };
  imx: { count: number; net: number | null };
}

const numOf = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);

const keyOrder = (keys: readonly string[]) => (a: FacetBucket, b: FacetBucket) => keys.indexOf(a.key) - keys.indexOf(b.key);
const byCount = (a: FacetBucket, b: FacetBucket) => b.count - a.count || a.key.localeCompare(b.key);
const keysOf = (list: readonly Bucket[]) => list.map((x) => x.key);

/**
 * Bucket order inside a column: years newest first; months / days / times and the bucketed columns (seq, prev, hold,
 * price, size) in their natural order; entry / exit / result in a fixed order; strategies, tickers, accounts and tags
 * by count.
 */
export function orderBuckets(dim: FacetDim, list: FacetBucket[], timeOrder: readonly string[]): FacetBucket[] {
  const last = (k: string) => (k === NONE_KEY || k === "unknown" ? 1 : 0);
  const cmp: Record<FacetDim, (a: FacetBucket, b: FacetBucket) => number> = {
    years: (a, b) => b.key.localeCompare(a.key),
    months: (a, b) => Number(a.key) - Number(b.key),
    days: (a, b) => Number(a.key) - Number(b.key),
    times: (a, b) => timeOrder.indexOf(a.key) - timeOrder.indexOf(b.key),
    strategies: (a, b) => b.count - a.count,
    types: (a, b) => a.key.localeCompare(b.key),
    gtags: byCount,
    ptags: byCount,
    seq: keyOrder(keysOf(SEQ_BUCKETS)),
    prev: keyOrder(PREV_KEYS),
    entry: keyOrder(ENTRY_KEYS),
    exit: keyOrder(EXIT_KEYS),
    hold: keyOrder(HOLD_ORDER),
    tickers: byCount,
    price: keyOrder(keysOf(PRICE_BUCKETS)),
    size: keyOrder(keysOf(SIZE_BUCKETS)),
    accounts: byCount,
    result: keyOrder(RESULT_KEYS),
  };
  return [...list].sort((a, b) => last(a.key) - last(b.key) || cmp[dim](a, b));
}

/** Fold the rows into the answer; `label(dim, key)` names a bucket in the reader's language; `money: false` nulls $. */
export function foldFacets(rows: FacetBucketRow[], label: (dim: FacetDim, key: string) => string, money: boolean, timeOrder: readonly string[]): FacetsAnswer {
  const dims = Object.fromEntries(FACET_DIMS.map((d) => [d, [] as FacetBucket[]])) as Record<FacetDim, FacetBucket[]>;
  let total = { count: 0, net: null as number | null };
  let imx = { count: 0, net: null as number | null };
  for (const r of rows) {
    const v = { count: Number(r.n) || 0, net: money ? numOf(r.net) : null };
    if (r.dim === "_total") total = v;
    else if (r.dim === "_imx") imx = v;
    else if ((FACET_DIMS as readonly string[]).includes(r.dim)) {
      const dim = r.dim as FacetDim;
      dims[dim].push({ key: String(r.key), label: label(dim, String(r.key)), ...v });
    }
  }
  for (const d of FACET_DIMS) dims[d] = orderBuckets(d, dims[d], timeOrder);
  return { dims, total, imx };
}

export type { FacetFilters };
