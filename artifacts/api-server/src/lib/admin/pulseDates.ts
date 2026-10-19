/**
 * Desk pulse helpers (routes/admin.ts GET /admin/desk-pulse): the desk day in New York, date shifts, optional tables.
 */
import { pool } from "@workspace/db";

// Desk day = New York trading date (audit P1-13): default and fallback are America/New_York, never UTC.
const PULSE_DEFAULT_TZ = "America/New_York";
export function pulseTz(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(raw)) return PULSE_DEFAULT_TZ;
  try { new Intl.DateTimeFormat("en-US", { timeZone: raw }); return raw; } catch { return PULSE_DEFAULT_TZ; }
}
export function ymdIn(tz: string, d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function ymdShift(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function isWeekend(ymd: string): boolean {
  const wd = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}
export async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [name]);
  return !!rows[0]?.ok;
}
export function maxDate(...vals: unknown[]): Date | null {
  let best: Date | null = null;
  for (const v of vals) {
    if (!v) continue;
    const d = v instanceof Date ? v : new Date(String(v));
    if (!isNaN(d.getTime()) && (!best || d > best)) best = d;
  }
  return best;
}
