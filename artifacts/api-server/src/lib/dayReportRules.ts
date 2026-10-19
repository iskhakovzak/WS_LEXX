/** Small day-level rules of the day report (lib/dayReport.ts), kept apart to hold that file under the size limit. */

/**
 * Opening-auction day (ROMAN-24, the same day-level rule as the dashboard): ≥ 70 % of the timed entries fall in
 * 09:30–09:45 ET and those trades did not lose. The «best window — keep the volume there» hint only repeats the
 * trader's own style on such a day, so the plan leaves it out.
 */
export function isOpeningDay(rows: { entryTime: string | null; net: number | null }[]): boolean {
  const timed = rows.filter((r) => r.entryTime != null);
  if (timed.length < 3) return false;
  const opening = timed.filter((r) => r.entryTime! >= "09:30:00" && r.entryTime! < "09:45:00");
  if (opening.length / timed.length < 0.7) return false;
  return opening.reduce((s, r) => s + (r.net ?? 0), 0) >= 0;
}
