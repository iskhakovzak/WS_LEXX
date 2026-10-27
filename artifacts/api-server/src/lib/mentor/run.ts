/**
 * One mentor model call on the assistant infrastructure (client, prices, budget units, advisor, usage): the frozen
 * mentor prompt as the cached prefix, structured output (the kind's JSON schema), validation with one retry.
 *
 * Model plan (cost control): the brief and chat run on the desk's default model alone (assistant.defaultModel, Haiku
 * 5.5 by default) at low effort; the debrief and the weekly review add the advisor tool (assistant.advisorEnabled /
 * assistant.advisorModel) when it is on — the default model writes, the stronger one advises once. Never the boost.
 * Fallbacks like the AI reviews: a 400 on the format + advisor combination re-issues without the format (the JSON is
 * then read from the text); a 400 naming the advisor re-issues without it. Both are remembered for the process.
 */
import { Anthropic } from "@workspace/integrations-anthropic-ai";
import type { AssistantClient, StreamParams } from "../assistant/client";
import { advisorTool } from "../assistant/engine";
import { ZERO_USAGE, addUsage, advisorFor, budgetTokens, requestCostUsd, unitWeight, type AssistantModel, type RouteSettings, type Usage } from "../assistant/models";
import { advisorCalls, usagesOf } from "../assistant/usage";
import { textOf } from "../assistant/review/run";
import { logger } from "../logger";
import { JSON_SCHEMAS, parseMentor, type MentorKind, type MentorOutput } from "./schema";

const MAX_PAUSES = 2;
const support = { formatWithAdvisor: true, advisor: true };
export function __resetMentorSupport(): void { support.formatWithAdvisor = true; support.advisor = true; }

export type MentorPlan = { model: AssistantModel; advisor: AssistantModel | null; format: boolean; effort: "low" | "medium"; maxTokens: number };

export function mentorPlan(kind: MentorKind, s: RouteSettings): MentorPlan {
  const heavy = kind === "debrief" || kind === "weekly";
  const advisor = heavy && support.advisor ? advisorFor(s) : null;
  return { model: s.defaultModel, advisor, format: advisor ? support.formatWithAdvisor : true, effort: heavy ? "medium" : "low", maxTokens: heavy ? 10_000 : 6_000 };
}

/** The request of one call. `cacheTtl: "1h"` = the batch form (a batch can outlive the 5-minute cache). */
export function mentorParams(kind: MentorKind, plan: MentorPlan, system: Anthropic.TextBlockParam[], messages: Anthropic.MessageParam[], opts: { cacheTtl?: "1h" } = {}): StreamParams {
  const cache = opts.cacheTtl ? { type: "ephemeral" as const, ttl: opts.cacheTtl } : { type: "ephemeral" as const };
  const params: StreamParams = {
    model: plan.model,
    max_tokens: plan.maxTokens,
    system: system.map((b) => ({ ...b, cache_control: cache })) as Anthropic.TextBlockParam[],
    tools: plan.advisor ? [advisorTool(plan.advisor) as unknown as Record<string, unknown>] : [],
    messages,
    output_config: { effort: plan.effort, ...(plan.format ? { format: { type: "json_schema" as const, schema: JSON_SCHEMAS[kind] } } : {}) },
  };
  if (!params.tools.length) delete (params as Partial<StreamParams>).tools;
  return params;
}

export type MentorCall<K extends MentorKind> = {
  value: MentorOutput[K];
  usage: Partial<Record<AssistantModel, Usage>>;
  costUsd: number;
  costByModel: Partial<Record<AssistantModel, number>>;
  units: number;
  models: AssistantModel[];
  deep: boolean;
  advisorCalls: number;
};

export class MentorRefused extends Error { constructor() { super("refused"); } }
export class MentorInvalid extends Error { constructor(readonly issues: string[]) { super(`invalid mentor answer: ${issues.join("; ")}`); } }

async function once(client: AssistantClient, params: StreamParams, signal: AbortSignal): Promise<Anthropic.Message> {
  const stream = client.stream(params, { signal });
  for await (const _ev of stream) { /* drain: the answer is validated whole */ }
  return stream.finalMessage();
}

/** Accumulate one response's usage into the call totals (cost at each model's price, units at its budget weight). */
export function addResponseUsage(out: Omit<MentorCall<MentorKind>, "value" | "deep">, plan: Pick<MentorPlan, "model" | "advisor">, message: Pick<Anthropic.Message, "usage" | "content">, s: RouteSettings, discount = 1): void {
  for (const { model, usage } of usagesOf(plan.model, message, plan.advisor)) {
    out.usage[model] = addUsage(out.usage[model] ?? ZERO_USAGE, usage);
    const cost = requestCostUsd(model, usage) * discount;
    out.costUsd += cost;
    out.costByModel[model] = (out.costByModel[model] ?? 0) + cost;
    out.units += budgetTokens(usage) * unitWeight(model, s);
    if (!out.models.includes(model)) out.models.push(model);
  }
  out.advisorCalls += advisorCalls(message);
}

export async function callMentor<K extends MentorKind>(args: {
  client: AssistantClient; settings: RouteSettings; kind: K; system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[]; signal: AbortSignal;
}): Promise<MentorCall<K>> {
  const { client, settings: s, kind, signal } = args;
  const out = { usage: {}, costUsd: 0, costByModel: {}, units: 0, models: [], advisorCalls: 0 } as Omit<MentorCall<K>, "value" | "deep">;
  let plan = mentorPlan(kind, s);
  let issues: string[] = [];
  let invalid = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const messages = [...args.messages];
    let message: Anthropic.Message | null = null;
    try {
      for (let pause = 0; pause <= MAX_PAUSES; pause++) {
        message = await once(client, mentorParams(kind, plan, args.system, messages), signal);
        logger.info({ kind, model: plan.model, advisor: plan.advisor, format: plan.format, stop: message.stop_reason, usage: message.usage }, "mentor: model call");
        addResponseUsage(out, plan, message, s);
        if ((message.stop_reason as string) !== "pause_turn") break;
        messages.push({ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] });
      }
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      if (plan.format && plan.advisor) { support.formatWithAdvisor = false; plan = { ...plan, format: false }; continue; }
      if (!plan.advisor) throw err;
      support.advisor = false;
      plan = mentorPlan(kind, s);
      continue;
    }
    if (!message || message.stop_reason === "refusal") throw new MentorRefused();
    const parsed = parseMentor(kind, textOf(message));
    if (parsed.ok) return { ...out, value: parsed.value, deep: !!plan.advisor };
    issues = parsed.issues;
    if (++invalid >= 2) break; // one retry on an answer that does not fit
  }
  throw new MentorInvalid(issues);
}

export const totalUsage = (u: Partial<Record<AssistantModel, Usage>>): Usage => Object.values(u).reduce<Usage>((a, x) => addUsage(a, x ?? ZERO_USAGE), ZERO_USAGE);
