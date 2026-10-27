/**
 * One AI review request end to end, after the inputs are gathered: cache lookup → model call → usage + audit → stored
 * row → the DTO the web gets (no model names). Routes (routes/aireview.ts) do the access checks and the gathering.
 */
import type { AssistantClient } from "../client";
import type { RouteSettings } from "../models";
import { recordUsage, writeAudit } from "../store";
import type { Lang } from "../../../i18n";
import { callReview, totalOf, type ReviewCall } from "./run";
import { cachedReview, inputHash, saveReview, type StoredReview, type Subject } from "./store";
import { whatIfRule } from "./schema";
import type { DayFacts } from "./gather";

export type ReviewDto = ReturnType<typeof reviewDto>;

/** What the web gets: the review, the deterministic day facts, the what-if rule to open — never a model name. */
export function reviewDto(r: StoredReview, cached: boolean) {
  return {
    id: r.id, kind: r.kind, trader: r.trader, tradeId: r.tradeId, day: r.day, lang: r.lang,
    review: r.review, facts: r.facts, tier: r.deep ? ("deep" as const) : ("standard" as const), units: r.units,
    whatIfRule: r.review.whatIf ? whatIfRule(r.review.whatIf) : null,
    createdAt: r.createdAt, cached,
  };
}

export type Gathered = { subject: Subject; data: unknown; facts: DayFacts | null; subjectLabel: string };

export type ReviewRequest = {
  client: AssistantClient; settings: RouteSettings; lang: Lang; today: string; actor: string; force: boolean; signal: AbortSignal; gathered: Gathered;
};

/** Returns the stored review for these inputs (no model call) or generates, records and stores a new one. Throws on failure. */
export async function reviewOrCached(q: ReviewRequest): Promise<ReviewDto> {
  const g = q.gathered;
  const hash = inputHash(g.subject.kind, q.lang, g.data);
  if (!q.force) {
    const hit = await cachedReview(g.subject, hash, q.lang);
    if (hit) return reviewDto(hit, true);
  }
  const started = Date.now();
  let call: ReviewCall | null = null;
  let failure: unknown = null;
  try {
    call = await callReview({ client: q.client, settings: q.settings, kind: g.subject.kind, lang: q.lang, today: q.today, subject: g.subjectLabel, data: g.data, signal: q.signal });
  } catch (err) {
    failure = err;
  }
  if (call) await recordUsage(q.actor, q.today, call.usage, call.costByModel);
  await writeAudit({
    user: q.actor, mode: "review", models: call?.models ?? [], reason: g.subject.kind, usage: totalOf(call?.usage ?? {}),
    costUsd: call?.costUsd ?? 0, tools: call?.advisorCalls ? ["advisor"] : [], drafts: 0, status: call ? "ok" : "error",
    errorCode: call ? null : "AI_UNAVAILABLE",
    page: g.subject.kind === "trade" ? `/trades?trade=${g.subject.tradeId}` : `/day-report?date=${g.subject.day}`, durationMs: Date.now() - started,
  }, false);
  if (!call) throw failure;
  const saved = await saveReview({ subject: g.subject, hash, lang: q.lang, review: call.review, facts: g.facts, deep: call.deep, units: call.units, costUsd: call.costUsd, by: q.actor });
  return reviewDto(saved, false);
}
