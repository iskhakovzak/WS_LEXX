/**
 * The strategy of a trade, PropReports style — ONE pure function (`deriveTradeStrategy`) for the whole site: the
 * stored column trades.strategy (lib/tradeStrategyStore, migrations 0237 / 0243), the /trades and /stats facets and
 * «Статистика офиса» (lib/officeStats classifyStrategy folds Print / Swing / Adjust into its seven classes).
 * Owner rules 2026-10-21: «OPG — открытие с начала премаркета до принта; OPGtoDAY — открытые на премаркете и закрытые в
 * течение дня, даже если принтом закрытия; Overnight — закрыты на следующий торговый день; Swing — больше 1 дня».
 *
 * Inputs: the symbol, the stored session / dates / horizon / size, the New York time of every fill (trade_executions,
 * else the broker's openedAt / closedAt), the desk Print cluster flag (lib/tradeStrategyStore) and the full-day market
 * holidays (holiday_calendar). A pre-market entry = first entry fill before 09:30:00 NY. Rules, first match wins:
 *
 *   1. OPT          the symbol is an option contract (OCC style «AAPL261016C00230000», also «AAPL 261016C230»).
 *   2. Adjust       a broker adjustment, not a market trade: zero size or a zero price on a stored trade.
 *   3. Overnight    exit on the NEXT trading day (weekends and full-day holidays skipped: Friday → Monday), entry and
 *                   exit in any session (pre-market … after-market). Swing: exit 2+ trading days after the entry.
 *                   Dates from the fills, else date → exit_date; without a later date the stored horizon decides
 *                   ('overnight' → Overnight, 'swing' → Swing).
 *   4. (no entry time) the session decides: premarket → OPG, postmarket → AfterMarket, any fill in the IMX window →
 *                   MOC, else Day.
 *   5. Pre-market entry, same day:
 *        OPG        exit before 09:30:00 (the pre-market round trip), or no exit time;
 *        Print      closed by the opening print: exit in [09:30:00, 09:30:01] (the cross + PRINT_REPORT_LAG_SEC of
 *                   report lag — any listing, the desk has no exchange data), or a desk cluster: exit before
 *                   PRINT_CLUSTER_UNTIL_SEC (09:45:00) at the same second as the pre-market positions of ≥
 *                   PRINT_CLUSTER_MIN_TRADERS distinct traders in the same ticker on the same NY day (this trade
 *                   included; NYSE auctions open at a random time) — `isOpenPrintCluster`, computed desk-wide by the store;
 *        OPGtoDAY   any later exit the same day — including the close auction (IMX window) and the after-market.
 *   6. Regular-session entry (09:30:00–15:59:59), same day: any fill in the IMX window → MOC (desk setting
 *      trades.imxWindowStart / End, default 15:50–16:00 NY, end minute inclusive); exit ≥ 16:01:00 → AfterMarket;
 *      else Day.
 *   7. AfterMarket  entered in the after-market (first entry ≥ 16:00:00).
 *
 * IMX (close-auction trade) is NOT a strategy: `isImxTrade` = any fill inside the IMX window, stored apart
 * (trades.is_imx, migration 0243; lib/imx). A pre-market entry closed in the close auction is OPGtoDAY + IMX.
 */

import { addDays, isWeekend } from "./tradingDate";

/** Every strategy, in display order (by time of day, then the multi-day holds, then the non-market rows). */
export const TRADE_STRATEGIES = ["OPG", "Print", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "Swing", "Adjust", "OPT"] as const;
export type TradeStrategy = (typeof TRADE_STRATEGIES)[number];

export function isTradeStrategy(v: unknown): v is TradeStrategy {
  return typeof v === "string" && (TRADE_STRATEGIES as readonly string[]).includes(v);
}

const hms = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

/** Regular session open / close (New York). */
export const RTH_OPEN_SEC = hms(9, 30);
export const RTH_CLOSE_SEC = hms(16, 0);
/** Print (opening cross): a pre-market position flat by 09:30:00 + this lag (the cross print and its report, inclusive). */
export const PRINT_REPORT_LAG_SEC = 1;
/** Print (desk cluster): the same-second exit of ≥ this many distinct traders' pre-market positions marks an auction. */
export const PRINT_CLUSTER_MIN_TRADERS = 3;
/** Print (desk cluster): the auction exit must come before 09:45:00 (exclusive). */
export const PRINT_CLUSTER_UNTIL_SEC = hms(9, 45);
/** An intraday exit from 16:01:00 on is a post-market close. */
export const AFTER_CLOSE_EXIT_SEC = hms(16, 1);
/** OCC-style option symbols: root (1–6) + YYMMDD + C/P + strike, optional «.», «+» or «O:» prefix and spaces. */
export const OPTION_SYMBOL_RE = /^[.+]?(?:O:)?[A-Z][A-Z0-9.]{0,5}\s*\d{6}\s*[CP]\s*\d{1,8}(?:\.\d+)?$/i;

export function isOptionSymbol(ticker: string | null | undefined): boolean {
  return !!ticker && OPTION_SYMBOL_RE.test(ticker.trim());
}

// ─── IMX window ─────────────────────────────────────────────────────────────────────────────────────────────

/** The close-auction window, seconds since NY midnight: a fill at `sec` is inside when fromSec ≤ sec < toSec + 60. */
export interface ImxWindow { start: string; end: string; fromSec: number; toSec: number }

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const parseHhmm = (s: string): number | null => {
  const m = HHMM_RE.exec((s ?? "").trim());
  return m ? hms(Number(m[1]), Number(m[2])) : null;
};
const fmtHhmm = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;

export const DEFAULT_IMX_START = "15:50";
export const DEFAULT_IMX_END = "16:00";

/** Window from two "HH:MM" (NY); an invalid value falls back to the default, a reversed pair is swapped. */
export function imxWindowOf(start: string = DEFAULT_IMX_START, end: string = DEFAULT_IMX_END): ImxWindow {
  let a = parseHhmm(start) ?? parseHhmm(DEFAULT_IMX_START)!;
  let b = parseHhmm(end) ?? parseHhmm(DEFAULT_IMX_END)!;
  if (b < a) [a, b] = [b, a];
  return { start: fmtHhmm(a), end: fmtHhmm(b), fromSec: a, toSec: b };
}

export const DEFAULT_IMX_WINDOW: ImxWindow = imxWindowOf();

export function inImxWindow(sec: number, w: ImxWindow = DEFAULT_IMX_WINDOW): boolean {
  return sec >= w.fromSec && sec < w.toSec + 60;
}

// ─── New York time of a fill ────────────────────────────────────────────────────────────────────────────────

const NY_TZ = "America/New_York";
const nyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: NY_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/**
 * NY UTC offset (ms) per UTC hour. US DST switches happen on a whole UTC hour, so one Intl call per hour is
 * exact — and the office endpoint classifies ~45k trades per load (formatToParts per trade cost ~0.4 s).
 */
const HOUR_MS = 3_600_000;
const nyOffsetByHour = new Map<number, number>();
function nyOffsetMs(ms: number): number {
  const hk = Math.floor(ms / HOUR_MS);
  let off = nyOffsetByHour.get(hk);
  if (off === undefined) {
    const base = hk * HOUR_MS;
    const p: Record<string, string> = {};
    for (const x of nyFmt.formatToParts(new Date(base))) p[x.type] = x.value;
    off = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - base;
    if (nyOffsetByHour.size > 100_000) nyOffsetByHour.clear();
    nyOffsetByHour.set(hk, off);
  }
  return off;
}

/** A naive broker wall clock ("YYYY-MM-DD HH:MM[:SS]", ET, no zone) — read as is, never through the server zone. */
const WALL_RE = /^(\d{4}-\d{2}-\d{2})[T ]([0-2]\d):([0-5]\d)(?::([0-5]\d))?(?:\.\d+)?$/;

/** New York calendar date + seconds since NY midnight of an instant (or a naive ET wall clock); null when unreadable. */
export function nyParts(at: string | Date | null | undefined): { date: string; sec: number } | null {
  if (at == null || at === "") return null;
  if (typeof at === "string") {
    const w = WALL_RE.exec(at.trim());
    if (w) return { date: w[1]!, sec: hms(Number(w[2]), Number(w[3]), Number(w[4] ?? 0)) };
  }
  const d = at instanceof Date ? at : new Date(at);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  const local = new Date(ms + nyOffsetMs(ms));
  return { date: local.toISOString().slice(0, 10), sec: local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds() };
}

// ─── Trading days ───────────────────────────────────────────────────────────────────────────────────────────

const NO_HOLIDAYS: ReadonlySet<string> = new Set();
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Trading days d with from < d ≤ to (weekends and the full-day holidays in `closed` skipped): Friday → Monday = 1. */
export function tradingDaysAfter(from: string, to: string, closed: ReadonlySet<string> = NO_HOLIDAYS): number {
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to) || to <= from) return 0;
  let n = 0;
  for (let d = addDays(from, 1), i = 0; d <= to && i < 4000; d = addDays(d, 1), i++) if (!isWeekend(d) && !closed.has(d)) n++;
  return n;
}
// ─── Derivation ─────────────────────────────────────────────────────────────────────────────────────────────

type When = string | Date | null | undefined;

export interface StrategyInput {
  ticker: string | null;
  /** trades.session: 'regular' | 'premarket' | 'postmarket' | null. */
  session?: string | null;
  /** trades.date (entry date, YYYY-MM-DD). */
  date?: string | null;
  /** trades.exit_date (multi-day holds). */
  exitDate?: string | null;
  /** trades.horizon: 'intraday' | 'overnight' | 'swing' | null. */
  horizon?: string | null;
  /** Stored size and prices (Adjust: an explicit 0, never a missing value). */
  qty?: number | string | null;
  entry?: number | string | null;
  /** First entry fill (instant or naive ET wall clock). */
  entryAt?: When;
  /** Last exit fill. */
  exitAt?: When;
  /** Every fill time (the IMX window looks at all of them; entryAt / exitAt are added). */
  fills?: readonly When[] | null;
  /**
   * The last exit shares its second (same ticker, same NY day) with the pre-market positions of ≥
   * PRINT_CLUSTER_MIN_TRADERS distinct desk traders — computed desk-wide by lib/tradeStrategyStore (rule 5, Print).
   */
  isOpenPrintCluster?: boolean | null;
}

/** IMX = a close-auction trade: any fill (first entry, last exit or any other) inside the IMX window. */
export function isImxTrade(t: Pick<StrategyInput, "entryAt" | "exitAt" | "fills">, win: ImxWindow = DEFAULT_IMX_WINDOW): boolean {
  for (const f of [t.entryAt, t.exitAt, ...(t.fills ?? [])]) {
    const p = nyParts(f);
    if (p && inImxWindow(p.sec, win)) return true;
  }
  return false;
}

/** Trading days held (≥ 1) when the trade crosses a session close — fills, else date → exit_date, else the horizon; null = same day. */
function heldDaysOf(t: StrategyInput, en: { date: string } | null, ex: { date: string } | null, closed: ReadonlySet<string>): number | null {
  if (en && ex && ex.date > en.date) return Math.max(1, tradingDaysAfter(en.date, ex.date, closed));
  const d0 = (t.date ?? "").slice(0, 10);
  const d1 = (t.exitDate ?? "").slice(0, 10);
  if (d0 && d1 && d1 > d0) return Math.max(1, tradingDaysAfter(d0, d1, closed));
  const h = (t.horizon ?? "").trim().toLowerCase();
  if (h === "swing") return 2;
  if (h === "overnight") return 1;
  return null;
}

const isZero = (v: number | string | null | undefined) => v != null && v !== "" && Number(v) === 0;

/** `closed` = the full-day market holidays (YYYY-MM-DD) for the trading-day distance of Overnight / Swing. */
export function deriveTradeStrategy(t: StrategyInput, win: ImxWindow = DEFAULT_IMX_WINDOW, closed: ReadonlySet<string> = NO_HOLIDAYS): TradeStrategy {
  if (isOptionSymbol(t.ticker)) return "OPT";
  if (isZero(t.qty) || isZero(t.entry)) return "Adjust";
  const en = nyParts(t.entryAt);
  const ex = nyParts(t.exitAt);
  const held = heldDaysOf(t, en, ex, closed);
  if (held != null) return held >= 2 ? "Swing" : "Overnight";

  if (!en) {
    const s = (t.session ?? "").toLowerCase();
    if (s === "premarket") return "OPG";
    if (s === "postmarket") return "AfterMarket";
    return isImxTrade(t, win) ? "MOC" : "Day";
  }
  if (en.sec < RTH_OPEN_SEC) {
    if (!ex || ex.sec < RTH_OPEN_SEC) return "OPG";
    if (ex.sec <= RTH_OPEN_SEC + PRINT_REPORT_LAG_SEC) return "Print";
    if (t.isOpenPrintCluster === true && ex.sec < PRINT_CLUSTER_UNTIL_SEC) return "Print";
    return "OPGtoDAY";
  }
  if (en.sec >= RTH_CLOSE_SEC) return "AfterMarket";
  if (isImxTrade(t, win)) return "MOC";
  if (ex && ex.sec >= AFTER_CLOSE_EXIT_SEC) return "AfterMarket";
  return "Day";
}

/** Seconds since NY midnight of the first entry (the «Время» facet); null when unknown. */
export function entrySecOf(t: Pick<StrategyInput, "entryAt">): number | null {
  return nyParts(t.entryAt)?.sec ?? null;
}

