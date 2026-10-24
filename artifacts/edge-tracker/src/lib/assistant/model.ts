/**
 * «Ассистент WS» — pure state of the panel: applying stream events to the answer being written, the starter prompts
 * per page, and the model label. No React here (components/assistant renders it).
 *
 * Steps: the server streams one model request after another (text → tool calls → results → more text). A `retry`
 * event means «drop what the current step wrote» (the step is re-run: unparseable input, or a draft handed to the
 * smarter model), so the answer keeps the text and the not-yet-run chips of finished steps only.
 */
import type { AssistantEvent, DraftKind } from "./sse";

export type ToolChip = { id: string; name: string; status: "start" | "done" | "error"; step: number };
export type DraftCard = { id: string; kind: DraftKind; draft: Record<string, unknown> };

export type ChatMessage = {
  key: string;
  role: "user" | "assistant";
  text: string;
  model: string | null;
  reason: string | null;
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
  return { key, role: "assistant", text: "", model: null, reason: null, chips: [], drafts: [], status: "streaming", error: null, stepStart: 0, step: 0, stepClosed: false };
}

function openStep(m: ChatMessage): ChatMessage {
  return m.stepClosed ? { ...m, step: m.step + 1, stepStart: m.text.length, stepClosed: false } : m;
}

export function applyEvent(m: ChatMessage, e: AssistantEvent): ChatMessage {
  switch (e.event) {
    case "meta":
      return { ...m, model: e.data.model, reason: e.data.reason };
    case "model":
      return { ...m, model: e.data.model, reason: e.data.reason };
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
      return { ...m, status: "done", model: e.data.model };
    case "error":
      return { ...m, status: "error", error: e.data };
  }
}

/** Short model label: «Haiku 5.5», «Sonnet 5.5», «Opus 5.5» (unknown ids as they are). */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return "";
  const m = /^claude-(haiku|sonnet|opus|fable)-(\d+)-(\d+)$/.exec(id);
  if (!m) return id;
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}`;
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

/** Merge what the page published with the current location (the location wins for the route). */
export function contextFor(location: string, published: PageContext | null): PageContext {
  return { ...(published ?? {}), route: location.slice(0, 300) };
}
