/**
 * The trader's day state (lib/dayState): what the dashboard leads with, and who on the team is stopped, paused, new.
 *
 *   GET  /api/me/state               the viewer's state (stopped | paused | newcomer | premarket | session |
 *                                    after_session), its facts (stop rule, last trade day, silent trading days, closed
 *                                    trades, review backlog with `freshFrom`) and the thresholds in force
 *   GET  /api/state/team             risk.read.team → { today, states } for the active traders in the viewer's scope
 *   GET  /api/state/trader/:name     journal.review on that trader → one state
 *   POST /api/state/message          journal.review on the trader {trader, text} → an in-app «curator_message» to the
 *                                    trader (the «Написать» of the silence signal; never Telegram)
 *
 * Read-only apart from the message; numbers come from the risk desk / journal (see lib/dayState/load.ts).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { assertCap, route } from "../lib/http/route";
import { notFound } from "../lib/http";
import { readScope } from "../lib/permissions";
import { notifyUser } from "../lib/notifyUtils";
import { langOf } from "../i18n";
import { activeTraders, traderStates } from "../lib/dayState/load";

const router: IRouter = Router();

const traderName = z.string().trim().min(1).max(100);

router.get("/me/state", route({}, async ({ req }) => {
  const actor = await assertCap(req, "trades.read.own", { trader: req.authUser?.name ?? "" });
  const [state] = await traderStates([actor.name], { lang: langOf(req) });
  if (!state) throw notFound("TRADER_NOT_FOUND");
  return state;
}));

router.get("/state/team", route({ cap: "risk.read.team" }, async ({ req }) => {
  const [names, scope] = await Promise.all([activeTraders(), readScope(req, "risk.read.team")]);
  const allowed = scope ? new Set(scope) : null;
  const states = await traderStates(allowed ? names.filter((n) => allowed.has(n)) : names, { lang: langOf(req) });
  return { today: states[0]?.today ?? null, states };
}));

router.get("/state/trader/:name", route({ params: z.object({ name: traderName }) }, async ({ req, params }) => {
  await assertCap(req, "journal.review", { trader: params.name });
  const [state] = await traderStates([params.name], { lang: langOf(req) });
  if (!state) throw notFound("TRADER_NOT_FOUND");
  return state;
}));

router.post("/state/message", route({
  cap: "journal.review",
  body: z.object({ trader: traderName, text: z.string().trim().min(1).max(1000) }),
}, async ({ req, body }) => {
  const actor = await assertCap(req, "journal.review", { trader: body.trader });
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE name = $1 AND active = true LIMIT 1`, [body.trader]);
  if (!rows.length) throw notFound("TRADER_NOT_FOUND");
  const id = await notifyUser({
    userName: body.trader, type: "curator_message", severity: "info", params: { curator: actor.name, text: body.text },
    link: "/", entityType: "trader", entityId: body.trader, actor: actor.name, source: "curator",
  });
  return { ok: true, delivered: id != null };
}));

export default router;
