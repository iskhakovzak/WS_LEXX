/**
 * The mentor end to end, after the route checked who may do what:
 *   rhythm(kind)   brief / debrief / weekly: the stored digest of the period (no model call) or a new one — facts →
 *                  context → ONE model call → the side effects (debrief: the rule for tomorrow becomes a commitment;
 *                  weekly: commitments closed / dropped / added; memory notes) → digest stored, opener posted to the
 *                  thread, usage charged to the trader's daily AI budget, audited (mode «mentor»)
 *   chat(message)  one conversation turn: the context as a cached system block, the last messages, the reply;
 *                  notes and an agreed commitment are applied
 * Generated on demand only (GET never generates). Cost: the digest is cached per trader × kind × period × language;
 * a changed context marks it `stale` and the trader decides when to refresh it.
 */
import crypto from "node:crypto";
import type { Anthropic } from "@workspace/integrations-anthropic-ai";
import type { AssistantClient } from "../assistant/client";
import type { RouteSettings } from "../assistant/models";
import { recordUsage, writeAudit } from "../assistant/store";
import { addDays, isWeekend } from "../tradingDate";
import type { Lang } from "../../i18n";
import { MAX_ACTIVE, parseParams, type CommitmentKind, type CommitmentParams } from "./commitments";
import { gatherFacts, weekOf, type MentorFacts } from "./facts";
import type { DayTwoHint } from "../catalyst/model";
import type { EasyLine } from "../deskPulse/easyMoney";
import { contextBlock, mentorContext, mentorSystem, rhythmUserTurn } from "./prompt";
import { callMentor, totalUsage, type MentorCall } from "./run";
import { guardStopped } from "./stopGuard";
import { MENTOR_VERSION, type Brief, type ChatAnswer, type Debrief, type MentorKind, type ModelNote, type Proposal, type RhythmKind, type Weekly } from "./schema";
import {
  addNote, closeCommitment, insertCommitment, listCommitments, loadThread, saveMessage, upsertDigest,
  type Commitment, type Digest, type Message, type NoteSource,
} from "./store";

export const RHYTHM_KINDS: readonly RhythmKind[] = ["brief", "debrief", "weekly"];

/** The period a rhythm digest belongs to: the trading day, or the week's Monday. */
export function periodOf(kind: RhythmKind, today: string): string {
  return kind === "weekly" ? weekOf(today).monday : today;
}

export function nextWeekday(day: string): string {
  let d = addDays(day, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

export function guidanceOf(f: Pick<MentorFacts, "notes">): string[] {
  return f.notes.filter((n) => n.kind === "guidance").slice(0, 8).map((n) => n.body);
}

export function contextHash(kind: MentorKind, lang: Lang, context: unknown, guidance: readonly string[]): string {
  return crypto.createHash("sha256").update(JSON.stringify({ v: MENTOR_VERSION, kind, lang, context, guidance })).digest("hex");
}

/** The model inputs of a rhythm kind (shared by the live call and the scheduled batch). */
export function rhythmRequest(kind: RhythmKind, f: MentorFacts, lang: Lang, staff: boolean): { system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[]; hash: string } {
  const context = mentorContext(f, kind, { staff });
  const guidance = guidanceOf(f);
  const block = contextBlock({ lang, context, guidance });
  return {
    system: [{ type: "text", text: mentorSystem(kind) }],
    messages: [{ role: "user", content: rhythmUserTurn(kind, block) }],
    hash: contextHash(kind, lang, context, guidance),
  };
}

// ─── side effects ───────────────────────────────────────────────────────────

const PROPOSAL_FIELDS: Record<CommitmentKind, readonly (keyof Proposal)[]> = {
  pause_after_loss: ["minutes"], max_trades: ["count"], max_daily_loss: ["usd"], stop_after_losses: ["count"],
  no_entry_before: ["time"], no_entry_after: ["time"], max_loss_per_trade: ["usd"], custom: [],
};

/** A proposal as stored params: its kind's fields validated; params that do not fit make it a custom commitment. */
export function proposalParams(p: Proposal): { kind: CommitmentKind; params: CommitmentParams } {
  const raw = Object.fromEntries(PROPOSAL_FIELDS[p.kind].map((k) => [k, p[k]]));
  const params = parseParams(p.kind, raw);
  return params ? { kind: p.kind, params } : { kind: "custom", params: {} };
}

const sameParams = (a: CommitmentParams, b: CommitmentParams) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export type Applied = { commitment: Commitment | null; replaced: number | null; skipped: "full" | "duplicate" | null };

/**
 * Adds a commitment unless the same one is active; with MAX_ACTIVE active ones it replaces `replaceId` (an active
 * commitment of this trader) or is skipped as «full». Exported for the route (the trader / curator add their own).
 */
export async function addCommitment(trader: string, p: Proposal, o: { source: NoteSource; by: string; startedOn: string; active?: readonly Commitment[] }): Promise<Applied> {
  const active = o.active ?? (await listCommitments(trader, 0)).active;
  const { kind, params } = proposalParams(p);
  const dup = active.find((c) => c.kind === kind && sameParams(c.params, params) && (kind !== "custom" || c.text === p.text));
  if (dup) return { commitment: dup, replaced: null, skipped: "duplicate" };
  let replaced: number | null = null;
  if (active.length >= MAX_ACTIVE) {
    const target = active.find((c) => c.id === p.replaceId);
    if (!target) return { commitment: null, replaced: null, skipped: "full" };
    await closeCommitment(target.id, "replaced", o.startedOn, null);
    replaced = target.id;
  }
  const c = await insertCommitment({ trader, kind, params, text: p.text, source: o.source, startedOn: o.startedOn, by: o.by });
  return { commitment: c, replaced, skipped: null };
}

async function addNotes(trader: string, notes: readonly ModelNote[], f: Pick<MentorFacts, "notes">): Promise<number> {
  let n = 0;
  for (const note of notes) {
    if (f.notes.some((x) => x.body.trim().toLowerCase() === note.body.trim().toLowerCase())) continue;
    await addNote(trader, { kind: note.kind, body: note.body, source: "mentor", author: "mentor" });
    n++;
  }
  return n;
}

/** The text a digest posts into the conversation (model-written sentences only; markers are language-neutral). */
export function openerOf(kind: RhythmKind, v: Brief | Debrief | Weekly): string {
  if (kind === "brief") { const b = v as Brief; return [b.headline, ...b.points.map((p) => `• ${p}`), `→ ${b.ruleToday}`].join("\n"); }
  if (kind === "debrief") { const d = v as Debrief; return [d.summary, d.vsPlan, `→ ${d.lesson}`, d.ruleTomorrow ? `→ ${d.ruleTomorrow.text}` : null].filter(Boolean).join("\n"); }
  const w = v as Weekly;
  return [w.summary, ...w.commitments.map((c) => `• ${c.note}`), `→ ${w.nextFocus}`].join("\n");
}

export type RhythmContent = (Brief & { setups: { id: number; name: string }[]; dayTwo: DayTwoHint[]; pulse: MentorFacts["pulse"] }) | (Debrief & { savedCommitmentId: number | null; ruleSkipped: Applied["skipped"]; easyMoney: EasyLine[] }) | (Weekly & { applied: { id: number; status: string }[]; savedCommitmentId: number | null });

/** Applies a validated rhythm answer for `trader` and returns the content to store. Shared with the batch job. */
export async function applyRhythm(kind: RhythmKind, value: Brief | Debrief | Weekly, f: MentorFacts): Promise<RhythmContent> {
  const trader = f.trader;
  if (kind === "brief") {
    const b = value as Brief;
    const names = new Map(f.playbook.map((s) => [s.id, s.name]));
    // The day-two lines are data, not model text: stored with the digest as codes + params, rendered by the web.
    return { ...b, setupIds: b.setupIds.filter((id) => names.has(id)), setups: b.setupIds.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })), dayTwo: f.risk.stopped ? [] : f.dayTwo, pulse: f.risk.stopped ? null : f.pulse };
  }
  if (kind === "debrief") {
    const d = value as Debrief;
    await addNotes(trader, d.notes, f);
    // The easy-money lines are data, not model text: stored with the digest as codes + params, rendered by the web.
    const easyMoney = f.easyMoney?.lines ?? [];
    if (!d.ruleTomorrow) return { ...d, savedCommitmentId: null, ruleSkipped: null, easyMoney };
    const a = await addCommitment(trader, d.ruleTomorrow, { source: "mentor", by: "mentor", startedOn: nextWeekday(f.today), active: f.commitments.active });
    return { ...d, savedCommitmentId: a.commitment?.id ?? null, ruleSkipped: a.skipped, easyMoney };
  }
  const w = value as Weekly;
  await addNotes(trader, w.notes, f);
  const applied: { id: number; status: string }[] = [];
  for (const op of w.commitments) {
    const c = f.commitments.active.find((x) => x.id === op.id);
    if (!c || op.verdict === "keep") continue;
    if (op.verdict === "close_achieved" && c.verdict !== "achieved") continue; // the numbers decide «achieved», not the model
    const closed = await closeCommitment(c.id, op.verdict === "close_achieved" ? "achieved" : "dropped", f.today, op.note);
    if (closed) applied.push({ id: c.id, status: closed.status });
  }
  let saved: number | null = null;
  if (w.newCommitment) {
    const left = f.commitments.active.filter((c) => !applied.some((a) => a.id === c.id));
    saved = (await addCommitment(trader, w.newCommitment, { source: "mentor", by: "mentor", startedOn: nextWeekday(f.today), active: left })).commitment?.id ?? null;
  }
  return { ...w, applied, savedCommitmentId: saved };
}

// ─── entry points ───────────────────────────────────────────────────────────

export type Caller = { client: AssistantClient; settings: RouteSettings; trader: string; lang: Lang; today: string; staff: boolean; signal: AbortSignal };

async function charge(c: Caller, kind: MentorKind, call: MentorCall<MentorKind> | null, started: number, failure: unknown): Promise<void> {
  if (call) await recordUsage(c.trader, c.today, call.usage, call.costByModel);
  await writeAudit({
    user: c.trader, mode: "mentor", models: call?.models ?? [], reason: kind, usage: totalUsage(call?.usage ?? {}), costUsd: call?.costUsd ?? 0,
    tools: call?.advisorCalls ? ["advisor"] : [], drafts: 0, status: call ? "ok" : "error", errorCode: call ? null : failure instanceof Error ? failure.constructor.name.slice(0, 60) : "AI_UNAVAILABLE",
    page: "/coach", durationMs: Date.now() - started,
  }, false);
}

export type RhythmResult = { digest: Digest; cached: boolean };

/** The period's digest (cached unless `force`) or a new one. Throws the model / validation error. */
export async function rhythm(c: Caller, kind: RhythmKind, o: { force: boolean; existing: Digest | null; facts?: MentorFacts }): Promise<RhythmResult> {
  if (o.existing && o.existing.status === "ready" && !o.force) return { digest: o.existing, cached: true };
  const f = o.facts ?? (await gatherFacts(c.trader, c.today));
  const req = rhythmRequest(kind, f, c.lang, c.staff);
  const started = Date.now();
  let call: MentorCall<RhythmKind> | null = null;
  let failure: unknown = null;
  try {
    call = await callMentor({ client: c.client, settings: c.settings, kind, system: req.system, messages: req.messages, signal: c.signal });
  } catch (err) {
    failure = err;
  }
  await charge(c, kind, call, started, failure);
  if (!call) throw failure;
  // A stopped trader is told so whatever the model wrote (lib/mentor/stopGuard).
  const value = guardStopped(kind, call.value as Brief | Debrief | Weekly, f.risk, c.lang);
  const content = await applyRhythm(kind, value, f);
  const digest = await upsertDigest({
    trader: c.trader, kind, period: periodOf(kind, c.today), lang: c.lang, inputHash: req.hash, content, status: "ready", source: "live",
    deep: call.deep, units: call.units, costUsd: call.costUsd,
  });
  await saveMessage(c.trader, { role: "mentor", kind, content: openerOf(kind, value) });
  return { digest, cached: false };
}

/** History as Messages API turns: the last `n`, consecutive same-role messages merged, starting with the trader. */
export function historyTurns(thread: readonly Message[], n = 12): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of thread.slice(-n)) {
    const role = m.role === "user" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${String(last.content)}\n\n${m.content}`;
    else out.push({ role, content: m.content });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

export type ChatResult = { message: Message; userMessage: Message; commitment: Applied | null; notes: number; units: number; deep: boolean };

export async function chat(c: Caller, text: string): Promise<ChatResult> {
  const [f, thread] = await Promise.all([gatherFacts(c.trader, c.today), loadThread(c.trader, 24)]);
  const block = contextBlock({ lang: c.lang, context: mentorContext(f, "chat", { staff: c.staff }), guidance: guidanceOf(f) });
  const userMessage = await saveMessage(c.trader, { role: "user", kind: "chat", content: text });
  const messages = historyTurns([...thread, userMessage]);
  const started = Date.now();
  let call: MentorCall<"chat"> | null = null;
  let failure: unknown = null;
  try {
    call = await callMentor({
      client: c.client, settings: c.settings, kind: "chat", signal: c.signal, messages,
      system: [{ type: "text", text: mentorSystem("chat") }, { type: "text", text: block }],
    });
  } catch (err) {
    failure = err;
  }
  await charge(c, "chat", call, started, failure);
  if (!call) throw failure;
  const answer: ChatAnswer = guardStopped("chat", call.value, f.risk, c.lang);
  const notes = await addNotes(c.trader, answer.notes, f);
  const commitment = answer.commitment ? await addCommitment(c.trader, answer.commitment, { source: "mentor", by: "mentor", startedOn: c.today, active: f.commitments.active }) : null;
  const message = await saveMessage(c.trader, { role: "mentor", kind: "chat", content: answer.reply });
  return { message, userMessage, commitment, notes, units: Math.round(call.units), deep: call.deep };
}
