/**
 * Draft tools — they NEVER write. A draft tool takes the model's validated input, shapes it into the card the panel
 * shows (kind + fields the web form expects) and returns it; the card's button saves through the app's normal write
 * endpoint with the person's own permissions (POST /playbook, PUT /game-plan/my/:date, PUT /eod/day/:date,
 * POST /rules, POST /curator/notes — edge-tracker components/assistant/draft-save.ts). This module imports no
 * database and no HTTP client on purpose; a test asserts that executing a draft touches neither.
 */
import { randomUUID } from "node:crypto";

export type DraftKind = "playbook" | "plan" | "eod" | "rule" | "curatorNote";

export type Draft = { id: string; kind: DraftKind; draft: Record<string, unknown> };

const TOOL_KIND: Record<string, DraftKind> = {
  draft_playbook_entry: "playbook",
  draft_plan_of_day: "plan",
  draft_eod_review: "eod",
  draft_rule: "rule",
  draft_curator_note: "curatorNote",
};

export function draftKindOf(tool: string): DraftKind | null {
  return TOOL_KIND[tool] ?? null;
}

const clean = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(typeof v === "string" && !v.trim()) && !(Array.isArray(v) && !v.length)));

/** The card for a validated draft-tool input (input already passed the tool's zod schema). */
export function buildDraft(tool: string, input: Record<string, unknown>): Draft | null {
  const kind = draftKindOf(tool);
  if (!kind) return null;
  const id = `d_${randomUUID().slice(0, 12)}`;
  if (kind === "playbook") {
    const tags = Array.isArray(input.tags) ? [...new Set(input.tags as string[])] : undefined;
    return { id, kind, draft: clean({ ...input, tags, exampleTradeIds: Array.isArray(input.exampleTradeIds) ? [...new Set(input.exampleTradeIds as number[])] : undefined }) };
  }
  if (kind === "plan") {
    const inPlay = Array.isArray(input.inPlay) ? (input.inPlay as Record<string, unknown>[]).map((x) => clean({ ...x, ticker: String(x.ticker ?? "").toUpperCase() })) : undefined;
    return { id, kind, draft: clean({ ...input, inPlay }) };
  }
  return { id, kind, draft: clean(input) };
}

/** What the model is told after a draft card was shown. */
export function draftToolResult(d: Draft): string {
  return JSON.stringify({
    shown: true,
    draftId: d.id,
    kind: d.kind,
    saved: false,
    note: "The draft is shown to the user as an editable card. It is NOT saved; the user reviews and saves it with one click. Reply briefly: what it is based on and what to check before saving.",
  });
}
