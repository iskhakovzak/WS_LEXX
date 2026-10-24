/**
 * Context matching for the dashboard quote: after a red day the draw prefers patience / loss / resilience quotes,
 * on a green streak humility / process ones. Uses only what the dashboard already has — the daily loop's last
 * finished day (GET /api/daily/me → evening.netPnl, cached by the dashboard) — plus a small per-browser ledger of
 * those day results, so a streak can be counted without another request.
 */
import type { QuoteTag } from "./types";

export type QuoteMood = "red" | "green" | null;

export const MOOD_TAGS: Record<Exclude<QuoteMood, null>, readonly QuoteTag[]> = {
  red: ["patience", "loss", "resilience", "endurance", "control"],
  green: ["humility", "process", "moderation", "discipline", "ego"],
};

/** Green days in a row that make a «streak» (one green day alone is not a reason to preach humility). */
export const GREEN_STREAK_DAYS = 3;
const LEDGER_DAYS = 12;

/** NY trading day → net $ of that day. */
export type DayLedger = Record<string, number>;

/** Add (or correct) one finished day; keeps the newest LEDGER_DAYS days. Returns the same object when unchanged. */
export function recordDay(ledger: DayLedger, date: string | null | undefined, net: number | null | undefined): DayLedger {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof net !== "number" || !Number.isFinite(net)) return ledger;
  if (ledger[date] === net) return ledger;
  const next: DayLedger = { ...ledger, [date]: net };
  const keep = Object.keys(next).sort().slice(-LEDGER_DAYS);
  return Object.fromEntries(keep.map((d) => [d, next[d]!]));
}

/** Green days in a row ending with the newest recorded day (a red or flat day breaks it). */
export function greenStreak(ledger: DayLedger): number {
  let run = 0;
  for (const d of Object.keys(ledger).sort().reverse()) {
    if ((ledger[d] ?? 0) > 0) run++;
    else break;
  }
  return run;
}

/** Mood of the newest finished day: red after a losing day, green after GREEN_STREAK_DAYS+ green days. */
export function moodOf(ledger: DayLedger): QuoteMood {
  const days = Object.keys(ledger).sort();
  const last = days[days.length - 1];
  if (!last) return null;
  const net = ledger[last] ?? 0;
  if (net < 0) return "red";
  return greenStreak(ledger) >= GREEN_STREAK_DAYS ? "green" : null;
}

export function moodTags(mood: QuoteMood): readonly QuoteTag[] | null {
  return mood ? MOOD_TAGS[mood] : null;
}

export function parseLedger(raw: unknown): DayLedger {
  if (!raw || typeof raw !== "object") return {};
  const out: DayLedger = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
