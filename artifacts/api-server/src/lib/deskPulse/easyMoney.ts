/**
 * «Лёгкие деньги дня» (pure; tests in __tests__/easyMoney.test.ts). After the close: which in-play tickers made a
 * CLEAN move the archived day really shows, what setup family and timing paid, and who of the group planned / traded it.
 *
 *   detectMove(day, ticker, bar, …)  a clean move of the day from the candle archive's numbers, or null:
 *       session  |open → close| ≥ pulse.easyMovePct and the body is ≥ pulse.easyCleanShare of the day's range (a trend
 *                day, not chop); side = the body's sign; family = the day's gap × that side (./family); timing from the
 *                archived intraday bars when there are any: ≥ half of the move done by 10:00 → open30, else day; no
 *                bars → null (not guessed)
 *       gap      no clean session move, but the opening gap is ≥ pulse.easyMovePct and held (the close keeps at least
 *                easyCleanShare of it): the money was pre-market — family gap_up_long / gap_down_short, timing am
 *     movePct is the size of THAT move (the body, or the gap), in %; the sources say why the ticker was in play.
 *   matchMove(move, person)          one person's line: took (traded the move's side) / against (traded only the other
 *                                    side) / skipped (planned, no trade) / missed (neither) with the shared $ stats
 *   personalLines(…)                 the debrief lines of one trader: every took / against / skipped, the biggest missed
 * Money is net (lib/playbookEdge computeUsdStats → lib/coreMetrics); trades come only from PropReports.
 */
import { computeUsdStats } from "../playbookEdge";
import type { TradeRowLike } from "../tradeMath";
import type { Timing } from "../sessionFlow/timing";
import { familyOf, gapOf, type DayBar, type Family } from "./family";

export const EASY_SOURCES = ["traded", "plan", "idea", "catalyst", "event", "earnings", "analyst", "em_break", "gap"] as const;
export type EasySource = (typeof EASY_SOURCES)[number];

export type EasyCfg = { minMovePct: number; cleanShare: number; gapPct: number };

export type EasyMove = {
  day: string;
  ticker: string;
  kind: "session" | "gap";
  side: "long" | "short";
  family: Family;
  timing: Timing | null;
  /** Size of the move that paid, % (the open → close body, or the gap that held). */
  movePct: number;
  gapPct: number;
  bodyPct: number;
  rangePct: number;
  /** |body| ÷ range of the day (0…1). */
  clean: number;
  sources: EasySource[];
  /** The expected move of a report that day when there was one (the move broke it: source em_break). */
  emPct: number | null;
};

/** An intraday bar (epoch seconds) with its New York minute already resolved by the caller. */
export type MinuteBar = { min: number; c: number };

const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number) => ((a - b) / b) * 100;

const OPEN_MIN = 9 * 60 + 30;
const TEN_MIN = 10 * 60;

/** open30 when at least half of the session move (same direction) was done by 10:00; null without bars before 10:00. */
export function timingFromBars(bars: readonly MinuteBar[] | null | undefined, open: number, close: number): Timing | null {
  if (!bars?.length) return null;
  const early = bars.filter((b) => b.min >= OPEN_MIN && b.min < TEN_MIN);
  if (!early.length) return null;
  const at10 = early[early.length - 1]!.c;
  const total = close - open;
  const done = at10 - open;
  return total !== 0 && Math.sign(done) === Math.sign(total) && Math.abs(done) >= Math.abs(total) / 2 ? "open30" : "day";
}

export function detectMove(
  day: string, ticker: string, bar: DayBar, sources: readonly EasySource[], cfg: EasyCfg,
  opts: { emPct?: number | null; bars?: readonly MinuteBar[] | null } = {},
): EasyMove | null {
  const gap = gapOf(bar);
  if (gap == null || !(bar.open > 0) || bar.high < bar.low) return null;
  const body = pct(bar.close, bar.open);
  const range = ((bar.high - bar.low) / bar.open) * 100;
  const clean = range > 0 ? Math.min(1, Math.abs(body) / range) : 0;
  const change = pct(bar.close, bar.prevClose);
  const emPct = opts.emPct ?? null;
  const src = new Set(sources);
  if (emPct != null && Math.abs(change) > emPct) src.add("em_break");
  if (Math.abs(gap) >= cfg.gapPct) src.add("gap");
  const base = { day, ticker, gapPct: r2(gap), bodyPct: r2(body), rangePct: r2(range), clean: r2(clean), sources: [...src], emPct };
  if (Math.abs(body) >= cfg.minMovePct && clean >= cfg.cleanShare) {
    const side = body > 0 ? "long" : "short";
    return { ...base, kind: "session", side, family: familyOf(gap, side, cfg.gapPct)!, timing: timingFromBars(opts.bars, bar.open, bar.close), movePct: r2(Math.abs(body)) };
  }
  const held = Math.sign(change) === Math.sign(gap) && Math.abs(change) >= cfg.cleanShare * Math.abs(gap);
  if (Math.abs(gap) >= cfg.minMovePct && held) {
    const side = gap > 0 ? "long" : "short";
    return { ...base, kind: "gap", side, family: familyOf(gap, side, cfg.gapPct)!, timing: "am", movePct: r2(Math.abs(gap)) };
  }
  return null;
}

// ─── who planned / traded it ──────────────────────────────────────────────────────────────────────────────────────

export type EasyTrade = TradeRowLike & { side: "long" | "short" | null };

export type PersonDay = {
  trader: string;
  /** A plan mark of the ticker that day (idea tier / catalyst tap) — plans are where manual input belongs. */
  planned: boolean;
  /** The person's trades in the ticker that day (PropReports). */
  trades: readonly EasyTrade[];
};

export const EASY_STATUSES = ["took", "against", "skipped", "missed"] as const;
export type EasyStatus = (typeof EASY_STATUSES)[number];

export type MatchRow = { trader: string; status: EasyStatus; planned: boolean; n: number; wins: number; losses: number; net: number | null };

export function matchMove(move: Pick<EasyMove, "side">, p: PersonDay): MatchRow {
  const st = computeUsdStats([...p.trades]);
  const withSide = p.trades.some((t) => t.side == null || t.side === move.side);
  const status: EasyStatus = p.trades.length ? (withSide ? "took" : "against") : p.planned ? "skipped" : "missed";
  return { trader: p.trader, status, planned: p.planned, n: p.trades.length, wins: st.wins, losses: st.losses, net: p.trades.length ? st.net : null };
}

export type EasyLine = Pick<EasyMove, "ticker" | "kind" | "side" | "family" | "timing" | "movePct" | "sources"> & Omit<MatchRow, "trader">;

/** The trader's debrief lines: every move he took, traded against or planned and skipped; the `missed` biggest of the rest. */
export function personalLines(moves: readonly EasyMove[], rows: ReadonlyMap<string, MatchRow>, missed: number): EasyLine[] {
  const line = (m: EasyMove, r: MatchRow): EasyLine => ({
    ticker: m.ticker, kind: m.kind, side: m.side, family: m.family, timing: m.timing, movePct: m.movePct, sources: m.sources,
    status: r.status, planned: r.planned, n: r.n, wins: r.wins, losses: r.losses, net: r.net,
  });
  const order: Record<EasyStatus, number> = { took: 0, against: 1, skipped: 2, missed: 3 };
  const all = moves.map((m) => ({ m, r: rows.get(m.ticker) })).filter((x): x is { m: EasyMove; r: MatchRow } => !!x.r);
  const kept = all.filter((x) => x.r.status !== "missed");
  const miss = all.filter((x) => x.r.status === "missed").sort((a, b) => b.m.movePct - a.m.movePct).slice(0, Math.max(0, missed));
  return [...kept, ...miss].sort((a, b) => order[a.r.status] - order[b.r.status] || b.m.movePct - a.m.movePct).map((x) => line(x.m, x.r));
}
