/**
 * AI reviews — «AI-разбор» of a trade (trade sheet → Разбор) and of a day (day report), on the assistant
 * infrastructure (lib/assistant/review: inputs read as the caller, cached prompt, structured output, the advisor).
 *
 *   GET  /trades/:id/ai-review          the latest review of the trade (current version) or null — no model call
 *   POST /trades/:id/ai-review          { force? } → 201 review; same inputs → the stored one (cached: true, no cost)
 *   GET  /ai/day-review?date=&trader=   the latest review of that day or null
 *   POST /ai/day-review                 { date, trader?, force? } → 201 review
 *
 * Reading a stored review: whoever may read the trade (canAccessTrade) / the trader's personal data (personalTrader).
 * Generating one: the assistant's gate and budget (capability assistant.use, desk switch, juniors switch, the daily
 * units budget — the review is charged to the requester), the assistant request rate. A review never names a model:
 * `tier` is "deep" when the advisor (or the stronger model) took part.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { AppError, idParam, notFound, route, type ErrorCode } from "../lib/http";
import { canAccessTrade, personalTrader } from "../lib/auth";
import type { Actor } from "../lib/permissions";
import { assistantLimiter } from "../lib/rateLimits";
import { langOf, type Lang } from "../i18n";
import { apiCallerFor } from "../lib/assistant/internalApi";
import type { ToolContext } from "../lib/assistant/tools";
import { gatherDay, gatherTrade, ReviewInputError } from "../lib/assistant/review/gather";
import { ReviewInvalid, ReviewRefused } from "../lib/assistant/review/run";
import { latestReview } from "../lib/assistant/review/store";
import { reviewDto, reviewOrCached, type Gathered } from "../lib/assistant/review/service";
import { providerErrorCode, ready } from "./ai-assistant";

const router: IRouter = Router();

async function requireTradeRead(req: Request, id: number): Promise<void> {
  const ok = await canAccessTrade(req, id, "read");
  if (ok === null) throw notFound("TRADE_NOT_FOUND");
  if (!ok) throw new AppError("OWN_TRADES_ONLY");
}

async function generate(req: Request, actor: Actor, force: boolean, gather: (ctx: ToolContext) => Promise<Gathered>) {
  const r = await ready(actor);
  const lang: Lang = langOf(req);
  const ctl = new AbortController();
  req.on("close", () => { if (!req.complete) ctl.abort(); });
  const ctx: ToolContext = { api: apiCallerFor(req, lang, ctl.signal), req, lang, actor: { name: actor.name, staff: r.staff, admin: actor.role === "admin" }, today: r.today };
  let gathered: Gathered;
  try {
    gathered = await gather(ctx);
  } catch (err) {
    if (err instanceof ReviewInputError) throw new AppError(err.code as ErrorCode, err.status);
    throw err;
  }
  try {
    return await reviewOrCached({ client: r.client, settings: r.s, lang, today: r.today, actor: actor.name, force, signal: ctl.signal, gathered });
  } catch (err) {
    if (err instanceof ReviewInvalid) req.log?.warn({ issues: err.issues }, "ai review: the answer did not fit the schema");
    throw new AppError(err instanceof ReviewInvalid || err instanceof ReviewRefused ? "AI_UNAVAILABLE" : providerErrorCode(err));
  }
}

// ─── trade ──────────────────────────────────────────────────────────────────

router.get("/trades/:id/ai-review", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  await requireTradeRead(req, params.id);
  const r = await latestReview({ kind: "trade", tradeId: params.id, trader: "" }, langOf(req));
  return r ? reviewDto(r, true) : null;
}));

router.post("/trades/:id/ai-review", assistantLimiter, route({
  cap: "assistant.use", params: z.object({ id: idParam }), body: z.object({ force: z.boolean().optional() }).passthrough(),
}, async ({ req, res, actor, params, body }) => {
  await requireTradeRead(req, params.id);
  const out = await generate(req, actor, !!body.force, async (ctx) => {
    const t = await gatherTrade(ctx, params.id);
    return { subject: { kind: "trade", tradeId: t.tradeId, trader: t.trader }, data: t.data, facts: null, subjectLabel: `trade ${t.tradeId}` };
  });
  res.status(201).json(out);
}));

// ─── day ────────────────────────────────────────────────────────────────────

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.get("/ai/day-review", route({ query: z.object({ date: YMD, trader: z.string().trim().max(120).optional() }).passthrough() }, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader);
  const r = await latestReview({ kind: "day", day: query.date, trader }, langOf(req));
  return r ? reviewDto(r, true) : null;
}));

router.post("/ai/day-review", assistantLimiter, route({
  cap: "assistant.use", body: z.object({ date: YMD, trader: z.string().trim().max(120).optional(), force: z.boolean().optional() }),
}, async ({ req, res, actor, body }) => {
  const trader = await personalTrader(req, body.trader);
  const out = await generate(req, actor, !!body.force, async (ctx) => {
    const d = await gatherDay(ctx, trader, body.date);
    return { subject: { kind: "day", day: d.day, trader: d.trader }, data: d.data, facts: d.facts, subjectLabel: `day ${d.day} of ${d.trader}` };
  });
  res.status(201).json(out);
}));

export default router;
