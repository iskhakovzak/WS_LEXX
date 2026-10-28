/**
 * The timing axis of a trade (pure): when it was entered and how long it was held, in the desk's words. It is the
 * stored PropReports-style strategy (lib/tradeStrategy, trades.strategy — derived from the fills' New York times) with
 * the regular-session «Day» split at 10:00 so the opening window stands on its own:
 *
 *   am         pre-market round trip (strategy OPG: entered and closed before 09:30)
 *   opg        closed by the opening print (strategy Print)
 *   open30     regular-session entry 09:30–09:59, closed the same day (strategy Day)
 *   day        regular-session entry from 10:00, closed the same day (strategy Day)
 *   moc        a fill in the close auction window (strategy MOC)
 *   pm         after-market (strategy AfterMarket)
 *   opg_day    pre-market entry held into the day (strategy OPGtoDAY)
 *   overnight  closed on the next trading day (strategy Overnight)
 *   swing      held two trading days or more (strategy Swing — the «second day» hold)
 *
 * Without a stored strategy the entry time alone decides (am / open30 / day / pm). Options and broker adjustments have
 * no timing (null). A playbook setup lists the timings it allows (playbook.timings); a trade outside them is flagged.
 */
import { RTH_CLOSE_SEC, RTH_OPEN_SEC } from "../tradeStrategy";

export const TIMINGS = ["am", "opg", "open30", "day", "moc", "pm", "opg_day", "overnight", "swing"] as const;
export type Timing = (typeof TIMINGS)[number];

export const isTiming = (v: unknown): v is Timing => typeof v === "string" && (TIMINGS as readonly string[]).includes(v);

/** The opening window ends here (NY seconds): 09:30:00 ≤ entry < 10:00:00. */
export const OPEN_WINDOW_END_SEC = 10 * 3600;

export function inOpenWindow(entrySec: number | null | undefined): boolean {
  return entrySec != null && entrySec >= RTH_OPEN_SEC && entrySec < OPEN_WINDOW_END_SEC;
}

const BY_STRATEGY: Record<string, Timing> = {
  OPG: "am", Print: "opg", OPGtoDAY: "opg_day", MOC: "moc", AfterMarket: "pm", Overnight: "overnight", Swing: "swing",
};

export function timingOf(t: { strategy?: string | null; entrySec?: number | null }): Timing | null {
  const s = t.strategy ?? null;
  if (s === "OPT" || s === "Adjust") return null;
  if (s && BY_STRATEGY[s]) return BY_STRATEGY[s]!;
  const sec = t.entrySec ?? null;
  if (s === "Day") return inOpenWindow(sec) ? "open30" : "day";
  if (sec == null) return null;
  if (sec < RTH_OPEN_SEC) return "am";
  if (sec >= RTH_CLOSE_SEC) return "pm";
  return inOpenWindow(sec) ? "open30" : "day";
}

/** A setup's allowed timings from any input (unknown codes dropped, display order kept); [] = no restriction. */
export function normTimings(input: unknown): Timing[] {
  if (!Array.isArray(input)) return [];
  const set = new Set(input.filter(isTiming));
  return TIMINGS.filter((k) => set.has(k));
}

/** The trade was taken in a timing its setup does not allow (an empty allow-list or an unknown timing never flags). */
export function offTiming(timing: Timing | null, allowed: readonly Timing[]): boolean {
  return timing != null && allowed.length > 0 && !allowed.includes(timing);
}
