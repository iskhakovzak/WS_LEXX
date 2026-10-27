/**
 * «Распределение риска» — capital allocation over the desk (lib/capital). Proposals live in the scaling queue
 * (/scaling: approve / reject one through POST /scaling/proposals/:id/approve|reject, which hands kind 'limits' to
 * lib/capital/decide). Access: the scaling capabilities (no parallel matrix).
 *
 *   GET  /capital/plan                    scaling.read.team — per trader raise / keep / cut with the «почему», the desk
 *                                         view (risk before / after, where it moves, expected $ with its 80 % interval),
 *                                         the settings in force and the recent applied changes (reversible)
 *   POST /capital/recompute               scaling.approve — «Пересчитать»: proposals into the queue (never auto-applied)
 *   POST /capital/approve-all             scaling.approve — every pending capital proposal (or `ids`); stale ones skipped
 *   POST /capital/history/:id/revert      scaling.approve — back to the «before» limits of an applied change
 * GET never writes. Dates are NY trading days.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { idParam, route } from "../lib/http";
import { langOf } from "../i18n";
import { nyDate } from "../lib/tradingDate";
import { setting } from "../lib/settings/registry";
import { capitalPlan, dropCapitalCache, recomputeCapital } from "../lib/capital/service";
import { approveAllCapital, capitalHistory, revertCapitalChange } from "../lib/capital/decide";
import { renderCapitalReasons } from "../lib/capital/text";
import type { CapPlanRow, Estimate } from "../lib/capital/types";

const router: IRouter = Router();
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const est = (e: Estimate | null, scale = 1) =>
  (e ? { theta: Math.round(e.theta * scale * 100) / 100, lo: Math.round(e.lo80 * scale * 100) / 100, hi: Math.round(e.hi80 * scale * 100) / 100, n: e.n } : null);

function rowOut(r: CapPlanRow, lang: ReturnType<typeof langOf>, pendingId: number | null) {
  const lim = r.current.dailyLossLimit ?? 0;
  return {
    trader: r.trader, tierKey: r.tierKey, direction: r.direction, stepPct: r.stepPct, current: r.current, proposed: r.proposed,
    band: r.band, composite: r.composite, expected: r.expected, pendingId,
    edge: { trades: r.edge.trades, days: r.edge.days, r: est(r.edge.r), usdPerDay: est(r.edge.u, lim), proven: r.edge.proven, negative: r.edge.negative },
    regime: r.regime ? { regime: r.regime.regime, days: r.regime.days, usdPerDay: est(r.regime.u, lim) } : null,
    discipline: r.discipline.score == null ? null : Math.round(r.discipline.score),
    why: renderCapitalReasons(r.reasons, lang),
  };
}

router.get("/capital/plan", route({ cap: "scaling.read.team", query: z.object({ date: YMD.optional() }) }, async ({ req, query }) => {
  const lang = langOf(req);
  const [plan, history] = await Promise.all([capitalPlan(query.date ?? nyDate()), capitalHistory(20)]);
  return {
    asOf: plan.asOf, regime: plan.regime, desk: plan.desk,
    settings: { ...plan.settings, autoApply: setting("capital.autoApply") === true },
    rows: plan.rows.map((r) => rowOut(r, lang, plan.pending.get(r.trader) ?? null)),
    history,
  };
}));

router.post("/capital/recompute", route({ cap: "scaling.approve", body: z.object({ date: YMD.optional() }) }, async ({ req, body, actor }) => {
  return recomputeCapital(actor.name, langOf(req), { today: body.date ?? nyDate() });
}));

router.post("/capital/approve-all", route({
  cap: "scaling.approve",
  body: z.object({ ids: z.array(idParam).max(500).optional() }),
}, async ({ req, body, actor }) => {
  const out = await approveAllCapital(actor.name, langOf(req), body.ids);
  dropCapitalCache();
  return out;
}));

router.post("/capital/history/:id/revert", route({ cap: "scaling.approve", params: z.object({ id: idParam }) }, async ({ req, params, actor }) => {
  const out = await revertCapitalChange(params.id, actor.name, langOf(req));
  dropCapitalCache();
  return out;
}));

export default router;
