/**
 * Library of analogues (lib/analogues/*, migration 0286).
 *
 *   GET    /playbook/:id/cases                      readable setup → its example cases (ticker + day, times, note)
 *   POST   /playbook/:id/cases                      who may add examples to the setup: {ticker, day, entryTime?,
 *                                                   exitTime?, side?, note?} (Playbook input — manual by design)
 *   PATCH  /playbook/:id/cases/:caseId              the case's author or whoever may edit the setup
 *   DELETE /playbook/:id/cases/:caseId              same (soft delete)
 *   GET    /analogues?ticker=&day=&setupId=         «похожие прошлые случаи»: the desk's past trades, examples and cases
 *                                                   ranked by setup, catalyst type, gap band, direction, strength, regime
 *                                                   (counts and R only — no one's $ or name)
 *   GET    /academy/analogue-quiz?exclude=          «на что похоже»: an anonymised chart + setup choices
 *   POST   /academy/analogue-quiz/answer            {ref, setupId} → right or wrong + the revealed case
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { AppError, idParam, notFound, route, unauthorized } from "../lib/http";
import { resolveActor } from "../lib/permissions";
import { accessHints, canEditPure, canReadPure, loadSetupAccess, loadViewer } from "../lib/playbookAccess";
import { assertSetupUnlocked } from "../lib/playbookLock";
import { addDays, nyDate } from "../lib/tradingDate";
import { normTicker, DIRECTIONS, KINDS, STRENGTHS } from "../lib/catalyst/model";
import { analoguesOf, caseById, casesOf, deleteCase, insertCase, updateCase } from "../lib/analogues/store";
import { checkAnswer, nextQuestion } from "../lib/analogues/quiz";

const router: IRouter = Router();
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T12:00:00Z`)), "date");
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Ticker = z.string().trim().max(12).transform((v, ctx) => {
  const t = normTicker(v);
  if (!t) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ticker" });
  return t ?? "";
});
const CaseBody = z.object({
  ticker: Ticker,
  day: YMD,
  entryTime: HHMM.nullish(),
  exitTime: HHMM.nullish(),
  side: z.enum(["long", "short"]).nullish(),
  note: z.string().trim().max(2000).nullish(),
}).strict();

async function readableSetup(req: Request, id: number) {
  const row = await loadSetupAccess(id);
  const v = await loadViewer(req);
  if (!row || !canReadPure(v, row)) throw new AppError("SETUP_NOT_FOUND");
  await assertSetupUnlocked(req, id);
  return { row, v };
}

async function member(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  return actor;
}

router.get("/playbook/:id/cases", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  if (!req.authUser) throw unauthorized();
  const { row, v } = await readableSetup(req, params.id);
  return { cases: await casesOf(row.id), canAdd: accessHints(v, row).canAddExamples };
}));

router.post("/playbook/:id/cases", route({ params: z.object({ id: idParam }), body: CaseBody }, async ({ req, params, body, res }) => {
  const actor = await member(req);
  const { row, v } = await readableSetup(req, params.id);
  if (!accessHints(v, row).canAddExamples) throw new AppError("EXAMPLE_SETUP_FORBIDDEN");
  if (body.day > nyDate()) throw new AppError("DAY_IN_FUTURE");
  const c = await insertCase(row.id, {
    ticker: body.ticker, day: body.day, entryTime: body.entryTime ?? null, exitTime: body.exitTime ?? null, side: body.side ?? null, note: body.note || null,
  }, actor.name);
  res.status(201).json(c);
}));

async function editableCase(req: Request, setupId: number, caseId: number) {
  const actor = await member(req);
  const { row, v } = await readableSetup(req, setupId);
  const c = await caseById(caseId);
  if (!c || c.playbookId !== row.id) throw notFound();
  if (c.addedBy !== actor.name && !canEditPure(v, row)) throw new AppError("EXAMPLE_SETUP_FORBIDDEN");
  return c;
}

router.patch("/playbook/:id/cases/:caseId", route({ params: z.object({ id: idParam, caseId: idParam }), body: CaseBody.partial() }, async ({ req, params, body }) => {
  await editableCase(req, params.id, params.caseId);
  if (body.day && body.day > nyDate()) throw new AppError("DAY_IN_FUTURE");
  const patch = Object.fromEntries(Object.entries({ ...body, note: body.note === undefined ? undefined : body.note || null }).filter(([, x]) => x !== undefined));
  const c = await updateCase(params.caseId, patch);
  if (!c) throw notFound();
  return c;
}));

router.delete("/playbook/:id/cases/:caseId", route({ params: z.object({ id: idParam, caseId: idParam }) }, async ({ req, params }) => {
  await editableCase(req, params.id, params.caseId);
  if (!(await deleteCase(params.caseId))) throw notFound();
  return { ok: true };
}));

router.get("/analogues", route({
  query: z.object({
    ticker: Ticker, day: YMD.optional(), setupId: z.coerce.number().int().positive().optional(),
    kind: z.enum(KINDS).optional(), direction: z.enum(DIRECTIONS).optional(), strength: z.enum(STRENGTHS).optional(),
  }),
}, async ({ req, query }) => {
  await member(req);
  const v = await loadViewer(req);
  const day = query.day ?? nyDate();
  if (day > addDays(nyDate(), 7)) throw new AppError("DAY_IN_FUTURE");
  return analoguesOf(v, { ticker: query.ticker, day, setupId: query.setupId ?? null, own: { kind: query.kind, direction: query.direction, strength: query.strength } });
}));

router.get("/academy/analogue-quiz", route({ query: z.object({ exclude: z.string().max(2000).optional() }) }, async ({ req, query }) => {
  await member(req);
  const exclude = (query.exclude ?? "").split(",").map((s) => s.trim()).filter((s) => /^[ce]:\d+$/.test(s)).slice(0, 200);
  return { question: await nextQuestion({ exclude }) };
}));

router.post("/academy/analogue-quiz/answer", route({
  body: z.object({ ref: z.string().regex(/^[ce]:\d+$/), setupId: z.number().int().positive() }).strict(),
}, async ({ req, body }) => {
  await member(req);
  const a = await checkAnswer(body.ref, body.setupId);
  if (!a) throw notFound();
  return a;
}));

export default router;
