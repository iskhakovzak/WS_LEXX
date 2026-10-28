/**
 * Corporate and index event calendar (lib/corpEvents/*, migration 0285) — the «Катализаторы» page block «Корпоративные
 * и индексные события». Desk data, never per-trade input.
 *
 *   GET    /corp-events?from=&to=           any member: manual + rule + offerings-feed + news rows of the window
 *                                           (default today … today + catalyst.corpLookaheadDays), the type → setup map
 *   POST   /corp-events                     gameplan.publish (curators / admins): {day, type, ticker?, indexCode?, note?}
 *   PATCH  /corp-events/:id                 gameplan.publish
 *   DELETE /corp-events/:id                 gameplan.publish (soft delete)
 *   PUT    /corp-events/type-setups/:type   gameplan.publish: {playbookId | null} — the setup the desk trades the type with
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { can } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { AppError, badRequest, idParam, notFound, route } from "../lib/http";
import { addDays, nyDate } from "../lib/tradingDate";
import { setting } from "../lib/settings/registry";
import { normTicker } from "../lib/catalyst/model";
import { CORP_TYPES, INDEX_CODES } from "../lib/corpEvents/rules";
import { corpCalendar, deleteCorpEvent, insertCorpEvent, setTypeSetup, typeSetups, updateCorpEvent, type CorpInput } from "../lib/corpEvents/store";

const router: IRouter = Router();
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T12:00:00Z`)), "date");
const MAX_SPAN_DAYS = 400;
const Ticker = z.string().trim().max(12).transform((v, ctx) => {
  if (!v) return null;
  const t = normTicker(v);
  if (!t) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ticker" });
  return t;
});
const Body = z.object({
  day: YMD,
  type: z.enum(CORP_TYPES),
  ticker: Ticker.nullish(),
  indexCode: z.enum(INDEX_CODES).nullish(),
  note: z.string().trim().max(500).nullish(),
}).strict();

router.get("/corp-events", route({ query: z.object({ from: YMD.optional(), to: YMD.optional() }) }, async ({ req, query }) => {
  const from = query.from ?? nyDate();
  const to = query.to ?? addDays(from, setting("catalyst.corpLookaheadDays"));
  if (to < from || addDays(from, MAX_SPAN_DAYS) < to) throw new AppError("INVALID_RANGE", undefined, { max: MAX_SPAN_DAYS });
  const [events, setups, canEdit] = await Promise.all([corpCalendar(from, to), typeSetups(), can(req, "gameplan.publish")]);
  return { from, to, events, typeSetups: Object.fromEntries(setups), canEdit };
}));

router.post("/corp-events", route({ cap: "gameplan.publish", body: Body }, async ({ body, actor, res }) => {
  if (!body.ticker && !body.indexCode) throw badRequest("INVALID_FIELD", undefined, { field: "ticker" });
  const id = await insertCorpEvent({ day: body.day, type: body.type, ticker: body.ticker ?? null, indexCode: body.indexCode ?? null, note: body.note || null }, actor.name);
  await logAudit({ actor: actor.name, action: "corp_events.create", targetType: "corp_events", targetId: String(id), details: { day: body.day, type: body.type, ticker: body.ticker ?? null } });
  res.status(201).json({ id });
}));

router.patch("/corp-events/:id", route({ cap: "gameplan.publish", params: z.object({ id: idParam }), body: Body.partial() }, async ({ params, body, actor }) => {
  const patch: Partial<CorpInput> = {};
  if (body.day) patch.day = body.day;
  if (body.type) patch.type = body.type;
  if ("ticker" in body) patch.ticker = body.ticker ?? null;
  if ("indexCode" in body) patch.indexCode = body.indexCode ?? null;
  if ("note" in body) patch.note = body.note || null;
  const ok = await updateCorpEvent(params.id, patch);
  if (!ok) throw notFound();
  await logAudit({ actor: actor.name, action: "corp_events.update", targetType: "corp_events", targetId: String(params.id), details: body });
  return { ok: true };
}));

router.delete("/corp-events/:id", route({ cap: "gameplan.publish", params: z.object({ id: idParam }) }, async ({ params, actor }) => {
  if (!(await deleteCorpEvent(params.id))) throw notFound();
  await logAudit({ actor: actor.name, action: "corp_events.delete", targetType: "corp_events", targetId: String(params.id) });
  return { ok: true };
}));

router.put("/corp-events/type-setups/:type", route({
  cap: "gameplan.publish",
  params: z.object({ type: z.enum(CORP_TYPES) }),
  body: z.object({ playbookId: z.number().int().positive().nullable() }).strict(),
}, async ({ params, body, actor }) => {
  if (body.playbookId != null) {
    const { rows } = await pool.query(`SELECT 1 FROM playbook WHERE id = $1 AND deleted_at IS NULL`, [body.playbookId]);
    if (!rows.length) throw notFound();
  }
  await setTypeSetup(params.type, body.playbookId, actor.name);
  await logAudit({ actor: actor.name, action: "corp_events.type_setup", targetType: "corp_event_type_setups", targetId: params.type, details: { playbookId: body.playbookId } });
  return { type: params.type, playbookId: body.playbookId };
}));

export default router;
