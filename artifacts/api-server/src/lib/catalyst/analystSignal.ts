/**
 * Analyst actions → catalyst STRENGTH suggestion (pure). The analyst feed (analyst_actions_cache, job
 * market.analyst-actions) says how strong a ticker's catalyst is in one direction when
 *
 *   cluster   at least `clusterMin` different firms move the same way (upgrade / downgrade / initiation by stance /
 *             a target change of PT_EVENT_MIN % or more — lib/analystReaction classifyAction) within `windowHours`;
 *   target    one firm changes its price target by `targetPct` % or more.
 *
 * Both are only SUGGESTIONS: they pre-fill the plan / watchlist taps (catalyst_marks) as «strong» in that direction,
 * the trader confirms with one tap. Two opposite clusters of the same size cancel out (no suggestion). Thresholds are
 * desk settings (catalyst.analyst*), read by the caller.
 *
 *   analystSignals(acts, opts)          per ticker: the strongest signal (cluster first, then the largest target change)
 *   dayTwoAnalyst(acts, day)            tickers with analyst comments that react on `day` and their net direction —
 *                                       the «day two» lines (lib/catalyst/model dayTwoHints)
 */
import { classifyAction, reactionDay } from "../analystReaction";
import type { Direction } from "./codes";

export type AnalystAct = {
  ticker: string;
  at: Date;
  firm: string;
  /** Raw Yahoo code: up / down / init / main / reit … */
  action: string;
  toGrade?: string | null;
  priceTarget?: unknown;
  priceTargetFrom?: unknown;
};

export type SignalAct = { firm: string; at: string; kind: string; direction: Direction; targetPct: number | null };
export type AnalystSignal = {
  ticker: string;
  direction: Direction;
  strength: "strong";
  reason: "cluster" | "target";
  /** Firms in the cluster (1 for a target change). */
  count: number;
  /** The largest |target change| in the signal's direction, % (signed). */
  targetPct: number | null;
  firstAt: string;
  lastAt: string;
  /** The actions behind the signal, newest first (release time = `at`). */
  acts: SignalAct[];
};

export type SignalOpts = { clusterMin: number; windowHours: number; targetPct: number };

type Dir = { act: AnalystAct; direction: Direction; kind: string; targetPct: number | null };

/** Directional actions of one list (classifyAction; maintain / reiterate count only through their price target). */
function directional(acts: readonly AnalystAct[]): Dir[] {
  const out: Dir[] = [];
  for (const a of acts) {
    const c = classifyAction({ action: a.action, to_grade: a.toGrade ?? null, price_target: a.priceTarget, price_target_from: a.priceTargetFrom });
    if (!c) continue;
    out.push({ act: a, direction: c.dir > 0 ? "bull" : "bear", kind: c.kind, targetPct: c.ptChg == null ? null : Math.round(c.ptChg * 10) / 10 });
  }
  return out;
}

/** The biggest set of distinct firms of one direction inside any `windowHours` span (sorted by time). */
function bestCluster(list: readonly Dir[], windowMs: number): Dir[] {
  const s = [...list].sort((a, b) => a.act.at.getTime() - b.act.at.getTime());
  let best: Dir[] = [];
  for (let i = 0; i < s.length; i++) {
    const firms = new Map<string, Dir>();
    for (let j = i; j < s.length && s[j].act.at.getTime() - s[i].act.at.getTime() <= windowMs; j++) {
      const f = s[j].act.firm.trim().toLowerCase();
      if (!firms.has(f)) firms.set(f, s[j]);
    }
    if (firms.size > best.length) best = [...firms.values()];
  }
  return best;
}

const toAct = (d: Dir): SignalAct => ({ firm: d.act.firm, at: d.act.at.toISOString(), kind: d.kind, direction: d.direction, targetPct: d.targetPct });

function signalOf(ticker: string, reason: AnalystSignal["reason"], dirs: readonly Dir[]): AnalystSignal {
  const sorted = [...dirs].sort((a, b) => b.act.at.getTime() - a.act.at.getTime());
  const direction = sorted[0].direction;
  const pts = sorted.map((d) => d.targetPct).filter((v): v is number => v != null);
  const targetPct = pts.length ? pts.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null;
  return {
    ticker, direction, strength: "strong", reason, count: sorted.length, targetPct,
    firstAt: sorted[sorted.length - 1].act.at.toISOString(), lastAt: sorted[0].act.at.toISOString(), acts: sorted.map(toAct),
  };
}

/** One signal per ticker (or none): a same-direction cluster first, else the largest qualifying target change. */
export function analystSignals(acts: readonly AnalystAct[], opts: SignalOpts): AnalystSignal[] {
  const byTicker = new Map<string, AnalystAct[]>();
  for (const a of acts) {
    const t = a.ticker.trim().toUpperCase();
    if (!t || !(a.at instanceof Date) || Number.isNaN(a.at.getTime())) continue;
    byTicker.set(t, [...(byTicker.get(t) ?? []), a]);
  }
  const windowMs = Math.max(1, opts.windowHours) * 3_600_000;
  const min = Math.max(2, Math.round(opts.clusterMin));
  const out: AnalystSignal[] = [];
  for (const [ticker, list] of byTicker) {
    const dirs = directional(list);
    const bull = bestCluster(dirs.filter((d) => d.direction === "bull"), windowMs);
    const bear = bestCluster(dirs.filter((d) => d.direction === "bear"), windowMs);
    if (bull.length !== bear.length && Math.max(bull.length, bear.length) >= min) {
      out.push(signalOf(ticker, "cluster", bull.length > bear.length ? bull : bear));
      continue;
    }
    const big = dirs
      .filter((d) => d.targetPct != null && Math.abs(d.targetPct) >= opts.targetPct && (d.targetPct > 0) === (d.direction === "bull"))
      .sort((a, b) => Math.abs(b.targetPct!) - Math.abs(a.targetPct!) || b.act.at.getTime() - a.act.at.getTime());
    // Opposite big target changes (one firm doubles, another halves) say nothing about the direction.
    if (big.length && big.every((d) => d.direction === big[0].direction)) out.push(signalOf(ticker, "target", [big[0]]));
  }
  return out.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt) || a.ticker.localeCompare(b.ticker));
}

/** Signals whose newest action reacts on `day` (the first session that can trade it) — a plan day's suggestions. */
export function signalsForDay(acts: readonly AnalystAct[], day: string, opts: SignalOpts): AnalystSignal[] {
  return analystSignals(acts, opts).filter((s) => reactionDay(new Date(s.lastAt)) === day);
}

/**
 * Tickers with analyst comments that react on `day`, with the net direction of the directional ones (null when they
 * cancel out or none is directional) — «analysts talk about it the day after the catalyst» = a day-two candidate.
 */
export function dayTwoAnalyst(acts: readonly AnalystAct[], day: string): Map<string, Direction | null> {
  const net = new Map<string, number>();
  for (const a of acts) {
    if (reactionDay(a.at) !== day) continue;
    const t = a.ticker.trim().toUpperCase();
    const c = classifyAction({ action: a.action, to_grade: a.toGrade ?? null, price_target: a.priceTarget, price_target_from: a.priceTargetFrom });
    net.set(t, (net.get(t) ?? 0) + (c?.dir ?? 0));
  }
  return new Map([...net].map(([t, n]) => [t, n > 0 ? "bull" : n < 0 ? "bear" : null]));
}

export type HintLike = {
  ticker: string;
  direction: Direction | null;
  kind: string | null;
  source: string;
  movePct: number | null;
  strength?: "weak" | "strong" | null;
  analyst?: { reason: AnalystSignal["reason"]; count: number; targetPct: number | null } | null;
};

/**
 * The day's prefill hints with the analyst strength on top: a signal in the hint's direction (or on a hint without
 * one) adds «strong» and the reason; a ticker with no hint gets an analyst hint of its own (kind news); a signal
 * AGAINST the hint's direction (an event / gap says bearish, analysts upgrade) suggests no strength at all.
 */
export function withAnalystStrength<H extends HintLike>(hints: readonly H[], signals: readonly AnalystSignal[], tickers: readonly string[]): (H | HintLike)[] {
  const sig = new Map(signals.map((s) => [s.ticker, s]));
  const out: (H | HintLike)[] = [];
  const seen = new Set<string>();
  for (const h of hints) {
    seen.add(h.ticker);
    const s = sig.get(h.ticker);
    if (!s || (h.direction && h.direction !== s.direction)) { out.push(h); continue; }
    out.push({ ...h, direction: h.direction ?? s.direction, strength: "strong", analyst: { reason: s.reason, count: s.count, targetPct: s.targetPct } });
  }
  for (const t of tickers) {
    const s = sig.get(t);
    if (!s || seen.has(t)) continue;
    out.push({ ticker: t, direction: s.direction, kind: "news", source: "analyst", movePct: null, strength: "strong", analyst: { reason: s.reason, count: s.count, targetPct: s.targetPct } });
  }
  return out;
}
