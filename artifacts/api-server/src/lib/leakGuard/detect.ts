/**
 * Live leak guard — detection, ladder and settlement (pure, no I/O; lib/leakGuard/scan.ts feeds it).
 *
 * Data reaches us by POLLING PropReports (lib/propreports/scheduler: the tick every 5 min in New York desk hours, or
 * PROPREPORTS_SYNC_MINUTES; positions every tick 09:30–16:15), so «at the moment» means «at the first sync that
 * shows the trigger». A trigger seen after its at-risk trade already happened is recorded as `late` (never counted as
 * complied or ignored); a pause already over when seen is `stale` (recorded for the latency numbers, nobody is told).
 */
import { byDay, inWindow, notionalOf } from "./profile";
import type {
  GuardConfig, GuardDraft, GuardLevel, GuardPattern, GuardSettlement, GuardTrade, LevelChoice, PatternStat, PersonalPattern, PersonalProfile,
} from "./types";

const MIN_MS = 60_000;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** First-trade events are raised from this NY minute (08:00: before the pre-market auction trades). */
export const FIRST_TRADE_FROM_MIN = 8 * 60;

export type LiveInput = {
  trader: string;
  /** NY trading date (today). */
  day: string;
  now: number;
  /** NY minutes of `now`. */
  nowMin: number;
  /** Today's trades of the trader (entries today). */
  today: readonly GuardTrade[];
  profile: PersonalProfile;
  cfg: GuardConfig;
  /** When today's «close to the stop» alert was claimed (lib/riskAlertQueue, risk_live_alerts warn), else null. */
  warnAt: number | null;
  /** Today's violations of auto rules: id + the violating trade's exit (or the row's time). */
  violations: ReadonlyArray<{ id: number; at: number; tradeId: number | null }>;
};

function draftOf(
  input: LiveInput, pattern: GuardPattern, stat: PatternStat, sourceKey: string, at: number, windowMin: number | null, tradeId: number | null,
): GuardDraft {
  const pauseUntil = windowMin == null ? null : at + windowMin * MIN_MS;
  const dayTrades = byDay(input.today).get(input.day) ?? [];
  // late: an at-risk entry already exists (it happened before this sync brought the trigger in)
  const late = pattern === "first_trade"
    ? dayTrades.some((t) => t.entryAt != null && t.entryAt <= input.now)
    : inWindow(dayTrades, at, windowMin ?? 0).length > 0;
  const stale = pattern === "first_trade" ? late : pauseUntil != null && input.now >= pauseUntil;
  return {
    trader: input.trader, day: input.day, pattern, sourceKey, triggerTradeId: tradeId, triggeredAt: at, pauseUntil, late, stale,
    costPerTrade: stat.costPerTrade, costPerTrigger: stat.costPerTrigger,
    stats: {
      atRisk: stat.atRisk, triggers: stat.triggers, tStat: stat.tStat, baselineAvg: stat.baselineAvg, atRiskAvg: stat.atRiskAvg,
      minutes: windowMin, medianNotional: stat.medianNotional ?? null,
    },
  };
}

/** Every guard event the trader's state calls for now (the store keeps one per trader / day / pattern / source key). */
export function detectLive(input: LiveInput): GuardDraft[] {
  const { cfg, profile } = input;
  if (!cfg.enabled) return [];
  const out: GuardDraft[] = [];
  const on = (p: PersonalPattern): PatternStat | null => (cfg.patterns[p] && profile[p]?.costly ? profile[p]! : null);

  const al = on("after_loss");
  if (al) {
    for (const t of input.today) {
      if (t.date !== input.day || t.result !== "loss" || t.exitAt == null || t.horizon !== "intraday") continue;
      out.push(draftOf(input, "after_loss", al, `trade:${t.id}`, t.exitAt, cfg.pauseMinutes, t.id));
    }
  }
  const ft = on("first_trade");
  if (ft && input.nowMin >= FIRST_TRADE_FROM_MIN) out.push(draftOf(input, "first_trade", ft, "day", input.now, null, null));
  const rv = on("rule_violation");
  if (rv) for (const v of input.violations) out.push(draftOf(input, "rule_violation", rv, `violation:${v.id}`, v.at, cfg.violationPauseMinutes, v.tradeId));
  const ns = on("near_stop");
  if (ns && input.warnAt != null) out.push(draftOf(input, "near_stop", ns, "warn", input.warnAt, cfg.nearStopPauseMinutes, null));
  return out;
}

/** The trader's ladder level: a per-trader override, else the desk default of the stage. */
export function levelFor(stage: "junior" | "trader" | "senior", override: LevelChoice | null, cfg: Pick<GuardConfig, "levelByStage">): LevelChoice {
  return override ?? cfg.levelByStage[stage];
}

/** Inside the quiet hours (NY minutes; a window may wrap past midnight)? */
export function inQuietHours(nowMin: number, quiet: GuardConfig["quiet"]): boolean {
  if (!quiet.enabled || quiet.fromMin === quiet.toMin) return false;
  return quiet.fromMin < quiet.toMin ? nowMin >= quiet.fromMin && nowMin < quiet.toMin : nowMin >= quiet.fromMin || nowMin < quiet.toMin;
}

/** Ladder steps due for a stored, told event (scan.ts runs them once each; firm and hard need the acknowledgement). */
export function dueSteps(e: {
  level: GuardLevel; detectedAt: number; ackedAt: number | null; escalatedAt: number | null; riskNotifiedAt: number | null; ignoredSoFar: boolean;
}, now: number, cfg: Pick<GuardConfig, "ackMinutes">): { escalateCurator: boolean; notifyRisk: boolean } {
  const needsAck = e.level === "firm" || e.level === "hard";
  const noAck = needsAck && e.ackedAt == null && now >= e.detectedAt + cfg.ackMinutes * MIN_MS;
  return {
    escalateCurator: needsAck && e.escalatedAt == null && (noAck || e.ignoredSoFar),
    notifyRisk: e.level === "hard" && e.riskNotifiedAt == null,
  };
}

export type StoredEvent = {
  pattern: GuardPattern;
  day: string;
  triggeredAt: number;
  pauseUntil: number | null;
  late: boolean;
  costPerTrigger: number | null;
  medianNotional: number | null;
  /** Ticker-scoped rule events (reentry, idea_limit): only later entries in this ticker / side are at risk. */
  scope?: { ticker: string; side: string | null } | null;
};

/** At-risk trades taken so far (the escalation reads it while the pause still runs). */
export function atRiskTrades(e: StoredEvent, dayTrades: readonly GuardTrade[]): GuardTrade[] {
  const sorted = [...dayTrades].filter((t) => t.date === e.day).sort((a, b) => (a.entryAt ?? 0) - (b.entryAt ?? 0) || a.id - b.id);
  if (e.pattern === "first_trade") return sorted.slice(0, 1);
  if (e.pauseUntil == null) return [];
  const win = inWindow(sorted, e.triggeredAt, (e.pauseUntil - e.triggeredAt) / MIN_MS);
  const sc = e.scope;
  return sc ? win.filter((t) => (t.ticker ?? "").toUpperCase() === sc.ticker && (sc.side == null || t.side === sc.side)) : win;
}

/**
 * The outcome of an event, or null while it is still open (pause running, an at-risk trade still open, no first trade
 * yet today). `dayOver` = the trading day ended (a first-trade event without a trade becomes no_trades).
 *   complied → saved ≈ costPerTrigger (first_trade: × the size cut, 1 − notional / median), lost 0
 *   ignored  → lost = the actual loss of the at-risk trades (0 when they made money), saved 0
 *   late     → neither (the guard could not have prevented it)
 */
export function settle(e: StoredEvent, dayTrades: readonly GuardTrade[], now: number, dayOver: boolean, cfg: Pick<GuardConfig, "firstTradeSizeRatio">): GuardSettlement | null {
  const risk = atRiskTrades(e, dayTrades);
  if (risk.some((t) => t.result === "open") && !dayOver) return null;
  const nets = risk.filter((t) => t.net != null).map((t) => t.net!);
  const actualNet = nets.length ? round2(nets.reduce((a, b) => a + b, 0)) : null;
  const ids = risk.map((t) => t.id);
  const lostOf = () => round2(Math.max(0, -(actualNet ?? 0)));
  const expected = Math.max(0, e.costPerTrigger ?? 0);

  if (e.pattern === "first_trade") {
    const first = risk[0];
    if (!first) return dayOver ? { outcome: "no_trades", atRiskIds: [], actualNet: null, saved: 0, lost: 0 } : null;
    if (e.late) return { outcome: "late", atRiskIds: ids, actualNet, saved: 0, lost: 0 };
    const size = notionalOf(first);
    if (size == null || !e.medianNotional) return { outcome: "unknown", atRiskIds: ids, actualNet, saved: 0, lost: 0 };
    const ratio = size / e.medianNotional;
    if (ratio <= cfg.firstTradeSizeRatio) {
      return { outcome: "complied", atRiskIds: ids, actualNet, saved: round2(expected * Math.min(1, Math.max(0, 1 - ratio))), lost: 0 };
    }
    return { outcome: "ignored", atRiskIds: ids, actualNet, saved: 0, lost: lostOf() };
  }

  if (e.pauseUntil != null && now < e.pauseUntil && !dayOver) return null;
  if (e.late) return { outcome: "late", atRiskIds: ids, actualNet, saved: 0, lost: 0 };
  if (!risk.length) return { outcome: "complied", atRiskIds: [], actualNet: null, saved: round2(expected), lost: 0 };
  return { outcome: "ignored", atRiskIds: ids, actualNet, saved: 0, lost: lostOf() };
}
