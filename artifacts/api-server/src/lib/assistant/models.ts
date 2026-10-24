/**
 * Assistant models, prices, the routing rule and the budget units (pure; docs/AI_ASSISTANT.md).
 *
 * Model names are internal: no DTO a member sees carries them (routes map a route to a tier: standard / boost / deep).
 *
 *   - The default (cheap) model answers chat and makes the tool calls: desk setting assistant.defaultModel (Haiku 5.5).
 *   - Boost (the «x5» switch in the panel): the turn runs on assistant.smartModel (Sonnet 5.5) — the member asked for
 *     the stronger model, always honoured while the budget lasts.
 *   - Heavy tasks («Help» rewrites, a heavy intent from a page button, long context; mid-turn: a draft tool requested,
 *     or more than MAX_CHEAP_DATA_CALLS data tools / run_whatif) escalate automatically (assistant.autoEscalate):
 *       advisor on (assistant.advisorEnabled, a valid pair): the default model keeps writing and gets the advisor tool
 *         (beta advisor-tool-2026-03-01) with assistant.advisorModel — it consults the stronger model mid-answer;
 *       advisor off: the old way — the turn moves to the escalation model (a draft request re-runs the step there).
 *   - Budget: one daily budget per member in units (assistant.dailyUnits, 1,000,000). Tokens of the default model count
 *     1x, tokens of any other model (boost, escalation, the advisor's sub-inference) count assistant.boostMultiplier x.
 *     Budget tokens = input + cache writes + output (cache reads are ~10% of the price and not counted).
 * Prices: USD per million tokens (Anthropic first-party rates, 2026-10). Haiku 5.5 has a second card above 100K prompt.
 */

export const ASSISTANT_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export type AssistantModel = (typeof ASSISTANT_MODELS)[number];

export function isAssistantModel(v: unknown): v is AssistantModel {
  return typeof v === "string" && (ASSISTANT_MODELS as readonly string[]).includes(v);
}

/** Capability order (the advisor must be stronger than the executor to be worth a call). */
const RANK: Record<AssistantModel, number> = { "claude-haiku-5-5": 0, "claude-sonnet-5-5": 1, "claude-opus-5-5": 2 };

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
const PRICES: Record<AssistantModel, { base: Price; long?: { above: number; price: Price } }> = {
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    long: { above: 100_000, price: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  },
  // Cache reads: Sonnet 5.5 0.05x input ($0.10), Opus 5.5 0.05x ($0.20), Haiku 5.5 $0.01 (prompt-caching docs, 2026-10).
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
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

/** Tokens a request counts against the daily budget: input + cache writes + output (cache reads are not counted). */
export function budgetTokens(u: Usage): number {
  return u.input + u.cacheWrite + u.output;
}

/** Model class of a route: the default model, or the stronger one (boost / escalation). */
export type ModelClass = "default" | "smart";

export type RouteReason =
  | "default"        // the cheap model
  | "manual"         // the boost switch
  | "assist"         // «Help» rewrite
  | "intent"         // a heavy intent from a page button (draft / deep analysis)
  | "long_context"   // long conversation or page context
  | "draft"          // the cheap model asked for a draft tool mid-turn
  | "heavy_tools"    // more than MAX_CHEAP_DATA_CALLS data tools or run_whatif mid-turn
  | "budget";        // not enough budget left for the stronger path → the default model alone

export type RouteSettings = {
  defaultModel: AssistantModel;
  smartModel: AssistantModel;
  autoEscalate: boolean;
  advisorEnabled: boolean;
  advisorModel: AssistantModel;
  /** Weight of non-default-model tokens in the budget (the «x5»). */
  multiplier: number;
};

/**
 * `model` writes the answer; `advisor` = the model the advisor tool consults (null = no advisor this turn).
 * escalated = a stronger model writes; boost = the member's switch.
 */
export type Route = { model: AssistantModel; cls: ModelClass; reason: RouteReason; escalated: boolean; advisor: AssistantModel | null };

/** What a member may see about a route (never model names). */
export type Tier = "standard" | "boost" | "deep";

export function tierOf(r: Pick<Route, "reason" | "escalated" | "advisor">): Tier {
  if (r.reason === "manual" && (r.escalated || r.advisor)) return "boost";
  if (r.escalated || r.advisor) return "deep";
  return "standard";
}

/** Intents a page button may send that call for the stronger path. */
export const HEAVY_INTENTS = ["draft_playbook", "draft_plan", "draft_eod", "draft_rule", "analysis"] as const;
export type HeavyIntent = (typeof HEAVY_INTENTS)[number];
export const LONG_CONTEXT_CHARS = 40_000;
/** The cheap path may make this many data-tool calls in a turn before the stronger path takes over. */
export const MAX_CHEAP_DATA_CALLS = 2;

/** The advisor the default model may consult under these settings, or null (off, or not stronger than the executor). */
export function advisorFor(s: RouteSettings): AssistantModel | null {
  if (!s.advisorEnabled) return null;
  return RANK[s.advisorModel] > RANK[s.defaultModel] ? s.advisorModel : null;
}

/** Budget weight of one token of `model`: 1 for the default model, the multiplier for any other (advisor included). */
export function unitWeight(model: AssistantModel, s: Pick<RouteSettings, "defaultModel" | "multiplier">): number {
  return model === s.defaultModel ? 1 : Math.max(1, s.multiplier);
}

/** Budget units of a set of per-model usages. */
export function unitsOf(usage: Partial<Record<AssistantModel, Usage>>, s: Pick<RouteSettings, "defaultModel" | "multiplier">): number {
  let n = 0;
  for (const [m, u] of Object.entries(usage) as [AssistantModel, Usage | undefined][]) if (u) n += budgetTokens(u) * unitWeight(m, s);
  return n;
}

export type RouteInput = {
  settings: RouteSettings;
  mode: "chat" | "assist";
  /** The boost switch. */
  boost: boolean;
  intent?: string | null;
  contextChars: number;
  /** false = not enough budget left today for the stronger path. */
  budgetLeft: boolean;
};

const plain = (s: RouteSettings, reason: RouteReason = "default"): Route => ({ model: s.defaultModel, cls: "default", reason, escalated: false, advisor: null });
const smart = (s: RouteSettings, reason: RouteReason): Route => ({ model: s.smartModel, cls: "smart", reason, escalated: s.smartModel !== s.defaultModel, advisor: null });

/** The stronger path for an automatic escalation: the advisor when it is available, else the escalation model. */
function deep(s: RouteSettings, reason: RouteReason): Route {
  const advisor = advisorFor(s);
  return advisor ? { ...plain(s, reason), advisor } : smart(s, reason);
}

/** The model (and advisor) a turn starts on. */
export function initialRoute(i: RouteInput): Route {
  const s = i.settings;
  if (i.boost) return i.budgetLeft ? smart(s, "manual") : plain(s, "budget");
  const want: RouteReason | null =
    !s.autoEscalate ? null
      : i.mode === "assist" ? "assist"
      : i.intent && (HEAVY_INTENTS as readonly string[]).includes(i.intent) ? "intent"
      : i.contextChars > LONG_CONTEXT_CHARS ? "long_context"
      : null;
  if (!want) return plain(s);
  if (!i.budgetLeft) return plain(s, "budget");
  return deep(s, want);
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
 * Mid-turn escalation after a response of the plain default model. `rerun: true` = drop that response and re-issue
 * the same request on the new route (drafts: written with the advisor / by the escalation model); `rerun: false` =
 * run the requested tools, then continue on the new route. null = stay.
 */
export function escalateAfter(current: Route, s: RouteSettings, sig: TurnSignals, budgetLeft: boolean): (Route & { rerun: boolean }) | null {
  if (current.cls === "smart" || current.advisor || !s.autoEscalate || !budgetLeft) return null;
  const next = (reason: RouteReason) => deep(s, reason);
  if (sig.draftRequested) {
    const r = next("draft");
    return r.advisor || r.escalated ? { ...r, rerun: true } : null;
  }
  if (sig.whatif || sig.dataCalls > MAX_CHEAP_DATA_CALLS) {
    const r = next("heavy_tools");
    return r.advisor || r.escalated ? { ...r, rerun: false } : null;
  }
  return null;
}
