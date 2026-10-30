/**
 * The risk signals scan. Three ways in, one code path:
 *   live      the live fills loop, in-process, seconds after a cycle wrote trades — only its changed traders, no
 *             settling (scanTradersNow via lib/riskSignals/live.ts: single-flight per trader, errors isolated)
 *   event     job «risksignals.scan» (lib/riskSignals/jobDefs.ts) on «propreports.synced» — the 5-minute full sync, and the
 *             live loop's coalesced event (≤ 1 a minute, through the outbox): the fallback for a lost live kick
 *   minute    the same job every minute 08:00–16:59 New York on weekdays (every trader active today: the positions
 *             snapshot moves the stop numbers without a sync event; a run lost to «already running» is caught up)
 *
 *   1. detect   today's trades (one truth: the behaviour engine's rows — an open position is a trade row with result
 *               «open» from its opening fill, so revenge / off-plan / restricted-window are judged at ENTRY; when the
 *               same row closes later, its alerts are already stored: the key has no trade id or exit in it),
 *               the dashboard's stop numbers (lib/riskData +
 *               lib/riskMetrics computeMetrics, counted unrealized included), today's plan, restricted windows, the
 *               trader's own size / pace baseline (cached per day) → hits (detect.ts detectLive)
 *   2. store    once per trader / day / signal / level (UNIQUE + an in-memory set, refilled from the DB per day)
 *   3. notify   critical alerts (top stop level, revenge) → curator + risk manager, once; an alert first seen more than
 *               STALE_MIN after its trigger (a late sync, a restart) is stored without a push
 *   4. settle   finished sessions → «desk saved» estimate (saved.ts), at most once a minute
 */
import { addDays, nyDate, nyMinutes } from "../tradingDate";
import { isMarketClosed, sessionFor } from "../marketDays";
import { loadDaily, loadDdResets, loadEffectiveLimits, loadLimits, loadLiveSnapshots } from "../riskData";
import { computeMetrics, drawdownSince, liveRisk, type DayRow } from "../riskMetrics";
import { baselineKey, currentSignalConfig } from "./config";
import { baselineOf, detectDay, detectLive, realizedAt, restAfter, windowsOf } from "./detect";
import { estimateSaved } from "./saved";
import {
  activeTraders, alertDays, claimStaffNotice, dayExtras, firedKeys, insertAlert, saveSettlement, signalTrades, unsettled,
  type AlertRow, type DayExtras,
} from "./store";
import { notifyStaff } from "./notify";
import type { Baseline, DayContext, Hit, Signal, SignalConfig, SignalTrade } from "./types";

/** Minutes after its trigger an alert is still pushed to staff. */
const STALE_MIN = 30;
const SETTLE_AFTER_CLOSE_MIN = 30;
/** Detection starts this long before the open (premarket entries count). */
const PREOPEN_MIN = 90;
const SETTLE_EVERY_MS = 60_000;

export type ScanResult = { traders: number; created: number; staffTold: number; settled: number; skipped?: string };

// ─── in-memory state (per process; the DB is the truth) ────────────────────

let fired: { day: string; keys: Set<string> } | null = null;
async function firedFor(day: string): Promise<Set<string>> {
  if (fired?.day !== day) fired = { day, keys: await firedKeys(day) };
  return fired.keys;
}

let baselineCache: { key: string; map: Map<string, Baseline> } | null = null;
async function baselinesFor(traders: readonly string[], day: string, cfg: SignalConfig): Promise<Map<string, Baseline>> {
  const key = `${day}|${baselineKey(cfg)}`;
  if (baselineCache?.key !== key) baselineCache = { key, map: new Map() };
  const cache = baselineCache.map;
  const missing = traders.filter((t) => !cache.has(t));
  if (missing.length) {
    const past = await signalTrades(addDays(day, -cfg.lookbackDays), addDays(day, -1), missing);
    for (const t of missing) cache.set(t, baselineOf([...(past.get(t)?.values() ?? [])]));
  }
  return cache;
}

let lastSettle = 0;

/** Tests: forget the per-process caches. */
export function resetRiskSignalState(): void {
  fired = null;
  baselineCache = null;
  lastSettle = 0;
}

const payloadTraders = (p: unknown): string[] | null => {
  const t = (p as { traders?: unknown } | null)?.traders;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string" && x.length > 0) : null;
};

function contextOf(trader: string, day: string, trades: SignalTrade[], dailyLimit: number | null, x: DayExtras, cfg: SignalConfig, baseline: Baseline | null): DayContext {
  const macro = [...(x.deskMacro.get(day) ?? []), ...(x.ownMacro.get(trader)?.get(day) ?? [])];
  return {
    trades, dailyLimit, baseline,
    plan: x.plans.get(trader)?.get(day) ?? null,
    windows: windowsOf(x.calendar.get(day) ?? [], macro, cfg.newsBeforeMin, cfg.newsAfterMin),
  };
}

// ─── 1–3: detect, store, notify ────────────────────────────────────────────

async function detectAndStore(day: string, now: Date, names: string[], cfg: SignalConfig, res: ScanResult): Promise<void> {
  if (!names.length) return;
  const [trades, extras, limitsMap, days, resets, live, baselines, keys] = await Promise.all([
    signalTrades(day, day, names), dayExtras(day, day, names), loadEffectiveLimits(null, day), loadDaily(null, day, names),
    loadDdResets(null, names), loadLiveSnapshots(day, names), baselinesFor(names, day, cfg), firedFor(day),
  ]);
  const daysBy = new Map<string, DayRow[]>();
  for (const d of days) daysBy.set(d.trader, [...(daysBy.get(d.trader) ?? []), d]);
  for (const name of names) {
    res.traders++;
    const limits = limitsMap.get(name) ?? null;
    // The dashboard's numbers (realized + the counted unrealized of a fresh positions snapshot).
    const m = computeMetrics(name, daysBy.get(name) ?? [], [], limits, day, "ru", drawdownSince(resets.get(name), day), liveRisk(live.get(name), day, now));
    const ctx = contextOf(name, day, trades.get(name)?.get(day) ?? [], limits?.dailyLossLimit ?? null, extras, cfg, baselines.get(name) ?? null);
    const hits = detectLive(ctx, cfg, { dailyPct: m.stop.dailyPct, pnlNet: m.today.pnlNet }, now.getTime());
    for (const h of hits) await storeHit(name, day, h, h.signal === "stop_proximity" ? m.today.pnlNet : realizedAt(ctx.trades, h.at), keys, now, cfg, res);
  }
}

async function storeHit(trader: string, day: string, h: Hit, pnlAt: number | null, keys: Set<string>, now: Date, cfg: SignalConfig, res: ScanResult): Promise<void> {
  const key = `${trader}|${h.signal}|${h.level}`;
  if (keys.has(key)) return;
  const row = await insertAlert(trader, day, h, pnlAt);
  keys.add(key);
  if (!row) return;
  res.created++;
  const fresh = now.getTime() - h.at <= STALE_MIN * 60_000;
  if (row.severity === "critical" && fresh && (await claimStaffNotice(row.id))) {
    await notifyStaff(row, cfg);
    res.staffTold++;
  }
}

// ─── 4: settle («desk saved») ──────────────────────────────────────────────

/** Off-plan and restricted-window alerts compare with any such hit of a past day (their level is a ticker / a time). */
const sameSituation = (a: AlertRow, h: Hit): boolean =>
  h.signal === a.signal && (a.signal === "off_plan" || a.signal === "banned_window" || h.level === a.level);

async function settleTrader(trader: string, alerts: AlertRow[], cfg: SignalConfig, res: ScanResult): Promise<void> {
  const firstDay = alerts.reduce((m, a) => (a.day < m ? a.day : m), alerts[0]!.day);
  const lastDay = alerts.reduce((m, a) => (a.day > m ? a.day : m), alerts[0]!.day);
  const from = addDays(firstDay, -cfg.lookbackDays);
  const [byTrader, extras, limits] = await Promise.all([signalTrades(from, lastDay, [trader]), dayExtras(from, lastDay, [trader]), loadLimits(trader)]);
  const byDay = byTrader.get(trader) ?? new Map<string, SignalTrade[]>();
  const dailyLimit = limits.get(trader)?.dailyLossLimit ?? null;
  const excluded = new Map<Signal, Set<string>>();
  for (const a of alerts) {
    const lookFrom = addDays(a.day, -cfg.lookbackDays);
    const pastDays = [...byDay.keys()].filter((d) => d >= lookFrom && d < a.day).sort();
    if (!excluded.has(a.signal)) excluded.set(a.signal, await alertDays(trader, a.signal, from, lastDay));
    const skip = excluded.get(a.signal)!;
    const baseline = baselineOf(pastDays.map((d) => byDay.get(d)!));
    const cases: number[] = [];
    for (const d of pastDays) {
      if (skip.has(d)) continue;
      const ctx = contextOf(trader, d, byDay.get(d)!, dailyLimit, extras, cfg, baseline);
      const hit = detectDay(ctx, cfg).filter((h) => sameSituation(a, h)).sort((x, y) => x.at - y.at)[0];
      if (hit) cases.push(restAfter(ctx.trades, hit.at));
    }
    const rest = restAfter(byDay.get(a.day) ?? [], Date.parse(a.triggeredAt));
    await saveSettlement(a.id, estimateSaved(rest, cases, cfg.savedMinSample));
    res.settled++;
  }
}

async function settleDue(day: string, now: Date, cfg: SignalConfig, res: ScanResult): Promise<void> {
  if (now.getTime() - lastSettle < SETTLE_EVERY_MS) return;
  lastSettle = now.getTime();
  const open = await unsettled();
  if (!open.length) return;
  const session = await sessionFor(day);
  const todayOver = session.closed || nyMinutes(now) >= session.closeMin + SETTLE_AFTER_CLOSE_MIN;
  const due = open.filter((a) => a.day < day || (a.day === day && todayOver));
  const by = new Map<string, AlertRow[]>();
  for (const a of due) by.set(a.trader, [...(by.get(a.trader) ?? []), a]);
  for (const [trader, alerts] of by) await settleTrader(trader, alerts, cfg, res);
}

// ─── the run ───────────────────────────────────────────────────────────────

/** `settle: false` = detect / store / notify only (the live path; settling is the job's minute run). */
export async function runRiskSignals(now: Date = new Date(), payload?: unknown, opts: { settle?: boolean } = {}): Promise<ScanResult> {
  const res: ScanResult = { traders: 0, created: 0, staffTold: 0, settled: 0 };
  const cfg = currentSignalConfig();
  const day = nyDate(now);
  const closed = await isMarketClosed(day);
  const session = closed ? null : await sessionFor(day);
  const minute = nyMinutes(now);
  const inSession = !!session && minute >= session.openMin - PREOPEN_MIN && minute <= session.closeMin + 15;
  if (cfg.enabled && inSession) {
    const names = payloadTraders(payload) ?? (await activeTraders(day));
    await detectAndStore(day, now, names, cfg, res);
  }
  if (opts.settle !== false) await settleDue(day, now, cfg, res);
  if (!cfg.enabled) res.skipped = "disabled";
  else if (closed) res.skipped = "market closed";
  else if (!inSession) res.skipped = "outside the session";
  return res;
}

/** The live loop's direct path (lib/riskSignals/live.ts): these traders only, now; settling stays with the job. */
export function scanTradersNow(traders: readonly string[], now: Date = new Date()): Promise<ScanResult> {
  return runRiskSignals(now, { traders: [...traders] }, { settle: false });
}
