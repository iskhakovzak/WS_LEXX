/**
 * «Ментор» — the personal AI mentor (lib/mentor/*). Page /coach, the dashboard line, the curator's per-trader panel.
 *
 *   GET    /mentor?trader=            the mentor state: facts it knows (hidden ones marked), memory notes, commitments
 *                                     with progress and verdict, today's check-in, the period digests (brief / debrief /
 *                                     weekly, `stale` when the context changed), the AI status and budget, the thread
 *                                     (own view only). Another trader: journal.review on him (curators: their wards) —
 *                                     notes, facts, commitments and escalations, never the conversation.
 *   GET    /mentor/line               the compact «Ментор: …» line for the dashboard (no model call, light)
 *   POST   /mentor/rhythm             { kind: brief | debrief | weekly, force? } → the digest (cached or new) + escalation check
 *   POST   /mentor/chat               { message } → the reply (one turn; notes / an agreed commitment applied)
 *   DELETE /mentor/thread             «Очистить» the conversation (memory notes stay)
 *   POST   /mentor/notes              { kind, body, trader? } — own note; with another trader: the curator's guidance
 *   PATCH  /mentor/notes/:id          { body?, kind? } — the trader edits notes about himself (not the curator's
 *   DELETE /mentor/notes/:id            guidance); the curator edits his guidance
 *   PUT    /mentor/hidden             { keys } — data facts the trader hides from the mentor
 *   POST   /mentor/commitments        { kind, minutes?, count?, usd?, time?, text, replaceId?, trader? } — own, or the curator's
 *   PATCH  /mentor/commitments/:id    { status: achieved | dropped, note? }
 *   GET    /mentor/escalations?scope= the roster's escalations of the last 30 days (journal.review)
 *   POST   /mentor/escalations/:id/ack  the curator took it (journal.review on the trader)
 *   GET    /mentor/admin/cost?days=   admin (settings.manage): the mentor's calls and cost (live and batch)
 *
 * Generating (rhythm, chat) is the trader's own action: capability assistant.use, the assistant's gate and daily
 * budget (routes/ai-assistant ready: desk switch, juniors switch, AI_BUDGET_EXCEEDED), the desk switch mentor.enabled,
 * the assistant request rate. GET never generates and never writes.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { AppError, assertCap, idParam, notFound, route } from "../lib/http";
import { isStaffRole, personalTrader } from "../lib/auth";
import { can, type Actor } from "../lib/permissions";
import { assistantLimiter } from "../lib/rateLimits";
import { setting } from "../lib/settings/registry";
import { addDays, nyDate, nyMinutes } from "../lib/tradingDate";
import { langOf } from "../i18n";
import { assistantClient } from "../lib/assistant/client";
import { budgetOf, usageToday } from "../lib/assistant/store";
import { loadRoster } from "../lib/curatorRoster";
import { behaviorTradesOf } from "../lib/daily/load";
import { COMMITMENT_KINDS, commitmentVerdict, trackCommitment } from "../lib/mentor/commitments";
import { gatherFacts, type MentorFacts } from "../lib/mentor/facts";
import { mentorContext } from "../lib/mentor/prompt";
import { MentorInvalid, MentorRefused } from "../lib/mentor/run";
import { ProposalSchema, type RhythmKind } from "../lib/mentor/schema";
import { addCommitment, chat, contextHash, guidanceOf, periodOf, RHYTHM_KINDS, rhythm } from "../lib/mentor/service";
import { escalateFromFacts } from "../lib/mentor/escalate";
import {
  acknowledgeEscalation, addNote, clearThread, closeCommitment, commitmentById, deleteNote, digestsFor, escalationById, escalationsOf,
  listCommitments, loadThread, mentorCost, noteById, setHiddenFacts, updateNote, type Digest,
} from "../lib/mentor/store";
import { gateOf, providerErrorCode, ready } from "./ai-assistant";

const router: IRouter = Router();

const traderName = z.string().trim().min(1).max(120);
const OWN_NOTE_KINDS = ["goal", "strength", "weakness", "leak", "discussed", "preference"] as const;

/** The session phase the page leads with: before the open → brief, after the close → debrief. */
export function phaseOf(minutes: number): "pre" | "session" | "post" {
  return minutes < 9 * 60 + 30 ? "pre" : minutes < 16 * 60 ? "session" : "post";
}

function digestView(d: Digest | undefined, hash: string | null) {
  if (!d || d.status !== "ready") return null;
  return { id: d.id, content: d.content, createdAt: d.createdAt, deep: d.deep, source: d.source, stale: hash != null && d.inputHash !== hash };
}

function mentorOn(): boolean {
  return setting("mentor.enabled");
}

/** The trader whose mentor this request reads: self, or another trader with journal.review on him. */
async function subjectOf(req: Request, raw: string | undefined): Promise<string> {
  return personalTrader(req, raw, "journal.review");
}

async function stateFor(req: Request, actor: Actor, trader: string) {
  const self = trader === actor.name;
  const today = nyDate();
  const lang = langOf(req);
  const f: MentorFacts = await gatherFacts(trader, today);
  const staffSubject = self ? isStaffRole(actor.role) : false;
  const hashes = Object.fromEntries(RHYTHM_KINDS.map((k) => [k, contextHash(k, lang, mentorContext(f, k, { staff: staffSubject }), guidanceOf(f))])) as Record<RhythmKind, string>;
  const digests = await digestsFor(trader, RHYTHM_KINDS.map((k) => ({ kind: k, period: periodOf(k, today) })), lang);
  const by = (k: RhythmKind) => digests.find((d) => d.kind === k);
  const g = await gateOf(actor);
  const client = assistantClient();
  const budget = budgetOf(g.s, await usageToday(actor.name, today));
  const viewerStaff = await can(req, "journal.review", { trader });
  return {
    trader, self, today, phase: phaseOf(nyMinutes()), stage: f.stage,
    status: {
      enabled: mentorOn() && g.s.enabled,
      allowed: self && mentorOn() && !g.blocked && !!client && budget.left,
      blocked: !mentorOn() ? "AI_ASSISTANT_OFF" : g.blocked ?? (client ? (budget.left ? null : "AI_BUDGET_EXCEEDED") : "AI_NOT_CONFIGURED"),
      budget,
    },
    facts: f.facts,
    notes: f.notes,
    commitments: f.commitments,
    checkin: self ? f.checkin : null,
    digests: { brief: digestView(by("brief"), hashes.brief), debrief: digestView(by("debrief"), hashes.debrief), weekly: digestView(by("weekly"), hashes.weekly) },
    thread: self ? await loadThread(trader, 40) : [],
    escalations: viewerStaff && !self ? await escalationsOf([trader], addDays(today, -30)) : [],
    canGuide: !self && viewerStaff,
  };
}

router.get("/mentor", route({ query: z.object({ trader: traderName.optional() }).passthrough() }, async ({ req, actor, query, res }) => {
  const trader = await subjectOf(req, query.trader);
  const me = actor ?? (await assertCap(req, "assistant.use"));
  if (trader === me.name) await assertCap(req, "assistant.use");
  res.setHeader("Cache-Control", "private, no-cache");
  return stateFor(req, me, trader);
}));

router.get("/mentor/line", route({ cap: "assistant.use" }, async ({ req, actor }) => {
  const today = nyDate();
  const lang = langOf(req);
  const [{ active }, digests] = await Promise.all([listCommitments(actor.name, 0), digestsFor(actor.name, [{ kind: "brief", period: today }, { kind: "debrief", period: today }], lang)]);
  const oldest = active.map((c) => c.startedOn).sort()[0];
  const trades = oldest ? await behaviorTradesOf(actor.name)(oldest, today) : [];
  const items = active.map((c) => {
    const p = trackCommitment(c, trades);
    return { id: c.id, kind: c.kind, params: c.params, text: c.text, kept: p.kept, opportunities: p.opportunities, verdict: commitmentVerdict(p) };
  });
  const order = { failing: 0, at_risk: 1, new: 2, on_track: 3, achieved: 4, untracked: 5 } as const;
  const brief = digests.find((d) => d.kind === "brief" && d.status === "ready")?.content as { ruleToday?: string } | undefined;
  return {
    enabled: mentorOn(), phase: phaseOf(nyMinutes()), ruleToday: brief?.ruleToday ?? null,
    hasBrief: !!brief, hasDebrief: digests.some((d) => d.kind === "debrief" && d.status === "ready"),
    commitment: [...items].sort((a, b) => order[a.verdict] - order[b.verdict])[0] ?? null, active: items.length,
  };
}));

// ─── generation (own) ──────────────────────────────────────────────────────

async function caller(req: Request, actor: Actor) {
  if (!mentorOn()) throw new AppError("AI_ASSISTANT_OFF");
  const r = await ready(actor);
  const ctl = new AbortController();
  req.on("close", () => { if (!req.complete) ctl.abort(); });
  return { client: r.client, settings: r.s, trader: actor.name, lang: langOf(req), today: r.today, staff: r.staff, signal: ctl.signal };
}

function aiError(req: Request, err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof MentorInvalid) req.log?.warn({ issues: err.issues }, "mentor: the answer did not fit the schema");
  return new AppError(err instanceof MentorInvalid || err instanceof MentorRefused ? "AI_UNAVAILABLE" : providerErrorCode(err));
}

router.post("/mentor/rhythm", assistantLimiter, route({
  cap: "assistant.use",
  body: z.object({ kind: z.enum(["brief", "debrief", "weekly"]), force: z.boolean().optional() }),
}, async ({ req, res, actor, body }) => {
  const c = await caller(req, actor);
  const [existing] = await digestsFor(c.trader, [{ kind: body.kind, period: periodOf(body.kind, c.today) }], c.lang);
  if (existing?.status === "ready" && !body.force) { res.status(200).json({ digest: digestView(existing, null), cached: true }); return; }
  const facts = await gatherFacts(c.trader, c.today);
  try {
    const out = await rhythm(c, body.kind, { force: !!body.force, existing: existing ?? null, facts });
    await escalateFromFacts(facts, c.staff);
    res.status(201).json({ digest: digestView(out.digest, null), cached: out.cached });
  } catch (err) {
    throw aiError(req, err);
  }
}));

router.post("/mentor/chat", assistantLimiter, route({
  cap: "assistant.use", body: z.object({ message: z.string().trim().min(1).max(4000) }),
}, async ({ req, res, actor, body }) => {
  const c = await caller(req, actor);
  try {
    res.status(201).json(await chat(c, body.message));
  } catch (err) {
    throw aiError(req, err);
  }
}));

router.delete("/mentor/thread", route({ cap: "assistant.use" }, async ({ actor }) => ({ cleared: await clearThread(actor.name) })));

// ─── memory ─────────────────────────────────────────────────────────────────

router.post("/mentor/notes", route({
  cap: "assistant.use",
  body: z.object({ kind: z.enum([...OWN_NOTE_KINDS, "guidance"]), body: z.string().trim().min(1).max(400), trader: traderName.optional() }),
}, async ({ req, res, actor, body }) => {
  const trader = body.trader ?? actor.name;
  if (trader !== actor.name) {
    await assertCap(req, "journal.review", { trader });
    res.status(201).json(await addNote(trader, { kind: "guidance", body: body.body, source: "curator", author: actor.name }));
    return;
  }
  if (body.kind === "guidance") throw new AppError("INVALID_FIELD", undefined, { field: "kind" });
  res.status(201).json(await addNote(trader, { kind: body.kind, body: body.body, source: "trader", author: actor.name }));
}));

/** The trader edits notes about himself except the curator's guidance; staff with journal.review edit guidance. */
async function editableNote(req: Request, actor: Actor, id: number) {
  const n = await noteById(id);
  if (!n) throw notFound("NOTE_NOT_FOUND");
  if (n.kind === "guidance") await assertCap(req, "journal.review", { trader: n.trader });
  else if (n.trader !== actor.name) throw new AppError("PERSONAL_DATA_FORBIDDEN");
  return n;
}

router.patch("/mentor/notes/:id", route({
  cap: "assistant.use",
  params: z.object({ id: idParam }),
  body: z.object({ body: z.string().trim().min(1).max(400).optional(), kind: z.enum(OWN_NOTE_KINDS).optional() }),
}, async ({ req, actor, params, body }) => {
  const n = await editableNote(req, actor, params.id);
  const out = await updateNote(params.id, { body: body.body, kind: n.kind === "guidance" ? undefined : body.kind });
  if (!out) throw notFound("NOTE_NOT_FOUND");
  return out;
}));

router.delete("/mentor/notes/:id", route({ cap: "assistant.use", params: z.object({ id: idParam }) }, async ({ req, actor, params }) => {
  await editableNote(req, actor, params.id);
  return { deleted: await deleteNote(params.id) };
}));

router.put("/mentor/hidden", route({
  cap: "assistant.use", body: z.object({ keys: z.array(z.string().trim().min(1).max(120)).max(50) }),
}, async ({ actor, body }) => ({ hidden: await setHiddenFacts(actor.name, body.keys) })));

// ─── commitments ────────────────────────────────────────────────────────────

const CommitmentBody = z.object({
  kind: z.enum(COMMITMENT_KINDS),
  minutes: z.number().int().nullable().optional(),
  count: z.number().int().nullable().optional(),
  usd: z.number().nullable().optional(),
  time: z.string().nullable().optional(),
  text: z.string().trim().min(1).max(200),
  replaceId: z.number().int().nullable().optional(),
  trader: traderName.optional(),
});

router.post("/mentor/commitments", route({ cap: "assistant.use", body: CommitmentBody }, async ({ req, res, actor, body }) => {
  const trader = body.trader ?? actor.name;
  const curator = trader !== actor.name;
  if (curator) await assertCap(req, "journal.review", { trader });
  const proposal = ProposalSchema.safeParse({ kind: body.kind, minutes: body.minutes ?? null, count: body.count ?? null, usd: body.usd ?? null, time: body.time ?? null, text: body.text, replaceId: body.replaceId ?? null });
  if (!proposal.success) throw new AppError("INVALID_FIELD", undefined, { field: proposal.error.issues[0]?.path.join(".") ?? "kind" });
  const out = await addCommitment(trader, proposal.data, { source: curator ? "curator" : "trader", by: actor.name, startedOn: nyDate() });
  if (out.skipped === "full") throw new AppError("CONFLICT", 409, undefined, { reason: "commitment_limit" });
  res.status(201).json(out);
}));

router.patch("/mentor/commitments/:id", route({
  cap: "assistant.use",
  params: z.object({ id: idParam }),
  body: z.object({ status: z.enum(["achieved", "dropped"]), note: z.string().trim().max(300).optional() }),
}, async ({ req, actor, params, body }) => {
  const c = await commitmentById(params.id);
  if (!c) throw notFound("NOT_FOUND");
  if (c.trader !== actor.name) await assertCap(req, "journal.review", { trader: c.trader });
  const out = await closeCommitment(params.id, body.status, nyDate(), body.note ?? null);
  if (!out) throw new AppError("CONFLICT", 409, undefined, { reason: "not_active" });
  return out;
}));

// ─── escalations (staff) ───────────────────────────────────────────────────

router.get("/mentor/escalations", route({
  cap: "journal.review",
  query: z.object({ scope: z.enum(["mine", "desk", "group", "all"]).optional() }).passthrough(),
}, async ({ req, query }) => {
  const roster = await loadRoster(req, query.scope);
  return { scope: roster.scope, items: await escalationsOf(roster.traders, addDays(nyDate(), -30)) };
}));

router.post("/mentor/escalations/:id/ack", route({ cap: "journal.review", params: z.object({ id: idParam }) }, async ({ req, actor, params }) => {
  const e = await escalationById(params.id);
  if (!e) throw notFound("NOT_FOUND");
  await assertCap(req, "journal.review", { trader: e.trader });
  return (await acknowledgeEscalation(params.id, actor.name)) ?? e;
}));

// ─── admin ──────────────────────────────────────────────────────────────────

router.get("/mentor/admin/cost", route({
  cap: "settings.manage",
  query: z.object({ days: z.coerce.number().int().min(1).max(90).optional() }).passthrough(),
}, async ({ query }) => {
  const to = nyDate();
  return { ...(await mentorCost(addDays(to, -((query.days ?? 14) - 1)), to)), pushesEnabled: setting("mentor.pushesEnabled"), enabled: mentorOn() };
}));

export default router;
