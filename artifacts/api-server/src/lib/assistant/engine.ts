/**
 * «Ассистент WS» — one turn of the agent loop (manual streaming loop over the Messages API; docs/AI_ASSISTANT.md).
 *
 *   request (tools → system → history + user turn, cached) → stream text to the client as it comes
 *   → tool_use? validate + run the tools (parallel), send chips / draft cards, append all results in ONE user message
 *   → repeat until the model answers without tools (at most MAX_STEPS requests; the last one may not call tools).
 *
 * Prompt caching: the tool list (fixed, sorted, breakpoint on the last tool) and the frozen system prompt (breakpoint)
 * form the shared prefix; a third breakpoint moves to the newest message each request, so the tool loop and the next
 * turn read the conversation from cache. Per-request facts live in the user turn (context.ts), never in the prefix.
 * Model routing (models.ts): the turn starts on initialRoute(); after a cheap-model response, escalateAfter() may
 * re-run it on the escalation model (draft requested) or hand the next request to it (heavy data). Thinking blocks
 * are passed back unchanged with the assistant content (a model that cannot read another model's blocks drops them).
 * Eager input streaming: a tool input the SDK could not parse at all rejects the stream → the step is re-issued
 * (at most MAX_JSON_RETRIES); typed API errors are never mistaken for that. Inputs are validated before any run.
 */
import { Anthropic } from "@workspace/integrations-anthropic-ai";
import type { AssistantClient, StreamParams } from "./client";
import { ASSISTANT_SYSTEM_PROMPT } from "./systemPrompt";
import { TOOL_BY_NAME, apiTools } from "./toolDefs";
import { executeTool, type ToolContext } from "./tools";
import type { Draft } from "./drafts";
import type { SseEvent } from "./sse";
import { ZERO_USAGE, addUsage, budgetTokens, escalateAfter, requestCostUsd, type AssistantModel, type Route, type RouteSettings, type TurnSignals, type Usage } from "./models";

export const MAX_STEPS = 8;
const MAX_TOKENS = 32_000;
const MAX_JSON_RETRIES = 2;

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
  /** May the escalation model still spend `smartTokens` more today (its budget)? */
  smartBudgetLeft: (smartTokensThisTurn: number) => boolean;
  /** At most this many model requests (default MAX_STEPS); the last one may not call tools. */
  maxSteps?: number;
};

export type EngineResult = {
  status: "ok" | "error" | "aborted" | "refused";
  errorCode?: string;
  text: string;
  drafts: Draft[];
  tools: string[];
  models: AssistantModel[];
  usage: Partial<Record<AssistantModel, Usage>>;
  costByModel: Partial<Record<AssistantModel, number>>;
  costUsd: number;
  route: Route;
  stop: string;
};

const SYSTEM: Anthropic.TextBlockParam[] = [{ type: "text", text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
const TOOLS = apiTools();

/** The request for one step: the newest message carries the moving cache breakpoint (only that one). */
export function buildParams(model: AssistantModel, messages: Anthropic.MessageParam[], lastStep: boolean): StreamParams & { tool_choice?: { type: "none" } } {
  const msgs = messages.map((m, i) => {
    if (i !== messages.length - 1) return m;
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content.map((b) => ({ ...b }));
    const last = blocks[blocks.length - 1] as Record<string, unknown> | undefined;
    if (last && last.type !== "thinking" && last.type !== "redacted_thinking") last.cache_control = { type: "ephemeral" };
    return { role: m.role, content: blocks } as Anthropic.MessageParam;
  });
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    tools: TOOLS,
    messages: msgs,
    output_config: { effort: "medium" },
    ...(lastStep ? { tool_choice: { type: "none" as const } } : {}),
  };
}

const usageOf = (m: Anthropic.Message): Usage => ({
  input: m.usage?.input_tokens ?? 0,
  output: m.usage?.output_tokens ?? 0,
  cacheRead: m.usage?.cache_read_input_tokens ?? 0,
  cacheWrite: m.usage?.cache_creation_input_tokens ?? 0,
});

class AbortedTurn extends Error {}

export async function runTurn(input: EngineInput): Promise<EngineResult> {
  const { client, emit, signal, settings } = input;
  const maxSteps = input.maxSteps ?? MAX_STEPS;
  const messages: Anthropic.MessageParam[] = [...input.history, { role: "user", content: input.userTurn }];
  const res: EngineResult = { status: "ok", text: "", drafts: [], tools: [], models: [input.route.model], usage: {}, costByModel: {}, costUsd: 0, route: input.route, stop: "end_turn" };
  let route = input.route;
  let dataCalls = 0;
  let whatif = false;
  let jsonRetries = 0;
  let smartTokens = 0;

  const account = (model: AssistantModel, m: Anthropic.Message) => {
    const u = usageOf(m);
    res.usage[model] = addUsage(res.usage[model] ?? ZERO_USAGE, u);
    const cost = requestCostUsd(model, u);
    res.costByModel[model] = (res.costByModel[model] ?? 0) + cost;
    res.costUsd += cost;
    if (route.cls === "smart") smartTokens += budgetTokens(u);
  };

  for (let step = 1; step <= maxSteps; step++) {
    if (signal.aborted) return { ...res, status: "aborted" };
    const params = buildParams(route.model, messages, step === maxSteps);
    let message: Anthropic.Message;
    let stepText = "";
    try {
      const stream = client.stream(params, { signal });
      for await (const ev of stream) {
        if (signal.aborted) { stream.abort(); throw new AbortedTurn(); }
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          emit({ event: "tool", data: { id: ev.content_block.id, name: ev.content_block.name, status: "start" } });
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          stepText += ev.delta.text;
          emit({ event: "text", data: { delta: ev.delta.text } });
        }
      }
      message = await stream.finalMessage();
    } catch (err) {
      if (signal.aborted || err instanceof AbortedTurn) return { ...res, status: "aborted" };
      if (err instanceof Anthropic.APIError) throw err; // auth, rate limit, overload… → the route answers an error event
      // A tool input the SDK could not parse at all (eager input streaming): no tool_use id to answer → re-issue.
      if (jsonRetries++ >= MAX_JSON_RETRIES) throw err;
      emit({ event: "retry", data: {} });
      step--;
      continue;
    }
    account(route.model, message);
    res.stop = message.stop_reason ?? "end_turn";

    if (message.stop_reason === "refusal") {
      res.text += stepText;
      return { ...res, status: "refused", route };
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
    const esc = escalateAfter(route, settings, signals, input.smartBudgetLeft(smartTokens));
    if (esc?.rerun) {
      // The cheap model wants to write a draft: the escalation model writes it — drop this response, same request again.
      emit({ event: "retry", data: {} });
      route = esc;
      res.models.push(route.model);
      emit({ event: "model", data: { model: route.model, reason: route.reason } });
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
    if (esc && !esc.rerun) {
      route = esc;
      res.models.push(route.model);
      emit({ event: "model", data: { model: route.model, reason: route.reason } });
    }
    if (signal.aborted) return { ...res, status: "aborted", route };
  }
  return { ...res, route };
}
