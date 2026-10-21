/**
 * Derived per-trade values of the filter panel's «when / how / what» columns (migration 0241), computed next to the
 * strategy (lib/tradeStrategyStore) so the PropReports sync and the 5-minute back-fill keep them fresh. Pure.
 *
 *   hold_sec    seconds held: trades.structure firstAt → lastAt (lib/tradeStructureStore), else the first entry → last
 *               exit fill, else the broker's openedAt → closedAt (context_snapshot), else the stored hold_time
 *               («19s», «27m», «4h 59m», «3min»)
 *   overnight   closed on a later New York date than opened
 *   entry_kind  reentry (trades.reentry_of set) > scaled (adds / a likely scaled entry) > single
 *   exit_kind   stopped (stop hit) > partials (partial exits / a likely scaled exit) > whole
 *   notional    max position × average entry (structure), else |qty × entry|, $
 *   day_seq     order of the trade among the same trader's live trades of the same NY day (entry_sec, then id)
 *   prev_kind   first | after-win | after-loss | after-be — the net result of the previous trade of that trader-day
 * An open trade has no hold / exit yet (NULL); every value is NULL when its data is missing (the facet's «unknown»).
 */
import { normResult } from "./tradeMath";
import { nyParts } from "./tradeStrategy";
import { resultKeyOf, type EntryKind, type ExitKind, type PrevKind } from "./tradeFacetBuckets";

/** The subset of trades.structure (StructureStats) read here. */
export interface StructureLite {
  adds?: unknown; partials?: unknown; stopHit?: unknown; scaledEntryLikely?: unknown; scaledExitLikely?: unknown;
  maxPosition?: unknown; avgEntry?: unknown; firstAt?: unknown; lastAt?: unknown;
}

export interface FacetDeriveInput {
  id: number;
  trader: string | null;
  date: string | null;
  exitDate: string | null;
  deleted: boolean;
  result: string | null;
  pnl: unknown;
  fees: unknown;
  qty: unknown;
  entry: unknown;
  holdTime: string | null;
  openedAt: string | null;
  closedAt: string | null;
  /** First entry / last exit fill (trade_executions; the strategy input), when the structure has no times. */
  entryAt?: string | Date | null;
  exitAt?: string | Date | null;
  structure: StructureLite | null;
  reentryOf: number | null;
  /** NY seconds of the first entry (derived in the same pass). */
  entrySec: number | null;
}

export interface FacetDerived {
  holdSec: number | null;
  overnight: boolean | null;
  entryKind: EntryKind | null;
  exitKind: ExitKind | null;
  notional: number | null;
  daySeq: number | null;
  prevKind: PrevKind | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const when = (v: unknown): string | Date | null => (v instanceof Date || (typeof v === "string" && v.trim()) ? v : null);

const HOLD_UNIT: Record<string, number> = { d: 86_400, h: 3600, hr: 3600, min: 60, m: 60, s: 1, sec: 1 };
const HOLD_PART_RE = /(\d+(?:\.\d+)?)\s*(d|hr|h|min|m|sec|s)(?![a-z])/gi;

/** Seconds of a stored hold_time («19s», «27m», «4h 59m», «3min», «1d 2h»); null when unreadable. */
export function parseHoldTime(s: string | null | undefined): number | null {
  if (!s) return null;
  let total = 0, hit = false;
  for (const m of s.matchAll(HOLD_PART_RE)) {
    total += Number(m[1]) * (HOLD_UNIT[m[2]!.toLowerCase()] ?? 0);
    hit = true;
  }
  return hit ? Math.round(total) : null;
}

const dayNo = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/** Hold seconds + overnight (pure). */
export function holdOf(t: Pick<FacetDeriveInput, "result" | "structure" | "openedAt" | "closedAt" | "entryAt" | "exitAt" | "holdTime" | "date" | "exitDate">): { holdSec: number | null; overnight: boolean | null } {
  if (normResult(t.result) === "open") return { holdSec: null, overnight: null };
  const pairs: [unknown, unknown][] = [[t.structure?.firstAt, t.structure?.lastAt], [t.entryAt, t.exitAt], [t.openedAt, t.closedAt]];
  for (const [a, z] of pairs) {
    const p0 = nyParts(when(a)), p1 = nyParts(when(z));
    if (!p0 || !p1) continue;
    const sec = (dayNo(p1.date) - dayNo(p0.date)) * 86_400 + (p1.sec - p0.sec);
    return { holdSec: sec >= 0 ? sec : null, overnight: p1.date > p0.date };
  }
  const holdSec = parseHoldTime(t.holdTime);
  const d0 = (t.date ?? "").slice(0, 10), d1 = (t.exitDate ?? "").slice(0, 10);
  if (d0 && d1) return { holdSec, overnight: d1 > d0 };
  return { holdSec, overnight: holdSec != null ? false : null };
}

export function entryKindOf(s: StructureLite | null, reentryOf: number | null): EntryKind | null {
  if (reentryOf != null) return "reentry";
  if (!s) return null;
  return (num(s.adds) ?? 0) > 0 || s.scaledEntryLikely === true ? "scaled" : "single";
}

export function exitKindOf(s: StructureLite | null, result: string | null): ExitKind | null {
  if (!s || normResult(result) === "open") return null;
  if (s.stopHit === true) return "stopped";
  return (num(s.partials) ?? 0) > 0 || s.scaledExitLikely === true ? "partials" : "whole";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function notionalOf(s: StructureLite | null, qty: unknown, entry: unknown): number | null {
  const mp = num(s?.maxPosition), ae = num(s?.avgEntry);
  if (mp != null && ae != null && mp !== 0 && ae > 0) return round2(Math.abs(mp * ae));
  const q = num(qty), e = num(entry);
  const v = q != null && e != null ? Math.abs(q * e) : 0;
  return v > 0 ? round2(v) : null;
}

/** Group key of a trader-day (same as the store's SQL: COALESCE(trader, '') + LEFT(date, 10)). */
const traderDayOf = (t: Pick<FacetDeriveInput, "trader" | "date">) => `${t.trader ?? ""}\u0000${(t.date ?? "").slice(0, 10)}`;

/**
 * day_seq / prev_kind of every trade in `rows` — pass WHOLE trader-days (every trade, deleted ones too): the live
 * trades of a day are ordered by entry second (unknown last), then id; deleted trades get NULL.
 */
export function daySequence(rows: readonly FacetDeriveInput[]): Map<number, { daySeq: number | null; prevKind: PrevKind | null }> {
  const out = new Map<number, { daySeq: number | null; prevKind: PrevKind | null }>();
  const days = new Map<string, FacetDeriveInput[]>();
  for (const r of rows) {
    if (r.deleted || !(r.date ?? "").slice(0, 10)) { out.set(r.id, { daySeq: null, prevKind: null }); continue; }
    const k = traderDayOf(r);
    const l = days.get(k);
    if (l) l.push(r); else days.set(k, [r]);
  }
  for (const list of days.values()) {
    list.sort((a, b) => (a.entrySec ?? Number.POSITIVE_INFINITY) - (b.entrySec ?? Number.POSITIVE_INFINITY) || a.id - b.id);
    list.forEach((r, i) => {
      if (i === 0) { out.set(r.id, { daySeq: 1, prevKind: "first" }); return; }
      const prev = list[i - 1]!;
      const k = resultKeyOf(prev.pnl, prev.fees);
      out.set(r.id, { daySeq: i + 1, prevKind: k === "unknown" ? null : (`after-${k}` as PrevKind) });
    });
  }
  return out;
}

/** Every derived value of a set of trades (whole trader-days, see daySequence). */
export function deriveFacetValues(rows: readonly FacetDeriveInput[]): Map<number, FacetDerived> {
  const seq = daySequence(rows);
  const out = new Map<number, FacetDerived>();
  for (const r of rows) {
    const { holdSec, overnight } = holdOf(r);
    const s = seq.get(r.id) ?? { daySeq: null, prevKind: null };
    out.set(r.id, {
      holdSec, overnight,
      entryKind: entryKindOf(r.structure, r.reentryOf),
      exitKind: exitKindOf(r.structure, r.result),
      notional: notionalOf(r.structure, r.qty, r.entry),
      daySeq: s.daySeq, prevKind: s.prevKind,
    });
  }
  return out;
}
