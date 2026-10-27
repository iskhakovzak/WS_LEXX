/**
 * Finviz Elite on the web — pure logic (no React): API shapes (finviz/CONTRACT.md), the morning clock, screener sort and
 * summary, the plan watchlist merge for «в план», the earnings flag of a ticker and the earnings block buckets.
 * Values arrive as numbers in absolute units (shares, $, %); null = Finviz had no value.
 */
import { fmtCompact, fmtNum, fmtPct } from "@/lib/format";

// ── API shapes ──────────────────────────────────────────────────────────────────────────────────────────────────

export type EarningsTiming = "bmo" | "amc" | null;

/** GET /api/finviz/status */
export type FinvizStatus = {
  enabled: boolean;
  lastScreenAt: string | null;
  lastSnapshotAt: string | null;
  lastEarningsAt: string | null;
};

export const SCREENER_PRESETS = ["gappers", "relvol", "earnings_today"] as const;
export type ScreenerPreset = (typeof SCREENER_PRESETS)[number];

export type ScreenerRow = {
  ticker: string;
  company: string | null;
  sector: string | null;
  price: number | null;
  changePct: number | null;
  gapPct: number | null;
  relVolume: number | null;
  volume: number | null;
  avgVolume: number | null;
  float: number | null;
  shortFloatPct: number | null;
  atr: number | null;
  marketCap: number | null;
  earningsDate: string | null;
  earningsTiming: EarningsTiming;
};

/** GET /api/finviz/screener?preset= */
export type ScreenerResponse = { asOf: string | null; preset: ScreenerPreset; rows: ScreenerRow[] };

/** GET /api/finviz/ticker/:symbol (null = Finviz has no snapshot of it). */
export type TickerSnapshot = {
  ticker: string;
  company: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  marketCap: number | null;
  float: number | null;
  shortFloatPct: number | null;
  shortRatio: number | null;
  avgVolume: number | null;
  relVolume: number | null;
  atr: number | null;
  beta: number | null;
  earningsDate: string | null;
  earningsTiming: EarningsTiming;
  asOf: string | null;
};

/** Row of GET /api/finviz/earnings?from=&to= */
export type EarningsRow = { ticker: string; date: string; timing: EarningsTiming; company: string | null; marketCap: number | null };

// ── Tickers and dates ───────────────────────────────────────────────────────────────────────────────────────────

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** "nvda " → "NVDA"; anything that is not a plain US ticker → null (no request for it). */
export function normTicker(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Next weekday after `date` (exchange holidays are not known here). */
export function nextWeekday(date: string): string {
  let d = shift(date, 1);
  while (weekday(d) === 0 || weekday(d) === 6) d = shift(d, 1);
  return d;
}

/** The NY clock of an instant: calendar date and minutes since midnight. */
export function nyClock(now: Date): { date: string; minutes: number } {
  const parts = now.toLocaleString("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  // "10/19/2026, 08:05"
  const m = /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/.exec(parts);
  if (!m) return { date: now.toISOString().slice(0, 10), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
  const hh = Number(m[4]) % 24;
  return { date: `${m[3]}-${m[1]}-${m[2]}`, minutes: hh * 60 + Number(m[5]) };
}

/** The NY trading session of an instant: today on a weekday, the next weekday on a weekend. */
export function sessionDay(now: Date): string {
  const { date } = nyClock(now);
  const wd = weekday(date);
  return wd === 0 || wd === 6 ? nextWeekday(date) : date;
}

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

/**
 * The day the morning screener prepares for and whether it is still «before the open» (the card is the focal point
 * then; after the bell it collapses). Weekend → the next session, before the open. After the close the next session is
 * prepared from the evening, so it counts as before the open too.
 */
export function morningState(now: Date): { planDate: string; beforeOpen: boolean } {
  const { date, minutes } = nyClock(now);
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return { planDate: nextWeekday(date), beforeOpen: true };
  if (minutes < OPEN_MIN) return { planDate: date, beforeOpen: true };
  if (minutes >= CLOSE_MIN) return { planDate: nextWeekday(date), beforeOpen: true };
  return { planDate: date, beforeOpen: false };
}

// ── Screener ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The move that matters for a row: the gap before the open (gappers), else the change of the day. */
export function rowMove(r: Pick<ScreenerRow, "gapPct" | "changePct">, preset: ScreenerPreset): number | null {
  if (preset === "gappers") return r.gapPct ?? r.changePct;
  return r.changePct ?? r.gapPct;
}

export type ScreenerSortKey = "ticker" | "price" | "move" | "relVolume" | "float" | "shortFloat" | "atr" | "marketCap";

/** Default sort per preset: gappers by |gap|, volume by RVOL, earnings by market cap. */
export const DEFAULT_SORT: Record<ScreenerPreset, ScreenerSortKey> = { gappers: "move", relvol: "relVolume", earnings_today: "marketCap" };

export function sortValue(r: ScreenerRow, key: ScreenerSortKey, preset: ScreenerPreset): number | string | null {
  switch (key) {
    case "ticker": return r.ticker;
    case "price": return r.price;
    case "move": {
      const m = rowMove(r, preset);
      return m == null ? null : Math.abs(m);
    }
    case "relVolume": return r.relVolume;
    case "float": return r.float;
    case "shortFloat": return r.shortFloatPct;
    case "atr": return r.atr;
    case "marketCap": return r.marketCap;
  }
}

/** Sorted copy; empty values always sink to the bottom. */
export function sortRows(rows: readonly ScreenerRow[], key: ScreenerSortKey, dir: "asc" | "desc", preset: ScreenerPreset): ScreenerRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    const va = sortValue(a, key, preset);
    const vb = sortValue(b, key, preset);
    if (va == null && vb == null) return a.ticker.localeCompare(b.ticker);
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return (dir === "asc" ? cmp : -cmp) || a.ticker.localeCompare(b.ticker);
  });
  return out;
}

/** Collapsed card line: how many candidates and the leader (largest |move|). */
export function screenerSummary(rows: readonly ScreenerRow[], preset: ScreenerPreset): { count: number; leader: ScreenerRow | null; move: number | null } {
  let leader: ScreenerRow | null = null;
  let best = -1;
  for (const r of rows) {
    const m = rowMove(r, preset);
    const v = preset === "relvol" ? r.relVolume ?? -1 : preset === "earnings_today" ? r.marketCap ?? -1 : m == null ? -1 : Math.abs(m);
    if (v > best) {
      best = v;
      leader = r;
    }
  }
  return { count: rows.length, leader, move: leader ? rowMove(leader, preset) : null };
}

// ── «В план»: the personal plan watchlist ───────────────────────────────────────────────────────────────────────

/** Server cap of plan tickers (api-server lib/gamePlan.ts PlanBody.inPlay max). */
export const PLAN_MAX_TICKERS = 30;

export type PlanInPlayItem = {
  ticker: string;
  catalyst: string;
  bias: "bull" | "bear" | "neutral";
  grade: null;
  levels: { support: number[]; resistance: number[] };
  plan: string;
  horizon: "intraday";
  risk_note: string;
  scenarioA: string;
  scenarioB: string;
  trigger: string;
  invalidation: string;
  tvLink: string;
  media: never[];
};

type DocLike = Record<string, unknown> & { inPlay?: unknown };

/** Tickers already in a plan doc (upper-cased). */
export function planTickers(doc: DocLike | null | undefined): Set<string> {
  const out = new Set<string>();
  const list = Array.isArray(doc?.inPlay) ? doc.inPlay : [];
  for (const it of list) {
    const t = it && typeof it === "object" ? (it as { ticker?: unknown }).ticker : null;
    if (typeof t === "string" && t.trim()) out.add(t.trim().toUpperCase());
  }
  return out;
}

/**
 * Prefilled catalyst of a ticker added from the screener (prefill law): the numbers that made it a candidate, in the
 * trading notation that reads the same in every language (Gap, RVOL, Float, SI). `earnings` = the translated timing
 * («отчёт до открытия»), added when the ticker reports.
 */
export function catalystLine(r: ScreenerRow, preset: ScreenerPreset, earnings: string | null): string {
  const parts: string[] = [];
  const move = rowMove(r, preset);
  if (move != null) parts.push(preset === "gappers" ? `Gap ${fmtPct(move, 1)}` : fmtPct(move, 1));
  if (rvolValue(r.relVolume) != null) parts.push(`RVOL ${fmtNum(r.relVolume, 1)}`);
  if (r.float != null) parts.push(`Float ${fmtCompact(r.float)}`);
  if (r.shortFloatPct != null) parts.push(`SI ${fmtPct(r.shortFloatPct, { decimals: 1, signed: false })}`);
  if (earnings) parts.push(earnings);
  return parts.join(" · ").slice(0, 500);
}

export function newPlanItem(ticker: string, catalyst: string): PlanInPlayItem {
  return {
    ticker, catalyst, bias: "neutral", grade: null, levels: { support: [], resistance: [] }, plan: "", horizon: "intraday", risk_note: "",
    scenarioA: "", scenarioB: "", trigger: "", invalidation: "", tvLink: "", media: [],
  };
}

export type AddToPlanResult = { kind: "added"; doc: DocLike } | { kind: "exists" } | { kind: "full" };

/**
 * The stored plan doc with one more ticker at the end of «Тикеры». Every stored field is sent back as is (the plan
 * PUT replaces the doc); a picks-only row (no inPlay yet) simply gets its first ticker.
 */
export function addTickerToDoc(doc: DocLike | null | undefined, item: PlanInPlayItem): AddToPlanResult {
  const base: DocLike = doc && typeof doc === "object" ? { ...doc } : {};
  const list = Array.isArray(base.inPlay) ? [...(base.inPlay as unknown[])] : [];
  if (planTickers(base).has(item.ticker.toUpperCase())) return { kind: "exists" };
  if (list.length >= PLAN_MAX_TICKERS) return { kind: "full" };
  list.push(item);
  return { kind: "added", doc: { ...base, inPlay: list } };
}

// ── Earnings ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EarningsFlag = "todayBmo" | "todayAmc" | "today" | "tomorrowBmo";

/**
 * Does `ticker` report around trading day `day`? Today before the open (the gap is the report), today after the close
 * (holding into it is a risk), today with no time, or the next session before the open (overnight risk).
 */
export function earningsFlag(ticker: string, rows: readonly EarningsRow[] | null | undefined, day: string): EarningsFlag | null {
  const t = ticker.trim().toUpperCase();
  if (!t || !rows?.length) return null;
  const next = nextWeekday(day);
  let flag: EarningsFlag | null = null;
  for (const r of rows) {
    if (r.ticker.toUpperCase() !== t) continue;
    if (r.date === day) return r.timing === "bmo" ? "todayBmo" : r.timing === "amc" ? "todayAmc" : "today";
    if (r.date === next && r.timing === "bmo") flag = "tomorrowBmo";
  }
  return flag;
}

/** The same flag from a snapshot / screener row that carries its own earnings date. */
export function earningsFlagOf(x: { earningsDate: string | null; earningsTiming: EarningsTiming; ticker: string }, day: string): EarningsFlag | null {
  if (!x.earningsDate) return null;
  return earningsFlag(x.ticker, [{ ticker: x.ticker, date: x.earningsDate.slice(0, 10), timing: x.earningsTiming, company: null, marketCap: null }], day);
}

export type EarningsPeriod = "today" | "tomorrow" | "week";

/** The date range of a period of the «Отчёты» block; «week» = today through the Friday of this week (next one on a weekend). */
export function periodRange(period: EarningsPeriod, today: string): { from: string; to: string } {
  const wd = weekday(today);
  const start = wd === 0 || wd === 6 ? nextWeekday(today) : today;
  if (period === "today") return { from: start, to: start };
  if (period === "tomorrow") {
    const d = nextWeekday(start);
    return { from: d, to: d };
  }
  const friday = shift(start, 5 - weekday(start));
  return { from: start, to: friday };
}

/** Rows of a period: own tickers first, then by market cap (largest first), then by date and timing (BMO before AMC). */
export function earningsList(rows: readonly EarningsRow[], range: { from: string; to: string }, mine: ReadonlySet<string>): EarningsRow[] {
  const order = (t: EarningsTiming) => (t === "bmo" ? 0 : t === "amc" ? 2 : 1);
  return rows
    .filter((r) => r.date >= range.from && r.date <= range.to)
    .sort((a, b) => {
      const ma = mine.has(a.ticker.toUpperCase()) ? 0 : 1;
      const mb = mine.has(b.ticker.toUpperCase()) ? 0 : 1;
      if (ma !== mb) return ma - mb;
      const ca = a.marketCap ?? -1;
      const cb = b.marketCap ?? -1;
      if (ca !== cb) return cb - ca;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return order(a.timing) - order(b.timing) || a.ticker.localeCompare(b.ticker);
    });
}

/**
 * Relative volume as shown: «—» while there is no volume yet (premarket / a fresh session reports 0, which printed as
 * a suspicious «0.0»), else one decimal. `null` for «not shown» in compact lines.
 */
export function rvolValue(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) || v < 0.05 ? null : v;
}
