/**
 * Draft card → the body of the app's normal write endpoint (pure). The assistant never writes; these payloads are sent
 * only when the person clicks the card's save button (components/assistant/draft-save.ts), through the same endpoints
 * and permissions as the site's own forms:
 *   playbook     POST /api/playbook (+ POST /api/playbook/:id/link-trade per example trade)
 *   plan         PUT  /api/game-plan/my/:date   (merged into the plan that already exists: empty fields filled, texts appended)
 *   eod          PUT  /api/eod/day/:date        (summary merged the same way) + PUT /api/eod/trades/:id/review per lesson
 *   rule         POST /api/rules
 *   curatorNote  POST /api/curator/notes
 */

type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Append `add` to `base` as a new paragraph (no duplicate when it is already there). */
export function appendText(base: unknown, add: unknown): string {
  const a = str(base);
  const b = str(add);
  if (!b) return a;
  if (!a) return b;
  return a.includes(b) ? a : `${a}\n\n${b}`;
}

export const PLAYBOOK_SECTIONS = ["context", "trigger", "entry", "stop", "targets", "management", "invalidation"] as const;
export type PlaybookSection = (typeof PLAYBOOK_SECTIONS)[number];

/** The setup's conditions as markdown sections (headings in the reader's language, from `label`). */
export function playbookConditions(d: Rec, label: (s: PlaybookSection) => string): string {
  return PLAYBOOK_SECTIONS.filter((s) => str(d[s])).map((s) => `## ${label(s)}\n${str(d[s])}`).join("\n\n");
}

export function playbookPayload(d: Rec, label: (s: PlaybookSection) => string): { body: Rec; tradeIds: number[] } {
  const tags = strs(d.tags);
  return {
    body: {
      name: str(d.name),
      space: "personal",
      ...(str(d.strategy) ? { setupType: str(d.strategy) } : {}),
      ...(str(d.horizon) ? { horizon: str(d.horizon) } : {}),
      conditions: playbookConditions(d, label),
      checklistItems: strs(d.checklist).map((text) => ({ text })),
      ...(str(d.notes) ? { notes: str(d.notes) } : {}),
      ...(tags.length ? { tags: tags.join(", ") } : {}),
    },
    tradeIds: nums(d.exampleTradeIds),
  };
}

const BIAS: Record<string, string> = { long: "bull", short: "bear", both: "neutral" };

/** The personal plan doc after merging the draft into what is stored (null = no plan yet). */
export function planDoc(existing: Rec | null, d: Rec): Rec {
  const base: Rec = { ...(existing ?? {}) };
  base.marketView = appendText(base.marketView, d.marketView);
  base.riskNotes = appendText(base.riskNotes, d.riskNotes);
  base.focus = str(base.focus) || str(d.focus);
  if (base.maxLossUsd == null && typeof d.maxLossUsd === "number") base.maxLossUsd = d.maxLossUsd;
  if (base.maxTrades == null && typeof d.maxTrades === "number") base.maxTrades = d.maxTrades;
  const have = Array.isArray(base.inPlay) ? (base.inPlay as Rec[]) : [];
  const known = new Set(have.map((x) => str(x.ticker).toUpperCase()));
  const add = (Array.isArray(d.inPlay) ? (d.inPlay as Rec[]) : [])
    .filter((x) => str(x.ticker) && !known.has(str(x.ticker).toUpperCase()))
    .map((x) => ({
      ticker: str(x.ticker).toUpperCase(),
      bias: BIAS[str(x.side)] ?? "neutral",
      trigger: str(x.trigger), invalidation: str(x.invalidation), scenarioA: str(x.scenarioA), scenarioB: str(x.scenarioB),
    }));
  base.inPlay = [...have, ...add].slice(0, 30);
  return base;
}

export function planPayload(existing: { doc?: Rec; status?: string } | null, d: Rec): Rec {
  return { ...planDoc(existing?.doc ?? null, d), status: existing?.status === "ready" ? "ready" : "draft" };
}

/** The day's summary after merging the draft (texts appended, mood only when not set). */
export function eodSummary(existing: Rec | null, d: Rec): Rec {
  const s: Rec = { ...(existing ?? {}) };
  s.repeat = appendText(s.repeat, d.repeat);
  s.stop = appendText(s.stop, d.stop);
  s.tomorrow = appendText(s.tomorrow, d.tomorrow);
  if (s.mood == null && typeof d.mood === "number") s.mood = d.mood;
  return s;
}

export function eodLessons(d: Rec): { tradeId: number; lesson: string }[] {
  return (Array.isArray(d.tradeLessons) ? (d.tradeLessons as Rec[]) : [])
    .map((x) => ({ tradeId: Number(x.tradeId), lesson: str(x.lesson) }))
    .filter((x) => Number.isInteger(x.tradeId) && x.tradeId > 0 && x.lesson);
}

export function rulePayload(d: Rec): Rec {
  return { name: str(d.name), kind: str(d.kind), ...(d.threshold && typeof d.threshold === "object" ? { threshold: d.threshold } : {}), ...(str(d.note) ? { note: str(d.note) } : {}) };
}

export function curatorNotePayload(d: Rec): Rec {
  return { trader: str(d.trader), body: str(d.body), kind: str(d.kind) || "note", ...(str(d.day) ? { day: str(d.day) } : {}) };
}
