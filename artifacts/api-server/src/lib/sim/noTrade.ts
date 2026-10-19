/**
 * «Не торгую» — a scored decision (POST /api/sim/games/:id/no-trade, «Тренажёр 2»). Pure.
 *
 * From the decision bar's close, each side is walked bar by bar along the intrabar path (engine.pathOf: bull bar
 * O→L→H→C, bear bar O→H→L→C) until price moves one risk unit against it; the best favourable excursion before that
 * is the side's move. The decision is correct when neither side offered ≥ 1.5R. Window: the next 60 minutes of the
 * session (intraday) / 20 bars (swing), never past the game's last bar — «no trade» judges now, not the whole day.
 */
import { pathOf, type SimBar } from "./engine";

export const NO_TRADE_RULES = { cleanR: 1.5, adverseR: 1, windowMinutes: 60, swingBars: 20 } as const;

export type NoTradeReason = "noTrade.correct" | "noTrade.missedLong" | "noTrade.missedShort";

export type MissedMove = { side: "long" | "short"; fromIdx: number; toIdx: number; entry: number; extreme: number; r: number };

export type NoTradeVerdict = {
  correct: boolean;
  bestR: number;
  reasonKey: NoTradeReason;
  decisionIdx: number;
  windowEnd: number;
  missed: MissedMove | null;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Last bar judged: `decisionIdx` + the window, capped at the game end. */
export function windowEndOf(decisionIdx: number, endIdx: number, baseSec: number, swing: boolean): number {
  const n = swing ? NO_TRADE_RULES.swingBars : Math.max(1, Math.round((NO_TRADE_RULES.windowMinutes * 60) / baseSec));
  return Math.min(endIdx, decisionIdx + n);
}

/** Best favourable move of one side before a 1R adverse move (price units), with where it peaked. */
export function sideMove(bars: readonly SimBar[], from: number, to: number, risk: number, dir: 1 | -1): { move: number; toIdx: number; extreme: number } {
  const entry = bars[from].c;
  let move = 0, toIdx = from, extreme = entry;
  for (let i = from + 1; i <= to && i < bars.length; i++) {
    for (const p of pathOf(bars[i])) {
      const fav = (p - entry) * dir;
      if (fav <= -risk * NO_TRADE_RULES.adverseR) return { move, toIdx, extreme };
      if (fav > move) { move = fav; toIdx = i; extreme = p; }
    }
  }
  return { move, toIdx, extreme };
}

export function noTradeVerdict(bars: readonly SimBar[], decisionIdx: number, windowEnd: number, riskUnit: number): NoTradeVerdict {
  const risk = riskUnit > 0 ? riskUnit : Math.max(0.01, (bars[decisionIdx]?.c ?? 1) * 0.002);
  const long = sideMove(bars, decisionIdx, windowEnd, risk, 1);
  const short = sideMove(bars, decisionIdx, windowEnd, risk, -1);
  const longR = r2(long.move / risk), shortR = r2(short.move / risk);
  const bestR = Math.max(longR, shortR);
  const correct = bestR < NO_TRADE_RULES.cleanR;
  const side: "long" | "short" = longR >= shortR ? "long" : "short";
  const m = side === "long" ? long : short;
  return {
    correct,
    bestR,
    reasonKey: correct ? "noTrade.correct" : side === "long" ? "noTrade.missedLong" : "noTrade.missedShort",
    decisionIdx,
    windowEnd,
    missed: correct ? null : { side, fromIdx: decisionIdx, toIdx: m.toIdx, entry: bars[decisionIdx].c, extreme: m.extreme, r: bestR },
  };
}
