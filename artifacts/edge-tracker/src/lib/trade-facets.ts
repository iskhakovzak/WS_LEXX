/**
 * «Улучшенный поиск» — the PropReports-style «Фильтры» panel of /trades and /stats (pure model, no React).
 * Server: GET /api/trades/facets (buckets {key, label, count, net} per column, computed in SQL), the same x* params
 * on /api/trades/page|days and /api/stats/aggregate; the view is saved per user (GET|PUT /api/trades/facets/view).
 *
 * Selection = what is UNCHECKED (`off[dim]`): every bucket is checked by default, a new year / tag too. A trade passes
 * a scalar column when its key is not unchecked, a tag column when one of its tags (or «__none__» without tags) is not.
 * «Исключить IMX» (`excludeImx`) drops close-auction trades (strategy MOC) from every list and number.
 * Mirrors api lib/tradeFacetsSql (the raw-trade filter below is what /stats applies to the own book).
 */
import type { Trade } from "@workspace/api-client-react";
import { entryMinutes } from "@/lib/trade-math";

export const FACET_DIMS = ["years", "months", "days", "times", "strategies", "types", "gtags", "ptags"] as const;
export type FacetDim = (typeof FACET_DIMS)[number];

export const FACET_PARAMS: Record<FacetDim, string> = {
  years: "xYears", months: "xMonths", days: "xDays", times: "xTimes",
  strategies: "xStrategies", types: "xTypes", gtags: "xGtags", ptags: "xPtags",
};
export const NONE_KEY = "__none__";
export const UNKNOWN_KEY = "unknown";
export const IMX_STRATEGY = "MOC";

export type FacetBucket = { key: string; label: string; count: number; net: number | null };
export type FacetLine = { count: number; net: number | null };
export type FacetsResponse = {
  dims: Record<FacetDim, FacetBucket[]>;
  total: FacetLine;
  imx: FacetLine;
  excludeImx: boolean;
  money: boolean;
  deskTags: string[];
};

export type FacetView = { off: Partial<Record<FacetDim, string[]>>; excludeImx: boolean; open: boolean };
export const EMPTY_FACET_VIEW: FacetView = { off: {}, excludeImx: false, open: false };

/** A stored / server view in the canonical shape (unknown columns and non-string keys dropped). */
export function normalizeFacetView(v: unknown): FacetView {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const raw = o.off && typeof o.off === "object" ? (o.off as Record<string, unknown>) : {};
  const off: FacetView["off"] = {};
  for (const d of FACET_DIMS) {
    const list = Array.isArray(raw[d]) ? [...new Set((raw[d] as unknown[]).filter((k): k is string => typeof k === "string" && k !== ""))] : [];
    if (list.length) off[d] = list;
  }
  return { off, excludeImx: o.excludeImx === true, open: o.open === true };
}

export function isChecked(view: FacetView, dim: FacetDim, key: string): boolean {
  return !(view.off[dim] ?? []).includes(key);
}

function withOff(view: FacetView, dim: FacetDim, keys: string[]): FacetView {
  const off = { ...view.off };
  if (keys.length) off[dim] = keys;
  else delete off[dim];
  return { ...view, off };
}

export function toggleKey(view: FacetView, dim: FacetDim, key: string): FacetView {
  const cur = view.off[dim] ?? [];
  return withOff(view, dim, cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
}

/** «все» (on = true: check every bucket) / «ничего» (uncheck every bucket listed in `keys`). */
export function setColumn(view: FacetView, dim: FacetDim, keys: readonly string[], on: boolean): FacetView {
  return withOff(view, dim, on ? [] : [...new Set([...(view.off[dim] ?? []), ...keys])]);
}

/** Check everything again (the panel stays as it is, the IMX switch is its own setting). */
export function resetFacets(view: FacetView): FacetView {
  return { ...view, off: {} };
}

export function activeCount(view: FacetView): number {
  return FACET_DIMS.reduce((n, d) => n + (view.off[d]?.length ?? 0), 0);
}

/** Query string of the selection («xYears=2024&excludeImx=1»), stable order; "" when nothing is excluded. */
export function facetQuery(view: FacetView): string {
  const p = new URLSearchParams();
  for (const d of FACET_DIMS) {
    const keys = view.off[d];
    if (keys?.length) p.set(FACET_PARAMS[d], [...keys].sort().join(","));
  }
  if (view.excludeImx) p.set("excludeImx", "1");
  return p.toString();
}

/** The unchecked buckets as chips «Колонка: значение», labels from the last facets answer (key when unknown). */
export function uncheckedChips(view: FacetView, data: FacetsResponse | null | undefined): { dim: FacetDim; key: string; label: string }[] {
  return FACET_DIMS.flatMap((dim) => (view.off[dim] ?? []).map((key) => ({
    dim, key, label: data?.dims[dim]?.find((b) => b.key === key)?.label ?? key,
  })));
}

// ─── Raw trades (the own /stats book) ───────────────────────────────────────────────────────────────────────

const hm = (h: number, m: number) => h * 3600 + m * 60;
export const TIME_BUCKETS: readonly { key: string; before: number }[] = [
  { key: "before-8:30", before: hm(8, 30) }, { key: "8:30-9:30", before: hm(9, 30) }, { key: "9:30-9:50", before: hm(9, 50) },
  { key: "9:50-10:10", before: hm(10, 10) }, { key: "10:10-11:15", before: hm(11, 15) }, { key: "11:15-13:30", before: hm(13, 30) },
  { key: "13:30-15:30", before: hm(15, 30) }, { key: "15:30-16:00", before: hm(16, 0) }, { key: "after-16:00", before: Infinity },
];

export function timeBucketOfSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return UNKNOWN_KEY;
  return TIME_BUCKETS.find((b) => sec < b.before)!.key;
}

type FacetTrade = Pick<Trade, "date" | "side" | "tags" | "strategy" | "entrySec" | "contextSnapshot">;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function splitTags(tags: string | null | undefined): string[] {
  return (tags ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** The keys of a trade in every column (same rules as the server SQL). */
export function tradeFacetKeys(t: FacetTrade, deskTags: readonly string[]): Record<FacetDim, string[]> {
  const m = DATE_RE.exec(String(t.date ?? ""));
  const desk = new Set(deskTags.map((x) => x.toLowerCase()));
  const tags = splitTags(t.tags);
  const g = tags.filter((x) => desk.has(x.toLowerCase()));
  const p = tags.filter((x) => !desk.has(x.toLowerCase()));
  const mins = t.entrySec == null ? entryMinutes(t as never) : null;
  const sec = t.entrySec ?? (mins != null ? mins * 60 : null);
  const side = (t.side ?? "").trim().toLowerCase();
  const dow = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : null;
  return {
    years: [m ? m[1]! : UNKNOWN_KEY],
    months: [m ? String(Number(m[2])) : UNKNOWN_KEY],
    days: [dow == null ? UNKNOWN_KEY : String(dow === 0 ? 7 : dow)],
    times: [timeBucketOfSec(sec)],
    strategies: [t.strategy || UNKNOWN_KEY],
    types: [side === "long" || side === "short" ? side : UNKNOWN_KEY],
    gtags: g.length ? g : [NONE_KEY],
    ptags: p.length ? p : [NONE_KEY],
  };
}

export function isImxTrade(t: Pick<Trade, "strategy" | "isImx">): boolean {
  return t.isImx === true || t.strategy === IMX_STRATEGY;
}

/** The trade passes the selection (every column + «Исключить IMX»). */
export function tradePassesFacets(t: FacetTrade & Pick<Trade, "isImx">, view: FacetView, deskTags: readonly string[]): boolean {
  if (view.excludeImx && isImxTrade(t)) return false;
  if (!activeCount(view)) return true;
  const keys = tradeFacetKeys(t, deskTags);
  return FACET_DIMS.every((d) => {
    const off = view.off[d];
    return !off?.length || keys[d].some((k) => !off.includes(k));
  });
}

/** Count / Σ value of the IMX trades in a list (the «из них IMX» line over raw trades). */
export function imxLineOf<T extends Pick<Trade, "strategy" | "isImx">>(trades: readonly T[], value: (t: T) => number | null): FacetLine {
  let count = 0, net = 0;
  for (const t of trades) if (isImxTrade(t)) { count++; net += value(t) ?? 0; }
  return { count, net: Math.round(net * 100) / 100 };
}
