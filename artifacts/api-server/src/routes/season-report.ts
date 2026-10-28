/**
 * «Автоотчёт за сезон» (lib/deskPulse/seasonReport + reportStore) — the season level of the weekly review, generated
 * from PropReports trades. The trader writes only the conclusions; they are saved into his Playbook as a note.
 *
 *   GET /season-report?trader=&season=current|previous&from=&to=   own report (staff: a trader's with
 *                                                                  trades.read.team) — the default is the current season
 *   GET /season-report/group?season=&from=&to=&scope=              curators / admins (trades.read.team): «Моя группа /
 *                                                                  Все» — per trader the totals and whether the
 *                                                                  conclusions are written
 *   PUT /season-report/conclusions                                 the caller's own conclusions { from, to, title,
 *                                                                  folder?, text } → his Playbook note of that period
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { personalTrader } from "../lib/auth";
import { AppError, route, unauthorized } from "../lib/http";
import { resolveActor } from "../lib/permissions";
import { loadRoster } from "../lib/curatorRoster";
import { CONCLUSIONS_MAX, groupReports, saveConclusions, seasonReportOf, seasonWindow } from "../lib/deskPulse/reportStore";

const router: IRouter = Router();
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = { season: z.enum(["current", "previous"]).optional(), from: YMD.optional(), to: YMD.optional() };

router.get("/season-report", route({
  query: z.object({ trader: z.string().trim().max(120).optional(), ...period }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "trades.read.team");
  const w = seasonWindow(query);
  return { ...(await seasonReportOf(trader, w.from, w.to)), season: w.season, seasons: { current: w.current, previous: w.previous } };
}));

router.get("/season-report/group", route({
  cap: "trades.read.team",
  query: z.object({ scope: z.enum(["group", "all", "mine", "desk"]).optional(), ...period }),
}, async ({ req, query }) => {
  const w = seasonWindow(query);
  const r = await loadRoster(req, query.scope);
  return { from: w.from, to: w.to, season: w.season, scope: r.scope, rows: await groupReports(r.traders, w.from, w.to) };
}));

router.put("/season-report/conclusions", route({
  body: z.object({
    from: YMD, to: YMD,
    title: z.string().trim().min(1).max(160),
    folder: z.string().trim().max(80).nullish(),
    text: z.string().trim().min(1).max(CONCLUSIONS_MAX),
  }).refine((b) => b.from <= b.to, "period"),
}, async ({ req, body }) => {
  const a = await resolveActor(req);
  if (!a) throw unauthorized();
  if (a.guest) throw new AppError("GUEST_READ_ONLY");
  return saveConclusions(a.name, { from: body.from, to: body.to }, { title: body.title, folder: body.folder || null, text: body.text });
}));

export default router;
