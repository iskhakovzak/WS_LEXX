/**
 * «Заморозить и угадать» — the replay decision drill of /chart-lab, pure: at a frozen moment of a real trade the future
 * is hidden, the trader says «держу» or «выхожу сейчас», then the rest is revealed and both outcomes are compared on the
 * WHOLE trade:
 *   - «выйти сейчас» = everything realised so far + the open remainder closed at the frozen bar's mark (lib/position
 *     positionAt total);
 *   - «держать» = what the real trade made (the position after its last fill).
 * With no share count (someone else's trade, sizes hidden) the comparison falls back to $ per share on the average
 * entry. Nothing here reads a bar after the frozen one except the real fills of the outcome.
 */
import { positionAt, replayMark } from "@/components/chart-engine/lib/position";
import type { Bar, Fill, Side } from "@/components/chart-engine/types";

export type Choice = "hold" | "exit";

export interface Outcome {
  /** «Выйти сейчас» on the whole trade ($ or $/share, see `unit`). */
  exitNow: number | null;
  /** «Держать» = the real result. */
  hold: number | null;
  unit: "usd" | "perShare";
}

export interface Verdict {
  choice: Choice;
  /** Result of the choice and of the other option. */
  mine: number | null;
  other: number | null;
  /** mine − other; > 0 = the choice was better. */
  diff: number | null;
  better: boolean | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Position is open at the frozen bar (entered, not yet flat): the only moments a «hold / exit» question makes sense. */
export function inPosition(fills: readonly Fill[], idx: number, side: Side, bars: readonly Bar[], qty: number | null): boolean {
  const mark = replayMark(bars, fills, idx);
  if (mark == null) return false;
  const p = positionAt(fills, idx, side, mark, qty);
  return p.avg != null && p.fillsSoFar > 0;
}

/** Both outcomes of a freeze at bar `idx`. */
export function outcomeAt(fills: readonly Fill[], idx: number, side: Side, bars: readonly Bar[], qty: number | null): Outcome {
  const mark = replayMark(bars, fills, idx);
  const last = fills.length ? fills[fills.length - 1] : null;
  if (mark == null || !last) return { exitNow: null, hold: null, unit: "usd" };
  const now = positionAt(fills, idx, side, mark, qty);
  const end = positionAt(fills, last.idx, side, last.price, qty);
  if (now.total != null && end.total != null) return { exitNow: r2(now.total), hold: r2(end.total), unit: "usd" };
  // No sizes: $ per share on the average entry (the open part at the mark vs the average exit of the real trade).
  const dir = side === "short" ? -1 : 1;
  const entries = fills.filter((f) => f.kind === "entry" || f.kind === "add");
  const exits = fills.filter((f) => f.kind !== "entry" && f.kind !== "add");
  const avg = (xs: readonly Fill[]) => (xs.length ? xs.reduce((s, f) => s + f.price, 0) / xs.length : null);
  const avgIn = avg(entries), avgOut = avg(exits);
  return {
    exitNow: avgIn != null ? r2(dir * (mark - avgIn)) : null,
    hold: avgIn != null && avgOut != null ? r2(dir * (avgOut - avgIn)) : null,
    unit: "perShare",
  };
}

export function verdictOf(choice: Choice, o: Outcome): Verdict {
  const mine = choice === "exit" ? o.exitNow : o.hold;
  const other = choice === "exit" ? o.hold : o.exitNow;
  const diff = mine != null && other != null ? r2(mine - other) : null;
  return { choice, mine, other, diff, better: diff == null || Math.abs(diff) < 0.005 ? null : diff > 0 };
}
