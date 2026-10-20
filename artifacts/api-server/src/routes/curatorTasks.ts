/**
 * «Готово» on a curator task (Волна 2 п. 2.13 — the curator's response as a step of the loop). Mounted by
 * routes/curator.ts (kept under the size ratchet).
 *
 *   POST /curator/tasks/:id/done   the trader whose manual curator task («curator_task» quest) it is reports it done:
 *                                  the task is stamped once (params.traderDoneOn), the assigning curator is notified
 *                                  (in his language, link to the trader in the cabinet) and still confirms it with
 *                                  POST /quests/:id/complete; the report earns TASK_DONE_POINTS discipline points at
 *                                  most once per NY day (lib/gamification/taskDone). Repeating it answers
 *                                  { already: true, points: 0 }. Someone else's / unknown task → 404 QUEST_NOT_FOUND,
 *                                  an auto-tracked curator quest → QUEST_NOT_MANUAL, a finished one → QUEST_NOT_ACTIVE.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { AppError, assertCap, idParam, notFound, route } from "../lib/http";
import { nyDate } from "../lib/tradingDate";
import { logger } from "../lib/logger";
import { notifyUser } from "../lib/notifyUtils";
import { localeOfUser } from "../i18n";
import { gamificationT } from "../i18n/ns";
import { questById } from "../lib/quests/store";
import { forgetQuests, isManual } from "../lib/quests/service";
import { TASK_DONE_POINTS, awardTaskDone, markTaskReported } from "../lib/gamification/taskDone";

const router: IRouter = Router();

async function notifyCurator(curator: string, trader: string, id: number, note: string | null): Promise<void> {
  const t = gamificationT.tFor(await localeOfUser(curator));
  await notifyUser({
    userName: curator, type: "curator_request", actor: trader, source: "quests",
    title: t("taskDone.title", { trader }),
    message: note ? t("taskDone.body", { note }) : t("taskDone.bodyNoNote"),
    link: `/curator?trader=${encodeURIComponent(trader)}`, entityType: "quest", entityId: String(id),
  });
}

router.post("/curator/tasks/:id/done", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const me = req.authUser?.name ?? "";
  await assertCap(req, "journal.write.own", { trader: me });
  const q = await questById(params.id);
  if (!q || q.trader !== me || q.scope !== "curator" || q.status === "cancelled") throw notFound("QUEST_NOT_FOUND");
  if (!isManual(q)) throw new AppError("QUEST_NOT_MANUAL");
  if (q.status !== "active") throw new AppError("QUEST_NOT_ACTIVE");
  const reported = typeof q.params?.traderDoneOn === "string" ? q.params.traderDoneOn : null;
  if (reported) return { ok: true, reportedOn: reported, points: 0, already: true };
  const day = nyDate();
  if (!(await markTaskReported(q.id, me, day))) {
    const again = await questById(q.id);
    const on = typeof again?.params?.traderDoneOn === "string" ? again.params.traderDoneOn : null;
    if (again?.status === "active" && on) return { ok: true, reportedOn: on, points: 0, already: true };
    throw new AppError("QUEST_NOT_ACTIVE");
  }
  const awarded = await awardTaskDone(me, day).catch((err) => {
    logger.warn({ err: (err as Error)?.message, trader: me }, "curator task done: points failed");
    return false;
  });
  forgetQuests(me);
  if (q.assignedBy && q.assignedBy !== me) {
    await notifyCurator(q.assignedBy, me, q.id, q.note).catch((err) => logger.warn({ err: (err as Error)?.message }, "curator task done: notify failed"));
  }
  return { ok: true, reportedOn: day, points: awarded ? TASK_DONE_POINTS : 0, already: false };
}));

export default router;
