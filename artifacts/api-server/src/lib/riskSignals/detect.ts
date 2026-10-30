/**
 * Live risk signals — PURE detectors (no I/O), unit-tested. The same functions run live on today's trades (scan.ts)
 * and replay past days for the «desk saved» baseline (saved.ts): one definition of «the situation happened».
 *
 *   stopProximity  closed trades by exit time, running realized net: the first exit at which the day's loss reached
 *                  each % of the daily loss limit. Live, the dashboard's stop numbers (computeMetrics, with the counted
 *                  unrealized) decide whether a level is reached; the replay only dates it.
 *   lossStreak     N losing closed trades in a row by exit time (a win or a breakeven resets the run).
 *   revenge        for every losing exit: entries in the next W minutes. «size» = one of them is ≥ ratio × the
 *                  trader's median position ($ notional); «pace» = at least max(3, ratio × usual entries per W minutes)
 *                  of them. Needs BASELINE_MIN_TRADES of history — without an own normal there is no «jump».
 *   offPlan        with an own plan today: a ticker outside the plan (own in-play + the desk plan's in-play), or a
 *                  linked playbook setup outside the day's picks. One alert per ticker, at most OFF_PLAN_MAX a day.
 *   bannedWindow   an entry minute inside [event − before, event + after] of a high-impact event of the day.
 */
import type { BannedWindow, Baseline, DayContext, Hit, PlanContext, SignalConfig, SignalTrade } from "./types";

/** Past trades the revenge baseline needs (fewer: no «own normal», no revenge signal). */
export const BASELINE_MIN_TRADES = 20;
/** The fewest entries after a loss that can count as a pace jump. */
export const PACE_MIN_ENTRIES = 3;
/** Distinct off-plan tickers alerted per day (the rest is the same message again). */
export const OFF_PLAN_MAX = 3;
/** A trading day shorter than this (first entry → last fill) counts as this long for the pace. */
const MIN_ACTIVE_MIN = 30;

const round2 = (v: number) => Math.round(v * 100) / 100;

const isLoss = (t: SignalTrade) => t.result === "loss" || (t.result == null && (t.net ?? 0) < 0);

/** Closed trades with a P&L, by exit time (ties by id). */
export function closedByExit(trades: readonly SignalTrade[]): SignalTrade[] {
  return trades
    .filter((t) => t.exitAt != null && t.net != null && t.result !== "open")
    .sort((a, b) => a.exitAt! - b.exitAt! || a.id - b.id);
}

/** Realized net of the trades closed at or before `at`. */
export function realizedAt(trades: readonly SignalTrade[], at: number): number {
  let s = 0;
  for (const t of trades) if (t.exitAt != null && t.net != null && t.result !== "open" && t.exitAt <= at) s += t.net;
  return round2(s);
}

/** Realized net of the whole day. */
export function finalNet(trades: readonly SignalTrade[]): number {
  return realizedAt(trades, Number.POSITIVE_INFINITY);
}

/** What the rest of the session did after `at`: the day's final realized net − the realized net at `at`. */
export function restAfter(trades: readonly SignalTrade[], at: number): number {
  return round2(finalNet(trades) - realizedAt(trades, at));
}

const notional = (t: SignalTrade): number | null =>
  t.qty != null && t.entry != null && t.qty !== 0 && t.entry > 0 ? Math.abs(t.qty * t.entry) : null;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The trader's own normal from past days (each inner list = one day's trades). */
export function baselineOf(days: readonly (readonly SignalTrade[])[]): Baseline {
  const sizes: number[] = [];
  let entries = 0;
  let minutes = 0;
  let trades = 0;
  for (const day of days) {
    const timed = day.filter((t) => t.entryAt != null);
    trades += day.length;
    for (const t of day) {
      const n = notional(t);
      if (n != null) sizes.push(n);
    }
    if (!timed.length) continue;
    const first = Math.min(...timed.map((t) => t.entryAt!));
    const last = Math.max(...timed.map((t) => Math.max(t.entryAt!, t.exitAt ?? t.entryAt!)));
    entries += timed.length;
    minutes += Math.max(MIN_ACTIVE_MIN, (last - first) / 60_000);
  }
  const med = median(sizes);
  return {
    trades,
    medianNotional: med == null ? null : round2(med),
    entriesPerMin: minutes > 0 ? entries / minutes : null,
  };
}

// ─── detectors ──────────────────────────────────────────────────────────────

/** Realized replay: the first exit at which the day's loss reached each % of the limit (ascending pcts). */
export function stopProximity(trades: readonly SignalTrade[], dailyLimit: number | null, pcts: readonly number[]): Hit[] {
  if (dailyLimit == null || !(dailyLimit > 0) || !pcts.length) return [];
  const out: Hit[] = [];
  const top = pcts[pcts.length - 1];
  let cum = 0;
  let next = 0;
  for (const t of closedByExit(trades)) {
    cum += t.net!;
    const loss = Math.max(0, -cum);
    while (next < pcts.length && loss >= (pcts[next]! / 100) * dailyLimit) {
      const pct = pcts[next]!;
      out.push({
        signal: "stop_proximity", level: String(pct), severity: pct === top ? "critical" : "warn", at: t.exitAt!, tradeId: t.id,
        stats: { pct: Math.round((loss / dailyLimit) * 100), lossUsd: round2(loss), limitUsd: dailyLimit },
      });
      next++;
    }
  }
  return out;
}

/** Live: the levels the dashboard's daily % has reached, dated by the realized replay (else `now`). */
export function stopProximityLive(
  trades: readonly SignalTrade[], m: { dailyPct: number | null; pnlNet: number | null; dailyLimit: number | null }, pcts: readonly number[], now: number,
): Hit[] {
  if (m.dailyPct == null || m.dailyLimit == null || !(m.dailyLimit > 0)) return [];
  const replay = new Map(stopProximity(trades, m.dailyLimit, pcts).map((h) => [h.level, h]));
  const top = pcts[pcts.length - 1];
  const loss = Math.max(0, -(m.pnlNet ?? 0));
  return pcts.filter((p) => m.dailyPct! >= p).map((pct) => {
    const r = replay.get(String(pct));
    return {
      signal: "stop_proximity" as const, level: String(pct), severity: pct === top ? ("critical" as const) : ("warn" as const),
      at: r?.at ?? now, tradeId: r?.tradeId ?? null,
      stats: { pct: Math.round(m.dailyPct!), lossUsd: round2(loss), limitUsd: m.dailyLimit },
    };
  });
}

export function lossStreak(trades: readonly SignalTrade[], n: number): Hit[] {
  if (n < 1) return [];
  let run = 0;
  let sum = 0;
  for (const t of closedByExit(trades)) {
    if (isLoss(t)) {
      run++;
      sum += t.net!;
      if (run === n) {
        return [{ signal: "loss_streak", level: String(n), severity: "warn", at: t.exitAt!, tradeId: t.id, stats: { losses: n, lossUsd: round2(-sum) } }];
      }
    } else {
      run = 0;
      sum = 0;
    }
  }
  return [];
}

export function revenge(
  trades: readonly SignalTrade[], baseline: Baseline | null, cfg: Pick<SignalConfig, "revengeWindowMin" | "revengeSizeRatio" | "revengePaceRatio">,
): Hit[] {
  if (!baseline || baseline.trades < BASELINE_MIN_TRADES) return [];
  const w = cfg.revengeWindowMin * 60_000;
  const entries = trades.filter((t) => t.entryAt != null).sort((a, b) => a.entryAt! - b.entryAt! || a.id - b.id);
  const need = baseline.entriesPerMin != null
    ? Math.max(PACE_MIN_ENTRIES, Math.ceil(cfg.revengePaceRatio * baseline.entriesPerMin * cfg.revengeWindowMin))
    : null;
  const out: Hit[] = [];
  let size = false;
  let pace = false;
  for (const loss of closedByExit(trades)) {
    if (!isLoss(loss) || (size && pace)) continue;
    const after = entries.filter((e) => e.id !== loss.id && e.entryAt! > loss.exitAt! && e.entryAt! <= loss.exitAt! + w);
    const base = { lossTradeId: loss.id, lossUsd: round2(-(loss.net ?? 0)), windowMin: cfg.revengeWindowMin };
    if (!size && baseline.medianNotional != null && baseline.medianNotional > 0) {
      const big = after.find((e) => (notional(e) ?? 0) >= cfg.revengeSizeRatio * baseline.medianNotional!);
      if (big) {
        size = true;
        out.push({
          signal: "revenge", level: "size", severity: "critical", at: big.entryAt!, tradeId: big.id,
          stats: { ...base, ticker: big.ticker, ratio: round2(notional(big)! / baseline.medianNotional), medianUsd: Math.round(baseline.medianNotional) },
        });
      }
    }
    if (!pace && need != null && after.length >= need) {
      pace = true;
      const e = after[need - 1]!;
      out.push({
        signal: "revenge", level: "pace", severity: "critical", at: e.entryAt!, tradeId: e.id,
        stats: { ...base, entries: need, usual: round2(baseline.entriesPerMin! * cfg.revengeWindowMin) },
      });
    }
  }
  return out;
}

/** Is this trade outside the plan? Plan tickers first; a linked setup outside the picks also counts. */
export function isOffPlan(t: SignalTrade, plan: NonNullable<PlanContext>): boolean {
  if (plan.tickers.size && !plan.tickers.has(t.ticker.toUpperCase())) return true;
  return plan.setups.size > 0 && t.playbookId != null && !plan.setups.has(t.playbookId);
}

export function offPlan(trades: readonly SignalTrade[], plan: PlanContext): Hit[] {
  if (!plan || (!plan.tickers.size && !plan.setups.size)) return [];
  const out: Hit[] = [];
  const seen = new Set<string>();
  const timed = trades.filter((t) => t.entryAt != null).sort((a, b) => a.entryAt! - b.entryAt! || a.id - b.id);
  for (const t of timed) {
    const ticker = t.ticker.toUpperCase();
    if (!ticker || seen.has(ticker) || !isOffPlan(t, plan)) continue;
    seen.add(ticker);
    out.push({ signal: "off_plan", level: ticker, severity: "warn", at: t.entryAt!, tradeId: t.id, stats: { ticker } });
    if (out.length >= OFF_PLAN_MAX) break;
  }
  return out;
}

export function bannedWindow(trades: readonly SignalTrade[], windows: readonly BannedWindow[]): Hit[] {
  const out: Hit[] = [];
  const timed = trades.filter((t) => t.entryAt != null && t.entryMin != null).sort((a, b) => a.entryAt! - b.entryAt! || a.id - b.id);
  for (const w of windows) {
    const t = timed.find((x) => x.entryMin! >= w.startMin && x.entryMin! <= w.endMin);
    if (t) out.push({ signal: "banned_window", level: w.key, severity: "warn", at: t.entryAt!, tradeId: t.id, stats: { time: w.key, event: w.event, ticker: t.ticker } });
  }
  return out;
}

/** Every signal of a day from realized data (the history replay; live adds the dashboard stop numbers). */
export function detectDay(ctx: DayContext, cfg: SignalConfig): Hit[] {
  return [
    ...stopProximity(ctx.trades, ctx.dailyLimit, cfg.stopPcts),
    ...lossStreak(ctx.trades, cfg.streakLosses),
    ...revenge(ctx.trades, ctx.baseline, cfg),
    ...(cfg.offPlan ? offPlan(ctx.trades, ctx.plan) : []),
    ...bannedWindow(ctx.trades, ctx.windows),
  ];
}

/** Today: the history detectors, with the stop levels judged by the dashboard's numbers (realized + counted live). */
export function detectLive(ctx: DayContext, cfg: SignalConfig, stop: { dailyPct: number | null; pnlNet: number | null }, now: number): Hit[] {
  return [
    ...stopProximityLive(ctx.trades, { ...stop, dailyLimit: ctx.dailyLimit }, cfg.stopPcts, now),
    ...detectDay({ ...ctx, dailyLimit: null }, cfg),
  ];
}

// ─── restricted windows ─────────────────────────────────────────────────────

/** «8:30am ET», «2pm ET», «2:30pm ET» in a calendar description → NY minutes of the day. */
export function timesInText(text: string | null | undefined): number[] {
  if (!text) return [];
  const out: number[] = [];
  for (const m of text.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*ET/gi)) {
    let h = Number(m[1]) % 12;
    if (m[3]!.toLowerCase() === "pm") h += 12;
    const min = h * 60 + Number(m[2] ?? 0);
    if (min >= 0 && min < 24 * 60) out.push(min);
  }
  return out;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export type CalendarRow = { type: string | null; name: string | null; description: string | null; importance: string | null };
export type MacroItem = { time?: unknown; title?: unknown; impact?: unknown };

/**
 * The day's restricted windows: high-impact market calendar events with a time in their description (CPI / NFP 8:30,
 * FOMC 14:00 and 14:30 …; holidays are not events) and high-impact macro items of the desk / own plan (HH:MM).
 * One window per event minute.
 */
export function windowsOf(calendar: readonly CalendarRow[], macro: readonly MacroItem[], before: number, after: number): BannedWindow[] {
  const at = new Map<number, string>();
  for (const r of calendar) {
    if (String(r.importance ?? "").toLowerCase() !== "high" || r.type === "holiday") continue;
    for (const min of timesInText(r.description)) if (!at.has(min)) at.set(min, String(r.name ?? r.type ?? ""));
  }
  for (const m of macro) {
    if (String(m.impact ?? "").toLowerCase() !== "high" || typeof m.time !== "string") continue;
    const x = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(m.time);
    if (!x) continue;
    const min = Number(x[1]) * 60 + Number(x[2]);
    if (!at.has(min)) at.set(min, typeof m.title === "string" ? m.title.slice(0, 120) : "");
  }
  return [...at.entries()].sort((a, b) => a[0] - b[0]).map(([min, event]) => ({ key: hhmm(min), startMin: min - before, endMin: min + after, event }));
}
