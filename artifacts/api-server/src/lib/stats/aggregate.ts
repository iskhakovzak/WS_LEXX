/**
 * Server aggregates for the staff view of /stats and /analytics (Волна 2 п. 2.5): the pages ask for these instead of
 * downloading the raw trades of the whole desk (~1.3 KB per trade; 50 traders × 90 days ≈ 13–15 MB). Pure functions,
 * no I/O — routes/stats-aggregate.ts loads the rows. Same definitions as the browser (edge-tracker/src/lib/trade-math.ts
 * and components/stats/metrics.ts), via the server mirror lib/tradeMath.ts:
 *
 *   closed     result win / loss / be (any stored spelling); open and unknown results count only in `n`
 *   values     r = signed R (lib/tradeMath signedR), gross = pnl as stored, net = pnl − |fees|; only closed trades
 *   day        close date = exit date, else the trade date (YYYY-MM-DD) — every period / day / weekday cut uses it
 *   hour       entry time in ET: the time part of `date`, else the broker snapshot `openedAt` (stats/metrics hourKey)
 *   fees       Σ|fees| over closed trades that have a P&L (net must equal gross − fees)
 *
 * A bucket is a fixed-order number array (BUCKET_FIELDS) so a desk-wide answer stays small: KPI cards, the daily equity
 * curve, the calendar, weekday × hour cells and every breakdown are sums of buckets; max drawdown is measured on the
 * end-of-day curve (canonical maxDrawdownByDay), win rate = W / (W + L).
 */
import { num, normResult, signedR } from "../tradeMath";

export const BUCKET_FIELDS = [
  "n", "closed", "wins", "losses",
  "rN", "r", "rPos", "rNeg", "rPosN", "rNegN",
  "pnlN", "gross", "grossPos", "grossNeg", "grossPosN", "grossNegN",
  "net", "netPos", "netNeg", "netPosN", "netNegN",
  "fees", "withFees",
] as const;
export type BucketField = (typeof BUCKET_FIELDS)[number];
export type Bucket = number[];
const F = Object.fromEntries(BUCKET_FIELDS.map((k, i) => [k, i])) as Record<BucketField, number>;

export type Metric = "r" | "usd" | "net";
export const METRICS: readonly Metric[] = ["r", "usd", "net"];

/** One trade row as routes/stats-aggregate.ts selects it (snake_case DB names, numerics may be strings). */
export type AggTradeRow = {
  id: number;
  trader: string | null;
  ticker: string | null;
  date: string | null;
  exit_date: string | null;
  result: string | null;
  side: string | null;
  entry: unknown; exit: unknown; stop: unknown;
  r_multiple: unknown; pnl: unknown; fees: unknown; risk_usd: unknown;
  horizon: string | null;
  setup: string | null;
  event_type: string | null;
  sector: string | null;
  session: string | null;
  conviction: number | null;
  broker_account: string | null;
  source: string | null;
  created_at: Date | string | null;
  opened_at: string | null;
};

/** Filters of /analytics (FilterBar) and /stats (horizon), applied exactly like the browser's applyNonPeriodFilters. */
export type AggFilters = {
  horizon?: "intraday" | "overnight" | "swing";
  side?: "long" | "short";
  ticker?: string;
  /** "__none__" = trades without a setup. */
  setup?: string;
  account?: string;
  source?: "manual" | "propreports";
};

type Facts = {
  row: AggTradeRow;
  day: string;
  closed: boolean;
  result: "win" | "loss" | "be" | null;
  open: boolean;
  r: number | null;
  gross: number | null;
  net: number | null;
  fees: number;
  hour: string;
  weekday: number;
  horizon: "intraday" | "overnight" | "swing";
};

const CLOCK_RE = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/;

/** Entry time as ET minutes (stats/metrics entryMinutes): timed `date`, else the snapshot `openedAt`. */
export function entryMinutesOf(date: string | null, openedAt: string | null): number | null {
  const a = CLOCK_RE.exec(String(date ?? ""));
  if (a) return Number(a[1]) * 60 + Number(a[2]);
  const b = typeof openedAt === "string" ? CLOCK_RE.exec(openedAt) : null;
  return b ? Number(b[1]) * 60 + Number(b[2]) : null;
}

/** Heatmap column (stats/metrics hourKey): pre · h9…h15 · post · none. */
export function hourKeyOf(minutes: number | null): string {
  if (minutes == null) return "none";
  if (minutes < 9 * 60 + 30) return "pre";
  if (minutes >= 16 * 60) return "post";
  return `h${Math.floor(minutes / 60)}`;
}

/** Monday-first weekday 0..6 of a YYYY-MM-DD key (stats/metrics weekdayIdx). */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)).getUTCDay() + 6) % 7;
}

const SESSION_CODES: Record<string, string> = {
  premarket: "premarket", pre: "premarket", regular: "regular", rth: "regular",
  afterhours: "afterhours", "after-hours": "afterhours", postmarket: "afterhours", after: "afterhours",
};
/** Session code (stats/metrics sessionKey); the page turns it into a label. */
export function sessionKeyOf(s: string | null): string {
  const v = (s ?? "").trim().toLowerCase();
  if (!v) return "none";
  return SESSION_CODES[v] ?? v;
}

/** Group key of the setup cut: the setup, else the event type marked with EVENT_PREFIX (the page shows its label). */
export const EVENT_PREFIX = "~ev:";
const NO_KEY = "—";

function factsOf(row: AggTradeRow): Facts {
  const day = String(row.exit_date || row.date || "").substring(0, 10);
  const result = normResult(row.result) === "open" ? null : (normResult(row.result) as Facts["result"]);
  const open = String(row.result ?? "").trim().toLowerCase() === "open";
  const closed = result != null;
  const gross = closed ? num(row.pnl) : null;
  const h = row.horizon === "overnight" || row.horizon === "swing" ? row.horizon : "intraday";
  return {
    row, day, closed, result, open,
    r: closed ? signedR(row) : null,
    gross,
    net: gross == null ? null : gross - Math.abs(num(row.fees) ?? 0),
    fees: Math.abs(num(row.fees) ?? 0),
    hour: hourKeyOf(entryMinutesOf(row.date, row.opened_at)),
    weekday: day ? weekdayOf(day) : 0,
    horizon: h,
  };
}

const sideOf = (s: string | null): "long" | "short" | "" => {
  const v = (s ?? "").trim().toLowerCase();
  return v.startsWith("l") ? "long" : v.startsWith("s") ? "short" : "";
};

/** The browser's applyNonPeriodFilters (minus the trader — the route scopes the rows). */
export function passesFilters(row: AggTradeRow, f: AggFilters): boolean {
  if (f.side && sideOf(row.side) !== f.side) return false;
  if (f.horizon && (row.horizon === "overnight" || row.horizon === "swing" ? row.horizon : "intraday") !== f.horizon) return false;
  if (f.ticker && (row.ticker ?? "").toUpperCase() !== f.ticker.toUpperCase()) return false;
  if (f.setup === "__none__" ? !!row.setup : f.setup && (row.setup ?? "") !== f.setup) return false;
  if (f.account && (row.broker_account ?? "").trim() !== f.account) return false;
  if (f.source && (row.source === "propreports" ? "propreports" : "manual") !== f.source) return false;
  return true;
}

export const emptyBucket = (): Bucket => BUCKET_FIELDS.map(() => 0);

function addTo(b: Bucket, x: Facts): void {
  b[F.n]++;
  if (!x.closed) return;
  b[F.closed]++;
  if (x.result === "win") b[F.wins]++;
  else if (x.result === "loss") b[F.losses]++;
  if (x.r != null) {
    b[F.rN]++; b[F.r] += x.r;
    if (x.r > 0) { b[F.rPos] += x.r; b[F.rPosN]++; } else if (x.r < 0) { b[F.rNeg] += x.r; b[F.rNegN]++; }
  }
  if (x.gross != null && x.net != null) {
    b[F.pnlN]++; b[F.gross] += x.gross; b[F.net] += x.net; b[F.fees] += x.fees;
    if (x.fees > 0) b[F.withFees]++;
    if (x.gross > 0) { b[F.grossPos] += x.gross; b[F.grossPosN]++; } else if (x.gross < 0) { b[F.grossNeg] += x.gross; b[F.grossNegN]++; }
    if (x.net > 0) { b[F.netPos] += x.net; b[F.netPosN]++; } else if (x.net < 0) { b[F.netNeg] += x.net; b[F.netNegN]++; }
  }
}

/** Sums rounded to 1e-4 (DB precision of pnl / fees) — keeps the JSON short, never changes a cent. */
const round = (b: Bucket): Bucket => b.map((v) => (Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4));

export type Keyed = { key: string; b: Bucket };

class Groups {
  private m = new Map<string, Bucket>();
  add(key: string, x: Facts) {
    let b = this.m.get(key);
    if (!b) { b = emptyBucket(); this.m.set(key, b); }
    addTo(b, x);
  }
  list(): Keyed[] {
    return [...this.m.entries()].map(([key, b]) => ({ key, b: round(b) }));
  }
}

const keyOf = (v: string | null | undefined): string => (v ?? "").toString().trim() || NO_KEY;

export const GROUP_DIMS = ["trader", "setup", "sector", "ticker", "session", "conviction", "horizon", "weekday", "hour", "account", "source"] as const;
export type GroupDim = (typeof GROUP_DIMS)[number];

function dimKey(dim: GroupDim, x: Facts): string {
  const r = x.row;
  switch (dim) {
    case "trader": return keyOf(r.trader);
    case "setup": return keyOf(r.setup || (r.event_type ? `${EVENT_PREFIX}${r.event_type}` : null));
    case "sector": return keyOf(r.sector);
    case "ticker": return keyOf(r.ticker?.toUpperCase());
    case "session": return sessionKeyOf(r.session);
    case "conviction": return r.conviction != null ? String(r.conviction) : NO_KEY;
    case "horizon": return x.horizon;
    case "weekday": return String(x.weekday);
    case "hour": return x.hour;
    case "account": return keyOf(r.broker_account);
    case "source": return r.source === "propreports" ? "propreports" : "manual";
  }
}

export type Streaks = { longestWin: number; longestLoss: number; current: { kind: "win" | "loss" | null; len: number } };

const createdKey = (v: Date | string | null): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));

/** Chronological order of the browser (stats/metrics chrono): close day, entry date, creation time, id. */
function chrono(xs: Facts[]): Facts[] {
  return [...xs].sort((a, b) => a.day.localeCompare(b.day)
    || String(a.row.date ?? "").substring(0, 10).localeCompare(String(b.row.date ?? "").substring(0, 10))
    || createdKey(a.row.created_at).localeCompare(createdKey(b.row.created_at)) || a.row.id - b.row.id);
}

/** Win / loss runs over closed trades in order (break-even breaks a run) — stats/metrics computeKpis. */
export function streaksOf(closedInOrder: readonly { result: Facts["result"] }[]): Streaks {
  let longestWin = 0, longestLoss = 0, run = 0;
  let kind: "win" | "loss" | null = null;
  for (const x of closedInOrder) {
    const k = x.result === "win" ? "win" : x.result === "loss" ? "loss" : null;
    if (k && k === kind) run++;
    else { kind = k; run = k ? 1 : 0; }
    if (kind === "win") longestWin = Math.max(longestWin, run);
    if (kind === "loss") longestLoss = Math.max(longestLoss, run);
  }
  return { longestWin, longestLoss, current: { kind, len: run } };
}

const valueOf = (x: Facts, m: Metric): number | null => (m === "r" ? x.r : m === "usd" ? x.gross : x.net);

/** A trade as the extremes list shows it (TradeLinkRow): only the fields it reads. */
export type TradeLite = {
  id: number; trader: string | null; ticker: string | null; date: string | null; exitDate: string | null; result: string | null;
  side: string | null; setup: string | null; eventType: string | null; entry: number | null; exit: number | null; stop: number | null;
  rMultiple: number | null; pnl: number | null; fees: number | null; riskUsd: number | null; horizon: string | null;
};
const lite = (r: AggTradeRow): TradeLite => ({
  id: r.id, trader: r.trader, ticker: r.ticker, date: r.date, exitDate: r.exit_date, result: r.result, side: r.side,
  setup: r.setup, eventType: r.event_type, entry: num(r.entry), exit: num(r.exit), stop: num(r.stop), rMultiple: num(r.r_multiple),
  pnl: num(r.pnl), fees: num(r.fees), riskUsd: num(r.risk_usd),
  horizon: r.horizon === "intraday" || r.horizon === "overnight" || r.horizon === "swing" ? r.horizon : null,
});

export const EXTREMES = 5;
/** Ticker groups kept (by trade count); the rest is summed into `tickersOther`. */
export const TICKERS_MAX = 300;
/** R histogram bins (analytics rHistogram): floor(R) clamped to −3 … 6. */
export const HIST_MIN = -3;
export const HIST_MAX = 6;

export type Aggregate = {
  fields: readonly BucketField[];
  total: Bucket;
  /** Per-trade best / worst value of the window per metric (null without values). */
  best: Record<Metric, number | null>;
  worst: Record<Metric, number | null>;
  streaks: Streaks;
  /** Close days ascending (the daily equity curve, calendar, drawdown, green / red days). */
  days: Keyed[];
  groups?: Record<GroupDim, Keyed[]>;
  /** Weekday × hour cells, key "weekday|hour". */
  heat?: Keyed[];
  /** Horizon groups of the same window WITHOUT the horizon filter (/stats horizon panel compares all three). */
  horizonAll?: Keyed[];
  /** Ids of the best / worst trades per metric (rows in `trades`). */
  extremes?: Record<Metric, { best: number[]; worst: number[] }>;
  trades?: TradeLite[];
  /** Signed R of closed trades: count per bin (HIST_MIN … HIST_MAX), the median and trades ≥ 2R. */
  rHist?: { bins: number[]; median: number | null; big: number };
  /** Ticker groups dropped beyond TICKERS_MAX (their trades still count in every other cut). */
  tickersOther?: number;
  /** Filter options of the window before the filters (analytics FilterBar). */
  options?: { setups: string[]; hasNoSetup: boolean; tickers: string[]; accounts: string[]; sources: string[] };
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The aggregate of `rows` (already scoped to the viewer and to the window by close date). `lite` = only the totals,
 * the days and the streaks (the comparison period needs nothing else).
 */
export function buildAggregate(rows: readonly AggTradeRow[], filters: AggFilters = {}, opts: { lite?: boolean } = {}): Aggregate {
  const all = rows.map(factsOf);
  const xs = all.filter((x) => passesFilters(x.row, filters));
  const total = emptyBucket();
  const days = new Groups();
  for (const x of xs) {
    addTo(total, x);
    if (x.day) days.add(x.day, x);
  }
  const closed = chrono(xs.filter((x) => x.closed));
  const best = {} as Record<Metric, number | null>;
  const worst = {} as Record<Metric, number | null>;
  for (const m of METRICS) {
    const vals = closed.map((x) => valueOf(x, m)).filter((v): v is number => v != null);
    best[m] = vals.length ? Math.max(...vals) : null;
    worst[m] = vals.length ? Math.min(...vals) : null;
  }
  const out: Aggregate = {
    fields: BUCKET_FIELDS,
    total: round(total),
    best, worst,
    streaks: streaksOf(closed),
    days: days.list().sort((a, b) => a.key.localeCompare(b.key)),
  };
  if (opts.lite) return out;

  const groups = Object.fromEntries(GROUP_DIMS.map((d) => [d, new Groups()])) as Record<GroupDim, Groups>;
  const heat = new Groups();
  for (const x of xs) {
    for (const d of GROUP_DIMS) groups[d].add(dimKey(d, x), x);
    if (x.day) heat.add(`${x.weekday}|${x.hour}`, x);
  }
  const lists = Object.fromEntries(GROUP_DIMS.map((d) => [d, groups[d].list()])) as Record<GroupDim, Keyed[]>;
  const tickers = lists.ticker.sort((a, b) => b.b[F.n]! - a.b[F.n]! || a.key.localeCompare(b.key));
  lists.ticker = tickers.slice(0, TICKERS_MAX);

  const horizonAll = new Groups();
  const noHorizon = { ...filters, horizon: undefined };
  for (const x of all) if (passesFilters(x.row, noHorizon)) horizonAll.add(x.horizon, x);

  const extremes = {} as Record<Metric, { best: number[]; worst: number[] }>;
  const keep = new Map<number, AggTradeRow>();
  for (const m of METRICS) {
    const valued = closed.filter((x) => valueOf(x, m) != null);
    const pick = (sign: 1 | -1) => valued.filter((x) => valueOf(x, m)! * sign > 0)
      .sort((a, b) => (valueOf(b, m)! - valueOf(a, m)!) * sign).slice(0, EXTREMES);
    const b = pick(1), w = pick(-1);
    for (const x of [...b, ...w]) keep.set(x.row.id, x.row);
    extremes[m] = { best: b.map((x) => x.row.id), worst: w.map((x) => x.row.id) };
  }

  const bins = Array.from({ length: HIST_MAX - HIST_MIN + 1 }, () => 0);
  const rs: number[] = [];
  for (const x of closed) {
    if (x.r == null) continue;
    rs.push(x.r);
    bins[Math.max(HIST_MIN, Math.min(HIST_MAX, Math.floor(x.r))) - HIST_MIN]!++;
  }

  // Filter options over the window before the filters (the browser: applyNonPeriodFilters with the trader only).
  const counts = new Map<string, number>();
  for (const x of all) { const k = (x.row.ticker ?? "").toUpperCase(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  const uniq = (vs: (string | null | undefined)[]) => [...new Set(vs.filter((v): v is string => !!v))].sort();
  return {
    ...out,
    groups: lists,
    heat: heat.list(),
    horizonAll: horizonAll.list(),
    extremes,
    trades: [...keep.values()].map(lite),
    rHist: { bins, median: median(rs), big: rs.filter((v) => v >= 2).length },
    tickersOther: Math.max(0, tickers.length - TICKERS_MAX),
    options: {
      setups: uniq(all.map((x) => x.row.setup?.trim())),
      hasNoSetup: all.some((x) => !x.row.setup),
      tickers: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TICKERS_MAX).map(([k]) => k),
      accounts: uniq(all.map((x) => (x.row.broker_account ?? "").trim())),
      sources: uniq(all.map((x) => (x.row.source === "propreports" ? "propreports" : "manual"))),
    },
  };
}

/** $ hidden from the viewer: money sums, per-trade $ extremes and the $ fields of the listed trades become null / 0. */
export const MONEY_FIELDS: readonly BucketField[] = [
  "pnlN", "gross", "grossPos", "grossNeg", "grossPosN", "grossNegN", "net", "netPos", "netNeg", "netPosN", "netNegN", "fees", "withFees",
];
export function redactAggregateMoney(a: Aggregate): Aggregate {
  const idx = MONEY_FIELDS.map((k) => F[k]);
  const blank = (b: Bucket): Bucket => b.map((v, i) => (idx.includes(i) ? 0 : v));
  const blankList = (l?: Keyed[]) => l?.map((k) => ({ key: k.key, b: blank(k.b) }));
  return {
    ...a,
    total: blank(a.total),
    best: { ...a.best, usd: null, net: null },
    worst: { ...a.worst, usd: null, net: null },
    days: blankList(a.days)!,
    groups: a.groups ? (Object.fromEntries(Object.entries(a.groups).map(([k, l]) => [k, blankList(l)])) as Record<GroupDim, Keyed[]>) : undefined,
    heat: blankList(a.heat),
    horizonAll: blankList(a.horizonAll),
    extremes: a.extremes ? { ...a.extremes, usd: { best: [], worst: [] }, net: { best: [], worst: [] } } : undefined,
    trades: a.trades?.map((t) => ({ ...t, pnl: null, fees: null, riskUsd: null })),
  };
}

/** Field index for readers of a bucket (tests, routes). */
export const bucketIndex = F;
