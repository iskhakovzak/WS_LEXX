/**
 * The strategy of a trade, PropReports style — ONE pure function (`deriveTradeStrategy`) for the whole site: the
 * stored column trades.strategy (lib/tradeStrategyStore, migration 0237), the /trades and /stats facets, the IMX mark
 * and «Статистика офиса» (lib/officeStats classifyStrategy folds Print / Adjust into its seven classes).
 *
 * Inputs: the symbol, the stored session / dates / horizon / size, and the New York time of every fill (trade_executions,
 * else the broker's openedAt / closedAt). Rules, first match wins:
 *
 *   1. OPT          the symbol is an option contract (OCC style «AAPL261016C00230000», also «AAPL 261016C230»).
 *   2. Adjust       a broker adjustment, not a market trade: zero size or a zero price on a stored trade.
 *   3. Overnight    held across a session close: horizon overnight / swing, an exit fill on a later NY date than the
 *                   entry fill, or exit_date > date.
 *   4. MOC          the close auction (imbalance): ANY fill inside the IMX window (desk setting trades.imxWindowStart /
 *                   End, default 15:50–16:00 NY; the end minute is inclusive — 16:00:00–16:00:59 is the closing cross
 *                   print and its report lag). Every MOC trade is an IMX trade (lib/imx).
 *   5. (no fill time) the session decides: premarket → OPG, postmarket → AfterMarket, else Day.
 *   6. AfterMarket  entered in the post-market (first entry ≥ 16:00:00).
 *   7. Print        the whole round trip in the pre-market (entry and exit before 09:30:00) — the news print.
 *   8. OPG          entered at the open — pre-market or the opening auction / first print (entry < 09:31:00) — and
 *                   flat by 10:00:00. OPGtoDAY: entered the same way, held into the day (exit after 10:00:00).
 *   9. AfterMarket  an intraday position closed in the post-market (exit ≥ 16:01:00).
 *  10. Day          everything else intraday.
 */

export const TRADE_STRATEGIES = ["Overnight", "OPG", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Print", "Adjust", "OPT"] as const;
export type TradeStrategy = (typeof TRADE_STRATEGIES)[number];

export function isTradeStrategy(v: unknown): v is TradeStrategy {
  return typeof v === "string" && (TRADE_STRATEGIES as readonly string[]).includes(v);
}

const hms = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

/** Regular session open / close (New York). */
export const RTH_OPEN_SEC = hms(9, 30);
export const RTH_CLOSE_SEC = hms(16, 0);
/** An entry before 09:31:00 counts as «at the open»: the 09:30:00 auction print plus the fill-report lag. */
export const OPEN_AUCTION_GRACE_SEC = 60;
/** OPG is flat by 10:00:00; a later exit makes it OPGtoDAY. */
export const OPG_EXIT_BY_SEC = hms(10, 0);
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
}

const isZero = (v: number | string | null | undefined) => v != null && v !== "" && Number(v) === 0;

export function deriveTradeStrategy(t: StrategyInput, win: ImxWindow = DEFAULT_IMX_WINDOW): TradeStrategy {
  if (isOptionSymbol(t.ticker)) return "OPT";
  if (isZero(t.qty) || isZero(t.entry)) return "Adjust";
  const h = (t.horizon ?? "").trim().toLowerCase();
  if (h === "overnight" || h === "swing") return "Overnight";
  const en = nyParts(t.entryAt);
  const ex = nyParts(t.exitAt);
  if (en && ex && ex.date > en.date) return "Overnight";
  const d0 = (t.date ?? "").slice(0, 10);
  const d1 = (t.exitDate ?? "").slice(0, 10);
  if (d0 && d1 && d1 > d0) return "Overnight";

  for (const f of [t.entryAt, t.exitAt, ...(t.fills ?? [])]) {
    const p = nyParts(f);
    if (p && inImxWindow(p.sec, win)) return "MOC";
  }

  if (!en) {
    const s = (t.session ?? "").toLowerCase();
    if (s === "premarket") return "OPG";
    if (s === "postmarket") return "AfterMarket";
    return "Day";
  }
  if (en.sec >= RTH_CLOSE_SEC) return "AfterMarket";
  if (en.sec < RTH_OPEN_SEC && ex && ex.sec < RTH_OPEN_SEC) return "Print";
  if (en.sec < RTH_OPEN_SEC + OPEN_AUCTION_GRACE_SEC) return !ex || ex.sec <= OPG_EXIT_BY_SEC ? "OPG" : "OPGtoDAY";
  if (ex && ex.sec >= AFTER_CLOSE_EXIT_SEC) return "AfterMarket";
  return "Day";
}

/** Seconds since NY midnight of the first entry (the «Время» facet); null when unknown. */
export function entrySecOf(t: Pick<StrategyInput, "entryAt">): number | null {
  return nyParts(t.entryAt)?.sec ?? null;
}

/** IMX = a close-auction trade: the strategy is MOC. */
export function isImxStrategy(s: string | null | undefined): boolean {
  return s === "MOC";
}
