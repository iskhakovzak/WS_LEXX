/**
 * «Темы рынка» — the API shapes (api-server lib/themes/*) and the pure view logic of the workspace (unit-tested in
 * model.test.ts): the default sort column per session (visible, non-empty columns only), the header click cycle, sorting
 * (unknown always last), the two halves on wide screens, cell intensity, empty-column rails, market breadth, the per-user
 * view (visible columns, hidden shared themes, sort, last tab), boards as tabs, Finviz screener input, the «В план дня»
 * date, polling, ticker input. Percentages are percent units (1.25 = 1.25 %); null = unknown.
 */

export type ThemeSession = "pre" | "rth" | "post" | "closed";
export type ThemeSource = "finviz" | "yahoo";

/**
 * Reference point of a move: premarket (last premarket print vs previous close, frozen after the open), from today's
 * open, for the day (vs previous close), after hours (vs today's regular close).
 */
export type ThemeMetric = "premarket" | "fromOpen" | "today" | "afterHours";
export const METRICS: readonly ThemeMetric[] = ["premarket", "fromOpen", "today", "afterHours"];
/** Tickers boards add gap %, relative volume and float (shares). */
export type BoardColumn = ThemeMetric | "gap" | "rvol" | "float";
export const TICKER_COLUMNS: readonly BoardColumn[] = [...METRICS, "gap", "rvol", "float"];
/** Signed % columns: tinted cells, counted in the breadth strip. */
export const isSigned = (c: BoardColumn): boolean => c !== "rvol" && c !== "float";

export type MemberQuote = { ticker: string; price: number | null; today: number | null; fromOpen: number | null; premarket: number | null; afterHours: number | null };

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

export type SortDir = "desc" | "asc";
export type ColSort<C extends string = ThemeMetric> = { col: C; dir: SortDir };
export type ThemeSort = ColSort<ThemeMetric>;
export type BoardTab = "shared" | number;

/** Visible columns, hidden shared themes, the shared board's sort (null = session default), the last tab. */
export type ThemesView = { columns: ThemeMetric[]; hidden: number[]; sort: ThemeSort | null; tab: BoardTab };
export type ScreenerSpec = { filters: string[]; order: string | null };

/** «Мои темы» on a themes board (only the owner gets them). */
export type PersonalThemeOut = ThemeOut & { kind: "tickers" | "screener"; tickers: string[]; screener: ScreenerSpec | null; needsFinviz: boolean; resolvedAt: string | null };

export type BoardKind = "themes" | "tickers";
export type BoardSource = { kind: "tickers"; tickers: string[] } | { kind: "screener"; screener: ScreenerSpec; top: 25 | 50 };
/** A personal board (tab): name, columns and sort of its own. */
export type BoardMeta = {
  id: number;
  name: string;
  kind: BoardKind;
  position: number;
  columns: BoardColumn[];
  sort: ColSort<BoardColumn> | null;
  pinned: number[];
  source: BoardSource | null;
  resolvedAt: string | null;
};

/** One row of a tickers board. */
export type TickerRow = Record<BoardColumn, number | null> & { ticker: string; price: number | null };

/** GET /api/themes */
export type ThemesResponse = {
  asOf: string | null;
  session: ThemeSession;
  source: ThemeSource | null;
  stale: boolean;
  themes: ThemeOut[];
  view: ThemesView;
  boards: BoardMeta[];
  /** Finviz is on: screeners resolve. */
  finviz: boolean;
  /** Cold server start: the first quote refresh is still running (no numbers yet). */
  warming?: boolean;
};

type BoardCommon = { board: BoardMeta; session: ThemeSession; finviz: boolean };
/** GET /api/themes/boards/:id */
export type BoardData =
  | (BoardCommon & { kind: "themes"; asOf: string | null; stale: boolean; themes: ThemeOut[]; personal: PersonalThemeOut[] })
  | (BoardCommon & { kind: "tickers"; rows: TickerRow[]; missing: string[]; needsFinviz: boolean; resolvedAt: string | null });

/** A themes-table row: a shared theme (`b<id>`) or one of the user's (`p<id>`, `mine` set). */
export type BoardTheme = ThemeOut & { key: string; mine: Omit<PersonalThemeOut, keyof ThemeOut> | null };

/** GET /api/themes/config (admin), POST / PUT answers. */
export type ThemeRecord = { id: number; name: string; tickers: string[]; sortOrder: number; active: boolean; updatedBy: string | null; updatedAt: string };

export const POLL_MS = 30_000;
/** A closed market is re-asked slowly, so a board left open overnight wakes up on its own for premarket / the open. */
export const CLOSED_POLL_MS = 5 * 60_000;

export const isLiveSession = (s: ThemeSession | null | undefined): boolean => s === "pre" || s === "rth" || s === "post";

/** Auto-refresh: 30 s while something can move (pre / rth / post), 5 min while closed; nothing before the first answer. */
export function pollInterval(session: ThemeSession | null | undefined): number | false {
  if (isLiveSession(session)) return POLL_MS;
  return session === "closed" ? CLOSED_POLL_MS : false;
}

const val = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
type Valued<C extends string> = { readonly [K in C]?: number | null };

export function isMetric(v: unknown): v is ThemeMetric {
  return typeof v === "string" && (METRICS as readonly string[]).includes(v);
}

/** Some row has a value in the column right now. */
export function hasValues<C extends string>(rows: readonly Valued<C>[], col: C): boolean {
  return rows.some((r) => val(r[col]) != null);
}

/** The visible columns without a single value right now (shown as a narrow rail with «appears at …»). */
export function emptyColumns<C extends string>(rows: readonly Valued<C>[], visible: readonly C[]): C[] {
  return visible.filter((c) => !hasValues(rows, c));
}

// ─── sorting ────────────────────────────────────────────────────────────────

export function isSortOf<C extends string>(v: unknown, cols: readonly C[]): v is ColSort<C> {
  const s = v as ColSort<C> | null;
  return !!s && typeof s === "object" && cols.includes(s.col) && (s.dir === "desc" || s.dir === "asc");
}

/** The column that matters most in each session. */
export const SESSION_COLUMN: Readonly<Record<ThemeSession, ThemeMetric>> = { pre: "premarket", rth: "fromOpen", post: "afterHours", closed: "today" };

/**
 * Default sort column among the visible ones: the session's one when it has values now, else the first visible that
 * has (today, fromOpen, premarket, afterHours, the rest), else «За день» (or the first visible).
 */
export function defaultColumn<C extends string>(session: ThemeSession, rows: readonly Valued<C>[], visible: readonly C[]): C {
  const prefer = [SESSION_COLUMN[session], "today", "fromOpen", "premarket", "afterHours"] as string[];
  const order = [...prefer.filter((c) => visible.includes(c as C)), ...visible.filter((c) => !prefer.includes(c))] as C[];
  return order.find((c) => hasValues(rows, c)) ?? ((visible.includes("today" as C) ? "today" : visible[0]) as C);
}

/** The user's stored sort when its column is visible, else the session default (desc). */
export function effectiveSort<C extends string>(stored: unknown, session: ThemeSession, rows: readonly Valued<C>[], visible: readonly C[]): ColSort<C> {
  if (isSortOf(stored, visible)) return stored;
  return { col: defaultColumn(session, rows, visible), dir: "desc" };
}

/** Header click: another column → it, desc; same column desc → asc; asc → null (back to the default). */
export function nextSort<C extends string>(current: ColSort<C>, col: C): ColSort<C> | null {
  if (current.col !== col) return { col, dir: "desc" };
  return current.dir === "desc" ? { col, dir: "asc" } : null;
}

/** Sorted by the column (unknown last in both directions), ties by label. */
export function sortRows<R, C extends string>(rows: readonly R[], sort: ColSort<C>, get: (r: R, c: C) => number | null | undefined, label: (r: R) => string): R[] {
  return [...rows].sort((a, b) => {
    const x = val(get(a, sort.col));
    const y = val(get(b, sort.col));
    if (x == null && y == null) return label(a).localeCompare(label(b));
    if (x == null) return 1;
    if (y == null) return -1;
    return (sort.dir === "desc" ? y - x : x - y) || label(a).localeCompare(label(b));
  });
}

export const sortThemes = <T extends ThemeOut>(themes: readonly T[], sort: ThemeSort): T[] => sortRows(themes, sort, (t, c) => t[c], (t) => t.name);
export const sortMembers = (members: readonly MemberQuote[], sort: ThemeSort): MemberQuote[] => sortRows(members, sort, (m, c) => m[c], (m) => m.ticker);

/** Wide screens: the sorted list in `n` columns read top-down, left to right (55 → 19 | 18 | 18). */
export function splitColumns<T>(rows: readonly T[], n: number): T[][] {
  const per = Math.ceil(rows.length / Math.max(1, n));
  return Array.from({ length: Math.max(1, n) }, (_, i) => rows.slice(i * per, (i + 1) * per));
}

/** Short boards stay one list; long ones (a full shared board) get a third column on very wide screens. */
export const SPLIT_MIN_ROWS = 13;
export const THREE_COLUMNS_MIN_ROWS = 41;

// ─── cells, breadth ─────────────────────────────────────────────────────────

/** Largest |value| of a column (0 without values): the scale of its cell tint. */
export function columnMax<C extends string>(rows: readonly Valued<C>[], col: C): number {
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

/** Phones show ≤ 2 of the visible columns: the active one and «За день» (for «За день»: «От открытия» or the next). */
export function phoneColumns<C extends string>(col: C, visible: readonly C[]): C[] {
  const others = visible.filter((c) => c !== col);
  const pick = (c: string) => (others as string[]).includes(c);
  const second = col === "today" ? (pick("fromOpen") ? "fromOpen" : others[0]) : pick("today") ? "today" : others[0];
  const set = new Set<string>([col, ...(second ? [second] : [])]);
  return visible.filter((c) => set.has(c));
}

export type Breadth = { up: number; down: number; flat: number; total: number; median: number | null };

/** «▲ 29 · ▼ 10» and the median move of a column (unknown values left out). */
export function breadth(values: readonly (number | null | undefined)[]): Breadth {
  const xs = values.map(val).filter((v): v is number => v != null).sort((a, b) => a - b);
  const up = xs.filter((v) => v > 0).length;
  const down = xs.filter((v) => v < 0).length;
  const n = xs.length;
  const median = n ? (n % 2 ? xs[(n - 1) / 2]! : (xs[n / 2 - 1]! + xs[n / 2]!) / 2) : null;
  return { up, down, flat: n - up - down, total: n, median: median == null ? null : Math.round(median * 100) / 100 };
}

/** The breadth strip counts the active column when it is a signed move, else «За день». */
export const breadthColumn = (col: BoardColumn): BoardColumn => (isSigned(col) ? col : "today");

// ─── the user's view, shared rows ───────────────────────────────────────────

export const DEFAULT_VIEW: ThemesView = { columns: [...METRICS], hidden: [], sort: null, tab: "shared" };
export const MAX_PERSONAL = 10;

/** Visible shared-board columns in table order (never empty). */
export function visibleColumns(view: Pick<ThemesView, "columns"> | null | undefined): ThemeMetric[] {
  const cols = METRICS.filter((m) => view?.columns?.includes(m));
  return cols.length ? cols : [...METRICS];
}

/** Checkbox click: show / hide a column (canonical order kept); the last visible one stays. */
export function toggleIn<C extends string>(visible: readonly C[], all: readonly C[], col: C): C[] {
  const next = visible.includes(col) ? visible.filter((c) => c !== col) : all.filter((m) => m === col || visible.includes(m));
  return next.length ? next : [...visible];
}

export function setHidden(view: ThemesView, id: number, hidden: boolean): ThemesView {
  const rest = view.hidden.filter((x) => x !== id);
  return { ...view, hidden: hidden ? [...rest, id] : rest };
}

const shared = (t: ThemeOut): BoardTheme => ({ ...t, key: `b${t.id}`, mine: null });
const own = ({ kind, tickers, screener, needsFinviz, resolvedAt, ...t }: PersonalThemeOut): BoardTheme => ({
  ...t, key: `p${t.id}`, mine: { kind, tickers, screener, needsFinviz, resolvedAt },
});

/** «Общие темы»: the shared themes the user did not hide. */
export const sharedRows = (data: Pick<ThemesResponse, "themes" | "view">): BoardTheme[] => {
  const hidden = new Set(data.view?.hidden ?? []);
  return data.themes.filter((t) => !hidden.has(t.id)).map(shared);
};

/** A themes board: the pinned shared themes, then the user's own (marked). */
export const themesBoardRows = (data: { themes: ThemeOut[]; personal: PersonalThemeOut[] }): BoardTheme[] => [...data.themes.map(shared), ...data.personal.map(own)];

// ─── boards ─────────────────────────────────────────────────────────────────

export const MAX_BOARDS = 8;
export const MAX_BOARD_TICKERS = 50;
export const columnsOf = (kind: BoardKind): readonly BoardColumn[] => (kind === "tickers" ? TICKER_COLUMNS : METRICS);

/** Tab strip values: "shared" or "b<id>". */
export const tabValue = (tab: BoardTab): string => (tab === "shared" ? "shared" : `b${tab}`);
export const tabOf = (value: string): BoardTab => (value.startsWith("b") && Number(value.slice(1)) > 0 ? Number(value.slice(1)) : "shared");

/** ← / → between tabs (wraps). */
export function nextTab(tabs: readonly BoardTab[], current: BoardTab, dir: -1 | 1): BoardTab {
  if (!tabs.length) return current;
  const i = Math.max(0, tabs.indexOf(current));
  return tabs[(i + dir + tabs.length) % tabs.length]!;
}

/** Which day's plan «В план дня» writes to (New York): today until the close, then the next session; weekend → Monday. */
export function planDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const step = () => day.setUTCDate(day.getUTCDate() + 1);
  if (Number(parts.hour) >= 16) step();
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) step();
  return day.toISOString().slice(0, 10);
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

/** Seconds since `asOf` (null without one); never negative. */
export function ageSeconds(asOf: string | null | undefined, now: number): number | null {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

export const MAX_TICKERS = 30;
const TICKER_RE = /^[A-Z.\-]{1,10}$/;

/** "mu, $wdc  stx" → { tickers: ["MU", "WDC", "STX"], invalid: [] } (server rule: A–Z . -, ≤ 10 letters). */
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

/** All tickers of a theme (quoted and missing), for «Скопировать тикеры» / «Новая доска из темы». */
export const themeTickerList = (t: Pick<ThemeOut, "members" | "missing">): string[] => [...new Set([...t.members.map((m) => m.ticker), ...t.missing])];
