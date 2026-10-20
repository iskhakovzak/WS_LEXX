/**
 * «Темы рынка» — the API shapes (api-server lib/themes/logic.ts) and the pure view logic of the heat-table (unit-tested
 * in model.test.ts): the default sort column per session (visible columns only), the header click cycle, sorting
 * (unknown always last), the two halves on wide screens, cell intensity, leaders / laggards, the per-user view
 * (visible columns, hidden base themes), merging «Мои темы» into the board, Finviz screener input, polling, ticker input.
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

/** Visible columns (≥ 1, table order) and base themes this user hid — users.settings.themesView on the server. */
export type ThemesView = { columns: ThemeMetric[]; hidden: number[] };
export type ScreenerSpec = { filters: string[]; order: string | null };

/** «Мои темы»: only the owner gets them. */
export type PersonalThemeOut = ThemeOut & {
  kind: "tickers" | "screener";
  tickers: string[];
  screener: ScreenerSpec | null;
  needsFinviz: boolean;
  resolvedAt: string | null;
};

/** GET /api/themes */
export type ThemesResponse = {
  asOf: string | null;
  session: ThemeSession;
  source: ThemeSource | null;
  stale: boolean;
  themes: ThemeOut[];
  personal: PersonalThemeOut[];
  view: ThemesView;
  /** Finviz is on: screener themes resolve. */
  finviz: boolean;
};

/** A table row: a base theme (`b<id>`) or one of the user's (`p<id>`, `mine` set). */
export type BoardTheme = ThemeOut & { key: string; mine: Omit<PersonalThemeOut, keyof ThemeOut> | null };

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

/**
 * Default sort column among the visible ones: the session's one when it has values now, else the first visible that
 * has (today, fromOpen, …), else «За день» (or the first visible).
 */
export function defaultColumn(session: ThemeSession, themes: readonly ThemeOut[], visible: readonly ThemeMetric[] = METRICS): ThemeMetric {
  const cols = visible.length ? visible : METRICS;
  const order: ThemeMetric[] = [SESSION_COLUMN[session], "today", "fromOpen", "premarket", "afterHours"];
  return order.find((m) => cols.includes(m) && hasValues(themes, m)) ?? (cols.includes("today") ? "today" : cols[0]!);
}

/** The user's stored sort when they picked one and its column is visible, else the session default (desc). */
export function effectiveSort(stored: unknown, session: ThemeSession, themes: readonly ThemeOut[], visible: readonly ThemeMetric[] = METRICS): ThemeSort {
  if (isSort(stored) && visible.includes(stored.col)) return stored;
  return { col: defaultColumn(session, themes, visible), dir: "desc" };
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

export function sortThemes<T extends ThemeOut>(themes: readonly T[], sort: ThemeSort): T[] {
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

/**
 * The phone shows ≤ 2 of the visible columns: the active one and «За день» (for «За день» itself: «От открытия», or
 * the next visible one); in table order.
 */
export function phoneColumns(col: ThemeMetric, visible: readonly ThemeMetric[] = METRICS): ThemeMetric[] {
  const others = visible.filter((c) => c !== col);
  const second = col === "today" ? (others.includes("fromOpen") ? "fromOpen" : others[0]) : others.includes("today") ? "today" : others[0];
  const set = new Set<ThemeMetric>([col, ...(second ? [second] : [])]);
  return METRICS.filter((c) => set.has(c));
}

// ─── the user's view and themes ─────────────────────────────────────────────

export const DEFAULT_VIEW: ThemesView = { columns: [...METRICS], hidden: [] };
export const MAX_PERSONAL = 10;

/** Visible columns in table order (never empty). */
export function visibleColumns(view: ThemesView | null | undefined): ThemeMetric[] {
  const cols = METRICS.filter((m) => view?.columns?.includes(m));
  return cols.length ? cols : [...METRICS];
}

/** Checkbox click: show / hide a column; the last visible one stays. */
export function toggleColumn(view: ThemesView, col: ThemeMetric): ThemesView {
  const cols = visibleColumns(view);
  const next = cols.includes(col) ? cols.filter((c) => c !== col) : METRICS.filter((m) => m === col || cols.includes(m));
  return next.length ? { ...view, columns: next } : view;
}

export function setHidden(view: ThemesView, id: number, hidden: boolean): ThemesView {
  const rest = view.hidden.filter((x) => x !== id);
  return { ...view, hidden: hidden ? [...rest, id] : rest };
}

/** Table rows: the base themes the user did not hide, then his own (marked), each with a unique key. */
export function mergeBoard(data: Pick<ThemesResponse, "themes" | "personal" | "view">): BoardTheme[] {
  const hidden = new Set(data.view?.hidden ?? []);
  const base: BoardTheme[] = data.themes.filter((t) => !hidden.has(t.id)).map((t) => ({ ...t, key: `b${t.id}`, mine: null }));
  const mine: BoardTheme[] = (data.personal ?? []).map(({ kind, tickers, screener, needsFinviz, resolvedAt, ...t }) => ({
    ...t, key: `p${t.id}`, mine: { kind, tickers, screener, needsFinviz, resolvedAt },
  }));
  return [...base, ...mine];
}

// ─── Finviz screener input (mirror of api-server lib/themes/personal.ts) ────

/** The 11 Finviz sectors (names as Finviz shows them; not translated). */
export const SECTORS = [
  { code: "sec_basicmaterials", name: "Basic Materials" },
  { code: "sec_communicationservices", name: "Communication Services" },
  { code: "sec_consumercyclical", name: "Consumer Cyclical" },
  { code: "sec_consumerdefensive", name: "Consumer Defensive" },
  { code: "sec_energy", name: "Energy" },
  { code: "sec_financial", name: "Financial" },
  { code: "sec_healthcare", name: "Healthcare" },
  { code: "sec_industrials", name: "Industrials" },
  { code: "sec_realestate", name: "Real Estate" },
  { code: "sec_technology", name: "Technology" },
  { code: "sec_utilities", name: "Utilities" },
] as const;

export const MAX_SCREENER_FILTERS = 15;
const FILTER_RE = /^[a-z0-9_][a-z0-9_.]{1,39}$/; // dots: sh_relvol_o1.5
const ORDER_RE = /^-?[a-z0-9_]{1,40}$/;

export type ScreenerParse = { ok: true; spec: ScreenerSpec } | { ok: false; reason: "empty" | "invalid" | "tooMany"; bad?: string[] };

/** A Finviz screener URL / "f=…&o=…" / filter list → filters + order. Only f and o are read (auth is dropped). */
export function parseScreenerInput(input: string, orderInput?: string | null): ScreenerParse {
  const text = String(input ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };
  let f = text;
  let o: string | null = orderInput?.trim() || null;
  if (/^https?:\/\//i.test(text) || text.includes("?") || /(^|&)f=/.test(text)) {
    let q: URLSearchParams;
    try {
      q = /^https?:\/\//i.test(text) ? new URL(text).searchParams : new URLSearchParams(text.includes("?") ? text.slice(text.indexOf("?") + 1) : text);
    } catch {
      return { ok: false, reason: "invalid" };
    }
    f = q.get("f") ?? "";
    o = q.get("o") ?? o;
  }
  const tokens = [...new Set(f.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!tokens.length) return { ok: false, reason: "empty" };
  const bad = tokens.filter((x) => !FILTER_RE.test(x));
  if (bad.length) return { ok: false, reason: "invalid", bad: bad.slice(0, 5) };
  if (tokens.length > MAX_SCREENER_FILTERS) return { ok: false, reason: "tooMany" };
  const order = o ? o.toLowerCase() : null;
  if (order && !ORDER_RE.test(order)) return { ok: false, reason: "invalid", bad: [order] };
  return { ok: true, spec: { filters: tokens, order } };
}

/** Header strip: the 3 best and the 3 worst themes of a column (worst first), never the same theme twice. */
export function leadersLaggards<T extends ThemeOut>(themes: readonly T[], col: ThemeMetric, n = 3): { leaders: T[]; laggards: T[] } {
  const ranked = sortThemes(themes, { col, dir: "desc" }).filter((t) => val(t[col]) != null);
  const leaders = ranked.slice(0, n).filter((t) => (t[col] as number) > 0);
  const taken = new Set<T>(leaders);
  const laggards = ranked.slice(-n).reverse().filter((t) => !taken.has(t) && (t[col] as number) < 0);
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
