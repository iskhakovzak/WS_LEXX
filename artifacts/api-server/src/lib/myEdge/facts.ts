/**
 * «Мой edge» — the trade facts and the pre-trade buckets of «Что у меня работает лучше всего». Pure (no DB).
 *
 * Every dimension except `hold` is observable BEFORE the entry:
 *   time         entry time bucket (NY), the «Разрезы» TIME_BUCKETS          seq      trade # in the day (day_seq)
 *   prev         after a win / loss / be, or the first trade (prev_kind)      price    entry price band
 *   dayPnl       realised day P&L before the entry, in zones of the trader's typical day (median |day net| D):
 *                first (nothing closed yet) | deepDown ≤ −D | down < −0.2·D | flat | up > 0.2·D | bigUp ≥ D
 *   strategy     trades.strategy                                              setup    trades.setup («none» without)
 *   familiarity  the trader's earlier trades on the ticker (whole book): new 0 | few 1–4 | known 5–19 | home 20+
 *   side         long | short                                                 sizeRel  size vs the usual one (size_rel)
 *   hold         holding time — an OUTCOME (known only after the exit), labelled as such in the UI
 * A missing value is «unknown» and is never ranked.
 */
import { UNKNOWN, holdKeyOf, priceKeyOf, seqKeyOf, sizeRelKeyOf } from "../tradeFacetBuckets";
import { timeBucketOf } from "../tradeFacetsSql";
import { meMedian } from "../stats/myEdgeStats";

export type MeTrade = {
  id: number;
  /** Close day (YYYY-MM-DD) — the day the result is realised; the day clusters of the bootstrap. */
  day: string;
  /** Entry day (YYYY-MM-DD). */
  entryDay: string;
  ticker: string;
  side: "long" | "short" | null;
  setup: string | null;
  strategy: string | null;
  entry: number | null;
  entrySec: number | null;
  holdSec: number | null;
  overnight: boolean | null;
  daySeq: number | null;
  prevKind: string | null;
  sizeRel: number | null;
  net: number;
  gross: number;
  fees: number;
  /** Earlier trades of the trader on this ticker (whole book, by entry order). */
  priorOnTicker: number;
  /** Passes the page filters and «Разрезы» (the rest only feed the day-P&L-before of the passing ones). */
  pass: boolean;
};

export const STRENGTH_DIMS = ["time", "seq", "prev", "dayPnl", "price", "strategy", "setup", "familiarity", "side", "sizeRel", "hold"] as const;
export type StrengthDim = (typeof STRENGTH_DIMS)[number];
/** Dimensions known only after the trade (shown, never offered as an entry rule). */
export const OUTCOME_DIMS: ReadonlySet<string> = new Set(["hold"]);

export const DAY_PNL_KEYS = ["first", "deepDown", "down", "flat", "up", "bigUp"] as const;
export const FAMILIARITY_KEYS = ["new", "few", "known", "home"] as const;
/** Share of the typical day (D) under which the running day P&L counts as «около нуля». */
export const DAY_FLAT_SHARE = 0.2;

export function familiarityKeyOf(prior: number): (typeof FAMILIARITY_KEYS)[number] {
  if (prior <= 0) return "new";
  if (prior < 5) return "few";
  if (prior < 20) return "known";
  return "home";
}

/** The day zone of a running realised P&L `before` (null = nothing closed yet that day) for a typical day `D`. */
export function dayPnlKeyOf(before: number | null, D: number): (typeof DAY_PNL_KEYS)[number] {
  if (before == null) return "first";
  if (before <= -D) return "deepDown";
  if (before < -DAY_FLAT_SHARE * D) return "down";
  if (before >= D) return "bigUp";
  if (before > DAY_FLAT_SHARE * D) return "up";
  return "flat";
}

/** Exit second of the day (entry + hold) for an intraday trade with both known; else null. */
const exitSecOf = (t: MeTrade): number | null =>
  t.entrySec != null && t.holdSec != null && t.holdSec >= 0 && t.overnight !== true ? t.entrySec + t.holdSec : null;

/**
 * Realised day P&L before each trade's entry (id → $ or null when nothing had closed): the same-entry-day trades
 * (ALL of them, also the ones the filters hide) whose exit is at or before this entry. Without times, the trades
 * with a smaller day_seq count as closed before.
 */
export function dayPnlBefore(trades: readonly MeTrade[]): Map<number, number | null> {
  const byDay = new Map<string, MeTrade[]>();
  for (const t of trades) {
    const list = byDay.get(t.entryDay);
    if (list) list.push(t); else byDay.set(t.entryDay, [t]);
  }
  const out = new Map<number, number | null>();
  for (const list of byDay.values()) {
    for (const t of list) {
      let sum = 0;
      let any = false;
      for (const o of list) {
        if (o.id === t.id) continue;
        const ox = exitSecOf(o);
        const before = t.entrySec != null && ox != null
          ? ox <= t.entrySec
          : t.daySeq != null && o.daySeq != null && o.daySeq < t.daySeq && o.overnight !== true;
        if (before) { sum += o.net; any = true; }
      }
      out.set(t.id, any ? Math.round(sum * 100) / 100 : null);
    }
  }
  return out;
}

/** The typical day D: median |net of a close day| over the given trades (at least $1). */
export function typicalDay(trades: readonly MeTrade[]): number {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.net);
  const m = meMedian([...byDay.values()].map((v) => Math.abs(v)));
  return Number.isFinite(m) && m >= 1 ? Math.round(m * 100) / 100 : 1;
}

/** Bucket key of a trade in one strength dimension (UNKNOWN = not ranked). */
export function strengthKeyOf(dim: StrengthDim, t: MeTrade, ctx: { before: number | null; D: number }): string {
  switch (dim) {
    case "time": return timeBucketOf(t.entrySec);
    case "seq": return seqKeyOf(t.daySeq);
    case "prev": return t.prevKind ?? UNKNOWN;
    case "dayPnl": return dayPnlKeyOf(ctx.before, ctx.D);
    case "price": return priceKeyOf(t.entry);
    case "strategy": return t.strategy?.trim() || UNKNOWN;
    case "setup": return t.setup?.trim() || "none";
    case "familiarity": return familiarityKeyOf(t.priorOnTicker);
    case "side": return t.side ?? UNKNOWN;
    case "sizeRel": return sizeRelKeyOf(t.sizeRel);
    case "hold": return holdKeyOf(t.holdSec, t.overnight);
  }
}

/** Keys of every strength dimension per passing trade (id → dim → key), plus the typical day used. */
export function strengthKeys(all: readonly MeTrade[]): { keys: Map<number, Record<StrengthDim, string>>; D: number } {
  const before = dayPnlBefore(all);
  const passing = all.filter((t) => t.pass);
  const D = typicalDay(passing.length ? passing : all);
  const keys = new Map<number, Record<StrengthDim, string>>();
  for (const t of passing) {
    const ctx = { before: before.get(t.id) ?? null, D };
    const rec = {} as Record<StrengthDim, string>;
    for (const dim of STRENGTH_DIMS) rec[dim] = strengthKeyOf(dim, t, ctx);
    keys.set(t.id, rec);
  }
  return { keys, D };
}
