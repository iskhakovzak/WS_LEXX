/**
 * Market regime layer (lib/marketRegime/*, migration 0263): the desk's regime of the day, the limit multiplier per
 * regime, the playbook regime tags, a trader's edge by regime and the weekly regime reflection.
 *
 *   GET  /market-regime/today?date=            any member: the day's regime (or null), multipliers, applyLimits, whether
 *                                               the viewer may set it, and the viewer's own base / suggested daily limit
 *   PUT  /market-regime/day/:date               regime.set — { regime, note?, suggestion? } upsert + audit «regime.set».
 *                                               The suggestion comes from the web engine (components/shared/market
 *                                               regime-suggest); auto_suggested = the person confirmed it as is
 *   GET  /market-regime/edge?trader=&from=&to=  own book, or staff with trades.read.team: stats per desk regime
 *   GET  /market-regime/reflection?trader=&week= own, or staff with journal.read.team: the week's answers (prefilled
 *                                               from the latest earlier week when the week has none)
 *   PUT  /market-regime/reflection              the trader only — { week, answers }
 *   PUT  /market-regime/playbook/:id/regimes    whoever may edit the setup — { regimes: [] }
 * GET never writes. Dates are NY trading days (YYYY-MM-DD), weeks ISO «YYYY-Www».
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { personalTrader } from "../lib/auth";
import { can, resolveActor } from "../lib/permissions";
import { AppError, idParam, notFound, route, unauthorized } from "../lib/http";
import { addDays, isWeekend, nyDate } from "../lib/tradingDate";
import { canEditSetupRow, loadSetupAccess } from "../lib/playbookAccess";
import { REGIME_KEYS, suggestedLimit } from "../lib/marketRegime/regimes";
import { regimeEdge } from "../lib/marketRegime/edge";
import {
  multipliers, reflection, regimeAdj, regimeDay, regimeTrades, saveReflection, setPlaybookRegimes, setRegimeDay,
  REFLECTION_QUESTIONS,
} from "../lib/marketRegime/store";
import { setting } from "../lib/settings/registry";

const router: IRouter = Router();

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const WEEK = z.string().regex(/^\d{4}-W\d{2}$/);
const Regime = z.enum(REGIME_KEYS);
/** How far ahead a regime may be set (the evening before / a long weekend). */
const MAX_AHEAD_DAYS = 4;

const Suggestion = z.object({
  regime: Regime,
  reasons: z.array(z.object({ code: z.string().regex(/^[a-zA-Z]{1,32}$/), value: z.number().finite().nullable() })).max(8),
  asOf: YMD,
});

router.get("/market-regime/today", route({ query: z.object({ date: YMD.optional() }) }, async ({ req, query }) => {
  if (!req.authUser) throw unauthorized();
  const date = query.date ?? nyDate();
  const actor = await resolveActor(req);
  const [day, adj, canSet] = await Promise.all([regimeDay(date), regimeAdj(date), can(req, "regime.set")]);
  let limit: { base: number | null; suggested: number | null } | null = null;
  if (actor && !actor.guest) {
    const { rows } = await pool.query<{ daily: string | null }>(`SELECT daily_loss_limit AS daily FROM trader_risk_limits WHERE trader = $1`, [actor.name]);
    const base = rows[0]?.daily == null ? null : Number(rows[0].daily);
    if (base != null && Number.isFinite(base)) limit = { base, suggested: day ? suggestedLimit(base, adj.multiplier) : null };
  }
  return { date, day, multiplier: adj.multiplier, multipliers: multipliers(), applyLimits: setting("regime.applyLimits") === true, canSet, limit };
}));

router.put("/market-regime/day/:date", route({
  cap: "regime.set",
  params: z.object({ date: YMD }),
  body: z.object({ regime: Regime, note: z.string().trim().max(500).nullish(), suggestion: Suggestion.nullish() }),
}, async ({ params, body, actor }) => {
  if (isWeekend(params.date) || Number.isNaN(Date.parse(`${params.date}T12:00:00Z`))) throw new AppError("INVALID_DATE");
  if (params.date > addDays(nyDate(), MAX_AHEAD_DAYS)) throw new AppError("DAY_IN_FUTURE");
  return setRegimeDay({ day: params.date, regime: body.regime, note: body.note || null, actor: actor.name, suggestion: body.suggestion ?? null });
}));

const EDGE_TTL_MS = 60_000;
const edgeCache = new Map<string, { at: number; value: Promise<ReturnType<typeof regimeEdge>> }>();

router.get("/market-regime/edge", route({
  query: z.object({ trader: z.string().trim().max(120).optional(), from: YMD.optional(), to: YMD.optional() }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "trades.read.team");
  const key = `${trader}|${query.from ?? ""}|${query.to ?? ""}`;
  let hit = edgeCache.get(key);
  if (!hit || Date.now() - hit.at > EDGE_TTL_MS) {
    const value = regimeTrades(trader, query.from, query.to).then((t) => regimeEdge(t));
    value.catch(() => edgeCache.delete(key));
    hit = { at: Date.now(), value };
    edgeCache.set(key, hit);
    if (edgeCache.size > 100) edgeCache.delete(edgeCache.keys().next().value as string);
  }
  const today = await regimeDay(nyDate()).catch(() => null);
  return { trader, ...(await hit.value), today: today?.regime ?? null };
}));

router.get("/market-regime/reflection", route({
  query: z.object({ trader: z.string().trim().max(120).optional(), week: WEEK }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "journal.read.team");
  return { ...(await reflection(trader, query.week)), canEdit: trader === req.authUser?.name };
}));

const Answer = z.string().max(1000);
const Answers = z.record(Regime, z.object(Object.fromEntries(REFLECTION_QUESTIONS.map((q) => [q, Answer.optional()]))).partial());

router.put("/market-regime/reflection", route({ body: z.object({ week: WEEK, answers: Answers }) }, async ({ req, body }) => {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  return saveReflection(actor.name, body.week, body.answers);
}));

router.put("/market-regime/playbook/:id/regimes", route({
  params: z.object({ id: idParam }),
  body: z.object({ regimes: z.array(Regime).max(REGIME_KEYS.length) }),
}, async ({ req, params, body }) => {
  if (!req.authUser) throw unauthorized();
  const row = await loadSetupAccess(params.id);
  if (!row) throw notFound();
  if (!(await canEditSetupRow(req, row))) throw new AppError("FORBIDDEN");
  const regimes = await setPlaybookRegimes(params.id, body.regimes);
  if (!regimes) throw notFound();
  return { id: params.id, regimes };
}));

export default router;
