/**
 * Playbook «Сегодня» (owner 2026-10-18: traders open the playbook in the morning to prepare). Shapes:
 * lib/playbookToday/types.ts; logic: lib/playbookToday/{service,build,plan}.ts.
 *
 *   GET /api/playbook/today[?trader=]   PlaybookToday for the viewer; staff pass ?trader= (journal.review on them)
 *   PUT /api/playbook/today/picks       { setupIds } → picks (≤ 3, unlocked, office or own setups) saved into the
 *                                       viewer's personal plan for PlaybookToday.date (doc.setups; row created if missing)
 * Mounted before routes/playbook.ts so "/playbook/today" never reads as a setup id.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AppError, assertCap, notFound, route } from "../lib/http";
import { checkPicks } from "../lib/playbookToday/build";
import { savePicks } from "../lib/playbookToday/plan";
import { playbookToday, rememberPicks } from "../lib/playbookToday/service";

const router: IRouter = Router();

const TodayQuery = z.object({ trader: z.string().trim().min(1).max(100).optional() });
const PicksBody = z.object({ setupIds: z.array(z.number().int().positive()).max(50) });

router.get("/playbook/today", route({ query: TodayQuery }, async ({ req, query }) => {
  const me = req.authUser?.name ?? "";
  if (query.trader && query.trader !== me) {
    await assertCap(req, "journal.review", { trader: query.trader });
    const { rowCount } = await pool.query(`SELECT 1 FROM users WHERE name = $1`, [query.trader]);
    if (!rowCount) throw notFound("TRADER_NOT_FOUND");
    return playbookToday(query.trader);
  }
  const actor = await assertCap(req, "trades.read.own", { trader: me });
  return playbookToday(actor.name);
}));

router.put("/playbook/today/picks", route({ body: PicksBody }, async ({ req, body }) => {
  const actor = await assertCap(req, "journal.write.own", { trader: req.authUser?.name ?? "" });
  const today = await playbookToday(actor.name, { fresh: true });
  const c = checkPicks(body.setupIds, today);
  if (!c.ok) {
    if (c.code === "TOO_MANY") throw new AppError("TOO_MANY", undefined, { field: "setupIds", max: c.max });
    if (c.code === "SETUP_NOT_FOUND") throw notFound("SETUP_NOT_FOUND");
    throw new AppError("PLAYBOOK_SETUP_LOCKED", undefined, { name: c.name });
  }
  const picks = await savePicks(actor.name, today.date, c.ids);
  rememberPicks(actor.name, today.date, picks);
  return picks;
}));

export default router;
