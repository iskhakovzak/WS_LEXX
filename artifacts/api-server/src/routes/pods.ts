/**
 * Trading pods (lib/pods/*, migration 0287) — 2–4 traders inside a curator's desk group.
 *
 *   GET    /pods                         my pod (as a member) + the groups / pods I manage (group curator; admin: all)
 *   POST   /pods                         manager: {groupId, name, memberIds} (traders of that group, one pod each,
 *                                        pods.minMembers … pods.maxMembers)
 *   PATCH  /pods/:id                     manager: {name?, memberIds?, archived?}
 *   GET    /pods/:id/stats?from=&to=     member / staff: per member + sum + median (core metrics), the money rules of
 *                                        lib/pods/stats (a trader: own $ only, the $ sum from 3 active members, no $ median)
 *   GET    /pods/:id/feed                member / staff;  POST {body} member / manager;  DELETE /pods/:id/feed/:postId
 *                                        author / manager (soft delete)
 *   GET    /pods/:id/review?week=        the shared weekly review (week = its Monday);  PUT {week, body} member / manager
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { AppError, badRequest, conflict, forbidden, idParam, notFound, route, unauthorized } from "../lib/http";
import { can, resolveActor } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { setting } from "../lib/settings/registry";
import { addDays, nyDate } from "../lib/tradingDate";
import { podStats } from "../lib/pods/stats";
import {
  addPost, createPod, deletePost, inOtherPod, managedGroups, memberTotals, podById, podFeed, podOfUser, podReview, podsOfGroups,
  postById, saveReview, tradersOfGroup, updatePod, type Pod,
} from "../lib/pods/store";
import { pool } from "@workspace/db";

const router: IRouter = Router();
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T12:00:00Z`)), "date");
const Name = z.string().trim().min(1).max(60);
const Ids = z.array(z.number().int().positive()).max(20);

/** Monday of the NY calendar week of `day`. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

async function actorOf(req: Request) {
  const a = await resolveActor(req);
  if (!a) throw unauthorized();
  if (a.guest) throw new AppError("GUEST_READ_ONLY");
  return a;
}

type Ctx = { pod: Pod; member: boolean; manager: boolean; staff: boolean; name: string };
/** The pod and what the caller may do with it; 404 for a trader outside it (pods are not public). */
async function podCtx(req: Request, id: number): Promise<Ctx> {
  const a = await actorOf(req);
  const pod = await podById(id);
  if (!pod) throw notFound();
  const admin = await can(req, "settings.manage");
  const manager = admin || pod.curatorId === a.id;
  const staff = await can(req, "trades.read.team");
  const member = pod.members.some((m) => m.id === a.id);
  if (!member && !manager && !(await can(req, "team.read"))) throw notFound();
  return { pod, member, manager, staff, name: a.name };
}

async function checkMembers(groupId: number, ids: readonly number[], podId: number | null): Promise<number[]> {
  const uniq = [...new Set(ids)];
  const min = setting("pods.minMembers");
  const max = Math.max(min, setting("pods.maxMembers"));
  if (uniq.length < min || uniq.length > max) throw badRequest("INVALID_FIELD", { min, max }, { field: "memberIds" });
  const ok = await tradersOfGroup(groupId, uniq);
  if (ok.length !== uniq.length) throw badRequest("INVALID_FIELD", undefined, { field: "memberIds" });
  const taken = await inOtherPod(uniq, podId);
  if (taken.length) throw conflict("CONFLICT", { taken });
  return uniq;
}

router.get("/pods", route({}, async ({ req }) => {
  const a = await actorOf(req);
  const admin = await can(req, "settings.manage");
  const [mine, groups] = await Promise.all([podOfUser(a.id), managedGroups(admin ? null : a.id)]);
  const pods = groups.length ? await podsOfGroups(admin ? null : groups.map((g) => g.id)) : [];
  return { mine, managed: groups.length ? { groups, pods } : null, limits: { min: setting("pods.minMembers"), max: setting("pods.maxMembers") } };
}));

router.post("/pods", route({ body: z.object({ groupId: z.number().int().positive(), name: Name, memberIds: Ids }).strict() }, async ({ req, body, res }) => {
  const a = await actorOf(req);
  const { rows } = await pool.query(`SELECT curator_id FROM desk_groups WHERE id = $1 AND archived_at IS NULL`, [body.groupId]);
  if (!rows[0]) throw notFound();
  if (Number(rows[0].curator_id) !== a.id && !(await can(req, "settings.manage"))) throw forbidden();
  const members = await checkMembers(body.groupId, body.memberIds, null);
  const id = await createPod(body.groupId, body.name, members, a.name);
  await logAudit({ actor: a.name, action: "pods.create", targetType: "trading_pods", targetId: String(id), details: { groupId: body.groupId, name: body.name, members } });
  res.status(201).json(await podById(id));
}));

router.patch("/pods/:id", route({
  params: z.object({ id: idParam }),
  body: z.object({ name: Name.optional(), memberIds: Ids.optional(), archived: z.literal(true).optional() }).strict(),
}, async ({ req, params, body }) => {
  const c = await podCtx(req, params.id);
  if (!c.manager) throw forbidden();
  const memberIds = body.memberIds && !body.archived ? await checkMembers(c.pod.groupId, body.memberIds, c.pod.id) : undefined;
  await updatePod(c.pod.id, { name: body.name, memberIds, archived: body.archived });
  await logAudit({ actor: c.name, action: body.archived ? "pods.archive" : "pods.update", targetType: "trading_pods", targetId: String(c.pod.id), details: body });
  return body.archived ? { ok: true } : await podById(c.pod.id);
}));

router.get("/pods/:id/stats", route({ params: z.object({ id: idParam }), query: z.object({ from: YMD.optional(), to: YMD.optional() }) }, async ({ req, params, query }) => {
  const c = await podCtx(req, params.id);
  const to = query.to ?? nyDate();
  const from = query.from ?? mondayOf(to);
  if (from > to || addDays(from, 400) < to) throw new AppError("INVALID_RANGE", undefined, { max: 400 });
  const totals = await memberTotals(c.pod.members.map((m) => m.name), from, to);
  return { podId: c.pod.id, from, to, ...podStats(totals, c.name, c.staff) };
}));

router.get("/pods/:id/feed", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const c = await podCtx(req, params.id);
  return { posts: await podFeed(c.pod.id), canPost: c.member || c.manager };
}));

router.post("/pods/:id/feed", route({ params: z.object({ id: idParam }), body: z.object({ body: z.string().trim().min(1).max(4000) }).strict() }, async ({ req, params, body, res }) => {
  const c = await podCtx(req, params.id);
  if (!c.member && !c.manager) throw forbidden();
  res.status(201).json(await addPost(c.pod.id, body.body, c.name));
}));

router.delete("/pods/:id/feed/:postId", route({ params: z.object({ id: idParam, postId: idParam }) }, async ({ req, params }) => {
  const c = await podCtx(req, params.id);
  const p = await postById(c.pod.id, params.postId);
  if (!p || p.kind !== "post") throw notFound();
  if (p.author !== c.name && !c.manager) throw forbidden();
  await deletePost(p.id);
  return { ok: true };
}));

router.get("/pods/:id/review", route({ params: z.object({ id: idParam }), query: z.object({ week: YMD.optional() }) }, async ({ req, params, query }) => {
  const c = await podCtx(req, params.id);
  const week = mondayOf(query.week ?? nyDate());
  return { week, review: await podReview(c.pod.id, week), canEdit: c.member || c.manager };
}));

router.put("/pods/:id/review", route({ params: z.object({ id: idParam }), body: z.object({ week: YMD, body: z.string().trim().min(1).max(4000) }).strict() }, async ({ req, params, body }) => {
  const c = await podCtx(req, params.id);
  if (!c.member && !c.manager) throw forbidden();
  return saveReview(c.pod.id, mondayOf(body.week), body.body, c.name);
}));

export default router;
