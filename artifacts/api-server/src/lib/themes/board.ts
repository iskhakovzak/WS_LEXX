/**
 * What /themes reads for one viewer.
 *
 *   GET /api/themes             getBoard: the shared board (service.getThemes, unchanged and as fast as before), the
 *                               viewer's view (columns, hidden themes, sort, last tab) and his boards (tabs, no data)
 *   GET /api/themes/boards/:id  getBoardData: one personal board's rows
 *     themes board   pinned shared themes (from the shared board) + the user's own themes on it
 *     tickers board  one row per ticker (moves + gap / RVOL / float)
 *
 *   quotes      tickerCache — only tickers missing / stale there (shared tickers are seeded by the shared refresh);
 *               never a wider shared refresh
 *   screeners   the stored resolved tickers; when older than an hour (or never resolved) and Finviz is on, ≤ 2 per
 *               request are re-resolved (the request waits ≤ SOFT_WAIT_MS, the rest finish in the background)
 * Guests (no users row) get the shared board, the default view and no boards. `newsChannel` reads service.getThemes.
 */
import { logger } from "../logger";
import { aggregateTheme, type MemberQuote, type ThemeOut, type ThemeSession, type ThemesResponse } from "./logic";
import { DEFAULT_VIEW, SCREENER_TOP, resolveStale, type PersonalThemeOut, type ThemesView } from "./personal";
import { listPersonalOnBoard, readView, saveResolved, type PersonalRecord } from "./personalStore";
import { boardTickers, tickerRows, type BoardColumn, type BoardKind, type BoardSource, type TickerRow } from "./boards";
import { boardById, floatsFor, listBoards, saveBoardResolved, type BoardRecord } from "./boardsStore";
import { resolveScreener, screenerEnabled } from "./screener";
import { SOFT_WAIT_MS, getThemes, sessionNow } from "./service";
import { detailsFor, quotesFor, type TickerDetail } from "./tickerCache";
import type { ColumnSort } from "./personal";

export const MAX_RESOLVE_PER_REQUEST = 2;

/** A board as the tab strip and the board editor see it. */
export type BoardMeta = {
  id: number;
  name: string;
  kind: BoardKind;
  position: number;
  columns: BoardColumn[];
  sort: ColumnSort<BoardColumn> | null;
  pinned: number[];
  source: BoardSource | null;
  resolvedAt: string | null;
};

export const boardMeta = (b: BoardRecord): BoardMeta => ({
  id: b.id, name: b.name, kind: b.kind, position: b.position, columns: b.columns, sort: b.sort, pinned: b.pinned, source: b.source,
  resolvedAt: b.resolvedAt != null ? new Date(b.resolvedAt).toISOString() : null,
});

export type BoardResponse = ThemesResponse & {
  view: ThemesView;
  boards: BoardMeta[];
  /** Finviz is on (screener themes / boards resolve). */
  finviz: boolean;
};

type Common = { board: BoardMeta; session: ThemeSession; finviz: boolean };
export type BoardDataResponse =
  | (Common & { kind: "themes"; asOf: string | null; stale: boolean; themes: ThemeOut[]; personal: PersonalThemeOut[] })
  | (Common & { kind: "tickers"; rows: TickerRow[]; missing: string[]; needsFinviz: boolean; resolvedAt: string | null });

export type BoardDeps = {
  base: () => Promise<ThemesResponse>;
  session: () => Promise<{ session: ThemeSession; today: string; now: number }>;
  listBoards: (userId: number) => Promise<BoardRecord[]>;
  boardById: (userId: number, id: number) => Promise<BoardRecord | null>;
  listPersonalOnBoard: (userId: number, boardId: number) => Promise<PersonalRecord[]>;
  readView: (userId: number) => Promise<ThemesView>;
  saveResolved: (id: number, tickers: string[], at: number) => Promise<void>;
  saveBoardResolved: (id: number, tickers: string[], at: number) => Promise<void>;
  quotesFor: (tickers: readonly string[], session: ThemeSession, today: string) => Promise<Map<string, MemberQuote>>;
  detailsFor: (tickers: readonly string[], session: ThemeSession, today: string) => Promise<Map<string, TickerDetail>>;
  floatsFor: (tickers: readonly string[]) => Promise<Map<string, number>>;
};

const LIVE: BoardDeps = {
  base: getThemes, session: sessionNow, listBoards, boardById, listPersonalOnBoard, readView, saveResolved, saveBoardResolved,
  quotesFor: (t, s, d) => quotesFor(t, s, d), detailsFor: (t, s, d) => detailsFor(t, s, d), floatsFor,
};
let deps: BoardDeps = LIVE;

export function setBoardDeps(d: Partial<BoardDeps>): () => void {
  deps = { ...LIVE, ...d };
  return () => {
    deps = LIVE;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());
const softly = async (jobs: Promise<unknown>[]) => {
  if (jobs.length) await Promise.race([Promise.all(jobs), sleep(SOFT_WAIT_MS)]);
};

export const tickersOf = (r: PersonalRecord): string[] => (r.kind === "tickers" ? r.tickers : r.resolvedTickers);

/** Re-resolve a personal screener theme now (create / edit, or a stale one); stores the top 25 on the row. */
export async function refreshScreener(r: PersonalRecord): Promise<PersonalRecord> {
  if (r.kind !== "screener" || !r.screener) return r;
  const res = await resolveScreener(r.screener);
  if (!res) return r;
  r.resolvedTickers = res.tickers.slice(0, SCREENER_TOP);
  r.resolvedAt = res.at;
  await deps.saveResolved(r.id, r.resolvedTickers, res.at).catch((err) => logger.warn({ err, id: r.id }, "themes: save resolved failed"));
  return r;
}

/** Re-resolve a screener tickers board (top 50 kept; the board shows its 25 / 50). */
export async function refreshBoardScreener(b: BoardRecord): Promise<BoardRecord> {
  if (b.source?.kind !== "screener") return b;
  const res = await resolveScreener(b.source.screener);
  if (!res) return b;
  b.resolvedTickers = res.tickers;
  b.resolvedAt = res.at;
  await deps.saveBoardResolved(b.id, res.tickers, res.at).catch((err) => logger.warn({ err, id: b.id }, "themes: save board resolved failed"));
  return b;
}

export function personalOut(r: PersonalRecord, quotes: ReadonlyMap<string, MemberQuote>, finviz: boolean): PersonalThemeOut {
  const tickers = tickersOf(r);
  return {
    ...aggregateTheme({ id: r.id, name: r.name, tickers }, quotes),
    kind: r.kind,
    tickers,
    screener: r.screener,
    needsFinviz: r.kind === "screener" && !finviz,
    resolvedAt: r.resolvedAt != null ? new Date(r.resolvedAt).toISOString() : null,
  };
}

export async function getBoard(userId: number | null): Promise<BoardResponse> {
  const base = await deps.base();
  const finviz = screenerEnabled();
  if (userId == null) return { ...base, view: DEFAULT_VIEW, boards: [], finviz };
  const [view, boards] = await Promise.all([deps.readView(userId), deps.listBoards(userId)]);
  const tab = typeof view.tab === "number" && !boards.some((b) => b.id === view.tab) ? "shared" : view.tab;
  return { ...base, view: { ...view, tab }, boards: boards.map(boardMeta), finviz };
}

async function themesBoard(userId: number, board: BoardRecord, finviz: boolean): Promise<BoardDataResponse> {
  const [base, rows, s] = await Promise.all([deps.base(), deps.listPersonalOnBoard(userId, board.id), deps.session()]);
  if (finviz) await softly(rows.filter((r) => r.kind === "screener" && resolveStale(r.resolvedAt, s.now)).slice(0, MAX_RESOLVE_PER_REQUEST).map(refreshScreener));
  const byId = new Map(base.themes.map((t) => [t.id, t]));
  const pinned = board.pinned.map((id) => byId.get(id)).filter((t): t is ThemeOut => !!t);
  const tickers = [...new Set(rows.flatMap(tickersOf))];
  const quotes = tickers.length ? await deps.quotesFor(tickers, s.session, s.today) : new Map<string, MemberQuote>();
  return {
    kind: "themes", board: boardMeta(board), session: s.session, finviz, asOf: base.asOf, stale: base.stale,
    themes: pinned, personal: rows.map((r) => personalOut(r, quotes, finviz)),
  };
}

async function tickersBoard(board: BoardRecord, finviz: boolean): Promise<BoardDataResponse> {
  const s = await deps.session();
  if (finviz && board.source?.kind === "screener" && resolveStale(board.resolvedAt, s.now)) await softly([refreshBoardScreener(board)]);
  const tickers = boardTickers(board.source, board.resolvedTickers);
  const details = tickers.length ? await deps.detailsFor(tickers, s.session, s.today) : new Map<string, TickerDetail>();
  const noFloat = tickers.filter((t) => details.get(t)?.extras.float == null);
  const { rows, missing } = tickerRows(tickers, details, await deps.floatsFor(noFloat));
  return {
    kind: "tickers", board: boardMeta(board), session: s.session, finviz, rows, missing,
    needsFinviz: board.source?.kind === "screener" && !finviz,
    resolvedAt: board.resolvedAt != null ? new Date(board.resolvedAt).toISOString() : null,
  };
}

/** One personal board's rows (null: not this user's, or archived). */
export async function getBoardData(userId: number, boardId: number): Promise<BoardDataResponse | null> {
  const board = await deps.boardById(userId, boardId);
  if (!board || !board.active) return null;
  const finviz = screenerEnabled();
  return board.kind === "themes" ? themesBoard(userId, board, finviz) : tickersBoard(board, finviz);
}
