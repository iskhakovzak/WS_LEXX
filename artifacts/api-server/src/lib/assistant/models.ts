/**
 * «Ассистент WS» — models, prices and the routing rule (pure; docs/AI_ASSISTANT.md).
 *
 * Owner decision 2026-10-25: «большинство задач — Haiku, если нужно умнее — Sonnet, все самые последние».
 *   - The default (cheap) model answers chat and makes the tool calls: desk setting assistant.defaultModel (Haiku 5.5).
 *   - The escalation model (assistant.smartModel, Sonnet 5.5) takes over
 *       before the turn: the «Умнее» toggle (always, even with auto-escalation off), «✦ Помочь» rewrites, a heavy intent
 *                        from a page button (draft a playbook entry / plan / EOD review, deep analysis) and long context;
 *       during the turn: the cheap model asked for a draft tool (its response is dropped and the same request is re-run on
 *                        the escalation model, so the draft is written by the smart model), or it gathered heavy data —
 *                        more than MAX_CHEAP_DATA_CALLS data tools or run_whatif — then the tools still run on the
 *                        cheap path and the escalation model writes the analysis from their results.
 *     Automatic escalation follows assistant.autoEscalate; the toggle is manual and always honoured.
 *   - Each model class has its own daily token budget per user (assistant.dailyTokensDefault / dailyTokensSmart). An
 *     exhausted escalation budget falls back to the default model; an exhausted default budget stops the assistant
 *     for the day (AI_BUDGET_EXCEEDED).
 * Prices: USD per million tokens (Anthropic first-party rates, 2026-10). Cache reads / 5-minute cache writes per the
 * pricing table (writes 1.25× input). Haiku 5.5 has a second rate card above 100K prompt tokens.
 */

export const ASSISTANT_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export type AssistantModel = (typeof ASSISTANT_MODELS)[number];

export function isAssistantModel(v: unknown): v is AssistantModel {
  return typeof v === "string" && (ASSISTANT_MODELS as readonly string[]).includes(v);
}

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
const PRICES: Record<AssistantModel, { base: Price; long?: { above: number; price: Price } }> = {
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    long: { above: 100_000, price: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  },
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  "claude-opus-5-5": { base: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/** Cost of ONE request (the long-prompt rate card applies per request). */
export function requestCostUsd(model: AssistantModel, u: Usage): number {
  const p = PRICES[model];
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const price = p.long && prompt > p.long.above ? p.long.price : p.base;
  return (u.input * price.input + u.output * price.output + u.cacheRead * price.cacheRead + u.cacheWrite * price.cacheWrite) / 1_000_000;
}

/** Tokens a request counts against the daily budget: input + cache writes + output (cache reads are ~10% and not counted). */
export function budgetTokens(u: Usage): number {
  return u.input + u.cacheWrite + u.output;
}

/** Model class of a model under the current settings (the budget it draws from). */
export type ModelClass = "default" | "smart";

export type RouteReason =
  | "default"        // the cheap model
  | "manual"         // the «Умнее» toggle
  | "assist"         // «✦ Помочь» rewrite
  | "intent"         // a heavy intent from a page button (draft / deep analysis)
  | "long_context"   // long conversation or page context
  | "draft"          // the cheap model asked for a draft tool mid-turn
  | "heavy_tools"    // more than MAX_CHEAP_DATA_CALLS data tools or run_whatif mid-turn
  | "smart_budget";  // the escalation budget is used up → the default model

export type RouteSettings = { defaultModel: AssistantModel; smartModel: AssistantModel; autoEscalate: boolean };
export type Route = { model: AssistantModel; cls: ModelClass; reason: RouteReason; escalated: boolean };

/** Intents a page button may send that call for the escalation model. */
export const HEAVY_INTENTS = ["draft_playbook", "draft_plan", "draft_eod", "draft_rule", "analysis"] as const;
export type HeavyIntent = (typeof HEAVY_INTENTS)[number];
export const LONG_CONTEXT_CHARS = 40_000;
/** The cheap path may make this many data-tool calls in a turn before the escalation model writes the answer. */
export const MAX_CHEAP_DATA_CALLS = 2;

export type RouteInput = {
  settings: RouteSettings;
  mode: "chat" | "assist";
  smart: boolean;
  intent?: string | null;
  contextChars: number;
  /** false = the caller's escalation budget for today is used up. */
  smartBudgetLeft: boolean;
};

const route = (s: RouteSettings, cls: ModelClass, reason: RouteReason): Route => ({
  model: cls === "smart" ? s.smartModel : s.defaultModel,
  cls,
  reason,
  escalated: cls === "smart" && s.smartModel !== s.defaultModel,
});

/** The model a turn starts on. */
export function initialRoute(i: RouteInput): Route {
  const s = i.settings;
  const want: RouteReason | null =
    i.smart ? "manual"
      : !s.autoEscalate ? null
      : i.mode === "assist" ? "assist"
      : i.intent && (HEAVY_INTENTS as readonly string[]).includes(i.intent) ? "intent"
      : i.contextChars > LONG_CONTEXT_CHARS ? "long_context"
      : null;
  if (!want) return route(s, "default", "default");
  if (!i.smartBudgetLeft) return route(s, "default", "smart_budget");
  return route(s, "smart", want);
}

export type TurnSignals = {
  /** Data (read) tool calls made so far this turn, including the ones in the latest response. */
  dataCalls: number;
  /** run_whatif was called this turn. */
  whatif: boolean;
  /** The latest response asks for a draft tool. */
  draftRequested: boolean;
};

/**
 * Mid-turn escalation after a response of the cheap model. `rerun: true` = drop that response and re-issue the same
 * request on the escalation model (drafts); `rerun: false` = run the requested tools, then continue on the escalation
 * model. null = stay.
 */
export function escalateAfter(current: Route, s: RouteSettings, sig: TurnSignals, smartBudgetLeft: boolean): (Route & { rerun: boolean }) | null {
  if (current.cls === "smart" || s.smartModel === s.defaultModel || !s.autoEscalate || !smartBudgetLeft) return null;
  if (sig.draftRequested) return { ...route(s, "smart", "draft"), rerun: true };
  if (sig.whatif || sig.dataCalls > MAX_CHEAP_DATA_CALLS) return { ...route(s, "smart", "heavy_tools"), rerun: false };
  return null;
}
