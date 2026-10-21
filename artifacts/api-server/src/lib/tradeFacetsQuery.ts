/**
 * GET /trades/facets (routes/trade-facets.ts) — the buckets of the «Фильтры» panel. Pure SQL builder + row folding.
 *
 * One statement: the rows of the current filter (every /trades/page filter, scope included) with each column's key
 * computed once, then per column the buckets {key, count, net} over the trades that pass every OTHER column (the
 * column's own exclusion is ignored, so an unchecked bucket keeps its numbers), plus the totals of the full selection
 * and the IMX part of it (strategy MOC — computed even when «Исключить IMX» is on, for the «из них IMX» line).
 */
import { netPnlSql } from "./tradeMath";
import { FACET_DIMS, NONE_KEY, facetKeySql, tagsSql, type FacetDim, type FacetFilters } from "./tradeFacetsSql";
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
  const others = (d: FacetDim | null) => FACET_DIMS.filter((o) => o !== d).map((o) => `y.p_${o}`).join(" AND ");
  const imxOff = facets?.excludeImx ? `AND NOT y.imx` : "";
  const parts: string[] = [];
  for (const d of FACET_DIMS) {
    const from = d === "gtags" || d === "ptags"
      ? `y CROSS JOIN LATERAL unnest(CASE WHEN cardinality(y.k_${d}) = 0 THEN ARRAY['${NONE_KEY}'] ELSE y.k_${d} END) k(v)`
      : "y";
    const key = d === "gtags" || d === "ptags" ? "k.v" : `y.k_${d}`;
    parts.push(`SELECT '${d}' AS dim, ${key} AS key, COUNT(*)::int AS n, SUM(y.net) AS net FROM ${from} WHERE ${others(d)} ${imxOff} GROUP BY 2`);
  }
  parts.push(`SELECT '_total', '', COUNT(*)::int, SUM(y.net) FROM y WHERE ${others(null)} ${imxOff}`);
  parts.push(`SELECT '_imx', '', COUNT(*)::int, SUM(y.net) FROM y WHERE ${others(null)} AND y.imx`);
  const sql = `WITH x AS MATERIALIZED (
      SELECT ${netPnlSql("t")} AS net, COALESCE(t.strategy, '') = 'MOC' AS imx, ${keyCols}, ${tagCols}
      ${buildFrom(join)} WHERE ${where}
    ), y AS (SELECT x.*, ${passCols} FROM x)
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

/** Bucket order inside a column: years newest first, months / days / times by their natural order, the rest by |net|. */
export function orderBuckets(dim: FacetDim, list: FacetBucket[], timeOrder: readonly string[]): FacetBucket[] {
  const last = (k: string) => (k === NONE_KEY || k === "unknown" ? 1 : 0);
  const cmp: Record<FacetDim, (a: FacetBucket, b: FacetBucket) => number> = {
    years: (a, b) => b.key.localeCompare(a.key),
    months: (a, b) => Number(a.key) - Number(b.key),
    days: (a, b) => Number(a.key) - Number(b.key),
    times: (a, b) => timeOrder.indexOf(a.key) - timeOrder.indexOf(b.key),
    strategies: (a, b) => b.count - a.count,
    types: (a, b) => a.key.localeCompare(b.key),
    gtags: (a, b) => b.count - a.count || a.key.localeCompare(b.key),
    ptags: (a, b) => b.count - a.count || a.key.localeCompare(b.key),
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
