/**
 * WS_NEWS channel briefs — the data of each post, from what the API already stores / caches (no new provider calls
 * beyond the shared themes board refresh):
 *
 *   gappers    lib/finviz readScreener: the «gappers» preset's latest run, only when it ran today (NY); gap-downs come
 *              from the negative gaps of the gappers + relvol runs (the default gappers filter is gap-up only)
 *   themes     lib/themes getThemes — the SHARED board only (market_themes), never anyone's personal themes
 *   earnings   lib/finviz readEarnings(today): before the open / after the close, biggest market cap first
 *   macro      holiday_calendar (the /events market calendar): today's FOMC / CPI / PPI / NFP / OPEX / early close…,
 *              names in Russian (lib/calendarText); a missing table or read error ⇒ no macro section
 *
 * Freshness (audit 2026-10-20, plan 0.13): «От открытия» needs the board of the regular session (rth), «Итоги дня»
 * the board of the post-market session (post); `awaitThemes` polls getThemes for up to THEMES_WAIT_MS (a refresh takes
 * ~44 s, getThemes itself waits only 4 s) and `themesProblem` says why a board must not be posted (stale, another
 * session, numbers fetched before the session began) — publish then skips with that reason and the job retries.
 * Premarket: a «gappers» run older than GAPPERS_MAX_AGE_MS triggers one screener refresh (lib/finviz/refresh, with its
 * desk cooldown) and the post waits for it once.
 *
 * The selection helpers are pure (unit-tested with fixtures); `gatherPost` takes injectable readers.
 */
import { pool } from "@workspace/db";
import { nyDate, nyMinutes, REGULAR_CLOSE_MIN } from "../tradingDate";
import { sessionFor } from "../marketDays";
import { readEarnings, readScreener } from "../finviz/read";
import type { EarningsRow, ScreenerPreset, ScreenerResponse, ScreenerRow } from "../finviz/types";
import { getThemes } from "../themes/service";
import { ttlMs, type ThemeMetric, type ThemeOut, type ThemeSession, type ThemesResponse } from "../themes/logic";
import { calendarDescription, calendarName } from "../calendarText";
import type { NewsPost } from "./schedule";

/** The channel's language (the owner: WS_NEWS is Russian). */
export const NEWS_LANG = "ru" as const;
/** Theme leaders / laggards per post. */
export const THEMES_PER_SIDE = 3;

export type GapRow = { ticker: string; gapPct: number; relVolume: number | null; float: number | null };
export type ThemeMove = { name: string; pct: number; top: { ticker: string; pct: number } | null };
export type Mover = { ticker: string; pct: number; theme: string | null };
export type EarningsItem = { ticker: string; marketCap: number | null };
export type MacroItem = { name: string; description: string | null };

export type PremarketData = {
  post: "premarket";
  date: string;
  gapUp: GapRow[];
  gapDown: GapRow[];
  leaders: ThemeMove[];
  laggards: ThemeMove[];
  earnings: { bmo: EarningsItem[]; amc: EarningsItem[] };
  macro: MacroItem[];
};
export type OpenData = { post: "open"; date: string; leaders: ThemeMove[]; laggards: ThemeMove[]; movers: Mover[] };
export type CloseData = { post: "close"; date: string; leaders: ThemeMove[]; laggards: ThemeMove[]; afterHours: Mover[] };
export type PostData = PremarketData | OpenData | CloseData;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ─── pure selection ─────────────────────────────────────────────────────────

/** ETFs / ETNs (leveraged single-stock and country funds flood the gap lists): by name, or a Financial row without a
 *  market cap. Traders want the stocks themselves. */
const FUND_NAME = /\b(ETF|ETN|ETP|Fund)\b|\b\d(\.\d+)?[xX]\b/;
export function isFundRow(r: Pick<ScreenerRow, "company" | "sector"> & { marketCap?: number | null }): boolean {
  return FUND_NAME.test(r.company ?? "") || (r.sector === "Financial" && r.marketCap == null);
}

/** Rows of a run from `date` with a non-zero gap, one per ticker (yesterday's gappers are not today's); funds skipped. */
function gapRows(runs: readonly ScreenerResponse[], date: string): GapRow[] {
  const seen = new Map<string, GapRow>();
  for (const run of runs) {
    if (!run.asOf || nyDate(new Date(run.asOf)) !== date) continue;
    for (const r of run.rows as readonly ScreenerRow[]) {
      const ticker = r.ticker.toUpperCase();
      if (!finite(r.gapPct) || r.gapPct === 0 || seen.has(ticker) || isFundRow(r)) continue;
      seen.set(ticker, { ticker, gapPct: r.gapPct, relVolume: finite(r.relVolume) ? r.relVolume : null, float: finite(r.float) ? r.float : null });
    }
  }
  return [...seen.values()];
}

/** Gap-ups of the «gappers» run (desc) and gap-downs of it + the other runs (asc). */
export function pickGaps(gappers: ScreenerResponse, others: readonly ScreenerResponse[], date: string): { up: GapRow[]; down: GapRow[] } {
  const byTicker = (a: GapRow, b: GapRow) => a.ticker.localeCompare(b.ticker);
  return {
    up: gapRows([gappers], date).filter((g) => g.gapPct > 0).sort((a, b) => b.gapPct - a.gapPct || byTicker(a, b)),
    down: gapRows([gappers, ...others], date).filter((g) => g.gapPct < 0).sort((a, b) => a.gapPct - b.gapPct || byTicker(a, b)),
  };
}

/** Theme leaders (best first) and laggards (worst first) by `metric`; with fewer than 2k themes they split, never overlap. */
export function pickThemes(themes: readonly ThemeOut[], metric: ThemeMetric, k = THEMES_PER_SIDE): { leaders: ThemeMove[]; laggards: ThemeMove[] } {
  const rows = themes
    .filter((t) => finite(t[metric]))
    .map((t) => ({ t, pct: t[metric] as number }))
    .sort((a, b) => b.pct - a.pct || a.t.name.localeCompare(b.t.name));
  const nLead = Math.min(k, Math.ceil(rows.length / 2));
  const nLag = Math.min(k, rows.length - nLead);
  const member = (t: ThemeOut, best: boolean) => {
    const ms = t.members.filter((m) => finite(m[metric]));
    if (!ms.length) return null;
    const pick = ms.reduce((x, y) => ((best ? (y[metric] as number) > (x[metric] as number) : (y[metric] as number) < (x[metric] as number)) ? y : x));
    return { ticker: pick.ticker, pct: pick[metric] as number };
  };
  return {
    leaders: rows.slice(0, nLead).map(({ t, pct }) => ({ name: t.name, pct, top: member(t, true) })),
    laggards: rows.slice(rows.length - nLag).reverse().map(({ t, pct }) => ({ name: t.name, pct, top: member(t, false) })),
  };
}

/** Theme members by the size of their `metric` move (|x| desc), one row per ticker (its first theme). */
export function pickMovers(themes: readonly ThemeOut[], metric: ThemeMetric): Mover[] {
  const seen = new Map<string, Mover>();
  for (const t of themes) {
    for (const m of t.members) {
      const v = m[metric];
      if (!finite(v) || v === 0 || seen.has(m.ticker)) continue;
      seen.set(m.ticker, { ticker: m.ticker, pct: v, theme: t.name });
    }
  }
  return [...seen.values()].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || a.ticker.localeCompare(b.ticker));
}

/** Today's reports split by timing (time not announced is left out), biggest market cap first. */
export function pickEarnings(rows: readonly EarningsRow[], date: string): { bmo: EarningsItem[]; amc: EarningsItem[] } {
  const of = (timing: "bmo" | "amc") =>
    rows
      .filter((r) => r.date === date && r.timing === timing)
      .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1) || a.ticker.localeCompare(b.ticker))
      .map((r) => ({ ticker: r.ticker.toUpperCase(), marketCap: r.marketCap }));
  return { bmo: of("bmo"), amc: of("amc") };
}

// ─── readers ────────────────────────────────────────────────────────────────

export type NewsDataDeps = {
  screener: (preset: ScreenerPreset) => Promise<ScreenerResponse>;
  earnings: (from: string, to: string) => Promise<EarningsRow[]>;
  themes: () => Promise<ThemesResponse>;
  macro: (date: string) => Promise<MacroItem[]>;
  /** Start one screener refresh and wait for it (true: it ran, re-read the runs). Absent ⇒ never refreshed. */
  refreshScreener?: () => Promise<boolean>;
  /** Clock / sleep of the freshness waits (tests inject a fake clock). */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const IMPORTANCE_ORDER = `CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END`;

/** Today's market-calendar rows except plain closed days (a closed day has no brief anyway). */
export async function readMacro(date: string): Promise<MacroItem[]> {
  try {
    const { rows } = await pool.query<{ name: string; description: string | null }>(
      `SELECT name, description FROM holiday_calendar
        WHERE date::text = $1 AND NOT (type = 'holiday' AND description ILIKE 'market closed%')
        ORDER BY ${IMPORTANCE_ORDER}, name LIMIT 10`,
      [date],
    );
    return rows.map((r) => ({ name: calendarName(r.name, NEWS_LANG) ?? r.name, description: calendarDescription(r.description, NEWS_LANG) }));
  } catch {
    return []; // no calendar ⇒ no macro section
  }
}

/** One screener refresh unless Finviz is off or a refresh started within the desk cooldown (then nothing is waited). */
async function refreshScreenerOnce(): Promise<boolean> {
  const { finvizEnabled } = await import("../finviz/presets");
  if (!finvizEnabled()) return false;
  const { refreshWait, runRefresh, startRefresh } = await import("../finviz/refresh");
  if (refreshWait("screener") > 0) return false;
  startRefresh("screener", null);
  await runRefresh("screener");
  return true;
}

export const LIVE_NEWS_DEPS: NewsDataDeps = {
  screener: readScreener, earnings: readEarnings, themes: getThemes, macro: readMacro, refreshScreener: refreshScreenerOnce,
};

const soft = async <T>(p: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p();
  } catch {
    return fallback; // one missing source drops its section, not the whole post
  }
};

const NO_THEMES: ThemesResponse = { asOf: null, session: "closed", source: null, stale: false, themes: [] };
const NO_RUN = (preset: ScreenerPreset): ScreenerResponse => ({ asOf: null, preset, rows: [] });

const realSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

// ─── freshness ──────────────────────────────────────────────────────────────

/** The session whose board each themes post describes. */
export const POST_THEME_SESSION = { open: "rth", close: "post" } as const satisfies Record<"open" | "close", ThemeSession>;
export type ThemesPost = keyof typeof POST_THEME_SESSION;
export const isThemesPost = (post: NewsPost): post is ThemesPost => post in POST_THEME_SESSION;
/** NY minute each session begins on a day closing at `closeMin` (post-market starts at the close: 13:00 on an early
 *  close); numbers stamped before start + SESSION_SETTLE_MIN may come from a refresh that started in the previous
 *  session (getThemes stamps a refresh when it ends). */
const sessionStartMin = (s: ThemeSession, closeMin: number): number => ({ pre: 4 * 60, rth: 9 * 60 + 30, post: closeMin, closed: 0 })[s];
export const SESSION_SETTLE_MIN = 2;
export const THEMES_WAIT_MS = 60_000;
export const THEMES_POLL_MS = 5_000;
/** A «gappers» run older than this before the premarket post triggers one screener refresh. */
export const GAPPERS_MAX_AGE_MS = 20 * 60_000;

/** Why `board` must not feed `post` at `now` (null: fresh numbers of the right session) on a day closing at `closeMin`. */
export function themesProblem(post: ThemesPost, board: ThemesResponse, now: number, closeMin: number = REGULAR_CLOSE_MIN): string | null {
  const want = POST_THEME_SESSION[post];
  if (board.session !== want) return `session mismatch: ${board.session}, need ${want}`;
  const asOf = board.asOf ? Date.parse(board.asOf) : NaN;
  if (!Number.isFinite(asOf)) return "no themes data yet";
  if (board.stale) return "stale: the themes refresh failed or is still running";
  const at = new Date(asOf);
  if (nyDate(at) !== nyDate(new Date(now)) || nyMinutes(at) < sessionStartMin(want, closeMin) + SESSION_SETTLE_MIN) {
    return `session mismatch: numbers from before the ${want} session`;
  }
  if (now - asOf > 2 * ttlMs(want)) return "stale: themes older than 2 × TTL";
  return null;
}

/**
 * The shared board for `post`, polled until fresh or `waitMs` ran out (aborted ⇒ stops). `problem` null = fresh.
 * Each getThemes call joins the single-flight refresh, so polling never starts a second one.
 */
export async function awaitThemes(
  post: ThemesPost,
  deps: NewsDataDeps,
  o: { waitMs?: number; pollMs?: number; signal?: AbortSignal; closeMin?: number } = {},
): Promise<{ board: ThemesResponse; problem: string | null; waitedMs: number }> {
  const now = deps.now ?? Date.now;
  const closeMin = o.closeMin ?? (await soft(async () => (await sessionFor(nyDate(new Date(now())))).closeMin, REGULAR_CLOSE_MIN));
  const sleep = deps.sleep ?? realSleep;
  const waitMs = o.waitMs ?? THEMES_WAIT_MS;
  const pollMs = o.pollMs ?? THEMES_POLL_MS;
  const maxPolls = Math.ceil(waitMs / pollMs) + 1; // a clock that does not move never spins forever
  const t0 = now();
  for (let i = 1; ; i++) {
    const board = await soft(deps.themes, NO_THEMES);
    const problem = themesProblem(post, board, now(), closeMin);
    const waitedMs = now() - t0;
    if (!problem || waitedMs >= waitMs || i >= maxPolls || o.signal?.aborted) return { board, problem, waitedMs };
    await sleep(Math.min(pollMs, waitMs - waitedMs), o.signal);
  }
}

/** No run, or a run older than GAPPERS_MAX_AGE_MS at `now`. */
export function runIsOld(run: ScreenerResponse, now: number): boolean {
  const t = run.asOf ? Date.parse(run.asOf) : NaN;
  return !Number.isFinite(t) || now - t > GAPPERS_MAX_AGE_MS;
}

/** `board`: a board the caller already checked (awaitThemes); otherwise the current one is read once. */
export async function gatherPost(post: NewsPost, date: string, deps: NewsDataDeps = LIVE_NEWS_DEPS, board?: ThemesResponse): Promise<PostData> {
  const themes = board ?? (await soft(deps.themes, NO_THEMES));
  if (post === "open") {
    return { post, date, ...pickThemes(themes.themes, "fromOpen"), movers: pickMovers(themes.themes, "fromOpen") };
  }
  if (post === "close") {
    return { post, date, ...pickThemes(themes.themes, "today"), afterHours: pickMovers(themes.themes, "afterHours") };
  }
  let gappers = await soft(() => deps.screener("gappers"), NO_RUN("gappers"));
  if (deps.refreshScreener && runIsOld(gappers, (deps.now ?? Date.now)())) {
    // Once: a refresh that did not help leaves the older run (or none); the post goes out with what there is.
    if (await soft(deps.refreshScreener, false)) gappers = await soft(() => deps.screener("gappers"), gappers);
  }
  const [relvol, earnings, macro] = await Promise.all([
    soft(() => deps.screener("relvol"), NO_RUN("relvol")),
    soft(() => deps.earnings(date, date), [] as EarningsRow[]),
    soft(() => deps.macro(date), [] as MacroItem[]),
  ]);
  const gaps = pickGaps(gappers, [relvol], date);
  return { post, date, gapUp: gaps.up, gapDown: gaps.down, ...pickThemes(themes.themes, "premarket"), earnings: pickEarnings(earnings, date), macro };
}
