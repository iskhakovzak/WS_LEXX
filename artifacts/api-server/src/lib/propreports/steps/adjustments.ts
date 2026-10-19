/**
 * Tick step "adjustments.daily" (phase 3 ACCURACY): broker cash adjustments → propreports_adjustments.
 *
 *   daily     once per New York date after 19:00 ET (or right away when it never ran): the last 7 calendar days of the
 *             effective scope (env account ids, else group) in one call — re-fetching a week catches late bookings,
 *             reversals and re-imports (new propReportsId, same data → the same row, see adjustments.ts)
 *   backfill  `requestAdjustmentsBackfill(from, to)` (route POST /propreports/adjustments/backfill, or CORE's history
 *             backfill via `adjustmentsBackfillChunk`) walks the range in ≤ 31-day chunks; progress lives in the cursor
 *             "adjustments:backfill", so a deadline only pauses it
 *
 * due() is hourly and cheap: run() returns at once when today's window is done and no backfill is pending.
 */
import { addDays, nyDate, nyMinutes } from "../../tradingDate";
import { getCursor, setCursor } from "../tick/cursor";
import { everyMinutes, remainingMs } from "../tick/due";
import type { TickCtx, TickStep } from "../tick/types";
import type { PropReportsClient } from "../client";
import { loadAccountMappings } from "../sync";
import { toAdjustmentRows } from "../adjustments-parse";
import { storeAdjustments, type StoreResult } from "../adjustments";

export const ADJUSTMENTS_WINDOW_DAYS = 7;
export const BACKFILL_CHUNK_DAYS = 31;
/** A chunk needs one API call + one transaction; do not start one with less than this left. */
const MIN_CHUNK_MS = 8_000;
const DAILY_AFTER_MIN = 19 * 60;

const DAILY_KEY = "adjustments:daily";
const BACKFILL_KEY = "adjustments:backfill";

type DailyCursor = { date: string; at: string; result?: StoreResult };
export type BackfillCursor = { from: string; to: string; next: string; requestedBy?: string | null; requestedAt: string; doneAt?: string | null; chunks?: number };

/** Pure: should the daily window run now? (NY date not done yet and past 19:00 ET, or never ran.) */
export function dailyDue(now: Date, cursor: DailyCursor | null): boolean {
  if (!cursor) return true;
  return cursor.date !== nyDate(now) && nyMinutes(now) >= DAILY_AFTER_MIN;
}

/** "groupId:-4" / "accountId:A1,A2" — the scope a fetch was authoritative for. */
export function scopeKey(client: Pick<PropReportsClient, "scopeParams">): string {
  return Object.entries(client.scopeParams()).map(([k, v]) => `${k}:${v}`).join(";");
}

/** Fetch + store one window (≤ 31 days). Also the hook for CORE's history backfill. */
export async function adjustmentsBackfillChunk(ctx: Pick<TickCtx, "client" | "log">, range: { from: string; to: string }): Promise<StoreResult & { fetched: number }> {
  const { adjustments } = await ctx.client.adjustments({ startDate: range.from, endDate: range.to });
  const { rows, issues } = toAdjustmentRows(adjustments);
  if (issues.length) ctx.log.warn({ issues: issues.slice(0, 5), count: issues.length }, "propreports adjustments: rows skipped");
  const mappings = await loadAccountMappings();
  const res = await storeAdjustments(rows, { scope: scopeKey(ctx.client), from: range.from, to: range.to, mappings });
  return { ...res, fetched: rows.length };
}

/** Queue a history range (replaces a pending request). */
export async function requestAdjustmentsBackfill(from: string, to: string, requestedBy: string | null): Promise<BackfillCursor> {
  const c: BackfillCursor = { from, to, next: from, requestedBy, requestedAt: new Date().toISOString(), doneAt: null, chunks: 0 };
  await setCursor(BACKFILL_KEY, c);
  return c;
}

export async function adjustmentsBackfillState(): Promise<BackfillCursor | null> {
  return getCursor<BackfillCursor>(BACKFILL_KEY);
}

const minDate = (a: string, b: string) => (a < b ? a : b);

export const adjustmentsStep: TickStep = {
  name: "adjustments.daily",
  due: everyMinutes(60),
  async run(ctx) {
    const notes: string[] = [];
    const daily = await getCursor<DailyCursor>(DAILY_KEY);
    if (dailyDue(ctx.now, daily)) {
      const to = nyDate(ctx.now);
      const from = addDays(to, -(ADJUSTMENTS_WINDOW_DAYS - 1));
      const r = await adjustmentsBackfillChunk(ctx, { from, to });
      await setCursor(DAILY_KEY, { date: to, at: ctx.now.toISOString(), result: { inserted: r.inserted, updated: r.updated, replaced: r.replaced, archived: r.archived } } satisfies DailyCursor);
      notes.push(`window ${from}..${to}: +${r.inserted} ~${r.updated} ⇄${r.replaced} −${r.archived}`);
    }
    let bf = await getCursor<BackfillCursor>(BACKFILL_KEY);
    while (bf && !bf.doneAt && bf.next <= bf.to) {
      if (remainingMs(ctx.deadline) < MIN_CHUNK_MS) {
        notes.push(`backfill paused at ${bf.next}`);
        return { done: false, note: notes.join("; ") };
      }
      const chunkTo = minDate(addDays(bf.next, BACKFILL_CHUNK_DAYS - 1), bf.to);
      const r = await adjustmentsBackfillChunk(ctx, { from: bf.next, to: chunkTo });
      const next = addDays(chunkTo, 1);
      bf = { ...bf, next, chunks: (bf.chunks ?? 0) + 1, doneAt: next > bf.to ? new Date().toISOString() : null };
      await setCursor(BACKFILL_KEY, bf);
      notes.push(`backfill ${chunkTo}: +${r.inserted} ⇄${r.replaced}`);
    }
    return { done: true, note: notes.join("; ") || "nothing due" };
  },
};
