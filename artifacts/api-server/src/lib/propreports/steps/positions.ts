/**
 * Tick step "positions.live" (phase 2 RISK-LIVE): open positions + unrealized P&L of the group, every tick during the
 * regular session (09:30–16:15 ET on market days; the last ticks after the close empty the book of positions closed at
 * the bell). One call `positions(type=open)` for today → the latest snapshot per account (lib/livePositions,
 * propreports_live_positions) → the risk desk adds the unrealized to today's realized net while it is fresh.
 * Then every trader with a snapshot is checked against the stop with the live numbers and the newly crossed thresholds
 * are queued as `risk.alert` outbox rows (lib/riskAlertQueue — once per trader / threshold / day).
 *
 * Idempotent: the snapshot is overwritten in place; nothing to resume (a deadline error throws and the next tick
 * retries). Runs after "fills.recent" so the realized trades and the open book come from the same moment.
 */
import { isWeekend, nyDate, nyMinutes } from "../../tradingDate";
import { isMarketClosed } from "../../marketDays";
import { remainingMs } from "../tick/due";
import type { TickStep } from "../tick/types";
import { loadAccountMappings } from "../sync";
import { buildAccountSnapshots, parsePositionsTable, saveLiveSnapshots } from "../../livePositions";
import { scanLiveAlerts } from "../../riskAlertQueue";

/** 09:30 ET — the open. */
export const LIVE_FROM_MIN = 9 * 60 + 30;
/** 16:15 ET — a few ticks after the close to clear positions flattened at the bell. */
export const LIVE_TO_MIN = 16 * 60 + 15;
/** Two runs never closer than this (a staff «Run now» right after the heartbeat). */
const MIN_GAP_MS = 60_000;
/** The alert scan needs a few DB round trips; leave it to the next tick when less is left. */
const SCAN_MIN_MS = 3_000;

/** Pure: is `now` inside the live window of a weekday (holidays are checked in run())? */
export function inLiveWindow(now: Date): boolean {
  if (isWeekend(nyDate(now))) return false;
  const m = nyMinutes(now);
  return m >= LIVE_FROM_MIN && m <= LIVE_TO_MIN;
}

/** Pure: every tick inside the window (at most once a minute). */
export function positionsDue(now: Date, last: Date | null): boolean {
  return inLiveWindow(now) && (!last || now.getTime() - last.getTime() >= MIN_GAP_MS);
}

export const positionsStep: TickStep = {
  name: "positions.live",
  due: positionsDue,
  async run(ctx) {
    const date = nyDate(ctx.now);
    if (!inLiveWindow(ctx.now)) return { done: true, note: "outside the live window" };
    if (await isMarketClosed(date)) return { done: true, note: "market closed" };
    const table = await ctx.client.positions(date, date, "open");
    const fetchedAt = new Date();
    const rows = parsePositionsTable(table);
    const snaps = buildAccountSnapshots(rows, await loadAccountMappings());
    await saveLiveSnapshots(snaps, date, fetchedAt);
    const unmapped = snaps.filter((s) => !s.trader && s.openCount > 0).length;
    const head = `${rows.length} open in ${snaps.filter((s) => s.openCount > 0).length}/${snaps.length} accounts${unmapped ? `, ${unmapped} unmapped` : ""}`;
    if (remainingMs(ctx.deadline) < SCAN_MIN_MS) return { done: true, note: `${head}; alert scan skipped (deadline)` };
    const a = await scanLiveAlerts(date, fetchedAt);
    ctx.log.info({ date, open: rows.length, accounts: snaps.length, alerts: a.queued }, "propreports positions: snapshot saved");
    return { done: true, note: `${head}; alerts queued ${a.queued} of ${a.checked} traders` };
  },
};
