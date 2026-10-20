/**
 * «Попросить куратора» (Волна 1 п. 1.1): wherever a trader sees «задаёт куратор» — limits, a learning group, the stage,
 * the desk plan — one button sends a request; it waits in the curator cabinet («Сегодня» → «Запросы») and the answer
 * comes back as a notification (in-app + Telegram).
 *
 *   POST  /curator-requests           member {kind, message?, link?} → 201 {request}; one open request per kind
 *                                     (409 CURATOR_REQUEST_OPEN, details.id); notifies the group curator / assigned
 *                                     staff (nobody assigned → every curator). Kind «review» (Волна 2 п. 2.13,
 *                                     «Попросить разбор» from a discussion / an idea) needs `link` = that thread
 *                                     («/discussions?thread=7», «/trade-ideas?idea=3»; 400 otherwise), one open per
 *                                     thread; the curator's notification and queue row lead to the thread
 *   GET   /curator-requests/mine      member → {requests} own open + resolved in the last 30 days
 *   GET   /curator-requests           journal.review ?status=open|done|dismissed&scope=group|all → {requests, scope}
 *                                     within the matrix scope; default «Моя группа» when the viewer leads anyone
 *   PATCH /curator-requests/:id       journal.review on that trader {status: done|dismissed, note?} → {request};
 *                                     the trader is notified with the note (404 outside the scope, 409 when closed)
 *
 * Texts are rendered in the recipient's language (server `risk` namespace, curatorRequests.*). Store:
 * lib/people/curatorRequests.ts; scope: lib/people/deskGroups.ts.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { readScope, requireCap, can } from "../lib/permissions";
import { notifyUser } from "../lib/notifyUtils";
import { logAudit } from "../lib/audit";
import { conflict, notFound, unauthorized } from "../lib/http";
import { localeOfUser } from "../i18n";
import { riskT } from "../i18n/ns";
import {
  REQUEST_KINDS, REQUEST_STATUSES, REVIEW_LINK_RE, insertRequest, listForStaff, listMine, memberId, openRequestOf, requestById, requestRecipients,
  resolveRequest, type CuratorRequest, type RequestKind,
} from "../lib/people/curatorRequests";
import { myPeople, pickScope } from "../lib/people/deskGroups";

const router: IRouter = Router();

/** Where the trader acts on the answer. */
const TRADER_LINK: Record<RequestKind, string> = { limits: "/risk", group: "/academy/my", stage: "/academy/path", plan: "/game-plan", other: "/", review: "/discussions" };
const CURATOR_LINK = "/curator?view=today#curator-requests";

/** Where a notification about `r` leads: a review request → its thread; else the kind's page / the curator cabinet. */
export const linkFor = (r: Pick<CuratorRequest, "kind" | "link">, side: "trader" | "curator"): string =>
  r.kind === "review" && r.link ? r.link : side === "trader" ? TRADER_LINK[r.kind] : CURATOR_LINK;

const CreateBody = z.object({
  kind: z.enum(REQUEST_KINDS),
  message: z.string().trim().max(500).optional().default(""),
  link: z.string().trim().max(120).regex(REVIEW_LINK_RE).optional(),
}).strict().refine((b) => (b.kind === "review") === !!b.link, { path: ["link"], message: "link is required for a review request (and only for it)" });

const ResolveBody = z.object({
  status: z.enum(["done", "dismissed"]),
  note: z.string().trim().max(500).nullable().optional().transform((v) => (v ? v : null)),
}).strict();

async function notifyCurators(r: CuratorRequest): Promise<void> {
  for (const name of await requestRecipients(r.trader)) {
    const t = riskT.tFor(await localeOfUser(name));
    await notifyUser({
      userName: name, type: "curator_request", actor: r.trader, source: "curator",
      title: t("curatorRequests.newTitle", { trader: r.trader, kind: t(`curatorRequests.kind.${r.kind}`) }),
      message: r.message ? t("curatorRequests.newBody", { message: r.message }) : t("curatorRequests.noMessage"),
      link: linkFor(r, "curator"), entityType: "curator_request", entityId: r.id,
    });
  }
}

async function notifyTrader(r: CuratorRequest, actor: string): Promise<void> {
  const t = riskT.tFor(await localeOfUser(r.trader));
  const kind = t(`curatorRequests.kind.${r.kind}`);
  await notifyUser({
    userName: r.trader, type: "curator_request_done", actor, source: "curator", telegram: true,
    title: t(r.status === "done" ? "curatorRequests.doneTitle" : "curatorRequests.dismissedTitle", { kind }),
    message: r.note ?? t(r.status === "done" ? "curatorRequests.doneBody" : "curatorRequests.dismissedBody"),
    link: linkFor(r, "trader"), entityType: "curator_request", entityId: r.id,
  });
}

router.post("/curator-requests", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "journal.write.own"))) return;
  const parsed = CreateBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const me = req.authUser!.name;
  const id = await memberId(me);
  if (id == null) throw unauthorized();
  const { kind, message } = parsed.data;
  const link = parsed.data.link ?? null;
  const open = await openRequestOf(id, kind, link);
  if (open) throw conflict("CURATOR_REQUEST_OPEN", { id: open.id });
  const created = await insertRequest(id, kind, message, link);
  if (!created) throw conflict("CURATOR_REQUEST_OPEN");
  await notifyCurators(created).catch(() => undefined); // the request is saved; a failed notification must not fail it
  res.status(201).json({ request: created });
}));

router.get("/curator-requests/mine", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "journal.write.own"))) return;
  const id = await memberId(req.authUser!.name);
  res.json({ requests: id == null ? [] : await listMine(id) });
}));

router.get("/curator-requests", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "journal.review"))) return;
  const status = (REQUEST_STATUSES as readonly string[]).includes(String(req.query.status)) ? (String(req.query.status) as (typeof REQUEST_STATUSES)[number]) : null;
  const [readable, mine] = await Promise.all([readScope(req, "journal.review"), myPeople(req.authUser!.name)]);
  const { scope, names } = pickScope(req.query.scope, mine);
  let traders: string[] | null = readable;
  if (names) traders = (traders ?? [...names]).filter((n) => names.has(n));
  res.json({ scope, requests: await listForStaff(traders, status) });
}));

router.patch("/curator-requests/:id", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "journal.review"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw notFound("CURATOR_REQUEST_NOT_FOUND");
  const parsed = ResolveBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const cur = await requestById(id);
  if (!cur || !(await can(req, "journal.review", { trader: cur.trader }))) throw notFound("CURATOR_REQUEST_NOT_FOUND");
  if (cur.status !== "open") throw conflict("CURATOR_REQUEST_CLOSED");
  const actor = req.authUser!;
  const done = await resolveRequest(id, parsed.data.status, parsed.data.note, actor.id);
  if (!done) throw conflict("CURATOR_REQUEST_CLOSED");
  await logAudit({ actor: actor.name, action: `curator.request.${done.status}`, targetType: "curator_requests", targetId: String(id), details: { trader: done.trader, kind: done.kind } });
  await notifyTrader(done, actor.name).catch(() => undefined);
  res.json({ request: done });
}));

export default router;
