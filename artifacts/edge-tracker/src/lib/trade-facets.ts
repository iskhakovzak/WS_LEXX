/**
 * «Улучшенный поиск» — the PropReports-style «Фильтры» panel of /trades and /stats (pure model, no React).
 * Server: GET /api/trades/facets (buckets {key, label, count, net} per column, computed in SQL), the same x* params
 * on /api/trades/page|days and /api/stats/aggregate; the view is saved per user (GET|PUT /api/trades/facets/view).
 *
 * Selection = what is UNCHECKED (`off[dim]`): every bucket is checked by default, a new year / tag too. A trade passes
 * a scalar column when its key is not unchecked, a tag column when one of its tags (or «__none__» without tags) is not.
 * «Исключить IMX» (`excludeImx`) drops close-auction trades (strategy MOC) from every list and number.
 * Mirrors api lib/tradeFacetsSql + lib/tradeFacetBuckets (the raw-trade filter below is what /stats applies to the
 * own book): the derived columns of a trade row (holdSec, overnight, entryKind, addsKind, exitKind, hasStop, notional,
 * sizeRel, daySeq, prevKind — api lib/tradeFacetDerive) are bucketed here exactly as in SQL
 * (lib/__tests__/facetBucketsParity.test.ts). Every key comes from the row itself, so full and lite list rows work.
 */
import type { Trade } from "@workspace/api-client-react";
import { entryMinutes } from "@/lib/trade-math";

export const FACET_DIMS = [
  "years", "months", "days", "times", "seq", "prev",
  "strategies", "types", "entry", "adds", "exit", "stop", "hold",
  "tickers", "price", "size", "sizeRel", "accounts",
  "result", "gtags", "ptags",
] as const;
export type FacetDim = (typeof FACET_DIMS)[number];

/** The panel's groups (headings «when · how · what · result and tags»), each a run of FACET_DIMS. */
export const FACET_GROUPS: readonly { id: "when" | "how" | "what" | "outcome"; dims: readonly FacetDim[] }[] = [
  { id: "when", dims: ["years", "months", "days", "times", "seq", "prev"] },
  { id: "how", dims: ["strategies", "types", "entry", "adds", "exit", "stop", "hold"] },
  { id: "what", dims: ["tickers", "price", "size", "sizeRel", "accounts"] },
  { id: "outcome", dims: ["result", "gtags", "ptags"] },
];

export const FACET_PARAMS: Record<FacetDim, string> = {
  years: "xYears", months: "xMonths", days: "xDays", times: "xTimes",
  strategies: "xStrategies", types: "xTypes", gtags: "xGtags", ptags: "xPtags",
  seq: "xSeq", prev: "xPrev", entry: "xEntry", exit: "xExit", hold: "xHold",
  tickers: "xTickers", price: "xPrice", size: "xSize", accounts: "xAccounts", result: "xResult",
  adds: "xAdds", stop: "xStop", sizeRel: "xSizeRel",
};
export const NONE_KEY = "__none__";
export const UNKNOWN_KEY = "unknown";
export const MANUAL_ACCOUNT_KEY = "manual";
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

// ─── Buckets of the numeric columns (mirror of api lib/tradeFacetBuckets — the parity test runs both) ─────────

export type Bucket = { key: string; before: number };
const b = (key: string, before: number): Bucket => ({ key, before });
export const SEQ_BUCKETS: readonly Bucket[] = [b("1", 2), b("2", 3), b("3", 4), b("4-5", 6), b("6+", Infinity)];
export const HOLD_BUCKETS: readonly Bucket[] = [
  b("lt1m", 60), b("1-5m", 300), b("5-15m", 900), b("15-60m", 3600), b("1-4h", 14_400), b("gt4h", Infinity),
];
export const OVERNIGHT_KEY = "overnight";
export const PRICE_BUCKETS: readonly Bucket[] = [
  b("lt5", 5), b("5-10", 10), b("10-20", 20), b("20-50", 50), b("50-100", 100), b("100-200", 200), b("gt200", Infinity),
];
export const SIZE_BUCKETS: readonly Bucket[] = [
  b("lt2k", 2000), b("2-5k", 5000), b("5-10k", 10_000), b("10-25k", 25_000), b("25-50k", 50_000), b("50-100k", 100_000), b("gt100k", Infinity),
];
/** Size relative to the trader's usual (trade.sizeRel, a ratio — shown to every viewer, unlike $ size). */
export const SIZE_REL_BUCKETS: readonly Bucket[] = [b("lt05", 0.5), b("normal", 1.5), b("x2", 3), b("x3", Infinity)];

/** Rule thresholds of the derived kinds (api lib/tradeFacetBuckets; named in the row tooltips). */
export const AGGRESSIVE_ADDS_MIN = 3;
export const AGGRESSIVE_WINDOW_SEC = 300;
export const AGGRESSIVE_SIZE_MULT = 3;
export const AGGRESSIVE_GAP_SEC = 60;
export const AGGRESSIVE_GAP_MIN_ADDS = 2;
export const SIZE_REL_DAYS = 60;
export const SIZE_REL_MIN_TRADES = 10;

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Key of `v` in a bucket list (first `v < before`); below `min` (or at it, when not inclusive) → unknown. */
export function bucketOf(list: readonly Bucket[], v: unknown, min: number, minInclusive: boolean): string {
  const n = toNum(v);
  if (n == null || (minInclusive ? n < min : n <= min)) return UNKNOWN_KEY;
  return list.find((x) => n < x.before)!.key;
}
export const seqKeyOf = (seq: unknown) => bucketOf(SEQ_BUCKETS, seq, 1, true);
export const priceKeyOf = (entry: unknown) => bucketOf(PRICE_BUCKETS, entry, 0, false);
export const sizeKeyOf = (notional: unknown) => bucketOf(SIZE_BUCKETS, notional, 0, false);
export const sizeRelKeyOf = (ratio: unknown) => bucketOf(SIZE_REL_BUCKETS, ratio, 0, false);
/** with | none by trade.hasStop; unknown when not derived yet. */
export function stopKeyOf(hasStop: unknown): string {
  return hasStop === true ? "with" : hasStop === false ? "none" : UNKNOWN_KEY;
}
export function holdKeyOf(holdSec: unknown, overnight: unknown): string {
  return overnight === true ? OVERNIGHT_KEY : bucketOf(HOLD_BUCKETS, holdSec, 0, true);
}
/** win / loss / be by the net (pnl − |fees|, to 1/10000 like the stored numeric); unknown without pnl. */
export function resultKeyOf(pnl: unknown, fees: unknown): string {
  const g = toNum(pnl);
  if (g == null) return UNKNOWN_KEY;
  const net = Math.round((g - Math.abs(toNum(fees) ?? 0)) * 1e4);
  return net > 0 ? "win" : net < 0 ? "loss" : "be";
}

type FacetTrade = Pick<Trade, "date" | "side" | "tags" | "strategy" | "entrySec" | "contextSnapshot"> &
  Partial<Pick<Trade, "ticker" | "entry" | "pnl" | "fees" | "brokerAccount" | "holdSec" | "overnight" | "entryKind" | "exitKind" | "notional" | "daySeq" | "prevKind"
    | "addsKind" | "sizeRel" | "hasStop">>;

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
    seq: [seqKeyOf(t.daySeq)],
    prev: [t.prevKind || UNKNOWN_KEY],
    entry: [t.entryKind || UNKNOWN_KEY],
    adds: [t.addsKind || UNKNOWN_KEY],
    exit: [t.exitKind || UNKNOWN_KEY],
    stop: [stopKeyOf(t.hasStop)],
    hold: [holdKeyOf(t.holdSec, t.overnight)],
    tickers: [(t.ticker ?? "").trim().toUpperCase() || UNKNOWN_KEY],
    price: [priceKeyOf(t.entry)],
    size: [sizeKeyOf(t.notional)],
    sizeRel: [sizeRelKeyOf(t.sizeRel)],
    accounts: [(t.brokerAccount ?? "").trim() || MANUAL_ACCOUNT_KEY],
    result: [resultKeyOf(t.pnl, t.fees)],
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
