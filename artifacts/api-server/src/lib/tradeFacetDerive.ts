/**
 * Derived per-trade values of the filter panel's «when / how / what» columns (migrations 0241, 0242), computed next to
 * the strategy (lib/tradeStrategyStore) so the PropReports sync and the 5-minute back-fill keep them fresh. Pure.
 *
 *   hold_sec    seconds held: trades.structure firstAt → lastAt (lib/tradeStructureStore), else the first entry → last
 *               exit fill, else the broker's openedAt → closedAt (context_snapshot), else the stored hold_time
 *               («19s», «27m», «4h 59m», «3min»)
 *   overnight   closed on a later New York date than opened
 *   entry_kind  reentry (trades.reentry_of set) > aggressive (see aggressiveEntry) > scaled (adds / a likely scaled
 *               entry) > single
 *   adds_kind   none | pyramid (every add above the average so far for a long, below for a short) | average (every add
 *               against it: averaging into a loser) | mixed — from the legs (trade_executions role / leg_index); NULL
 *               when adds are known to exist but not their prices (a PropReports «Trades» report average)
 *   exit_kind   flip (reversed: flipOut, a flip leg, or a closing leg larger than the open position) > stopped (stop
 *               hit) > partials (partial exits / a likely scaled exit) > whole
 *   has_stop    a stop price is known: trades.stop, or the structure's stopPrice (explicit, or derived from risk $)
 *   notional    max position × average entry (structure), else |qty × entry|, $
 *   size_rel    notional ÷ the median notional of the same trader's trades opened before it within SIZE_REL_DAYS
 *               calendar days (≥ SIZE_REL_MIN_TRADES of them, else NULL) — see sizeRelations
 *   day_seq     order of the trade among the same trader's live trades of the same NY day (entry_sec, then id)
 *   prev_kind   first | after-win | after-loss | after-be — the net result of the previous trade of that trader-day
 * An open trade has no hold / exit yet (NULL); every value is NULL when its data is missing (the facet's «unknown»).
 * Legs come from PropReports fills; a «Trades» report trade has one entry and one exit leg (averages), a manual trade
 * without fills has none — its entry / adds / exit kinds then rest on the structure alone (or are NULL without one).
 */
import { normResult } from "./tradeMath";
import { nyParts } from "./tradeStrategy";
import {
  AGGRESSIVE_ADDS_MIN, AGGRESSIVE_GAP_MIN_ADDS, AGGRESSIVE_GAP_SEC, AGGRESSIVE_SIZE_MULT, AGGRESSIVE_WINDOW_SEC,
  SIZE_REL_DAYS, SIZE_REL_MIN_TRADES, resultKeyOf, type AddsKind, type EntryKind, type ExitKind, type PrevKind,
} from "./tradeFacetBuckets";

/** The subset of trades.structure (StructureStats) read here. */
export interface StructureLite {
  adds?: unknown; partials?: unknown; stopHit?: unknown; scaledEntryLikely?: unknown; scaledExitLikely?: unknown;
  maxPosition?: unknown; avgEntry?: unknown; firstAt?: unknown; lastAt?: unknown;
  side?: unknown; stopPrice?: unknown; flipOut?: unknown; carriedIn?: unknown;
}

/** One leg (an order: its fills folded together) of a trade, in leg order (lib/tradeStructure roles). */
export interface FacetLeg {
  role: string | null;
  /** Raised the position (an entry / add / re-entry / flip-in fill). */
  opening: boolean;
  /** VWAP of the leg's fills. */
  price: number | null;
  /** Shares; null when a fill has no qty. */
  qty: number | null;
  /** Epoch seconds of the leg's first fill; null when untimed. */
  at: number | null;
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
  /** The trade's legs (trade_executions), [] / absent without fills. */
  legs?: readonly FacetLeg[] | null;
  /** trades.stop. */
  stop?: unknown;
}

export interface FacetDerived {
  holdSec: number | null;
  overnight: boolean | null;
  entryKind: EntryKind | null;
  addsKind: AddsKind | null;
  exitKind: ExitKind | null;
  hasStop: boolean;
  notional: number | null;
  sizeRel: number | null;
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

const EPS = 1e-6;
const median = (xs: readonly number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

/**
 * «Aggressive» adds (thresholds in lib/tradeFacetBuckets): AGGRESSIVE_ADDS_MIN+ adds within AGGRESSIVE_WINDOW_SEC of the
 * first fill (inclusive), OR a max position ≥ AGGRESSIVE_SIZE_MULT × the first leg's shares (with at least one add), OR
 * AGGRESSIVE_GAP_MIN_ADDS+ adds with a median gap between consecutive opening legs under AGGRESSIVE_GAP_SEC.
 * Legs, not raw fills: an order filled in pieces is one leg (lib/tradeStructure groupLegs), so its pieces never count
 * as adds 0 s apart.
 */
export function aggressiveEntry(legs: readonly FacetLeg[] | null | undefined, s: StructureLite | null): boolean {
  const opening = (legs ?? []).filter((l) => l.opening);
  const adds = opening.filter((l) => l.role === "add");
  const first = opening[0];
  if (!first || !adds.length) return false;
  if (first.at != null) {
    const t0 = first.at;
    const soon = adds.filter((l) => l.at != null && l.at - t0 <= AGGRESSIVE_WINDOW_SEC).length;
    if (soon >= AGGRESSIVE_ADDS_MIN) return true;
  }
  const maxPos = num(s?.maxPosition);
  if (first.qty != null && first.qty > 0 && maxPos != null && Math.abs(maxPos) >= AGGRESSIVE_SIZE_MULT * first.qty - EPS) return true;
  if (adds.length >= AGGRESSIVE_GAP_MIN_ADDS && opening.every((l) => l.at != null)) {
    const at = opening.map((l) => l.at as number).sort((a, b) => a - b);
    const gaps = at.slice(1).map((x, i) => x - at[i]!);
    if (median(gaps) < AGGRESSIVE_GAP_SEC) return true;
  }
  return false;
}

export function entryKindOf(s: StructureLite | null, reentryOf: number | null, legs?: readonly FacetLeg[] | null): EntryKind | null {
  if (reentryOf != null) return "reentry";
  if (!s) return null;
  if (aggressiveEntry(legs, s)) return "aggressive";
  return (num(s.adds) ?? 0) > 0 || s.scaledEntryLikely === true ? "scaled" : "single";
}

/**
 * none | pyramid | average | mixed. Each add is compared with the average cost of the position at that moment (the
 * opening legs since the last entry / re-entry / flip-in, qty-weighted, unit-weighted without qty; partial exits do
 * not change it): better in the trade's direction (long: higher, short: lower) → pyramid, worse → average. An add at
 * exactly the average counts for neither; adds both ways (or only at the average) → mixed.
 * NULL without a structure, and when adds exist but their prices do not (adds > 0 / scaledEntryLikely, no add legs —
 * a PropReports «Trades» report average).
 */
export function addsKindOf(s: StructureLite | null, legs: readonly FacetLeg[] | null | undefined): AddsKind | null {
  if (!s) return null;
  const list = legs ?? [];
  if (!list.some((l) => l.role === "add")) return (num(s.adds) ?? 0) > 0 || s.scaledEntryLikely === true ? null : "none";
  const dir = String(s.side ?? "").toLowerCase() === "short" ? -1 : 1;
  let pq = 0, q = 0, up = false, down = false;
  for (const l of list) {
    if (!l.opening || l.price == null) continue;
    const w = l.qty != null && l.qty > 0 ? l.qty : 1;
    if (l.role !== "add") { pq = 0; q = 0; }
    else if (q > 0) {
      const d = dir * (l.price - pq / q);
      if (d > EPS) up = true;
      else if (d < -EPS) down = true;
    }
    pq += l.price * w;
    q += w;
  }
  return up && !down ? "pyramid" : down && !up ? "average" : "mixed";
}

/** A closing leg larger than the open position (every qty known, nothing carried in): the rest reversed it. */
function reversedInTrade(legs: readonly FacetLeg[] | null | undefined, s: StructureLite): boolean {
  const list = legs ?? [];
  if (s.carriedIn === true || !list.length || list.some((l) => l.qty == null)) return false;
  let pos = 0;
  for (const l of list) {
    const qv = l.qty as number;
    if (l.opening) { pos += qv; continue; }
    if (pos > EPS && qv > pos + EPS) return true;
    pos = Math.max(0, pos - qv);
  }
  return false;
}

export function exitKindOf(s: StructureLite | null, result: string | null, legs?: readonly FacetLeg[] | null): ExitKind | null {
  if (!s || normResult(result) === "open") return null;
  if (s.flipOut === true || (legs ?? []).some((l) => !l.opening && l.role === "flip") || reversedInTrade(legs, s)) return "flip";
  if (s.stopHit === true) return "stopped";
  return (num(s.partials) ?? 0) > 0 || s.scaledExitLikely === true ? "partials" : "whole";
}

/** A stop price is known for the trade: trades.stop, or the structure's stopPrice (explicit or derived from risk $). */
export function hasStopOf(s: StructureLite | null, stop: unknown): boolean {
  return (num(stop) ?? 0) > 0 || (num(s?.stopPrice) ?? 0) > 0;
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

/** One trade's place in its trader's size history (sizeRelations). */
export interface SizeRow {
  id: number;
  trader: string | null;
  date: string | null;
  entrySec: number | null;
  deleted: boolean;
  notional: number | null;
}

/** "YYYY-MM-DD" of a trade date when it is a real calendar day, else null. */
export function isoDayOf(date: string | null | undefined): string | null {
  const d = (date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d ? null : d;
}

/** `day` ± `n` calendar days ("YYYY-MM-DD"). */
export function shiftIsoDay(day: string, n: number): string {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n)).toISOString().slice(0, 10);
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
/** Cap of the stored ratio (numeric(12,4)); anything ≥ 3 is «×3 and more» anyway. */
const SIZE_REL_CAP = 1_000_000;

/**
 * size_rel of each `targets` trade: its notional ÷ the median notional of the same trader's live trades with a notional
 * that opened BEFORE it (NY date, then entry second — unknown last — then id, as daySequence) on one of the previous
 * SIZE_REL_DAYS calendar days or earlier the same day (date ≥ its date − SIZE_REL_DAYS). Fewer than
 * SIZE_REL_MIN_TRADES such trades, no notional, no valid date or deleted → null. `rows` = the targets plus their
 * history (the store loads the SIZE_REL_DAYS before every target day).
 */
export function sizeRelations(rows: readonly SizeRow[], targets: ReadonlySet<number>): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const byTrader = new Map<string, { r: SizeRow; day: number }[]>();
  for (const r of rows) {
    if (targets.has(r.id)) out.set(r.id, null);
    const iso = isoDayOf(r.date);
    if (r.deleted || iso == null || r.notional == null || !(r.notional > 0)) continue;
    const k = r.trader ?? "";
    const l = byTrader.get(k);
    const item = { r, day: dayNo(iso) };
    if (l) l.push(item); else byTrader.set(k, [item]);
  }
  for (const list of byTrader.values()) {
    list.sort((a, b) => a.day - b.day || (a.r.entrySec ?? Number.POSITIVE_INFINITY) - (b.r.entrySec ?? Number.POSITIVE_INFINITY) || a.r.id - b.r.id);
    let from = 0;
    list.forEach(({ r, day }, i) => {
      while (list[from]!.day < day - SIZE_REL_DAYS) from++;
      if (!targets.has(r.id) || i - from < SIZE_REL_MIN_TRADES) return;
      const usual = median(list.slice(from, i).map((x) => x.r.notional as number));
      out.set(r.id, usual > 0 ? Math.min(SIZE_REL_CAP, round4((r.notional as number) / usual)) : null);
    });
  }
  return out;
}

/**
 * Every derived value of a set of trades (whole trader-days, see daySequence). `history` = the trades of the previous
 * SIZE_REL_DAYS of the same traders that are not in `rows` (read only, for size_rel).
 */
export function deriveFacetValues(rows: readonly FacetDeriveInput[], history: readonly SizeRow[] = []): Map<number, FacetDerived> {
  const seq = daySequence(rows);
  const notional = new Map(rows.map((r) => [r.id, notionalOf(r.structure, r.qty, r.entry)]));
  const own = new Set(rows.map((r) => r.id));
  const sizes = sizeRelations([
    ...rows.map((r) => ({ id: r.id, trader: r.trader, date: r.date, entrySec: r.entrySec, deleted: r.deleted, notional: notional.get(r.id) ?? null })),
    ...history.filter((h) => !own.has(h.id)),
  ], own);
  const out = new Map<number, FacetDerived>();
  for (const r of rows) {
    const { holdSec, overnight } = holdOf(r);
    const s = seq.get(r.id) ?? { daySeq: null, prevKind: null };
    out.set(r.id, {
      holdSec, overnight,
      entryKind: entryKindOf(r.structure, r.reentryOf, r.legs),
      addsKind: addsKindOf(r.structure, r.legs),
      exitKind: exitKindOf(r.structure, r.result, r.legs),
      hasStop: hasStopOf(r.structure, r.stop),
      notional: notional.get(r.id) ?? null,
      sizeRel: sizes.get(r.id) ?? null,
      daySeq: s.daySeq, prevKind: s.prevKind,
    });
  }
  return out;
}

// ─── Legs from fills ────────────────────────────────────────────────────────────────────────────────────────

/** A trade_executions row as the store reads it. */
export interface FacetFill {
  id?: number;
  kind: string;
  role?: string | null;
  leg_index?: number | null;
  price?: string | number | null;
  qty?: string | number | null;
  executed_at: Date | string | null;
  sort_order?: number | null;
}

const OPENING_FILL_KINDS = new Set(["entry", "add"]);
const epochSec = (v: Date | string | null): number | null => {
  if (v == null) return null;
  const t = (v instanceof Date ? v : new Date(v)).getTime();
  return Number.isFinite(t) ? t / 1000 : null;
};

/**
 * The legs of a trade from its fills: fills sharing a leg_index (written by lib/tradeStructureStore with the role) are
 * one leg — VWAP price, summed qty, the first fill's time. Fills without a leg index (the structure is not computed
 * yet) are a leg each, in time / logged order; their role is then read from the kind (entry: the first opening fill,
 * later ones adds; trim: partial exit; exit / stop as such).
 */
export function legsOf(fills: readonly FacetFill[]): FacetLeg[] {
  const fillAt = (f: FacetFill) => epochSec(f.executed_at);
  const sorted = [...fills].sort((a, b) =>
    (a.leg_index ?? Number.POSITIVE_INFINITY) - (b.leg_index ?? Number.POSITIVE_INFINITY)
    || (fillAt(a) ?? Number.POSITIVE_INFINITY) - (fillAt(b) ?? Number.POSITIVE_INFINITY)
    || (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  const groups: FacetFill[][] = [];
  for (const f of sorted) {
    const last = groups[groups.length - 1];
    if (last && f.leg_index != null && last[0]!.leg_index === f.leg_index) last.push(f);
    else groups.push([f]);
  }
  let openingSeen = 0;
  return groups.map((g) => {
    const opening = OPENING_FILL_KINDS.has(g[0]!.kind);
    const prices = g.map((f) => num(f.price));
    const qtys = g.map((f) => num(f.qty));
    const known = qtys.every((x) => x != null && x > 0);
    const w = (i: number) => (known ? (qtys[i] as number) : 1);
    let pw = 0, ww = 0;
    g.forEach((_, i) => { const p = prices[i]; if (p != null && p > 0) { pw += p * w(i); ww += w(i); } });
    const times = g.map(fillAt).filter((x): x is number => x != null);
    let role = g[0]!.role ?? null;
    if (role == null) {
      const k = g[0]!.kind;
      role = opening ? (openingSeen === 0 && k !== "add" ? "entry" : "add") : k === "trim" ? "partial_exit" : k;
    }
    if (opening) openingSeen++;
    return {
      role, opening,
      price: ww > 0 ? pw / ww : null,
      qty: known ? qtys.reduce((s0: number, x) => s0 + (x as number), 0) : null,
      at: times.length ? Math.min(...times) : null,
    };
  });
}
