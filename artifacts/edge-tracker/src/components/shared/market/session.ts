/** New York session clock for the market frame (shared by /indicators and the desk regime suggestion). Pure. */

/** Minutes since midnight in New York (DST-aware). */
export function nyMinutes(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
/** The regular session (9:30–16:00 NY) of `lastBarDate` is still running ⇒ its daily bar is not final yet. */
export function sessionInProgress(lastBarDate: string | null, today: string, minutes: number): boolean {
  return lastBarDate != null && lastBarDate === today && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}
