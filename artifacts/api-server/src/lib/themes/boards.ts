/**
 * Personal boards on /themes — pure rules (unit-tested in __tests__/themes/boards.test.ts).
 *
 *   boards    ≤ 8 active per user, each a tab next to «Общие темы» with its own columns and sort:
 *               themes   rows = the user's own themes on it + shared themes he pinned (≤ 40)
 *               tickers  rows = tickers: a list (≤ 50) or a Finviz screener (top 25 / 50)
 *   columns   themes boards: the 4 moves; tickers boards: the 4 moves + gap %, RVOL, float. Stored in canonical order;
 *             none / unknown → all.
 *   order     ← / → swaps a board with its neighbour; positions are renumbered 0…n−1.
 */
import { THEME_METRICS, type MemberQuote, type ThemeMetric, type TickerExtras } from "./logic";
import { normalizeSort, type ColumnSort, type ScreenerSpec } from "./personal";

export const MAX_BOARDS = 8;
export const MAX_BOARD_TICKERS = 50;
export const MAX_PINNED = 40;
export const BOARD_TOPS = [25, 50] as const;
export type BoardTop = (typeof BOARD_TOPS)[number];

export type BoardKind = "themes" | "tickers";
export type TickerColumn = ThemeMetric | "gap" | "rvol" | "float";
export const TICKER_COLUMNS: readonly TickerColumn[] = [...THEME_METRICS, "gap", "rvol", "float"];
export type BoardColumn = TickerColumn;

export const columnsOf = (kind: BoardKind): readonly BoardColumn[] => (kind === "tickers" ? TICKER_COLUMNS : THEME_METRICS);

/** Valid columns of the board kind in canonical order; none → all. */
export function normalizeColumns(kind: BoardKind, raw: unknown): BoardColumn[] {
  const list = Array.isArray(raw) ? raw : [];
  const cols = columnsOf(kind).filter((c) => list.includes(c));
  return cols.length ? cols : [...columnsOf(kind)];
}

export const normalizeBoardSort = (kind: BoardKind, raw: unknown): ColumnSort<BoardColumn> | null => normalizeSort(raw, columnsOf(kind));

/** Swap the board with its left / right neighbour; returns every board's new position (0…n−1). */
export function movePositions<T extends { id: number; position: number }>(boards: readonly T[], id: number, dir: "left" | "right"): { id: number; position: number }[] {
  const order = [...boards].sort((a, b) => a.position - b.position || a.id - b.id).map((b) => b.id);
  const i = order.indexOf(id);
  const j = dir === "left" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < order.length) [order[i], order[j]] = [order[j]!, order[i]!];
  return order.map((bid, position) => ({ id: bid, position }));
}

/** The source of a tickers board. */
export type BoardSource = { kind: "tickers"; tickers: string[] } | { kind: "screener"; screener: ScreenerSpec; top: BoardTop };

/** The tickers a tickers board shows: its list, or the first `top` of the resolved screener. */
export function boardTickers(source: BoardSource | null, resolved: readonly string[]): string[] {
  if (!source) return [];
  return source.kind === "tickers" ? source.tickers.slice(0, MAX_BOARD_TICKERS) : resolved.slice(0, source.top);
}

/** One row of a tickers board (percent units; float in shares; null = unknown). */
export type TickerRow = {
  ticker: string;
  price: number | null;
  premarket: number | null;
  fromOpen: number | null;
  today: number | null;
  afterHours: number | null;
  gap: number | null;
  rvol: number | null;
  float: number | null;
};

/**
 * Tickers + cached quotes → rows in the board's ticker order; `missing` = tickers without any quote. Float falls back
 * to the Finviz ticker snapshot (`floats`) when the quote provider did not send it.
 */
export function tickerRows(
  tickers: readonly string[],
  details: ReadonlyMap<string, { quote: MemberQuote; extras: TickerExtras }>,
  floats: ReadonlyMap<string, number> = new Map(),
): { rows: TickerRow[]; missing: string[] } {
  const rows: TickerRow[] = [];
  const missing: string[] = [];
  for (const raw of tickers) {
    const t = raw.toUpperCase();
    const d = details.get(t);
    if (!d || (d.quote.price == null && d.quote.today == null)) {
      missing.push(t);
      continue;
    }
    const q = d.quote;
    rows.push({
      ticker: t, price: q.price, premarket: q.premarket, fromOpen: q.fromOpen, today: q.today, afterHours: q.afterHours,
      gap: d.extras.gap, rvol: d.extras.rvol, float: d.extras.float ?? floats.get(t) ?? null,
    });
  }
  return { rows, missing };
}
