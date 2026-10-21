/**
 * Staff view of /stats and /analytics without raw trades (Волна 2 п. 2.5) — the pattern of /benchmark: the server
 * sums, the page only draws. Pure maths: lib/stats/aggregate.ts (same definitions as the browser's trade-math).
 *
 *   GET /stats/aggregate  ?scope=desk|trader &trader= &from=YYYY-MM-DD &to=YYYY-MM-DD (by close date; none = all time)
 *                         &horizon &side &ticker &setup (__none__ = without) &account &source   (the page filters)
 *                         &xYears &xMonths &xDays &xTimes &xStrategies &xTypes &xGtags &xPtags &excludeImx («Фильтры»)
 *                         &lite=1   only totals + days + streaks (the comparison period)
 *     → { scope, trader, from, to, money, ...Aggregate }
 *       KPI cards (total bucket + best / worst + streaks), the daily equity curve and calendar (days), breakdowns by
 *       trader / setup / sector / ticker / session / conviction / horizon / weekday / hour / account / source,
 *       weekday × hour cells, the R histogram, the 5 best / worst trades per metric, filter options.
 *
 * Who: any signed-in member. scope=desk → every trader the viewer may read (team.read: desk → all, assigned → the
 * wards + self; a plain member → only self). scope=trader → that trader (403 outside the viewer's scope; none = self).
 * $ of a book that is not the viewer's own are visible to staff only (lib/playbookPrivacy canSeeBookMoney) — else
 * every money sum is zeroed and `money: false`. Guests: 403. GET only, no tables created.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AppError, route, unauthorized } from "../lib/http";
import { forbiddenError, readScope, resolveActor } from "../lib/permissions";
import { loadMoneyViewer } from "../lib/playbookAccess";
import { canSeeBookMoney } from "../lib/playbookPrivacy";
import { closeDateSql } from "../lib/tradeMath";
import { buildAggregate, redactAggregateMoney, type AggTradeRow, type Aggregate } from "../lib/stats/aggregate";
import { statsAggregateCache } from "../lib/tradesPageCache";
import { FACET_QUERY, facetFiltersOf } from "../lib/tradesPageParams";
import { facetSqlTail, type FacetFilters } from "../lib/tradeFacetsSql";

const router: IRouter = Router();

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Query = z.object({
  scope: z.enum(["desk", "trader"]).default("desk"),
  trader: z.string().trim().max(120).optional(),
  from: YMD.optional(),
  to: YMD.optional(),
  horizon: z.enum(["intraday", "overnight", "swing"]).optional(),
  side: z.enum(["long", "short"]).optional(),
  ticker: z.string().trim().max(20).optional(),
  setup: z.string().trim().max(200).optional(),
  account: z.string().trim().max(120).optional(),
  source: z.enum(["manual", "propreports"]).optional(),
  lite: z.enum(["1", "true", "0", "false"]).optional(),
  ...FACET_QUERY, // «Улучшенный поиск» columns + excludeImx (lib/tradeFacetsSql)
});

/** The rows of the window: not deleted, the given traders (null = every trader), close date in [from, to]. */
export async function loadAggregateRows(traders: string[] | null, from: string | null, to: string | null, facets?: FacetFilters): Promise<AggTradeRow[]> {
  const CLOSE = `LEFT(${closeDateSql("t")}, 10)`;
  const params: unknown[] = [traders, from, to];
  const tail = facetSqlTail(facets, params);
  const { rows } = await pool.query<AggTradeRow>(
    `SELECT t.id, t.trader, t.ticker, t.date, t.exit_date, t.result, t.side, t.entry, t.exit, t.stop, t.r_multiple, t.pnl,
            t.fees, t.risk_usd, t.horizon, t.setup, t.event_type, t.sector, t.session, t.conviction, t.broker_account,
            t.source, t.created_at, t.context_snapshot ->> 'openedAt' AS opened_at
       FROM trades t
      WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL
        AND ($1::text[] IS NULL OR t.trader = ANY($1::text[]))
        AND ($2::text IS NULL OR ${CLOSE} >= $2)
        AND ($3::text IS NULL OR ${CLOSE} <= $3)${tail}`,
    params,
  );
  return rows;
}

router.get("/stats/aggregate", route({ query: Query }, async ({ req, query: q }) => {
  if (!req.authUser) throw unauthorized();
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_UNAVAILABLE");
  // null = the whole desk; else the readable traders (a plain member: only self).
  const readable = await readScope(req, "team.read");
  let traders: string[] | null;
  let trader: string | null = null;
  if (q.scope === "trader" || q.trader) {
    trader = q.trader || actor.name;
    if (trader !== actor.name && readable !== null && !readable.includes(trader)) throw forbiddenError("team.read");
    traders = [trader];
  } else {
    traders = readable === null ? null : [...new Set([...readable, actor.name])];
  }
  const facets = facetFiltersOf(q);
  const filters = {
    horizon: q.horizon, side: q.side, ticker: q.ticker || undefined, setup: q.setup || undefined,
    account: q.account || undefined, source: q.source,
  };
  const lite = q.lite === "1" || q.lite === "true";
  // 60 s per (traders, window, facets, filters, lite), cleared on every trade write (lib/tradesPageCache). The money
  // redaction below depends on the viewer and is applied to the shared (never mutated) aggregate per request.
  const key = JSON.stringify({ traders: traders ? [...traders].sort() : null, from: q.from ?? null, to: q.to ?? null, facets, filters, lite });
  const agg = (await statsAggregateCache.getOrLoad(key, async () =>
    buildAggregate(await loadAggregateRows(traders, q.from ?? null, q.to ?? null, facets), filters, { lite }))) as Aggregate;
  const money = canSeeBookMoney(await loadMoneyViewer(req), trader ?? (traders?.length === 1 ? traders[0]! : null));
  return {
    scope: trader ? "trader" : "desk",
    trader,
    from: q.from ?? null,
    to: q.to ?? null,
    money,
    ...(money ? agg : redactAggregateMoney(agg)),
  };
}));

export default router;
