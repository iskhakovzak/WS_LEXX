/**
 * «Тренажёр» — which real trades / ticker-days may become training material (owner rule 2026-10-21). ONE pure filter,
 * used by every selection path: «Мои дни» (lib/sim/ownService), «Задача дня» (daily.ts pickNow), «Найди вход»
 * (drillStore.ensureDrills) and the free simulator's intraday pool (lib/sim/pick).
 *
 *   close auction  a trade with ANY execution (entry, add, trim, exit, stop) between 15:50:00 and 16:00:00 New York
 *                  time inclusive is close-auction (imbalance) noise: that trade is out. Only that trade — other
 *                  trades of the same ticker-day stay usable (owner, 2026-10-21: «не тикер целиком, именно тот момент»).
 *   short hold     a trade held less than 25 minutes, first fill → last fill (24:59 out, 25:00 in).
 *   missing times  conservative: a trade whose open / close time is unknown, or with any fill without a time, is out.
 *
 * New York wall clock via Intl (America/New_York), so DST is handled by the tz database, never by a fixed offset.
 * Existing games and drills are not touched: the filter only decides what is picked from now on.
 */

export const CLOSE_AUCTION_FROM_SEC = 15 * 3600 + 50 * 60; // 15:50:00 NY
export const CLOSE_AUCTION_TO_SEC = 16 * 3600; // 16:00:00 NY (the close itself is in)
export const MIN_HOLD_MS = 25 * 60_000;

/** An instant: Date, ISO string / anything Date.parse reads, or epoch MILLISECONDS. null / undefined = unknown. */
export type TimeLike = Date | string | number | null | undefined;

/** The trade's own open / close instants when the caller has them (else they come from the executions). */
export type EligibilityTrade = { openAt?: TimeLike; closeAt?: TimeLike };
export type EligibilityExec = { at: TimeLike };

export type EligibilityReason = "noTimes" | "closeAuction" | "shortHold";
export type Eligibility = { ok: true; reason: null } | { ok: false; reason: EligibilityReason };

/** Epoch ms of a TimeLike, or null when unknown / unreadable. */
export function toMs(v: TimeLike): number | null {
  if (v == null || v === "") return null;
  const ms = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

const nyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** New York calendar date and seconds since NY midnight of an instant (epoch ms). */
export function nyClock(ms: number): { date: string; sec: number } {
  const p: Record<string, string> = {};
  for (const part of nyFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, sec: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second) };
}

/** 15:50:00 ≤ NY time ≤ 16:00:00 (whole seconds: 16:00:00.400 is still 16:00:00 → in). */
export function inCloseAuction(at: TimeLike): boolean {
  const ms = toMs(at);
  if (ms == null) return false;
  const { sec } = nyClock(ms);
  return sec >= CLOSE_AUCTION_FROM_SEC && sec <= CLOSE_AUCTION_TO_SEC;
}

/** The one rule: may this trade (with its fills) be training material? Order: missing times → close auction → hold. */
export function isTrainerEligible(trade: EligibilityTrade | null | undefined, executions?: readonly EligibilityExec[] | null): Eligibility {
  const execs = executions ?? [];
  const fills = execs.map((e) => toMs(e?.at));
  if (fills.some((ms) => ms == null)) return { ok: false, reason: "noTimes" };
  const open = toMs(trade?.openAt), close = toMs(trade?.closeAt);
  const all = [...(fills as number[]), ...(open != null ? [open] : []), ...(close != null ? [close] : [])];
  // Without fills the trade's own open AND close are required; with fills they span first → last.
  if (!execs.length && (open == null || close == null)) return { ok: false, reason: "noTimes" };
  if (!all.length) return { ok: false, reason: "noTimes" };
  if (all.some((ms) => inCloseAuction(ms))) return { ok: false, reason: "closeAuction" };
  const first = Math.min(...all), last = Math.max(...all);
  if (last - first < MIN_HOLD_MS) return { ok: false, reason: "shortHold" };
  return { ok: true, reason: null };
}

/** "TICKER:YYYY-MM-DD" — the ticker-day key used by every pool. */
export const tickerDayKey = (ticker: string, day: string): string => `${String(ticker).trim().toUpperCase()}:${String(day).slice(0, 10)}`;

/** Ticker-days poisoned by a close-auction fill (the NY date of the fill itself). Fills without a time are skipped. */
export function closeAuctionDays(fills: Iterable<{ ticker: string; at: TimeLike }>): Set<string> {
  const out = new Set<string>();
  for (const f of fills) {
    const ms = toMs(f.at);
    if (ms == null || !inCloseAuction(ms)) continue;
    out.add(tickerDayKey(f.ticker, nyClock(ms).date));
  }
  return out;
}

/** Ticker-day pools (archive days, challenges): drop every ticker-day in `blocked`. */
export function withoutBlockedDays<T>(items: readonly T[], keyOf: (x: T) => { ticker: string; day: string }, blocked: ReadonlySet<string>): T[] {
  if (!blocked.size) return [...items];
  return items.filter((x) => { const k = keyOf(x); return !blocked.has(tickerDayKey(k.ticker, k.day)); });
}

/**
 * Trade pools: keep a trade only when it is eligible itself. `blocked` ticker-days are still honoured when a caller
 * passes some (empty by default — the desk-wide ticker-day block is off since the owner's rule is per trade).
 */
export function eligibleTrades<T>(
  items: readonly T[],
  view: (x: T) => { ticker: string; day: string; trade?: EligibilityTrade | null; executions?: readonly EligibilityExec[] | null },
  blocked: ReadonlySet<string> = new Set(),
): T[] {
  const views = items.map((x) => view(x));
  return items.filter((_, i) => {
    const v = views[i];
    if (blocked.size && blocked.has(tickerDayKey(v.ticker, v.day))) return false;
    return isTrainerEligible(v.trade ?? null, v.executions ?? null).ok;
  });
}
