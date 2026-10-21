/**
 * Other traders' money is for staff only (owner decision 9, 2026-10-20; wave 1, item 1.22).
 *
 * On shared screens — «Топ дня», the leaderboard, «Деск на тикере», discussions — a trader sees other traders' results
 * in R, %, counts and win rate; the dollar fields of another trader come back null from the server. Their own rows keep
 * every dollar. Staff (curator / admin) see everything. This applies whatever the names setting
 * (lib/access/names: privacy.namesVisibleTo per stage) is: anonymity by day alias no longer opens other people's money.
 *
 * Aggregates over several traders (desk net of a day, office position on a ticker, desk total on a ticker) follow
 * `canSeeDeskAggregate`: staff always; a trader only when at least DESK_AGGREGATE_MIN_TRADERS traders are in it (a sum
 * over three people does not reveal one of them even after subtracting one's own result; with two it would).
 *
 * The per-trade rule itself is lib/playbookPrivacy (canSeeTradeMoney) — this module is its one entry point for
 * shared screens. Pure; unit-tested in __tests__/moneyVisibility.test.ts.
 */
import { canSeeTradeMoney, nullFields, type MoneyViewer } from "./playbookPrivacy";

export const DESK_AGGREGATE_MIN_TRADERS = 3;

/** Dollar fields of a leaderboard / shared-screen row (absent keys are left alone). */
export const OTHERS_MONEY_FIELDS = [
  "net", "gross", "fees", "netPnl", "pnl", "grossPnl", "totalPnl", "avgPnl", "expectancy", "bestTrade", "worstTrade",
  "maxDrawdownNet", "profitFactorUsd", "sharpeDaily", "qty", "riskUsd", "positionUsd", "notional",
  "accountSize", "dailyLossLimit", "maxDrawdownLimit",
] as const;

/** May `viewer` see the dollars of `owner`'s result? Own rows and staff: yes. */
export function seesMoneyOf(viewer: string | null | undefined, isStaff: boolean, owner: string | null | undefined): boolean {
  return canSeeTradeMoney({ name: viewer ?? null, staff: isStaff }, owner);
}

/** May the viewer see a dollar sum over `traders` people (desk / office / ticker totals)? */
export function canSeeDeskAggregate(isStaff: boolean, traders: number): boolean {
  return isStaff || traders >= DESK_AGGREGATE_MIN_TRADERS;
}

export interface RedactOptions<T> {
  /** Owner of a row (default: `row.trader`). */
  owner?: (row: T) => string | null | undefined;
  /** Top-level dollar fields (default OTHERS_MONEY_FIELDS). */
  fields?: readonly string[];
  /** Nested objects with their own dollar fields, e.g. { prev: ["net", "totalPnl"] }. */
  nested?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Rows of several traders with every dollar field of somebody else's row set to null (R, %, counts stay). Own rows and
 * every row for staff come back unchanged. Returns new objects; the input is not mutated.
 */
export function redactOthersMoney<T extends object>(
  rows: readonly T[], viewer: string | null | undefined, isStaff: boolean, opts: RedactOptions<T> = {},
): T[] {
  if (isStaff) return [...rows];
  const ownerOf = opts.owner ?? ((r: T) => (r as { trader?: string | null }).trader);
  const fields = opts.fields ?? OTHERS_MONEY_FIELDS;
  return rows.map((row) => {
    if (seesMoneyOf(viewer, false, ownerOf(row))) return row;
    const out = nullFields(row, fields) as Record<string, unknown>;
    for (const [key, keys] of Object.entries(opts.nested ?? {})) {
      const inner = out[key];
      if (inner && typeof inner === "object") out[key] = nullFields(inner as object, keys);
    }
    return out as T;
  });
}

/** The request-level viewer for these helpers (same shape as lib/playbookAccess loadMoneyViewer). */
export type { MoneyViewer };
