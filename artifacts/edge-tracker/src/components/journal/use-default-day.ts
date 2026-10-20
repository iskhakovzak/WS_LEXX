/**
 * Journal page helpers split out of pages/journal.tsx (size ratchet): the default day (Волна 1, item 1.4 — the last
 * finished day still to close, picked once when the data is in) and the month calendar's review marks.
 */
import { useEffect, type MutableRefObject } from "react";
import type { ReviewMark } from "./MonthCalendar";
import { hasReview, type JournalEntry } from "./use-journal-days";
import type { DayStats } from "./utils";
import { defaultJournalDay, nyMinutesOf } from "./default-day";

/** A day's close mark as the EOD range answers it (eod-api EodDayMark; the page passes it in, no feature-to-feature import). */
export type EodMark = { date: string; status: string };

/**
 * Without ?date= the own journal opens the last finished day still to close (not an empty today before the close):
 * once the trades window (≥ 2 weeks back) and the last two weeks' close marks (`recent`: the page's EOD range over
 * OPEN_DAY_LOOKBACK days) are in. `pending` is the page's flag — any pick by hand clears it first, so the default never
 * overrides the trader.
 */
export function useDefaultJournalDay(v: {
  pending: MutableRefObject<boolean>;
  /** The viewer's own journal (a curator reading a trader keeps the URL / home day). */
  own: boolean;
  recent: ReadonlyMap<string, EodMark> | undefined;
  today: string;
  tradesLoading: boolean;
  tradeDays: readonly string[];
  activeDate: string;
  pick: (date: string) => void;
}): void {
  const { pending, own, recent, today, tradesLoading, tradeDays, activeDate, pick } = v;
  useEffect(() => {
    if (!pending.current) return;
    if (!own) { pending.current = false; return; }
    if (tradesLoading || !recent) return;
    pending.current = false;
    const closed = new Set([...recent.values()].filter((m) => m.status !== "open").map((m) => m.date));
    const d = defaultJournalDay({ today, nyMinutes: nyMinutesOf(), tradeDays, closed });
    if (d !== activeDate) pick(d);
  }, [pending, own, tradesLoading, recent, tradeDays, today, activeDate, pick]);
}

/** One review mark per day: checked by the curator › closed › reflection written › traded without reflection. */
export function reviewMarks(
  eod: ReadonlyMap<string, EodMark>,
  statsByDate: ReadonlyMap<string, DayStats>,
  entriesByDate: ReadonlyMap<string, JournalEntry[]>,
  today: string,
): Map<string, ReviewMark> {
  const m = new Map<string, ReviewMark>();
  const days = new Set<string>([...statsByDate.keys(), ...entriesByDate.keys(), ...eod.keys()]);
  for (const d of days) {
    if (d > today) continue;
    const e = eod.get(d);
    if (e?.status === "reviewed") m.set(d, "reviewed");
    else if (e?.status === "closed") m.set(d, "closed");
    else if ((entriesByDate.get(d) ?? []).some(hasReview)) m.set(d, "filled");
    else if ((statsByDate.get(d)?.trades ?? 0) > 0) m.set(d, "missing");
  }
  return m;
}
