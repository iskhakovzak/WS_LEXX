/**
 * «Петля вчера» — pure model (unit-tested in loop-yesterday-model.test.ts): the state of each cell of a trader's row,
 * where the loop breaks (rows with gaps first), where a ✗ is fixed, the totals' denominators and the one-line pilot
 * verdict (PILOT §3, from usage-model pilotSummary).
 *
 *   plan     ok (before 09:30 NY) · late (saved after the open) · miss
 *   closed   ok · miss (traded, not closed) · na (no trades, nothing to close)
 *   review   ok · late (reviewed past the SLA) · wait · overdue (waiting past the SLA) · na (day not closed)
 *   telegram ok · miss
 */
import { links } from "@/lib/links";
import { splitHours } from "@/lib/format";
import type { LoopRow, LoopTotals } from "./loop-yesterday-api";
import type { PilotRow, PilotRowKey } from "./usage-model";

export type Cell = "ok" | "late" | "miss" | "wait" | "overdue" | "na";
export type Column = "plan" | "closed" | "review" | "telegram";

export function planCell(r: LoopRow): Cell {
  return !r.plan ? "miss" : r.planBeforeOpen ? "ok" : "late";
}

export function closedCell(r: LoopRow): Cell {
  return r.closed ? "ok" : r.trades > 0 ? "miss" : "na";
}

export function reviewCell(r: LoopRow): Cell {
  if (!r.closed) return "na";
  if (r.reviewed) return r.overSla ? "late" : "ok";
  return r.overSla ? "overdue" : "wait";
}

export function telegramCell(r: LoopRow): Cell {
  return r.telegram ? "ok" : "miss";
}

export function cellOf(col: Column, r: LoopRow): Cell {
  return col === "plan" ? planCell(r) : col === "closed" ? closedCell(r) : col === "review" ? reviewCell(r) : telegramCell(r);
}

/** A cell that breaks the loop (red / amber attention): missing, waiting or overdue. */
export const isGap = (c: Cell): boolean => c === "miss" || c === "wait" || c === "overdue";

const COLUMNS: readonly Column[] = ["plan", "closed", "review", "telegram"];

/** How many cells of the row break the loop. */
export function gapsOf(r: LoopRow): number {
  return COLUMNS.filter((c) => isGap(cellOf(c, r))).length;
}

/** Rows with gaps first (most gaps on top, an overdue review before the rest), then by name. */
export function sortRows(rows: readonly LoopRow[]): LoopRow[] {
  const overdue = (r: LoopRow) => (reviewCell(r) === "overdue" ? 1 : 0);
  return [...rows].sort((a, b) => gapsOf(b) - gapsOf(a) || overdue(b) - overdue(a) || a.name.localeCompare(b.name, "ru"));
}

/**
 * Where a gap is fixed (null = no screen for it, or nothing to fix): the trader's day for «not closed» / «waiting for
 * the curator» (the review is done on the day), «people» for Telegram (the console's «Люди» tab).
 */
export function fixOf(col: Column, r: LoopRow, date: string): { href: string } | { tab: "people" } | null {
  const c = cellOf(col, r);
  if (!isGap(c)) return null;
  if (col === "closed" || col === "review") return { href: links.journalDay(date, r.name) };
  if (col === "telegram") return { tab: "people" };
  return null;
}

/** The trader's card in the curator cabinet. */
export function profileHref(name: string): string {
  return `/curator?${new URLSearchParams({ trader: name }).toString()}`;
}

/** «ждёт N ч» / «ждёт N д M ч» (the queue's rounding, lib/format splitHours). */
export function waitParts(hours: number | null): { d: number; h: number } {
  return splitHours(hours ?? 0);
}

/** Denominators for the totals row: plan / Telegram of everyone, «closed» of who traded (or closed anyway). */
export function totalsOf(rows: readonly LoopRow[], t: LoopTotals) {
  const closeDue = rows.filter((r) => r.trades > 0 || r.closed).length;
  return {
    plan: { n: t.plan, of: t.traders, beforeOpen: t.planBeforeOpen },
    trades: { sum: t.trades, traded: t.traded },
    closed: { n: t.closed, of: closeDue },
    review: { n: t.reviewed, of: t.closed, waiting: t.waiting, overdue: t.overdue },
    telegram: { n: t.telegram, of: t.traders },
  };
}

export type PilotVerdict = { good: number; measured: number; bad: PilotRowKey[] };

/** The PILOT §3 week in one line: how many measured lines are «хорошо», which are «плохо». */
export function pilotVerdict(rows: readonly PilotRow[]): PilotVerdict {
  const measured = rows.filter((r) => r.good !== null);
  return { good: measured.filter((r) => r.good).length, measured: measured.length, bad: measured.filter((r) => r.good === false).map((r) => r.key) };
}
