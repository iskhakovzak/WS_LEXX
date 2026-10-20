/**
 * «Темы рынка» — the API shapes (api-server lib/themes/logic.ts) and the pure view logic (unit-tested in model.test.ts):
 * sorting best → worst, the diverging bar geometry, polling by session, ticker input parsing for staff.
 * Percentages are percent units (1.25 = 1.25 %); null = unknown.
 */

export type ThemeSession = "pre" | "rth" | "post" | "closed";
export type ThemeSource = "finviz" | "yahoo";
export type ThemeMetric = "fromOpen" | "today";
export const METRICS: readonly ThemeMetric[] = ["fromOpen", "today"];

export type MemberQuote = { ticker: string; price: number | null; today: number | null; fromOpen: number | null };

export type ThemeOut = {
  id: number;
  name: string;
  today: number | null;
  fromOpen: number | null;
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

export function isMetric(v: unknown): v is ThemeMetric {
  return v === "fromOpen" || v === "today";
}

const val = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Best → worst by the metric; themes without a value go last (by name). */
export function sortThemes(themes: readonly ThemeOut[], metric: ThemeMetric): ThemeOut[] {
  return [...themes].sort((a, b) => {
    const x = val(a[metric]);
    const y = val(b[metric]);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || a.name.localeCompare(b.name);
  });
}

/** Members of an opened theme, best → worst by the same metric (unknown last, by ticker). */
export function sortMembers(members: readonly MemberQuote[], metric: ThemeMetric): MemberQuote[] {
  return [...members].sort((a, b) => {
    const x = val(a[metric]);
    const y = val(b[metric]);
    if (x == null && y == null) return a.ticker.localeCompare(b.ticker);
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || a.ticker.localeCompare(b.ticker);
  });
}

/** Bar scale of a panel: the largest |value| (0 when the panel has no values). */
export function panelScale(themes: readonly ThemeOut[], metric: ThemeMetric): number {
  let max = 0;
  for (const t of themes) {
    const v = val(t[metric]);
    if (v != null) max = Math.max(max, Math.abs(v));
  }
  return max;
}

/**
 * Diverging bar: the centre line is 0, down grows left, up grows right. `width` is the share of ONE half (0…100 %),
 * so the largest |value| of the panel fills its half. A non-zero value gets at least a sliver (visible).
 */
export function barOf(value: number | null | undefined, scale: number): { side: "up" | "down" | null; width: number } {
  const v = val(value);
  if (v == null || v === 0 || !(scale > 0)) return { side: null, width: 0 };
  const width = Math.min(100, Math.max(2, (Math.abs(v) / scale) * 100));
  return { side: v > 0 ? "up" : "down", width: Math.round(width * 10) / 10 };
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
