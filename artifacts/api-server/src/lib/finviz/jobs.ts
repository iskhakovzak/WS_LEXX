/**
 * Finviz job bodies (registered in ./jobDefs.ts → jobs/definitions.ts). Each one checks the feature switch, records a
 * finviz_runs row per fetch and returns a small summary for job_runs.details. Finviz is called only from here.
 *
 *   runScreener        every preset → finviz_screener_rows (+ ticker snapshots). Scheduled: 07:00–09:30 NY every
 *                      5 min, 09:45–16:00 every 15 min, trading days only (screenerDue + market calendar).
 *   runSnapshot        daily: tickers of trades / plans / watchlist / ideas, ≤ 100 per call.
 *   runSnapshotPending tickers a page asked for (GET /ticker miss), ≤ 100 per run.
 *   runEarnings        this week + next week calendar → finviz_earnings.
 */
import { isMarketClosed } from "../marketDays";
import { nyDate, nyMinutes } from "../tradingDate";
import { setting } from "../settings/registry";
import { fetchExport, fetchTickers, MAX_TICKERS_PER_CALL, type ExportOptions } from "./client";
import { finvizEnabled, presetFilters, PRESETS, rankRows } from "./presets";
import {
  deskTickers, finishRun, markNotFound, pendingTickers, saveScreenerRows, startRun, supersedeMissing, upsertEarnings,
  upsertSnapshots, type EarningsInput,
} from "./store";
import { SCREENER_PRESETS, type ScreenerPreset } from "./types";
import type { FinvizRow } from "./csv";

/** The jobs here are the scheduled Finviz work: never refused by the client's queue cap. */
const SCHEDULED: ExportOptions = { scheduled: true };

type Ctx = { trigger?: string; signal?: AbortSignal; now?: Date };

/** New York weekday 0..6 (Sun..Sat) of an instant. */
function nyWeekday(d: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

/**
 * Which screener slot `now` is (NY wall clock, weekdays): "premarket" every 5 min 07:00–09:30, "rth" every 15 min
 * 09:45–16:00, else null. Holidays are checked separately (isMarketClosed).
 */
export function screenerDue(now: Date): "premarket" | "rth" | null {
  const wd = nyWeekday(now);
  if (wd === 0 || wd === 6) return null;
  const m = nyMinutes(now);
  if (m >= 7 * 60 && m <= 9 * 60 + 30) return m % 5 === 0 ? "premarket" : null;
  if (m >= 9 * 60 + 45 && m <= 16 * 60) return m % 15 === 0 ? "rth" : null;
  return null;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

async function runPreset(preset: ScreenerPreset, trigger: string, day: string, signal?: AbortSignal) {
  const runId = await startRun("screener", preset, trigger, day);
  try {
    const rows = await fetchExport({ filters: presetFilters(preset), order: PRESETS[preset].order }, day, signal, SCHEDULED);
    const ranked = rankRows(preset, rows, setting("finviz.maxRows"));
    await saveScreenerRows(runId, preset, day, ranked);
    await upsertSnapshots(ranked, "screener");
    await finishRun(runId, "ok", ranked.length);
    return { preset, rows: ranked.length };
  } catch (err) {
    await finishRun(runId, "error", 0, errText(err));
    return { preset, error: errText(err) };
  }
}

export async function runScreener(ctx: Ctx = {}): Promise<Record<string, unknown>> {
  if (!finvizEnabled()) return { skipped: "finviz disabled" };
  const now = ctx.now ?? new Date();
  const trigger = ctx.trigger ?? "schedule";
  const day = nyDate(now);
  if (trigger === "schedule") {
    const slot = screenerDue(now);
    if (!slot) return { skipped: "outside screener slots" };
    if (await isMarketClosed(day)) return { skipped: "market closed" };
  }
  const results = [];
  for (const preset of SCREENER_PRESETS) {
    if (ctx.signal?.aborted) break;
    results.push(await runPreset(preset, trigger, day, ctx.signal));
  }
  return { day, results };
}

/** Fetch a ticker list, store it, mark the ones Finviz did not return (only when every batch succeeded). */
async function snapshotTickers(tickers: string[], trigger: string, day: string, signal?: AbortSignal) {
  const runId = await startRun("snapshot", null, trigger, day);
  const r = await fetchTickers(tickers, day, signal, SCHEDULED);
  try {
    const n = await upsertSnapshots(r.rows, "snapshot");
    if (r.failed === 0) {
      const got = new Set(r.rows.map((x) => x.ticker));
      await markNotFound(tickers.filter((t) => !got.has(t)));
    }
    const ok = r.failed < r.batches || r.batches === 0;
    await finishRun(runId, ok ? "ok" : "error", n, r.errors[0] ?? null);
    return { tickers: tickers.length, stored: n, batches: r.batches, failed: r.failed };
  } catch (err) {
    await finishRun(runId, "error", 0, errText(err));
    throw err;
  }
}

export async function runSnapshot(ctx: Ctx = {}): Promise<Record<string, unknown>> {
  if (!finvizEnabled()) return { skipped: "finviz disabled" };
  const day = nyDate(ctx.now ?? new Date());
  const tickers = await deskTickers(day);
  if (!tickers.length) return { skipped: "no desk tickers" };
  return snapshotTickers(tickers, ctx.trigger ?? "schedule", day, ctx.signal);
}

export async function runSnapshotPending(ctx: Ctx = {}): Promise<Record<string, unknown>> {
  if (!finvizEnabled()) return { skipped: "finviz disabled" };
  const tickers = await pendingTickers(MAX_TICKERS_PER_CALL);
  if (!tickers.length) return { skipped: "nothing pending" };
  return snapshotTickers(tickers, ctx.trigger ?? "schedule", nyDate(ctx.now ?? new Date()), ctx.signal);
}

/** Calendar base filters: liquid names only (avg volume > 100K), any country (ADRs report too). */
const EARNINGS_CAL_FILTERS = ["sh_avgvol_o100"];
const WEEKS = ["earningsdate_thisweek", "earningsdate_nextweek"];

function earningsOfRows(rows: readonly FinvizRow[]): EarningsInput[] {
  return rows.filter((r) => r.earningsDate).map((r) => ({
    ticker: r.ticker, date: r.earningsDate!, timing: r.earningsTiming, company: r.company, marketCap: r.marketCap,
  }));
}

export async function runEarnings(ctx: Ctx = {}): Promise<Record<string, unknown>> {
  if (!finvizEnabled()) return { skipped: "finviz disabled" };
  const day = nyDate(ctx.now ?? new Date());
  const runId = await startRun("earnings", null, ctx.trigger ?? "schedule", day);
  const all: FinvizRow[] = [];
  const errors: string[] = [];
  for (const week of WEEKS) {
    try {
      all.push(...(await fetchExport({ filters: [...EARNINGS_CAL_FILTERS, week], order: "-marketcap" }, day, ctx.signal, SCHEDULED)));
    } catch (err) {
      errors.push(errText(err));
    }
  }
  try {
    const items = earningsOfRows(all);
    const n = await upsertEarnings(items);
    await upsertSnapshots(all, "screener");
    let superseded = 0;
    // only a complete answer may retire rows (a failed / empty week must never wipe the calendar)
    if (!errors.length && items.length) {
      const to = items.reduce((mx, r) => (r.date > mx ? r.date : mx), day);
      superseded = await supersedeMissing(day, to, items);
    }
    await finishRun(runId, errors.length === WEEKS.length ? "error" : "ok", n, errors[0] ?? null);
    return { day, rows: n, superseded, errors: errors.length };
  } catch (err) {
    await finishRun(runId, "error", 0, errText(err));
    throw err;
  }
}

/** The next NY trading day after `day` (weekends and full-day holidays skipped; ≤ 10 steps). */
export async function nextTradingDay(day: string, closed: (d: string) => Promise<boolean> = isMarketClosed): Promise<string> {
  let d = day;
  for (let i = 0; i < 10; i++) {
    d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (!(await closed(d))) return d;
  }
  return d;
}
