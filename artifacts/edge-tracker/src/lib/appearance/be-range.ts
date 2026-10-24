/**
 * Break-even range («Вид» → Деньги): ±$X around zero that the UI *shows* as break-even — colour and WIN / LOSS / BE
 * label only. Stored results, P&L sums, win rate, expectancy and every other analytics number are untouched: this
 * module is read by presentational helpers (ds `moneyText`, `visualResult`) and nothing else.
 * A tiny external store, so components subscribe with useSyncExternalStore (ds `useBeRange`).
 */
let range = 0;
const subs = new Set<() => void>();

export function getBeRange(): number {
  return range;
}

export function setBeRange(next: number): void {
  const v = Number.isFinite(next) && next > 0 ? next : 0;
  if (v === range) return;
  range = v;
  for (const fn of subs) fn();
}

export function subscribeBeRange(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** Visual class of a dollar result: within ±range (range > 0) → "be"; exactly 0 with no range → "flat". */
export type PnlClass = "win" | "loss" | "be" | "flat" | "none";

export function classifyPnl(usd: number | null | undefined, beRange: number = range): PnlClass {
  if (usd == null || !Number.isFinite(usd)) return "none";
  if (beRange > 0 && Math.abs(usd) <= beRange) return "be";
  if (usd > 0) return "win";
  if (usd < 0) return "loss";
  return "flat";
}
