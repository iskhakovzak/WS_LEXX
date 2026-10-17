import type { Tone } from "@/components/ds";
import { addDays } from "@/lib/trading-date";

const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

/** "+$1 234" / "−$4.20" — two decimals under $10 so small averages stay readable. */
export function usd(v: number | null | undefined, opts: { digits?: number } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = opts.digits ?? (abs < 10 ? 2 : 0);
  return `${sign(Math.round(v * 10 ** digits) === 0 ? 0 : v)}$${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const pctText = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`);

export const toneOfMoney = (v: number | null | undefined): Tone => (v == null || Math.abs(v) < 0.005 ? "neutral" : v > 0 ? "up" : "down");

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** "16 окт" / "пт 16 окт" */
export function dayLabel(d: string, withWeekday = false): string {
  const [y, m, dd] = d.split("-").map(Number);
  if (!y || !m || !dd) return d;
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return `${withWeekday ? `${WEEKDAYS[wd]} ` : ""}${dd} ${MONTHS[m - 1]}`;
}

export function nextWeekday(d: string): string {
  let n = addDays(d, 1);
  for (;;) {
    const wd = new Date(`${n}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) return n;
    n = addDays(n, 1);
  }
}

/** Russian plural: plural(5, ["день", "дня", "дней"]). */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
export const daysWord = (n: number) => `${n} ${plural(n, ["день", "дня", "дней"])}`;

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
