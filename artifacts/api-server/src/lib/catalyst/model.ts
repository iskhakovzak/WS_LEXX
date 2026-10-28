/**
 * Catalyst direction × strength (the morning plan / watchlist taps, table catalyst_marks, migration 0276) — pure.
 *
 *   linkMarks(trades, marks)        each PropReports trade → its mark by (trader, NY entry day, ticker); no trade input
 *   catalystEdge(trades, marks)     P&L / win rate / expectancy / count by strength × direction («no catalyst marked»
 *                                   is its own bucket) and per setup × strength, plus ONE insight line. Every number is
 *                                   lib/playbookEdge computeUsdStats (the shared $ math), never a formula of its own.
 *   hintFrom(...)                   the direction suggested by the day's event / earnings / gap (the trader confirms)
 *   dayTwoHints(...)                «day two after a strong catalyst»: yesterday's strong catalysts that moved big
 *   formulaBreaks(...)              trades entered on a setup whose formula needs a catalyst the plan mark does not show
 */
import { computeUsdStats, type UsdStats } from "../playbookEdge";
import type { TradeRowLike } from "../tradeMath";
import { hasCatalystRequirement, type StrategyFormula } from "../strategyFormula";

import type { Direction, Kind, MarkSource, Strength } from "./codes";

export { DIRECTIONS, KINDS, MARK_SOURCES, STRENGTHS, type Direction, type Kind, type MarkSource, type Strength } from "./codes";

export type CatalystMark = {
  trader: string;
  day: string;
  ticker: string;
  direction: Direction | null;
  strength: Strength | null;
  kind: Kind | null;
  source: MarkSource;
  suggested: boolean;
};

const TICKER_RE = /^[A-Z0-9][-A-Z0-9.]{0,11}$/;
export function normTicker(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  return TICKER_RE.test(s) ? s : null;
}

export const markKey = (trader: string, day: string, ticker: string): string => `${trader}\u0000${day}\u0000${ticker.toUpperCase()}`;
export const isMarked = (m: Pick<CatalystMark, "direction" | "strength"> | null | undefined): boolean => !!m && (m.direction != null || m.strength != null);

export type StrengthKey = Strength | "unset";
export type DirectionKey = Direction | "unset";
export type BucketKey = `${StrengthKey}_${DirectionKey}` | "none";
/** Display order: the four full marks, the half-marked ones, then «no catalyst marked». */
export const BUCKET_ORDER: readonly BucketKey[] = [
  "strong_bull", "strong_bear", "weak_bull", "weak_bear", "strong_unset", "weak_unset", "unset_bull", "unset_bear", "none",
];

export function bucketOf(m: Pick<CatalystMark, "direction" | "strength"> | null | undefined): BucketKey {
  if (!m || !isMarked(m)) return "none";
  return `${m.strength ?? "unset"}_${m.direction ?? "unset"}`;
}

/** A closed trade as the catalyst slice needs it: the shared $ fields + who / when / what / which setup. */
export type CatalystTrade = TradeRowLike & {
  id: number;
  trader: string;
  /** NY trading day of the entry (LEFT(trades.date, 10)). */
  day: string;
  ticker: string;
  /** The top-level setup (a variant rolls up to its parent); null = no setup. */
  setupId: number | null;
  setupName: string | null;
};

/** Each trade's mark (or null) — the automatic link: same trader, same entry day, same ticker. */
export function linkMarks<T extends Pick<CatalystTrade, "id" | "trader" | "day" | "ticker">>(trades: readonly T[], marks: readonly CatalystMark[]): Map<number, CatalystMark | null> {
  const by = new Map(marks.map((m) => [markKey(m.trader, m.day, m.ticker), m]));
  return new Map(trades.map((t) => [t.id, by.get(markKey(t.trader, t.day, t.ticker)) ?? null]));
}

export type BucketRow = UsdStats & { key: BucketKey; strength: StrengthKey | null; direction: DirectionKey | null };
export type CellKey = StrengthKey | "none";
export type SetupRow = { setupId: number; setupName: string; n: number; cells: (UsdStats & { strength: CellKey })[] };
export type Insight = { setupId: number; setupName: string; strength: CellKey; n: number; net: number };
export type CatalystEdge = { total: number; marked: number; buckets: BucketRow[]; bySetup: SetupRow[]; insight: Insight | null };

/** A setup × strength cell needs this many trades before it can be the insight line. */
export const INSIGHT_MIN_TRADES = 3;
const CELL_ORDER: readonly CellKey[] = ["strong", "weak", "unset", "none"];
const MAX_SETUPS = 8;

function cellOf(m: CatalystMark | null): CellKey {
  if (!m || !isMarked(m)) return "none";
  return m.strength ?? "unset";
}

/** The catalyst slice of a set of closed trades. */
export function catalystEdge(trades: readonly CatalystTrade[], marks: readonly CatalystMark[]): CatalystEdge {
  const link = linkMarks(trades, marks);
  const byBucket = new Map<BucketKey, CatalystTrade[]>();
  const bySetup = new Map<number, { name: string; cells: Map<CellKey, CatalystTrade[]> }>();
  let marked = 0;
  for (const t of trades) {
    const m = link.get(t.id) ?? null;
    if (isMarked(m)) marked++;
    const b = bucketOf(m);
    byBucket.set(b, [...(byBucket.get(b) ?? []), t]);
    if (t.setupId != null) {
      const s = bySetup.get(t.setupId) ?? { name: t.setupName ?? String(t.setupId), cells: new Map() };
      const c = cellOf(m);
      s.cells.set(c, [...(s.cells.get(c) ?? []), t]);
      bySetup.set(t.setupId, s);
    }
  }
  const buckets: BucketRow[] = BUCKET_ORDER.filter((k) => byBucket.has(k)).map((key) => {
    const [strength, direction] = key === "none" ? [null, null] : (key.split("_") as [StrengthKey, DirectionKey]);
    return { key, strength, direction, ...computeUsdStats(byBucket.get(key)!) };
  });
  const setups: SetupRow[] = [...bySetup.entries()]
    .map(([setupId, s]) => {
      const cells = CELL_ORDER.filter((c) => s.cells.has(c)).map((strength) => ({ strength, ...computeUsdStats(s.cells.get(strength)!) }));
      return { setupId, setupName: s.name, n: cells.reduce((a, c) => a + c.n, 0), cells };
    })
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || a.setupName.localeCompare(b.setupName))
    .slice(0, MAX_SETUPS);
  return { total: trades.length, marked, buckets, bySetup: setups, insight: insightOf(setups) };
}

/** The one line worth reading: the costliest setup × strength cell (≥ INSIGHT_MIN_TRADES), else the best one. */
export function insightOf(setups: readonly SetupRow[]): Insight | null {
  const cells = setups.flatMap((s) => s.cells.filter((c) => c.n >= INSIGHT_MIN_TRADES && c.net != null).map((c) => ({ setupId: s.setupId, setupName: s.setupName, strength: c.strength, n: c.n, net: c.net! })));
  const worst = cells.filter((c) => c.net < 0).sort((a, b) => a.net - b.net || b.n - a.n)[0];
  if (worst) return worst;
  return cells.filter((c) => c.net > 0).sort((a, b) => b.net - a.net || b.n - a.n)[0] ?? null;
}

// ─── suggestions (prefill: the trader only confirms) ───────────────────────────────────────────────────────────────

export type DayEvent = { ticker: string; kind: Kind; direction: Direction | null; movePct: number | null; source: "event" | "earnings" };
export type Hint = { ticker: string; direction: Direction | null; kind: Kind | null; source: "event" | "earnings" | "gap"; movePct: number | null };

/** Events page type → catalyst kind (analyst up / downgrades are news; momentum, squeezes and the rest are «other»). */
export function kindOfEventType(type: string | null | undefined): Kind {
  const t = String(type ?? "").trim().toLowerCase();
  if (t === "earnings") return "earnings";
  if (t === "news" || t === "upg" || t === "dwg") return "news";
  if (t === "fed" || t === "macro" || t === "economic") return "macro";
  if (t === "ipo") return "offering";
  return "other";
}

/** Direction of an events-page row: the sign of its logged move, else its type / reaction. */
export function eventDirection(e: { type?: string | null; reaction?: string | null; movePct?: number | null }): Direction | null {
  if (e.movePct != null && Number.isFinite(e.movePct) && e.movePct !== 0) return e.movePct > 0 ? "bull" : "bear";
  const t = String(e.type ?? "").trim().toLowerCase();
  if (t === "upg") return "bull";
  if (t === "dwg") return "bear";
  const r = String(e.reaction ?? "").trim().toLowerCase();
  if (r === "gap_up" || r === "grind_up" || r === "bullish") return "bull";
  if (r === "gap_down" || r === "grind_down" || r === "bearish") return "bear";
  return null;
}

/** A gap this large (in %) suggests a direction on its own. */
export const GAP_HINT_PCT = 2;

/** The suggestion for one ticker of a day: an event first, then earnings (direction from the gap), then the gap alone. */
export function hintFrom(ticker: string, events: readonly DayEvent[], gapPct: number | null): Hint | null {
  const mine = events.filter((e) => e.ticker === ticker);
  const gapDir: Direction | null = gapPct != null && Math.abs(gapPct) >= GAP_HINT_PCT ? (gapPct > 0 ? "bull" : "bear") : null;
  const ev = mine.find((e) => e.source === "event" && e.direction) ?? mine.find((e) => e.source === "event");
  if (ev) return { ticker, direction: ev.direction ?? gapDir, kind: ev.kind, source: "event", movePct: ev.movePct ?? gapPct };
  const er = mine.find((e) => e.source === "earnings");
  if (er) return { ticker, direction: er.direction ?? gapDir, kind: "earnings", source: "earnings", movePct: er.movePct ?? gapPct };
  return gapDir ? { ticker, direction: gapDir, kind: null, source: "gap", movePct: gapPct } : null;
}

// ─── day two ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type SetupLite = { id: number; name: string; setupType: string | null; formula: StrategyFormula | null };
export type DayTwoHint = {
  ticker: string;
  direction: Direction;
  /** Where «strong» came from: the trader's own mark, or the day's event / earnings. */
  source: "mark" | "event" | "earnings";
  kind: Kind | null;
  /** Yesterday's close vs the close before, %. */
  movePct: number;
  setupId: number | null;
  setupName: string | null;
};

/** Second-day setups by name / type, in RU / EN / UZ («Second Day Play», «2D VWAP», «второй день», «ikkinchi kun»). */
const DAY_TWO_RE = /second.?day|day.?(2|two)\b|\b2.?d(ay)?\b|втор(ой|ого).?дн|2-?й.?день|ikkinchi.?kun/i; // i18n-ignore (input matcher)

/** The playbook setup to watch on day two in `direction` (null when none fits). */
export function dayTwoSetup(setups: readonly SetupLite[], direction: Direction): SetupLite | null {
  let best: { s: SetupLite; score: number } | null = null;
  for (const s of setups) {
    let score = 0;
    if (DAY_TWO_RE.test(`${s.name} ${s.setupType ?? ""}`)) score += 3;
    const c = s.formula?.catalyst;
    if (c?.strength === "strong") score += 2;
    if (c && hasCatalystRequirement(s.formula)) {
      if (c.direction === direction) score += 1;
      else if (c.direction) score -= 5;
    }
    if (score >= 3 && (!best || score > best.score || (score === best.score && s.id < best.s.id))) best = { s, score };
  }
  return best?.s ?? null;
}

/**
 * Yesterday's tickers with a STRONG catalyst (the trader's mark; or an event / earnings the trader did not mark weak)
 * that moved at least `minMovePct` in the catalyst's direction → today's «day two» lines, biggest move first.
 */
export function dayTwoHints(x: {
  marks: readonly CatalystMark[];
  events: readonly DayEvent[];
  moves: ReadonlyMap<string, number>;
  minMovePct: number;
  setups: readonly SetupLite[];
  limit?: number;
}): DayTwoHint[] {
  const out = new Map<string, DayTwoHint>();
  const marks = new Map(x.marks.map((m) => [m.ticker, m]));
  const consider = (ticker: string, dir: Direction | null, source: DayTwoHint["source"], kind: Kind | null, fallbackMove: number | null) => {
    if (out.has(ticker)) return;
    const move = x.moves.get(ticker) ?? fallbackMove;
    if (move == null || !Number.isFinite(move) || Math.abs(move) < x.minMovePct) return;
    const moveDir: Direction = move > 0 ? "bull" : "bear";
    if (dir && dir !== moveDir) return; // a big move against the catalyst is not its day two
    const setup = dayTwoSetup(x.setups, moveDir);
    out.set(ticker, { ticker, direction: moveDir, source, kind, movePct: Math.round(move * 100) / 100, setupId: setup?.id ?? null, setupName: setup?.name ?? null });
  };
  for (const m of x.marks) if (m.strength === "strong") consider(m.ticker, m.direction, "mark", m.kind, null);
  for (const e of x.events) {
    const own = marks.get(e.ticker);
    if (own && isMarked(own) && own.strength !== "strong") continue; // the trader called it weak (or left the strength open)
    consider(e.ticker, own?.direction ?? e.direction, e.source, e.kind, e.movePct);
  }
  return [...out.values()].sort((a, b) => Math.abs(b.movePct) - Math.abs(a.movePct) || a.ticker.localeCompare(b.ticker)).slice(0, x.limit ?? 3);
}

// ─── formula check (mentor) ─────────────────────────────────────────────────────────────────────────────────────

export type FormulaBreak = {
  tradeId: number;
  day: string;
  ticker: string;
  setupId: number;
  setupName: string;
  reason: "unmarked" | "strength" | "direction";
  required: { strength: Strength | null; direction: Direction | null };
  actual: { strength: Strength | null; direction: Direction | null } | null;
};

/** Trades on a setup whose formula needs a catalyst (strength / direction) that the day's plan mark does not show. */
export function formulaBreaks(
  trades: readonly { id: number; trader: string; day: string; ticker: string; setupId: number; setupName: string }[],
  formulas: ReadonlyMap<number, StrategyFormula>,
  marks: readonly CatalystMark[],
): FormulaBreak[] {
  const link = linkMarks(trades, marks);
  const out: FormulaBreak[] = [];
  for (const t of trades) {
    const f = formulas.get(t.setupId);
    if (!f || !hasCatalystRequirement(f)) continue;
    const req = { strength: f.catalyst.strength, direction: f.catalyst.direction };
    const m = link.get(t.id) ?? null;
    const actual = m && isMarked(m) ? { strength: m.strength, direction: m.direction } : null;
    let reason: FormulaBreak["reason"] | null = null;
    if (!actual) reason = "unmarked";
    else if (req.strength === "strong" && actual.strength === "weak") reason = "strength";
    else if (req.direction && actual.direction && actual.direction !== req.direction) reason = "direction";
    else if ((req.strength === "strong" && !actual.strength) || (req.direction && !actual.direction)) reason = "unmarked";
    if (reason) out.push({ tradeId: t.id, day: t.day, ticker: t.ticker, setupId: t.setupId, setupName: t.setupName, reason, required: req, actual });
  }
  return out;
}
