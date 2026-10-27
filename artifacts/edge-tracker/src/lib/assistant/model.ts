/**
 * Assistant — pure state of the panel: applying stream events to the answer being written, and the starter prompts
 * per page. No React here (components/assistant renders it). No model names reach the web: an answer carries its tier
 * (standard / boost = the «x5» switch / deep = the advisor or the stronger model took part).
 *
 * Steps: the server streams one model request after another (text → tool calls → results → more text). A `retry`
 * event means «drop what the current step wrote» (the step is re-run: unparseable input, or a draft handed to the
 * stronger path), so the answer keeps the text and the not-yet-run chips of finished steps only.
 */
import type { AssistantEvent, DraftKind, Tier } from "./sse";

export type { Tier } from "./sse";
export type ToolChip = { id: string; name: string; status: "start" | "done" | "error"; step: number };
export type DraftCard = { id: string; kind: DraftKind; draft: Record<string, unknown> };

export type ChatMessage = {
  key: string;
  role: "user" | "assistant";
  text: string;
  tier: Tier | null;
  reason: string | null;
  /** The default model is consulting the advisor right now (the «deep analysis» chip). */
  advising: "start" | "done" | "error" | null;
  chips: ToolChip[];
  drafts: DraftCard[];
  status: "streaming" | "done" | "error" | "stopped";
  error: { code: string; message: string } | null;
  /** Where the current step's text starts (a retry cuts back to it). */
  stepStart: number;
  step: number;
  /** The current step has run its tools: the next text / chip opens a new step. */
  stepClosed: boolean;
};

export function newAssistantMessage(key: string): ChatMessage {
  return { key, role: "assistant", text: "", tier: null, reason: null, advising: null, chips: [], drafts: [], status: "streaming", error: null, stepStart: 0, step: 0, stepClosed: false };
}

function openStep(m: ChatMessage): ChatMessage {
  return m.stepClosed ? { ...m, step: m.step + 1, stepStart: m.text.length, stepClosed: false } : m;
}

export function applyEvent(m: ChatMessage, e: AssistantEvent): ChatMessage {
  switch (e.event) {
    case "meta":
    case "tier":
      return { ...m, tier: e.data.tier, reason: e.data.reason };
    case "advisor":
      return { ...m, advising: e.data.status, tier: m.tier === "boost" ? m.tier : "deep" };
    case "text": {
      const n = openStep(m);
      return { ...n, text: n.text + e.data.delta };
    }
    case "tool": {
      if (e.data.status === "start") {
        const n = openStep(m);
        if (n.chips.some((c) => c.id === e.data.id)) return n;
        return { ...n, chips: [...n.chips, { id: e.data.id, name: e.data.name, status: "start", step: n.step }] };
      }
      const has = m.chips.some((c) => c.id === e.data.id);
      const chips = has
        ? m.chips.map((c) => (c.id === e.data.id ? { ...c, status: e.data.status } : c))
        : [...m.chips, { id: e.data.id, name: e.data.name, status: e.data.status, step: m.step }];
      return { ...m, chips, stepClosed: true };
    }
    case "retry":
      return { ...m, text: m.text.slice(0, m.stepStart), chips: m.chips.filter((c) => !(c.step === m.step && c.status === "start")), stepClosed: false };
    case "draft":
      return m.drafts.some((d) => d.id === e.data.id) ? m : { ...m, drafts: [...m.drafts, { id: e.data.id, kind: e.data.kind, draft: e.data.draft }] };
    case "done":
      return { ...m, status: "done", tier: e.data.tier };
    case "error":
      return { ...m, status: "error", error: e.data };
  }
}

/** Share of today's budget left, as a whole percent for the meter («72% left today»); null without a budget. */
export function budgetLeftPct(b: { limit: number; leftShare: number } | null | undefined): number | null {
  if (!b || b.limit <= 0) return null;
  const pct = Math.floor(Math.max(0, Math.min(1, b.leftShare)) * 100);
  return b.leftShare > 0 && pct === 0 ? 1 : pct;
}

// ─── page context and starters ────────────────────────────────────────────

export type PageKey = "dashboard" | "trades" | "trade" | "dayReport" | "whatIf" | "analytics" | "playbook" | "plan" | "generic";
export type Starter = { key: "a" | "b" | "c"; intent?: "draft_playbook" | "draft_plan" | "draft_eod" | "draft_rule" | "analysis" };

export type PageContext = {
  route?: string;
  title?: string;
  tradeId?: number;
  date?: string;
  from?: string;
  to?: string;
  trader?: string;
  playbookId?: number;
  facets?: Record<string, string | number | boolean | string[]>;
};

export function pageKeyOf(route: string | undefined, ctx: PageContext | null | undefined): PageKey {
  const path = (route ?? "/").split("?")[0]!.replace(/\/+$/, "") || "/";
  if (ctx?.tradeId) return "trade";
  if (path === "/") return "dashboard";
  if (path.startsWith("/trades")) return "trades";
  if (path.startsWith("/day-report")) return "dayReport";
  if (path.startsWith("/what-if")) return "whatIf";
  if (path.startsWith("/analytics") || path.startsWith("/stats") || path.startsWith("/behavior")) return "analytics";
  if (path.startsWith("/playbook")) return "playbook";
  if (path.startsWith("/game-plan") || path.startsWith("/journal")) return "plan";
  return "generic";
}

export const STARTERS: Readonly<Record<PageKey, readonly Starter[]>> = {
  dashboard: [{ key: "a" }, { key: "b", intent: "analysis" }, { key: "c" }],
  trades: [{ key: "a" }, { key: "b", intent: "draft_playbook" }, { key: "c" }],
  trade: [{ key: "a" }, { key: "b" }, { key: "c" }],
  dayReport: [{ key: "a" }, { key: "b", intent: "draft_eod" }, { key: "c" }],
  whatIf: [{ key: "a", intent: "analysis" }, { key: "b" }, { key: "c" }],
  analytics: [{ key: "a", intent: "analysis" }, { key: "b" }, { key: "c" }],
  playbook: [{ key: "a", intent: "draft_playbook" }, { key: "b" }, { key: "c" }],
  plan: [{ key: "a", intent: "draft_plan" }, { key: "b" }, { key: "c" }],
  generic: [{ key: "a" }, { key: "b" }, { key: "c" }],
};

/**
 * The orb's one-line suggestion for a page with an «ask» context (a selected trade, a day report, the simulator…):
 * `key` names the i18n texts (chips.<key>.label / chips.<key>.prompt), `id` is what a dismissal remembers (the same
 * suggestion for the same trade / day stays dismissed). null = no suggestion on this page.
 */
export type Suggestion = { key: "trade" | "dayReport" | "whatIf" | "analytics" | "playbook"; id: string; intent: NonNullable<Starter["intent"]> };

export function suggestionFor(page: PageKey, ctx: PageContext | null | undefined): Suggestion | null {
  switch (page) {
    case "trade": return ctx?.tradeId ? { key: "trade", id: `trade:${ctx.tradeId}`, intent: "analysis" } : null;
    case "dayReport": return { key: "dayReport", id: `day:${ctx?.date ?? "today"}:${ctx?.trader ?? ""}`, intent: "analysis" };
    case "whatIf": return { key: "whatIf", id: "whatIf", intent: "analysis" };
    case "analytics": return { key: "analytics", id: "analytics", intent: "analysis" };
    case "playbook": return ctx?.playbookId ? { key: "playbook", id: `playbook:${ctx.playbookId}`, intent: "draft_playbook" } : null;
    default: return null;
  }
}

/** Screens whose header asks their own question (i18n assistant.headerAsk.<key>), by route prefix. */
const HEADER_ASK_ROUTES = [["/stats", "stats"], ["/behavior", "behavior"], ["/office", "office"], ["/benchmark", "benchmark"]] as const;
export type HeaderAskKey = (typeof HEADER_ASK_ROUTES)[number][1];

/**
 * The page header's assistant question (components/assistant/page-ask.tsx): a screen with its own header question,
 * else the page's suggestion (trade, day, what-if, analytics, playbook entry), else the page's first starter
 * (dashboard, trades, plan), else none («Спросить WS»).
 */
export type HeaderQuestion =
  | { kind: "header"; key: HeaderAskKey }
  | { kind: "chip"; key: Suggestion["key"]; intent: Suggestion["intent"] }
  | { kind: "starter"; key: "dashboard" | "trades" | "plan"; intent?: Starter["intent"] }
  | { kind: "none" };

export function headerQuestionOf(route: string | undefined, page: PageKey, suggestion: Suggestion | null): HeaderQuestion {
  const path = (route ?? "/").split("?")[0]!.replace(/\/+$/, "") || "/";
  const hit = page === "trade" ? undefined : HEADER_ASK_ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (hit) return { kind: "header", key: hit[1] };
  if (suggestion) return { kind: "chip", key: suggestion.key, intent: suggestion.intent };
  if (page === "dashboard" || page === "trades" || page === "plan") return { kind: "starter", key: page, intent: STARTERS[page][0]?.intent };
  return { kind: "none" };
}

/** Merge what the page published with the current location (the location wins for the route). */
export function contextFor(location: string, published: PageContext | null): PageContext {
  return { ...(published ?? {}), route: location.slice(0, 300) };
}
