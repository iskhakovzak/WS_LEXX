/**
 * Assistant — one turn of the agent loop (manual streaming loop over the Messages API; docs/AI_ASSISTANT.md).
 *
 *   request (tools → system → history + user turn, cached) → stream text to the client as it comes
 *   → tool_use? validate + run the tools (parallel), send chips / draft cards, append all results in ONE user message
 *   → repeat until the model answers without tools (at most MAX_STEPS requests; the last one may not call tools).
 *
 * Prompt caching: the tool list (fixed, sorted, breakpoint on the last tool) and the frozen system prompt (breakpoint)
 * form the shared prefix; a third breakpoint moves to the newest message each request, so the tool loop and the next
 * turn read the conversation from cache. Per-request facts live in the user turn (context.ts), never in the prefix.
 * Model routing (models.ts): the turn starts on initialRoute(); after a plain default-model response, escalateAfter()
 * may re-run it or hand the next request to the stronger path — the advisor tool (the default model consults the
 * advisor model mid-answer) or, with the advisor off, the escalation model. Once on, the advisor stays for the turn
 * (history with advisor results needs the tool). pause_turn (a long advisor call) re-sends the assistant content as is.
 * Thinking / advisor blocks are passed back unchanged with the assistant content.
 * Eager input streaming: a tool input the SDK could not parse at all rejects the stream → the step is re-issued
 * (at most MAX_JSON_RETRIES); typed API errors are never mistaken for that. Inputs are validated before any run.
 */
import { Anthropic } from "@workspace/integrations-anthropic-ai";
import type { AdvisorTool, AssistantClient, StreamParams } from "./client";
import { ADVISOR_GUIDE, ASSISTANT_SYSTEM_PROMPT } from "./systemPrompt";
import { TOOL_BY_NAME, apiTools } from "./toolDefs";
import { executeTool, type ToolContext } from "./tools";
import type { Draft } from "./drafts";
import type { SseEvent } from "./sse";
import {
  ZERO_USAGE, addUsage, budgetTokens, escalateAfter, requestCostUsd, tierOf, unitWeight,
  type AssistantModel, type Route, type RouteSettings, type TurnSignals, type Usage,
} from "./models";
import { advisorCalls, usagesOf } from "./usage";
import { logger } from "../logger";

export const MAX_STEPS = 8;
const MAX_TOKENS = 32_000;
const MAX_JSON_RETRIES = 2;
/** Advisor calls per request and the cap on each call's output (docs: 2048 cuts advice ~7x with no truncation). */
export const ADVISOR_MAX_USES = 2;
export const ADVISOR_MAX_TOKENS = 2048;

export type Emit = (e: SseEvent) => void;

export type EngineInput = {
  client: AssistantClient;
  tools: ToolContext;
  settings: RouteSettings;
  route: Route;
  history: Anthropic.MessageParam[];
  userTurn: string;
  emit: Emit;
  signal: AbortSignal;
  /** Is there budget left after `turnUnits` more units today (gates the mid-turn stronger path)? */
  budgetLeft: (turnUnits: number) => boolean;
  /** At most this many model requests (default MAX_STEPS); the last one may not call tools. */
  maxSteps?: number;
};

export type EngineResult = {
  status: "ok" | "error" | "aborted" | "refused";
  errorCode?: string;
  text: string;
  drafts: Draft[];
  tools: string[];
  /** Internal (audit only): every model that ran, the advisor included. */
  models: AssistantModel[];
  usage: Partial<Record<AssistantModel, Usage>>;
  costByModel: Partial<Record<AssistantModel, number>>;
  costUsd: number;
  /** Budget units of this turn. */
  units: number;
  advisorCalls: number;
  route: Route;
  stop: string;
};

const SYSTEM: Anthropic.TextBlockParam[] = [{ type: "text", text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
const SYSTEM_WITH_ADVISOR: Anthropic.TextBlockParam[] = [...SYSTEM, { type: "text", text: ADVISOR_GUIDE }];
const TOOLS = apiTools();

export function advisorTool(model: AssistantModel): AdvisorTool {
  return { type: "advisor_20260301", name: "advisor", model, max_uses: ADVISOR_MAX_USES, max_tokens: ADVISOR_MAX_TOKENS };
}

/** The newest message carries the moving cache breakpoint (only that one). */
export function withMovingBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((m, i) => {
    if (i !== messages.length - 1) return m;
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content.map((b) => ({ ...b }));
    const last = blocks[blocks.length - 1] as Record<string, unknown> | undefined;
    if (last && (last.type === "text" || last.type === "tool_result")) last.cache_control = { type: "ephemeral" };
    return { role: m.role, content: blocks } as Anthropic.MessageParam;
  });
}

/** The request for one step. */
export function buildParams(route: Pick<Route, "model" | "advisor">, messages: Anthropic.MessageParam[], lastStep: boolean): StreamParams {
  return {
    model: route.model,
    max_tokens: MAX_TOKENS,
    system: route.advisor ? SYSTEM_WITH_ADVISOR : SYSTEM,
    tools: route.advisor ? [...TOOLS, advisorTool(route.advisor) as unknown as Record<string, unknown>] : TOOLS,
    messages: withMovingBreakpoint(messages),
    output_config: { effort: "medium" },
    ...(lastStep ? { tool_choice: { type: "none" as const } } : {}),
  };
}

class AbortedTurn extends Error {}

type StreamOutcome = { message: Anthropic.Message; text: string };

/** Streams one request: text deltas, tool chips and advisor progress go to the client as they come. */
async function streamStep(input: EngineInput, params: StreamParams): Promise<StreamOutcome> {
  const { client, emit, signal } = input;
  let text = "";
  const stream = client.stream(params, { signal });
  for await (const ev of stream) {
    if (signal.aborted) { stream.abort(); throw new AbortedTurn(); }
    if (ev.type === "content_block_start") {
      const b = ev.content_block as { type: string; id?: string; name?: string; content?: { type?: string } };
      if (b.type === "tool_use") emit({ event: "tool", data: { id: b.id!, name: b.name!, status: "start" } });
      else if (b.type === "server_tool_use" && b.name === "advisor") emit({ event: "advisor", data: { status: "start" } });
      else if (b.type === "advisor_tool_result") emit({ event: "advisor", data: { status: b.content?.type === "advisor_tool_result_error" ? "error" : "done" } });
    } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      text += ev.delta.text;
      emit({ event: "text", data: { delta: ev.delta.text } });
    }
  }
  return { message: await stream.finalMessage(), text };
}

export async function runTurn(input: EngineInput): Promise<EngineResult> {
  const { emit, signal, settings } = input;
  const maxSteps = input.maxSteps ?? MAX_STEPS;
  const messages: Anthropic.MessageParam[] = [...input.history, { role: "user", content: input.userTurn }];
  const res: EngineResult = {
    status: "ok", text: "", drafts: [], tools: [], models: [input.route.model, ...(input.route.advisor ? [input.route.advisor] : [])],
    usage: {}, costByModel: {}, costUsd: 0, units: 0, advisorCalls: 0, route: input.route, stop: "end_turn",
  };
  let route = input.route;
  let dataCalls = 0;
  let whatif = false;
  let jsonRetries = 0;

  const account = (m: Anthropic.Message) => {
    // Usage only (no content): cache reads / writes and advisor iterations, for cost and cache-hit checks.
    logger.info({ model: route.model, advisor: route.advisor, stop: m.stop_reason, usage: m.usage }, "assistant: model call");
    for (const { model, usage } of usagesOf(route.model, m, route.advisor)) {
      res.usage[model] = addUsage(res.usage[model] ?? ZERO_USAGE, usage);
      const cost = requestCostUsd(model, usage);
      res.costByModel[model] = (res.costByModel[model] ?? 0) + cost;
      res.costUsd += cost;
      res.units += budgetTokens(usage) * unitWeight(model, settings);
    }
    res.advisorCalls += advisorCalls(m);
  };
  const switchTo = (next: Route) => {
    route = next;
    for (const m of [next.model, next.advisor]) if (m && !res.models.includes(m)) res.models.push(m);
    emit({ event: "tier", data: { tier: tierOf(next), reason: next.reason } });
  };

  for (let step = 1; step <= maxSteps; step++) {
    if (signal.aborted) return { ...res, status: "aborted" };
    const params = buildParams(route, messages, step === maxSteps);
    let out: StreamOutcome;
    try {
      out = await streamStep(input, params);
    } catch (err) {
      if (signal.aborted || err instanceof AbortedTurn) return { ...res, status: "aborted" };
      if (err instanceof Anthropic.APIError) throw err; // auth, rate limit, overload… → the route answers an error event
      // A tool input the SDK could not parse at all (eager input streaming): no tool_use id to answer → re-issue.
      if (jsonRetries++ >= MAX_JSON_RETRIES) throw err;
      emit({ event: "retry", data: {} });
      step--;
      continue;
    }
    const { message, text: stepText } = out;
    account(message);
    res.stop = message.stop_reason ?? "end_turn";

    if (message.stop_reason === "refusal") {
      res.text += stepText;
      return { ...res, status: "refused", route };
    }
    if ((message.stop_reason as string) === "pause_turn") {
      // A long advisor call paused the turn: re-send the assistant content unchanged, advisor tool still on.
      res.text += stepText;
      messages.push({ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] });
      continue;
    }
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUses.length) {
      res.text += stepText;
      return { ...res, route };
    }
    if (message.stop_reason === "max_tokens") {
      // A tool input cut off at max_tokens can still parse as a valid partial object: never run it.
      if (jsonRetries++ >= MAX_JSON_RETRIES) { res.text += stepText; return { ...res, status: "error", errorCode: "TRUNCATED", route }; }
      emit({ event: "retry", data: {} });
      step--;
      continue;
    }

    const kinds = toolUses.map((t) => TOOL_BY_NAME.get(t.name)?.kind ?? "unknown");
    const signals: TurnSignals = {
      dataCalls: dataCalls + kinds.filter((k) => k === "data").length,
      whatif: whatif || toolUses.some((t) => t.name === "run_whatif"),
      draftRequested: kinds.includes("draft"),
    };
    const esc = escalateAfter(route, settings, signals, input.budgetLeft(res.units));
    if (esc?.rerun) {
      // A draft is written on the stronger path: drop this response, same request again there.
      emit({ event: "retry", data: {} });
      switchTo(esc);
      step--; // the re-run does not use up a step
      continue;
    }

    res.text += stepText;
    messages.push({ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] });
    const outcomes = await Promise.all(toolUses.map(async (t) => {
      const o = await executeTool(t.name, t.input, input.tools);
      emit({ event: "tool", data: { id: t.id, name: t.name, status: o.isError ? "error" : "done", ...(o.code ? { code: o.code } : {}) } });
      if (o.draft) { res.drafts.push(o.draft); emit({ event: "draft", data: { id: o.draft.id, kind: o.draft.kind, draft: o.draft.draft } }); }
      return { t, o };
    }));
    for (const { t } of outcomes) if (!res.tools.includes(t.name)) res.tools.push(t.name);
    messages.push({
      role: "user",
      content: outcomes.map(({ t, o }) => ({ type: "tool_result" as const, tool_use_id: t.id, content: o.content, ...(o.isError ? { is_error: true } : {}) })),
    });
    dataCalls = signals.dataCalls;
    whatif = signals.whatif;
    if (esc && !esc.rerun) switchTo(esc);
    if (signal.aborted) return { ...res, status: "aborted", route };
  }
  return { ...res, route };
}
