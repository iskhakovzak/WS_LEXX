/**
 * Generate an AI review (trade or day) on the assistant infrastructure:
 *   inputs (gather.ts, as the caller) → cache lookup (same inputs + version + language → no model call)
 *   → ONE request: the default model with the advisor tool (assistant.advisorEnabled; else the escalation model when
 *     auto-escalation is on, else the default model alone), the frozen review prompt as the cached prefix, the data in
 *     the user turn, structured output (output_config.format = the review JSON schema)
 *   → validation (schema.ts; one retry on an answer that does not fit) → stored, usage recorded at budget weights,
 *     audited (mode "review").
 * Fallbacks: a 400 on the format + advisor combination re-issues without the format (the JSON is then validated from
 * the text); a 400 naming the advisor re-issues without the advisor. Both are remembered for the process lifetime.
 */
import { Anthropic } from "@workspace/integrations-anthropic-ai";
import type { AssistantClient, StreamParams } from "../client";
import { advisorTool } from "../engine";
import {
  ZERO_USAGE, addUsage, advisorFor, budgetTokens, requestCostUsd, unitWeight, type AssistantModel, type RouteSettings, type Usage,
} from "../models";
import { usagesOf } from "../usage";
import { logger } from "../../logger";
import type { Lang } from "../../../i18n";
import { parseReview, REVIEW_JSON_SCHEMA, type Review } from "./schema";
import { DAY_REVIEW_SYSTEM, TRADE_REVIEW_SYSTEM, reviewUserTurn } from "./prompt";

const MAX_TOKENS = 12_000;
const MAX_PAUSES = 3;

/** Process-wide memory of what the API refused (so a refused combination is not retried on every review). */
const support = { formatWithAdvisor: true, advisor: true };
export function __resetReviewSupport(): void { support.formatWithAdvisor = true; support.advisor = true; }

export type ReviewCall = {
  review: Review;
  usage: Partial<Record<AssistantModel, Usage>>;
  costUsd: number;
  costByModel: Partial<Record<AssistantModel, number>>;
  units: number;
  models: AssistantModel[];
  deep: boolean;
  advisorCalls: number;
};

type Plan = { model: AssistantModel; advisor: AssistantModel | null; format: boolean };

export function reviewPlan(s: RouteSettings): Plan {
  const advisor = support.advisor ? advisorFor(s) : null;
  if (advisor) return { model: s.defaultModel, advisor, format: support.formatWithAdvisor };
  return { model: s.autoEscalate ? s.smartModel : s.defaultModel, advisor: null, format: true };
}

export function reviewParams(kind: "trade" | "day", plan: Plan, messages: Anthropic.MessageParam[]): StreamParams {
  const params: StreamParams = {
    model: plan.model,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: kind === "trade" ? TRADE_REVIEW_SYSTEM : DAY_REVIEW_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: plan.advisor ? [advisorTool(plan.advisor) as unknown as Record<string, unknown>] : [],
    messages,
    output_config: { effort: "medium", ...(plan.format ? { format: { type: "json_schema" as const, schema: REVIEW_JSON_SCHEMA } } : {}) },
  };
  if (!params.tools.length) delete (params as Partial<StreamParams>).tools;
  return params;
}

async function once(client: AssistantClient, params: StreamParams, signal: AbortSignal): Promise<Anthropic.Message> {
  const stream = client.stream(params, { signal });
  for await (const _ev of stream) { /* drain: the review is shown whole */ }
  return stream.finalMessage();
}

const textOf = (m: Anthropic.Message) => (m.content as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");

export async function callReview(args: {
  client: AssistantClient; settings: RouteSettings; kind: "trade" | "day"; lang: Lang; today: string; subject: string; data: unknown; signal: AbortSignal;
}): Promise<ReviewCall> {
  const { client, settings: s, kind, signal } = args;
  const out: ReviewCall = { review: null as unknown as Review, usage: {}, costUsd: 0, costByModel: {}, units: 0, models: [], deep: false, advisorCalls: 0 };
  const userTurn = reviewUserTurn({ kind, lang: args.lang, today: args.today, subject: args.subject, data: args.data });
  let plan = reviewPlan(s);
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < 4; attempt++) {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userTurn }];
    let message: Anthropic.Message | null = null;
    try {
      for (let pause = 0; pause <= MAX_PAUSES; pause++) {
        message = await once(client, reviewParams(kind, plan, messages), signal);
        // Usage only (no content): executor tokens, cache reads / writes and the advisor's iterations — for cost checks.
        logger.info({ kind, model: plan.model, advisor: plan.advisor, format: plan.format, stop: message.stop_reason, usage: message.usage }, "ai review: model call");
        for (const { model, usage } of usagesOf(plan.model, message, plan.advisor)) {
          out.usage[model] = addUsage(out.usage[model] ?? ZERO_USAGE, usage);
          const cost = requestCostUsd(model, usage);
          out.costUsd += cost;
          out.costByModel[model] = (out.costByModel[model] ?? 0) + cost;
          out.units += budgetTokens(usage) * unitWeight(model, s);
          if (!out.models.includes(model)) out.models.push(model);
        }
        out.advisorCalls += (message.content as Array<{ type: string; name?: string }>).filter((b) => b.type === "server_tool_use" && b.name === "advisor").length;
        if ((message.stop_reason as string) !== "pause_turn") break;
        messages.push({ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] });
      }
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      // The request shape was refused: first drop the format (the JSON is then read from the text), then the advisor.
      if (plan.format) {
        if (plan.advisor) support.formatWithAdvisor = false;
        plan = { ...plan, format: false };
        continue;
      }
      if (!plan.advisor) throw err;
      support.advisor = false;
      plan = { ...reviewPlan(s), format: false };
      continue;
    }
    if (!message || message.stop_reason === "refusal") throw new ReviewRefused();
    const parsed = parseReview(textOf(message));
    if (parsed.ok) {
      out.review = parsed.review;
      out.deep = !!plan.advisor || plan.model !== s.defaultModel;
      return out;
    }
    lastIssues = parsed.issues;
    if (attempt >= 1) break; // one retry on an answer that does not fit
  }
  throw new ReviewInvalid(lastIssues);
}

export class ReviewRefused extends Error { constructor() { super("refused"); } }
export class ReviewInvalid extends Error { constructor(readonly issues: string[]) { super(`invalid review: ${issues.join("; ")}`); } }

export const totalOf = (u: Partial<Record<AssistantModel, Usage>>): Usage => Object.values(u).reduce<Usage>((a, x) => addUsage(a, x ?? ZERO_USAGE), ZERO_USAGE);
