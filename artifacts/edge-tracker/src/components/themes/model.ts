/**
 * «Темы рынка» — the API shapes (api-server lib/themes/logic.ts) and the pure view logic of the heat-table (unit-tested
 * in model.test.ts): the default sort column per session, the header click cycle, sorting (unknown always last), the
 * two halves on wide screens, cell intensity, leaders / laggards, polling, staff ticker input.
 * Percentages are percent units (1.25 = 1.25 %); null = unknown.
 */

export type ThemeSession = "pre" | "rth" | "post" | "closed";
export type ThemeSource = "finviz" | "yahoo";

/**
 * Reference point of a move: premarket (last premarket print vs previous close, frozen after the open), from today's
 * open, for the day (vs previous close), after hours (vs today's regular close).
 */
export type ThemeMetric = "premarket" | "fromOpen" | "today" | "afterHours";
export const METRICS: readonly ThemeMetric[] = ["premarket", "fromOpen", "today", "afterHours"];

export type MemberQuote = {
  ticker: string;
  price: number | null;
  today: number | null;
  fromOpen: number | null;
  premarket: number | null;
  afterHours: number | null;
};

export type ThemeOut = {
  id: number;
  name: string;
  today: number | null;
  fromOpen: number | null;
  premarket: number | null;
  afterHours: number | null;
  members: MemberQuote[];
  missing: string[];
};

/** GET /api/themes */
export type ThemesResponse = {
  asOf: string | null;
  session: ThemeSession;
  source: ThemeSource | null;
  stale: boolean;
  themes: ThemeOut[];
};

/** GET /api/themes/config (staff), POST / PUT answers. */
export type ThemeRecord = {
  id: number;
  name: string;
  tickers: string[];
  sortOrder: number;
  active: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

export const POLL_MS = 30_000;

/** Auto-refresh only while something can move (pre / rth / post); a closed market is not polled. */
export function pollInterval(session: ThemeSession | null | undefined): number | false {
  return session === "pre" || session === "rth" || session === "post" ? POLL_MS : false;
}

export const isLiveSession = (s: ThemeSession | null | undefined): boolean => pollInterval(s) !== false;

const val = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function isMetric(v: unknown): v is ThemeMetric {
  return typeof v === "string" && (METRICS as readonly string[]).includes(v);
}

/** Some theme has a value for the metric right now (else its header is dimmed with «appears at …»). */
export function hasValues(themes: readonly ThemeOut[], metric: ThemeMetric): boolean {
  return themes.some((t) => val(t[metric]) != null);
}

// ─── sorting ────────────────────────────────────────────────────────────────

export type SortDir = "desc" | "asc";
export type ThemeSort = { col: ThemeMetric; dir: SortDir };

export function isSort(v: unknown): v is ThemeSort {
  const s = v as ThemeSort | null;
  return !!s && typeof s === "object" && isMetric(s.col) && (s.dir === "desc" || s.dir === "asc");
}

/** The column that matters most in each session. */
export const SESSION_COLUMN: Readonly<Record<ThemeSession, ThemeMetric>> = {
  pre: "premarket",
  rth: "fromOpen",
  post: "afterHours",
  closed: "today",
};

/** Default sort column: the session's one when it has values now, else the first that has (today, fromOpen, …). */
export function defaultColumn(session: ThemeSession, themes: readonly ThemeOut[]): ThemeMetric {
  const order: ThemeMetric[] = [SESSION_COLUMN[session], "today", "fromOpen", "premarket", "afterHours"];
  return order.find((m) => hasValues(themes, m)) ?? "today";
}

/** The user's stored sort when they picked one, else the session default (desc). */
export function effectiveSort(stored: unknown, session: ThemeSession, themes: readonly ThemeOut[]): ThemeSort {
  return isSort(stored) ? stored : { col: defaultColumn(session, themes), dir: "desc" };
}

/** Header click: another column → it, desc; same column desc → asc; asc → null (back to the default). */
export function nextSort(current: ThemeSort, col: ThemeMetric): ThemeSort | null {
  if (current.col !== col) return { col, dir: "desc" };
  return current.dir === "desc" ? { col, dir: "asc" } : null;
}

function byValue<T>(rows: readonly T[], get: (r: T) => number | null, label: (r: T) => string, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const x = val(get(a));
    const y = val(get(b));
    if (x == null && y == null) return label(a).localeCompare(label(b));
    if (x == null) return 1; // unknown last in both directions
    if (y == null) return -1;
    return (dir === "desc" ? y - x : x - y) || label(a).localeCompare(label(b));
  });
}

export function sortThemes(themes: readonly ThemeOut[], sort: ThemeSort): ThemeOut[] {
  return byValue(themes, (t) => t[sort.col], (t) => t.name, sort.dir);
}

export function sortMembers(members: readonly MemberQuote[], sort: ThemeSort): MemberQuote[] {
  return byValue(members, (m) => m[sort.col], (m) => m.ticker, sort.dir);
}

/** Wide screens: ranks 1…⌈n/2⌉ left, the rest right. */
export function splitHalves<T>(rows: readonly T[]): [T[], T[]] {
  const mid = Math.ceil(rows.length / 2);
  return [rows.slice(0, mid), rows.slice(mid)];
}

// ─── cells ──────────────────────────────────────────────────────────────────

/** Largest |value| of a column (0 without values): the scale of its cell tint. */
export function columnMax(rows: readonly Pick<ThemeOut, ThemeMetric>[], col: ThemeMetric): number {
  let max = 0;
  for (const r of rows) {
    const v = val(r[col]);
    if (v != null) max = Math.max(max, Math.abs(v));
  }
  return max;
}

/** Tint strength of a cell, 0…1 = |value| / column max (0 for unknown / zero / no scale). */
export function cellIntensity(value: number | null | undefined, max: number): number {
  const v = val(value);
  if (v == null || v === 0 || !(max > 0)) return 0;
  return Math.min(1, Math.abs(v) / max);
}

/** The phone shows two values: the active column and «За день» (for «За день» itself: «От открытия»). */
export function phoneColumns(col: ThemeMetric): [ThemeMetric, ThemeMetric] {
  return col === "today" ? ["today", "fromOpen"] : [col, "today"];
}

/** Header strip: the 3 best and the 3 worst themes of a column (worst first), never the same theme twice. */
export function leadersLaggards(themes: readonly ThemeOut[], col: ThemeMetric, n = 3): { leaders: ThemeOut[]; laggards: ThemeOut[] } {
  const ranked = sortThemes(themes, { col, dir: "desc" }).filter((t) => val(t[col]) != null);
  const leaders = ranked.slice(0, n).filter((t) => (t[col] as number) > 0);
  const taken = new Set(leaders.map((t) => t.id));
  const laggards = ranked.slice(-n).reverse().filter((t) => !taken.has(t.id) && (t[col] as number) < 0);
  return { leaders, laggards };
}

/** Seconds since `asOf` (null without one); never negative. */
export function ageSeconds(asOf: string | null | undefined, now: number): number | null {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

export const MAX_TICKERS = 30;
const TICKER_RE = /^[A-Z.\-]{1,10}$/;

/** Staff input "mu, $wdc  stx" → { tickers: ["MU", "WDC", "STX"], invalid: [] } (server rule: 1–30 of A–Z . -). */
export function parseTickers(text: string): { tickers: string[]; invalid: string[] } {
  const tickers: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.trim().toUpperCase().replace(/^\$/, "");
    if (!t) continue;
    if (!TICKER_RE.test(t)) {
      if (!invalid.includes(t)) invalid.push(t);
    } else if (!tickers.includes(t)) tickers.push(t);
  }
  return { tickers, invalid };
}
