/**
 * Nightly AI reviews at half price — the job body (job ai.batch-reviews, jobs/definitions → batch/jobDefs.ts).
 *
 * One run (every 5 minutes while there is something to do — see jobDefs dueNow):
 *   1. poll   every open batch that is due (backoff 5 → 10 → 15 min; the id is in ai_batches, so a restart resumes):
 *             ended → read the results (any order, by custom_id) → validate each review with the same schema as a live
 *             one (NO retry: an answer that does not fit is logged and skipped) → store it in ai_reviews under the same
 *             cache key → assistant audit row (mode "batch"); gone / older than 25 h → failed (the day can still be
 *             reviewed by hand); a batch stuck in «submitting» (crash between our insert and the provider's answer) →
 *             failed, its items kept so they are never submitted twice.
 *   2. notify «Разбор дня готов» (in-app, the recipient's notification preferences / «не беспокоить» apply) — only in
 *             the morning window (telegram.morningTime … 20:00 NY): a review that lands at night waits for the morning.
 *   3. submit when aiBatch.enabled and the desk's day has closed (plan.dayClosed): gather each due review AS the
 *             trader (batch/caller.ts), skip trader-days already submitted or already reviewed, fit the nightly desk
 *             cap (plan.pickWithinCap), insert batch + items, then create ONE provider batch and store its id.
 * No key → nothing is submitted and nothing polled (a clean skip). Batch reviews never touch a trader's personal daily
 * budget: they count in ai_batches against aiBatch.nightlyUnits only.
 */
import { Anthropic } from "@workspace/integrations-anthropic-ai";
import type { JobContext } from "../../../jobs/registry";
import { logAudit } from "../../audit";
import { setting } from "../../settings/registry";
import { timeToMinutes } from "../../settings/validate";
import { SETTINGS } from "../../settings/registry";
import { viewerStage } from "../../access/stage";
import { insertNotification } from "../../notifyUtils";
import { ZERO_USAGE, addUsage, budgetTokens, isAssistantModel, requestCostUsd, unitWeight, type AssistantModel, type RouteSettings, type Usage } from "../models";
import { assistantSettings, writeAudit } from "../store";
import { usagesOf, advisorCalls } from "../usage";
import type { BatchClient, BatchResultLine } from "../batchClient";
import { reviewParams, reviewPlan, textOf, type Plan } from "../review/run";
import { parseReview } from "../review/schema";
import { reviewUserTurn } from "../review/prompt";
import { inputHash, reviewedTraders, saveReview, type Subject } from "../review/store";
import type { Gathered } from "../review/service";
import { ReviewInputError } from "../review/gather";
import {
  dayClosed, estimateUnits, GIVE_UP_MS, inNotifyWindow, nextPollDelay, nightTargets, nyClock, pickWithinCap,
  type Candidate, type Clock, type Scopes, type Target,
} from "./plan";
import * as store from "./store";
import type { BatchKind, NewItem, OpenBatch, TraderDay } from "./store";

/** Batch prices: every token at 50% of the standard rate (docs: Message Batches pricing). */
export const BATCH_DISCOUNT = 0.5;
/** After this many failed submissions in one night the job stops trying until the next night. */
const MAX_FAILED_SUBMITS = 3;
const GATHER_CONCURRENCY = 4;

export type BatchSettings = {
  enabled: boolean;
  cutoffMin: number;
  scopes: Scopes;
  nightlyUnits: number;
  model: AssistantModel;
  morningMin: number;
  route: RouteSettings;
};

export function batchSettings(): BatchSettings {
  const m = setting("aiBatch.model");
  const minutes = (key: "aiBatch.time" | "telegram.morningTime") => timeToMinutes(setting(key)) ?? (timeToMinutes(SETTINGS[key].default) as number);
  return {
    enabled: setting("aiBatch.enabled"),
    cutoffMin: minutes("aiBatch.time"),
    scopes: { day: setting("aiBatch.day"), week: setting("aiBatch.week"), month: setting("aiBatch.month") },
    nightlyUnits: setting("aiBatch.nightlyUnits"),
    model: isAssistantModel(m) ? m : "claude-haiku-5-5",
    morningMin: minutes("telegram.morningTime"),
    route: assistantSettings(),
  };
}

export type BatchDeps = {
  client: () => BatchClient | null;
  now: () => Date;
  settings: () => BatchSettings;
  /** Gathers one review's inputs as the trader; a ReviewInputError (no data, no access) skips that trader. */
  gather: (t: TraderDay, target: Target, signal: AbortSignal) => Promise<Gathered>;
  notify: (item: store.ReadyItem) => Promise<boolean>;
};

export type RunDetails = {
  skipped?: string;
  polled: number; ended: number; failed: number; stored: number; invalid: number;
  notified: number;
  submitted: { batchId: number; requests: number; estUnits: number; skippedBudget: number } | null;
  waiting?: string;
};

// ─── defaults ───────────────────────────────────────────────────────────────

async function defaultGather(t: TraderDay, target: Target, signal: AbortSignal): Promise<Gathered> {
  const [{ memberCaller }, { gatherDay, gatherPeriod }] = await Promise.all([import("./caller"), import("../review/gather")]);
  const ctx = { api: await memberCaller({ id: t.userId, name: t.trader, role: t.role }, t.lang, signal), lang: t.lang, today: target.to };
  if (target.kind === "day") {
    const d = await gatherDay(ctx, t.trader, target.period);
    return { subject: { kind: "day", day: d.day, trader: d.trader }, data: d.data, facts: d.facts, subjectLabel: `day ${d.day} of ${d.trader}` };
  }
  const p = await gatherPeriod(ctx, t.trader, target.kind, target.period);
  return { subject: { kind: target.kind, day: p.from, trader: p.trader }, data: p.data, facts: null, subjectLabel: `${target.kind} ${p.from}..${p.to} of ${p.trader}` };
}

/** «Разбор дня готов» (week / month variants) — in-app; preferences and «не беспокоить» are honoured by insertNotification. */
async function defaultNotify(item: store.ReadyItem): Promise<boolean> {
  const link = item.kind === "day" ? `/day-report?date=${item.period}` : item.kind === "week" ? "/weekly-review" : "/my-review";
  const id = await insertNotification({
    userName: item.trader, type: "ai_review_ready", params: { variant: item.kind, periodDate: item.period }, link,
    entityType: "ai_review", entityId: `${item.kind}:${item.period}`, source: "assistant",
  });
  return id != null;
}

async function defaultClient(): Promise<BatchClient | null> {
  const { batchClient } = await import("../batchClient");
  return batchClient();
}

// ─── poll ───────────────────────────────────────────────────────────────────

const isGone = (err: unknown) => err instanceof Anthropic.NotFoundError;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

type ItemOutcome = { status: store.ItemStatus; units: number; costUsd: number; usage: Usage; error: string | null; reviewId: number | null };

/** One result line → stored review (or the reason it was skipped). Never throws. */
async function storeResult(b: OpenBatch, item: store.PendingItem, line: BatchResultLine | undefined, s: BatchSettings, log: JobContext["logger"]): Promise<ItemOutcome> {
  const none: ItemOutcome = { status: "expired", units: 0, costUsd: 0, usage: ZERO_USAGE, error: null, reviewId: null };
  if (!line) return { ...none, status: "errored", error: "no result line" };
  const r = line.result;
  if (r.type === "expired") return { ...none, status: "expired", error: "expired" };
  if (r.type === "canceled") return { ...none, status: "canceled", error: "canceled" };
  if (r.type === "errored") return { ...none, status: "errored", error: r.error?.error?.type ?? r.error?.type ?? "error" };
  const msg = r.message;
  let usage = ZERO_USAGE;
  let units = 0;
  let costUsd = 0;
  const models: AssistantModel[] = [];
  for (const { model, usage: u } of usagesOf(b.model, msg, b.advisor)) {
    usage = addUsage(usage, u);
    costUsd += requestCostUsd(model, u) * BATCH_DISCOUNT;
    units += budgetTokens(u) * unitWeight(model, s.route);
    if (!models.includes(model)) models.push(model);
  }
  const base = { units, costUsd, usage };
  log.info({ batch: b.id, item: item.id, model: b.model, advisor: b.advisor, stop: msg.stop_reason, usage: msg.usage }, "ai batch: result");
  if ((msg.stop_reason as string) === "refusal") return { ...base, status: "refused", error: "refusal", reviewId: null };
  const parsed = parseReview(textOf(msg));
  if (!parsed.ok) {
    log.warn({ batch: b.id, item: item.id, issues: parsed.issues }, "ai batch: the answer did not fit the schema — skipped (no retry)");
    return { ...base, status: "invalid", error: parsed.issues.join("; ").slice(0, 500), reviewId: null };
  }
  const subject: Subject = item.kind === "day" ? { kind: "day", day: item.period, trader: item.trader } : { kind: item.kind, day: item.period, trader: item.trader };
  const deep = !!b.advisor || b.model !== s.route.defaultModel;
  const saved = await saveReview({ subject, hash: item.inputHash, lang: item.lang, review: parsed.review, facts: item.facts, deep, units, costUsd, by: "system", source: "batch" });
  await writeAudit({
    user: item.trader, mode: "batch", models, reason: item.kind, usage, costUsd, tools: advisorCalls(msg) ? ["advisor"] : [], drafts: 0, status: "ok",
    page: item.kind === "day" ? `/day-report?date=${item.period}` : null, durationMs: 0,
  }, false);
  return { ...base, status: saved.id ? "stored" : "errored", error: saved.id ? null : "could not store", reviewId: saved.id || null };
}

async function collect(client: BatchClient, b: OpenBatch, s: BatchSettings, ctx: JobContext): Promise<store.BatchTotals> {
  const items = await store.pendingItems(b.id);
  const lines = new Map<string, BatchResultLine>();
  for await (const line of client.results(b.providerId!)) {
    if (ctx.signal.aborted) throw new Error("aborted while reading results");
    lines.set(line.custom_id, line);
  }
  const t: store.BatchTotals = { succeeded: 0, invalid: 0, errored: 0, expired: 0, canceled: 0, units: 0, usage: ZERO_USAGE, costUsd: 0 };
  for (const item of items) {
    const o = await storeResult(b, item, lines.get(customId(item.id)), s, ctx.logger);
    await store.finishItem({ id: item.id, status: o.status, error: o.error, units: o.units, costUsd: o.costUsd, reviewId: o.reviewId });
    t.units += o.units; t.costUsd += o.costUsd; t.usage = addUsage(t.usage, o.usage);
    if (o.status === "stored") t.succeeded++;
    else if (o.status === "invalid" || o.status === "refused") t.invalid++;
    else if (o.status === "expired") t.expired++;
    else if (o.status === "canceled") t.canceled++;
    else t.errored++;
  }
  return t;
}

async function pollAll(client: BatchClient, s: BatchSettings, now: Date, ctx: JobContext, out: RunDetails): Promise<void> {
  for (const b of await store.dueBatches(now)) {
    if (ctx.signal.aborted) return;
    if (b.status === "submitting" || !b.providerId) {
      // Our row exists but the provider's answer never got stored (a crash mid-submit): give up, keep the items.
      if (now.getTime() - b.createdAt.getTime() > 10 * 60_000) {
        await store.markBatchFailed(b.id, "failed", "submission interrupted", "errored");
        out.failed++;
      }
      continue;
    }
    out.polled++;
    try {
      const info = await client.retrieve(b.providerId);
      if (info.processing_status !== "ended") {
        if (now.getTime() - b.createdAt.getTime() > GIVE_UP_MS) {
          await store.markBatchFailed(b.id, "expired", "still processing after 25 h", "expired");
          out.failed++;
        } else await store.bumpPoll(b.id, new Date(now.getTime() + nextPollDelay(b.pollCount)), null);
        continue;
      }
      const t = await collect(client, b, s, ctx);
      const status = t.succeeded === 0 && t.expired > 0 ? "expired" : t.succeeded === 0 && t.canceled > 0 ? "canceled" : "ended";
      await store.finishBatch(b.id, status, t, null);
      out.ended++; out.stored += t.succeeded; out.invalid += t.invalid;
      await logAudit({ actor: "system", action: "ai.batch.end", targetType: "ai_batch", targetId: String(b.id), details: { status, ...t, usage: undefined, tokens: t.usage } });
    } catch (err) {
      if (isGone(err)) {
        await store.markBatchFailed(b.id, "failed", "batch not found at the provider", "errored");
        out.failed++;
        continue;
      }
      ctx.logger.warn({ err: message(err), batch: b.id }, "ai batch: poll failed — will retry");
      await store.bumpPoll(b.id, new Date(now.getTime() + nextPollDelay(b.pollCount)), message(err));
    }
  }
}

// ─── notify ─────────────────────────────────────────────────────────────────

async function notifyReady(deps: BatchDeps, s: BatchSettings, c: Clock, out: RunDetails): Promise<void> {
  if (!inNotifyWindow(c, s.morningMin)) return;
  const items = await store.unnotifiedItems();
  // One notice per trader, kind and period; the claim is written first so a crash never sends twice.
  for (const item of items) {
    await store.markNotified([item.id]);
    if (await deps.notify(item)) out.notified++;
  }
}

// ─── submit ─────────────────────────────────────────────────────────────────

export const customId = (itemId: number) => `r${itemId}`;

async function mapLimit<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]!); }
  }));
  return out;
}

/** The batch model and advisor: aiBatch.model writes; the advisor as the assistant settings allow (a stronger model). */
export function batchPlan(s: BatchSettings): Plan {
  return reviewPlan({ ...s.route, defaultModel: s.model, autoEscalate: false });
}

type Prepared = Candidate & { target: Target; t: TraderDay; g: Gathered; hash: string; userTurn: string };

async function submit(client: BatchClient, deps: BatchDeps, s: BatchSettings, now: Date, ctx: JobContext, out: RunDetails): Promise<"done" | "waiting"> {
  const c = nyClock(now);
  const targets = nightTargets(c, s.scopes);
  if (!targets.length) return "done";
  const night = c.today;
  if ((await store.failedSubmissions(night)) >= MAX_FAILED_SUBMITS) { out.waiting = "too many failed submissions tonight"; return "done"; }

  const dayTarget = targets.find((x) => x.kind === "day");
  const todays = dayTarget ? await store.tradersWithTrades(dayTarget.from, dayTarget.to) : [];
  const closed = dayTarget ? await store.eodClosed(dayTarget.period, todays.map((x) => x.trader)) : new Set<string>();
  const manual = ctx.trigger === "manual";
  if (!manual && !dayClosed(c, s.cutoffMin, todays.length, closed.size)) {
    out.waiting = `EOD closed ${closed.size}/${todays.length}, cutoff not reached`;
    return "waiting";
  }

  const plan = batchPlan(s);
  const isJunior = async (t: TraderDay) => (await viewerStage(t.trader).catch(() => "junior" as const)) === "junior";

  const wanted: { target: Target; t: TraderDay }[] = [];
  for (const target of targets) {
    const traders = target.kind === "day" ? todays : await store.tradersWithTrades(target.from, target.to);
    const names = traders.map((x) => x.trader);
    const [submitted, reviewed] = await Promise.all([store.submittedTraders(target.kind, target.period, names), reviewedTraders(target.kind, target.period, names)]);
    for (const t of traders) if (!submitted.has(t.trader) && !reviewed.has(t.trader)) wanted.push({ target, t });
  }
  if (!wanted.length) return "done";

  const averages = new Map<BatchKind, number | null>();
  for (const k of new Set(wanted.map((w) => w.target.kind))) averages.set(k, await store.recentAverageUnits(k, plan.model, plan.advisor));

  const prepared = (await mapLimit(wanted, GATHER_CONCURRENCY, async ({ target, t }): Promise<Prepared | null> => {
    if (ctx.signal.aborted) return null;
    try {
      const g = await deps.gather(t, target, ctx.signal);
      const hash = inputHash(target.kind, t.lang, g.data);
      const userTurn = reviewUserTurn({ kind: target.kind, lang: t.lang, today: target.to, subject: g.subjectLabel, data: g.data });
      const system = (reviewParams(target.kind, plan, []).system[0]?.text ?? "").length;
      const estUnits = estimateUnits({ promptChars: system + userTurn.length, model: plan.model, advisor: plan.advisor, recentAverage: averages.get(target.kind) ?? null }, s.route);
      return { kind: target.kind, trader: t.trader, junior: await isJunior(t), trades: t.trades, estUnits, target, t, g, hash, userTurn };
    } catch (err) {
      if (err instanceof ReviewInputError) ctx.logger.info({ trader: t.trader, kind: target.kind, code: err.code }, "ai batch: nothing to review — skipped");
      else ctx.logger.warn({ err: message(err), trader: t.trader, kind: target.kind }, "ai batch: gathering failed — skipped");
      return null;
    }
  })).filter((p): p is Prepared => !!p);
  if (!prepared.length) return "done";

  const capLeft = s.nightlyUnits - (await store.nightUnits(night));
  const { picked, skipped } = pickWithinCap(prepared, capLeft);
  if (skipped.length) ctx.logger.warn({ night, capLeft, skipped: skipped.length }, "ai batch: nightly cap reached — lower-priority reviews skipped");
  if (!picked.length) { out.waiting = "nightly cap reached"; return "done"; }

  const items: NewItem[] = picked.map((p) => ({ kind: p.kind, trader: p.trader, period: p.target.period, lang: p.t.lang, inputHash: p.hash, facts: p.g.facts, estUnits: p.estUnits }));
  const { batchId, itemIds } = await store.createBatch({
    night, model: plan.model, advisor: plan.advisor, kinds: [...new Set(picked.map((p) => p.kind))], skippedBudget: skipped.length,
    createdBy: manual ? "manual" : "system", items,
  });
  const requests = picked.flatMap((p, k) => {
    const id = itemIds[k];
    return id == null ? [] : [{ custom_id: customId(id), params: reviewParams(p.kind, plan, [{ role: "user", content: p.userTurn }], { cacheTtl: "1h" }) }];
  });
  if (!requests.length) { await store.markSubmitFailed(batchId, "nothing left to submit", false); return "done"; }

  let created: Awaited<ReturnType<BatchClient["create"]>>;
  try {
    created = await client.create(requests);
  } catch (err) {
    // An HTTP answer = the provider created nothing: free the items for a later try. No answer (timeout, network) =
    // unknown: keep them, so the same trader-day is never billed twice.
    const answered = err instanceof Anthropic.APIError && typeof err.status === "number";
    await store.markSubmitFailed(batchId, message(err), !answered);
    ctx.logger.error({ err: message(err), batch: batchId }, "ai batch: submit failed");
    out.failed++;
    return "done";
  }
  // The provider has the batch now: storing its id must not be mistaken for a failed submission. One retry; if the
  // database still refuses, the error propagates and the row stays «submitting» (later: failed, items kept).
  const nextPoll = new Date(now.getTime() + nextPollDelay(0));
  await store.markSubmitted(batchId, created.id, nextPoll).catch(() => store.markSubmitted(batchId, created.id, nextPoll));
  const estUnits = items.reduce((a, i) => a + i.estUnits, 0);
  out.submitted = { batchId, requests: requests.length, estUnits, skippedBudget: skipped.length };
  await logAudit({ actor: "system", action: "ai.batch.submit", targetType: "ai_batch", targetId: String(batchId), details: { night, model: plan.model, advisor: plan.advisor, ...out.submitted } });
  return "done";
}

// ─── run ────────────────────────────────────────────────────────────────────

/** The night a run has finished submitting for (the due-state getter stops asking until the next night). */
export let doneNight: string | null = null;

export async function runBatchReviews(ctx: JobContext, over: Partial<BatchDeps> = {}): Promise<RunDetails> {
  const deps: BatchDeps = {
    client: () => null, now: () => new Date(), settings: batchSettings, gather: defaultGather, notify: defaultNotify, ...over,
  };
  const out: RunDetails = { polled: 0, ended: 0, failed: 0, stored: 0, invalid: 0, notified: 0, submitted: null };
  const client = over.client ? deps.client() : await defaultClient();
  if (!client) return { ...out, skipped: "no API key" };
  const s = deps.settings();
  const now = deps.now();
  const c = nyClock(now);
  await pollAll(client, s, now, ctx, out);
  await notifyReady(deps, s, c, out);
  if (s.enabled && (ctx.trigger === "manual" || doneNight !== c.today)) {
    if ((await submit(client, deps, s, now, ctx, out)) === "done" && nightTargets(c, s.scopes).length) doneNight = c.today;
  }
  return out;
}

/** Tests only. */
export function __resetBatchJob(): void {
  doneNight = null;
}
