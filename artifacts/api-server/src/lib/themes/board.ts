/**
 * GET /api/themes for one viewer: the shared base board (service.getThemes, unchanged and as fast as before) plus the
 * viewer's own themes («Мои темы») and his view (visible columns, hidden base themes).
 *
 *   personal quotes  tickerCache.quotesFor — only the viewer's tickers that are missing / stale there (base tickers are
 *                    seeded by the base refresh), never a wider base refresh
 *   screener themes  the stored top tickers; when older than an hour (or never resolved) and Finviz is on, ≤ 2 per
 *                    request are re-resolved (the request waits ≤ SOFT_WAIT_MS, the rest finish in the background)
 * Guests (no users row) get the base board, the default view and no personal themes.
 */
import { nyDate } from "../tradingDate";
import { logger } from "../logger";
import { aggregateTheme, type MemberQuote, type ThemeSession, type ThemesResponse } from "./logic";
import { DEFAULT_VIEW, resolveStale, type PersonalThemeOut, type ThemesView } from "./personal";
import { listPersonal, readView, saveResolved, type PersonalRecord } from "./personalStore";
import { resolveScreener, screenerEnabled } from "./screener";
import { SOFT_WAIT_MS, getThemes } from "./service";
import { quotesFor } from "./tickerCache";

export const MAX_RESOLVE_PER_REQUEST = 2;

export type BoardResponse = ThemesResponse & {
  personal: PersonalThemeOut[];
  view: ThemesView;
  /** Finviz is on (screener themes can be created / refreshed). */
  finviz: boolean;
};

export type BoardDeps = {
  now: () => number;
  base: () => Promise<ThemesResponse>;
  listPersonal: (userId: number) => Promise<PersonalRecord[]>;
  readView: (userId: number) => Promise<ThemesView>;
  saveResolved: (id: number, tickers: string[], at: number) => Promise<void>;
  quotesFor: (tickers: readonly string[], session: ThemeSession, today: string) => Promise<Map<string, MemberQuote>>;
};

const LIVE: BoardDeps = { now: () => Date.now(), base: getThemes, listPersonal, readView, saveResolved, quotesFor: (t, s, d) => quotesFor(t, s, d) };
let deps: BoardDeps = LIVE;

export function setBoardDeps(d: Partial<BoardDeps>): () => void {
  deps = { ...LIVE, ...d };
  return () => {
    deps = LIVE;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

export const tickersOf = (r: PersonalRecord): string[] => (r.kind === "tickers" ? r.tickers : r.resolvedTickers);

/** Re-resolve a screener theme now (create / edit, or a stale one); stores the result on the row. */
export async function refreshScreener(r: PersonalRecord): Promise<PersonalRecord> {
  if (r.kind !== "screener" || !r.screener) return r;
  const res = await resolveScreener(r.screener);
  if (!res) return r;
  r.resolvedTickers = res.tickers;
  r.resolvedAt = res.at;
  await deps.saveResolved(r.id, res.tickers, res.at).catch((err) => logger.warn({ err, id: r.id }, "themes: save resolved failed"));
  return r;
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
  if (userId == null) return { ...base, personal: [], view: DEFAULT_VIEW, finviz };
  const [rows, view] = await Promise.all([deps.listPersonal(userId), deps.readView(userId)]);
  const now = deps.now();
  if (finviz) {
    const stale = rows.filter((r) => r.kind === "screener" && resolveStale(r.resolvedAt, now)).slice(0, MAX_RESOLVE_PER_REQUEST);
    if (stale.length) await Promise.race([Promise.all(stale.map(refreshScreener)), sleep(SOFT_WAIT_MS)]);
  }
  const tickers = [...new Set(rows.flatMap(tickersOf))];
  const quotes = tickers.length ? await deps.quotesFor(tickers, base.session, nyDate(new Date(now))) : new Map<string, MemberQuote>();
  return { ...base, personal: rows.map((r) => personalOut(r, quotes, finviz)), view, finviz };
}
