/**
 * Quests and achievements (owner 2026-10-18: «добавить квесты и ачивки — очень развей эту систему»). Logic:
 * lib/quests/service.ts over the pure catalog / engine / achievements; shapes: lib/quests/types.ts.
 *
 *   GET  /api/quests/me               the viewer's QuestsMe (quests synced for today, achievements awarded)
 *   GET  /api/quests/trader/:name     the same for a trader (journal.review on that trader)
 *   GET  /api/quests/templates        curator-assignable templates with bounds and default points (journal.review)
 *   POST /api/quests/assign           AssignQuestBody — a curator quest for a trader the viewer reviews (journal.review
 *                                     on the trader); progress counts from today
 *   POST /api/quests/:id/cancel       the assigner (or an admin) cancels an active curator quest
 *   POST /api/quests/:id/complete     a reviewer of the trader marks the manual «curator_task» done
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AppError, assertCap, idParam, notFound, route } from "../lib/http";
import { nyDate } from "../lib/tradingDate";
import { setting } from "../lib/settings/registry";
import { CURATOR_TEMPLATES } from "../lib/quests/catalog";
import { questById } from "../lib/quests/store";
import {
  activeCuratorCount, assignQuest, cancelQuest, checkAssign, completeQuest, isManual, MAX_DEADLINE_DAYS, questsMe,
} from "../lib/quests/service";

const router: IRouter = Router();

const isRealDate = (s: string) => {
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, "invalid date");
const traderName = z.string().trim().min(1).max(100);

async function userRow(name: string): Promise<{ role: string; active: boolean } | null> {
  const { rows } = await pool.query<{ role: string; active: boolean }>(`SELECT role, active FROM users WHERE name = $1 LIMIT 1`, [name]);
  return rows[0] ?? null;
}

router.get("/quests/me", route({}, async ({ req }) => {
  const actor = await assertCap(req, "trades.read.own", { trader: req.authUser?.name ?? "" });
  return questsMe(actor.name);
}));

router.get("/quests/trader/:name", route({ params: z.object({ name: traderName }) }, async ({ req, params }) => {
  await assertCap(req, "journal.review", { trader: params.name });
  if (!(await userRow(params.name))) throw notFound("TRADER_NOT_FOUND");
  return questsMe(params.name);
}));

router.get("/quests/templates", route({ cap: "journal.review" }, async () => ({
  templates: CURATOR_TEMPLATES.map((t) => ({
    template: t.key,
    title: { key: `quest.${t.key}.title`, params: { target: t.assign.defaultTarget, count: t.assign.defaultTarget } },
    description: { key: `quest.${t.key}.desc`, params: { target: t.assign.defaultTarget, count: t.assign.defaultTarget, done: 0 } },
    unit: t.assign.unit,
    defaultTarget: t.assign.defaultTarget,
    minTarget: t.assign.minTarget,
    maxTarget: t.assign.maxTarget,
    defaultPoints: setting("quests.curatorDefaultPoints"),
    manual: t.key === "curator_task",
  })),
  maxPoints: setting("quests.curatorMaxPoints"),
  maxDeadlineDays: MAX_DEADLINE_DAYS,
})));

const AssignBody = z.object({
  trader: traderName,
  template: z.string().trim().min(1).max(60),
  target: z.number().int(),
  endsOn: ymd,
  rewardPoints: z.number().int().optional(),
  note: z.string().max(500).optional(),
});

router.post("/quests/assign", route({ body: AssignBody }, async ({ req, body }) => {
  const actor = await assertCap(req, "journal.review", { trader: body.trader });
  const user = await userRow(body.trader);
  if (!user) throw notFound("TRADER_NOT_FOUND");
  if (user.role !== "trader" || !user.active) throw new AppError("QUEST_TRADER_ONLY");
  const today = nyDate();
  const problem = checkAssign(body, today, await activeCuratorCount(body.trader));
  if (problem) {
    const { code, ...params } = problem;
    throw new AppError(code, undefined, params as Record<string, string | number>);
  }
  return assignQuest(body, actor.name, today);
}));

async function curatorQuest(id: number) {
  const q = await questById(id);
  if (!q || q.scope !== "curator" || q.status === "cancelled") throw notFound("QUEST_NOT_FOUND");
  return q;
}

router.post("/quests/:id/cancel", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const q = await curatorQuest(params.id);
  const actor = await assertCap(req, "journal.review", { trader: q.trader });
  if (actor.name !== q.assignedBy && actor.role !== "admin") throw new AppError("QUEST_NOT_YOURS");
  if (q.status !== "active") throw new AppError("QUEST_NOT_ACTIVE");
  const out = await cancelQuest(q, actor.name);
  if (!out) throw new AppError("QUEST_NOT_ACTIVE");
  return { ok: true, quest: out };
}));

router.post("/quests/:id/complete", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const q = await curatorQuest(params.id);
  const actor = await assertCap(req, "journal.review", { trader: q.trader });
  if (!isManual(q)) throw new AppError("QUEST_NOT_MANUAL");
  if (q.status !== "active") throw new AppError("QUEST_NOT_ACTIVE");
  const out = await completeQuest(q, actor.name);
  if (!out) throw new AppError("QUEST_NOT_ACTIVE");
  return { ok: true, quest: out };
}));

export default router;
