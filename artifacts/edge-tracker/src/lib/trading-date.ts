// The desk trades US equities: the trading day is the America/New_York calendar date,
// not the browser's local date. Use this for "today", day navigation and API date params.

const NY_TZ = "America/New_York";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: NY_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD in New York for the given instant (default: now). */
export function nyDate(d: Date = new Date()): string {
  return dateFmt.format(d);
}

/** Shift a YYYY-MM-DD date by whole days. */
export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** Previous weekday before `date` (holidays not considered). */
export function prevWeekday(date: string): string {
  let d = addDays(date, -1);
  for (;;) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) return d;
    d = addDays(d, -1);
  }
}

/**
 * Data freshness of a sync (PropReports): stale once the last synced desk day is before the previous weekday
 * (Fri → Mon is fresh, Thu → Sat is not; holidays not considered). Every «последний синк» status reads this rule,
 * so a green «успешно» never sits over old trades. `days` = whole calendar days since `lastAt`.
 */
export function syncStale(lastAt: string | null | undefined, now: Date = new Date()): { stale: boolean; days: number } {
  if (!lastAt) return { stale: false, days: 0 };
  const at = new Date(lastAt);
  if (Number.isNaN(at.getTime())) return { stale: false, days: 0 };
  return { stale: nyDate(at) < prevWeekday(nyDate(now)), days: Math.floor((now.getTime() - at.getTime()) / 86_400_000) };
}
