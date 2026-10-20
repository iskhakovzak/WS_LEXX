/**
 * One enriched row per analyst action: quote, desk/trader context, firm weight, historical reaction and the
 * importance score. Built once per render in the page and shared by «Сегодня до открытия» and the table.
 */
import type { FirmWeightRow, ReactionAgg, ReactionKind, TickerReaction } from "./api";
import {
  gapOf, isTopFirm, ptChangePct, scoreAction,
  type FeedAction, type FirmWeightLite, type OpenPosition, type Quote, type ScoreReason, type SortKey,
} from "./lib";
import type { SortDir } from "@/components/ds";
import { analystI18n } from "@/i18n/ns/analyst";

export type Row = {
  a: FeedAction;
  quote: Quote | null;
  held: OpenPosition[];
  watched: boolean;
  /** My closed trades on this ticker (0 = never traded / unknown). */
  traded: number;
  top: boolean;
  weight: FirmWeightLite | null;
  /** Historical reaction of this ticker to the same kind of action. */
  reaction: ReactionAgg | null;
  reactionKind: ReactionKind | null;
  score: number;
  reasons: ScoreReason[];
};

/** Minimum events before a historical average is shown. */
export const REACTION_MIN_N = 2;

export function reactionKindOf(a: FeedAction): ReactionKind | null {
  if (a.action === "upgrade") return "up";
  if (a.action === "downgrade") return "down";
  if (a.action === "initiated") return "init";
  const p = ptChangePct(a);
  if (p == null || Math.abs(p) < 5) return null;
  return p > 0 ? "ptUp" : "ptDown";
}

/** Reaction kind → lower-case label in the UI language (getters: read at access time). */
export const REACTION_KIND_LABEL = {} as Record<ReactionKind, string>;
for (const k of ["up", "down", "init", "ptUp", "ptDown"] as const) {
  Object.defineProperty(REACTION_KIND_LABEL, k, { get: () => analystI18n.t(`reactionKind.${k}`), enumerable: true });
}

export function weightMap(firms: FirmWeightRow[] | null | undefined): Map<string, FirmWeightLite> {
  const m = new Map<string, FirmWeightLite>();
  for (const f of firms ?? []) {
    m.set(f.firm, { n: f.rating.n, ratio: f.rating.avgRatio, hit: f.rating.hitRate, avgSignedDay: f.rating.avgSignedDay });
  }
  return m;
}

export type EnrichCtx = {
  quotes: Record<string, Quote> | undefined;
  held: Map<string, OpenPosition[]>;
  isWatched: (t: string) => boolean;
  traded: Map<string, number>;
  weights: Map<string, FirmWeightLite>;
  reactions: Record<string, TickerReaction> | undefined;
};

export function enrich(a: FeedAction, ctx: EnrichCtx): Row {
  const t = a.ticker.toUpperCase();
  const quote = ctx.quotes?.[t] ?? null;
  const held = ctx.held.get(t) ?? [];
  const watched = ctx.isWatched(t);
  const traded = ctx.traded.get(t) ?? 0;
  const weight = ctx.weights.get(a.firm) ?? null;
  const top = isTopFirm(a.firm, weight);
  const kind = reactionKindOf(a);
  const reaction = kind ? ctx.reactions?.[t]?.[kind] ?? null : null;
  const { score, reasons } = scoreAction(a, { held: held.length > 0, watched, traded, top, weight, gapPct: gapOf(quote) });
  return { a, quote, held, watched, traded, top, weight, reaction, reactionKind: kind, score, reasons };
}

/* ── Table sort (moved from pages/analyst-actions.tsx) ─────────────────── */

export type SortState = { key: SortKey; dir: SortDir };

/** Sort accessors: empty values always sink. */
const SORT_GET: Record<SortKey, (r: Row) => number | string | null> = {
  score: (r) => r.score,
  time: (r) => r.a.gradedAt ?? null,
  pt: (r) => { const p = ptChangePct(r.a); return p == null ? null : Math.abs(p); },
  gap: (r) => { const g = gapOf(r.quote); return g == null ? null : Math.abs(g); },
  weight: (r) => (r.weight && r.weight.n >= 5 ? r.weight.ratio : null),
  ticker: (r) => r.a.ticker,
};

export function sortRows(rows: Row[], s: SortState): Row[] {
  const get = SORT_GET[s.key];
  const out = [...rows];
  out.sort((x, y) => {
    const a = get(x);
    const b = get(y);
    if (a == null && b == null) return (y.a.gradedAt ?? "").localeCompare(x.a.gradedAt ?? "");
    if (a == null) return 1;
    if (b == null) return -1;
    const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    return (s.dir === "asc" ? c : -c) || (y.a.gradedAt ?? "").localeCompare(x.a.gradedAt ?? "");
  });
  return out;
}
