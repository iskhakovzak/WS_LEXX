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
 * The selection helpers are pure (unit-tested with fixtures); `gatherPost` takes injectable readers.
 */
import { pool } from "@workspace/db";
import { nyDate } from "../tradingDate";
import { readEarnings, readScreener } from "../finviz/read";
import type { EarningsRow, ScreenerPreset, ScreenerResponse, ScreenerRow } from "../finviz/types";
import { getThemes } from "../themes/service";
import type { ThemeMetric, ThemeOut, ThemesResponse } from "../themes/logic";
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

/** Rows of a run from `date` with a non-zero gap, one per ticker (yesterday's gappers are not today's). */
function gapRows(runs: readonly ScreenerResponse[], date: string): GapRow[] {
  const seen = new Map<string, GapRow>();
  for (const run of runs) {
    if (!run.asOf || nyDate(new Date(run.asOf)) !== date) continue;
    for (const r of run.rows as readonly ScreenerRow[]) {
      const ticker = r.ticker.toUpperCase();
      if (!finite(r.gapPct) || r.gapPct === 0 || seen.has(ticker)) continue;
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

export const LIVE_NEWS_DEPS: NewsDataDeps = { screener: readScreener, earnings: readEarnings, themes: getThemes, macro: readMacro };

const soft = async <T>(p: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p();
  } catch {
    return fallback; // one missing source drops its section, not the whole post
  }
};

const NO_THEMES: ThemesResponse = { asOf: null, session: "closed", source: null, stale: false, themes: [] };
const NO_RUN = (preset: ScreenerPreset): ScreenerResponse => ({ asOf: null, preset, rows: [] });

export async function gatherPost(post: NewsPost, date: string, deps: NewsDataDeps = LIVE_NEWS_DEPS): Promise<PostData> {
  const board = await soft(deps.themes, NO_THEMES);
  if (post === "open") {
    return { post, date, ...pickThemes(board.themes, "fromOpen"), movers: pickMovers(board.themes, "fromOpen") };
  }
  if (post === "close") {
    return { post, date, ...pickThemes(board.themes, "today"), afterHours: pickMovers(board.themes, "afterHours") };
  }
  const [gappers, relvol, earnings, macro] = await Promise.all([
    soft(() => deps.screener("gappers"), NO_RUN("gappers")),
    soft(() => deps.screener("relvol"), NO_RUN("relvol")),
    soft(() => deps.earnings(date, date), [] as EarningsRow[]),
    soft(() => deps.macro(date), [] as MacroItem[]),
  ]);
  const gaps = pickGaps(gappers, [relvol], date);
  return { post, date, gapUp: gaps.up, gapDown: gaps.down, ...pickThemes(board.themes, "premarket"), earnings: pickEarnings(earnings, date), macro };
}
