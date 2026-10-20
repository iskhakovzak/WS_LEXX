/**
 * «Мои темы» and the per-user view of /themes — pure rules (unit-tested in __tests__/themes/personal.test.ts).
 *
 *   view      users.settings.themesView = { columns: visible metrics (≥ 1, in table order), hidden: base theme ids,
 *             sort: the shared board's sort or null (session default), tab: the last active tab ("shared" | board id) }
 *   screener  a Finviz screener URL, a "f=…&o=…" query or a plain filter list → { filters, order }. Only `f` and `o`
 *             are read from a URL: `auth` (the Elite token) and every other parameter are dropped, never stored or echoed.
 *             Filters: ≤ 15 tokens of /^[a-z0-9_][a-z0-9_.]{1,39}$/; order: /^-?[a-z0-9_]{1,40}$/.
 *   limits    ≤ 10 active personal themes per user; a screener theme shows the top 25 tickers of the export (by market
 *             cap unless the user gave an order), re-resolved after an hour.
 */
import { THEME_METRICS, type ThemeMetric, type ThemeOut } from "./logic";

export const MAX_PERSONAL_THEMES = 10;
export const MAX_SCREENER_FILTERS = 15;
export const SCREENER_TOP = 25;
/** A screener resolves up to this many (tickers boards may show 50; personal themes take the first 25). */
export const SCREENER_MAX = 50;
export const SCREENER_DEFAULT_ORDER = "-marketcap";
export const RESOLVE_TTL_MS = 60 * 60_000;
export const MAX_HIDDEN = 200;

const FILTER_RE = /^[a-z0-9_][a-z0-9_.]{1,39}$/; // dots: sh_relvol_o1.5
const ORDER_RE = /^-?[a-z0-9_]{1,40}$/;

export type SortDir = "desc" | "asc";
export type ColumnSort<C extends string = ThemeMetric> = { col: C; dir: SortDir };
export type ViewTab = "shared" | number;
export type ThemesView = { columns: ThemeMetric[]; hidden: number[]; sort: ColumnSort | null; tab: ViewTab };
export const DEFAULT_VIEW: ThemesView = { columns: [...THEME_METRICS], hidden: [], sort: null, tab: "shared" };

/** { col, dir } with col among `cols`, else null. */
export function normalizeSort<C extends string>(raw: unknown, cols: readonly C[]): ColumnSort<C> | null {
  const r = raw as { col?: unknown; dir?: unknown } | null;
  if (!r || typeof r !== "object" || !cols.includes(r.col as C) || (r.dir !== "desc" && r.dir !== "asc")) return null;
  return { col: r.col as C, dir: r.dir };
}

export const normalizeTab = (raw: unknown): ViewTab => (Number.isSafeInteger(raw) && (raw as number) > 0 ? (raw as number) : "shared");

/** Stored JSON → a valid view: known columns in table order (none → all), positive unique ids, a valid sort / tab. */
export function normalizeView(raw: unknown): ThemesView {
  const r = (raw && typeof raw === "object" ? raw : {}) as { columns?: unknown; hidden?: unknown; sort?: unknown; tab?: unknown };
  const cols = Array.isArray(r.columns) ? r.columns : [];
  const columns = THEME_METRICS.filter((m) => cols.includes(m));
  const hidden = Array.isArray(r.hidden)
    ? [...new Set(r.hidden.filter((x): x is number => Number.isSafeInteger(x) && (x as number) > 0))].slice(0, MAX_HIDDEN)
    : [];
  return { columns: columns.length ? columns : [...THEME_METRICS], hidden, sort: normalizeSort(r.sort, THEME_METRICS), tab: normalizeTab(r.tab) };
}

export type ScreenerSpec = { filters: string[]; order: string | null };
export type ScreenerParse = { ok: true; spec: ScreenerSpec } | { ok: false; reason: "empty" | "invalid" | "tooMany"; bad?: string[] };

function fromQuery(q: URLSearchParams): { f: string; o: string | null } {
  return { f: q.get("f") ?? "", o: q.get("o") };
}

/**
 * Screener input → filters + order. Accepts
 *   https://elite.finviz.com/screener.ashx?v=111&f=sec_technology,cap_large&o=-volume&auth=…
 *   f=sec_technology,cap_large&o=-volume
 *   sec_technology cap_large      (comma / space / semicolon separated)
 * Never returns anything but f / o tokens.
 */
export function parseScreenerInput(input: string, orderInput?: string | null): ScreenerParse {
  const text = String(input ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };
  let f = text;
  let o: string | null = orderInput?.trim() || null;
  if (/^https?:\/\//i.test(text) || text.includes("?")) {
    let q: URLSearchParams;
    try {
      q = /^https?:\/\//i.test(text) ? new URL(text).searchParams : new URLSearchParams(text.slice(text.indexOf("?") + 1));
    } catch {
      return { ok: false, reason: "invalid" };
    }
    const qf = fromQuery(q);
    f = qf.f;
    o = qf.o ?? o;
  } else if (/(^|&)f=/.test(text)) {
    const q = new URLSearchParams(text);
    const qf = fromQuery(q);
    f = qf.f;
    o = qf.o ?? o;
  }
  const tokens = [...new Set(f.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!tokens.length) return { ok: false, reason: "empty" };
  const bad = tokens.filter((x) => !FILTER_RE.test(x));
  if (bad.length) return { ok: false, reason: "invalid", bad: bad.slice(0, 5) };
  if (tokens.length > MAX_SCREENER_FILTERS) return { ok: false, reason: "tooMany" };
  const order = o ? o.trim().toLowerCase() : null;
  if (order && !ORDER_RE.test(order)) return { ok: false, reason: "invalid", bad: [order] };
  return { ok: true, spec: { filters: tokens, order } };
}

/** Cache key of a screener (the same sector picked by two users resolves once). */
export const screenerKey = (s: ScreenerSpec): string => `${s.filters.join(",")}|${s.order ?? SCREENER_DEFAULT_ORDER}`;

export function resolveStale(resolvedAt: number | null, now: number): boolean {
  return resolvedAt == null || now - resolvedAt >= RESOLVE_TTL_MS;
}

/** A personal theme as GET /api/themes sends it (only to its owner). */
export type PersonalThemeOut = ThemeOut & {
  kind: "tickers" | "screener";
  /** kind tickers: the user's list; kind screener: the resolved top tickers. */
  tickers: string[];
  screener: ScreenerSpec | null;
  /** A screener theme while Finviz is off: it cannot be resolved / refreshed. */
  needsFinviz: boolean;
  resolvedAt: string | null;
};
