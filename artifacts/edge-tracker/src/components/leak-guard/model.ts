/**
 * Live leak guard — client model (pure; unit-tested in model.test.ts). Shapes mirror the API
 * (artifacts/api-server/src/routes/leak-guard.ts, lib/leakGuard/types.ts).
 */
export type GuardPattern = "after_loss" | "first_trade" | "rule_violation" | "near_stop";
export type GuardLevel = "soft" | "firm" | "hard";
export type LevelChoice = "off" | GuardLevel;
export type GuardOutcome = "complied" | "ignored" | "late" | "no_trades" | "unknown";
export type Stage = "junior" | "trader" | "senior";

export const LEVEL_CHOICES: readonly LevelChoice[] = ["off", "soft", "firm", "hard"];

export type GuardEvent = {
  id: number;
  day: string;
  pattern: GuardPattern;
  level: GuardLevel;
  triggeredAt: string;
  detectedAt: string;
  pauseUntil: string | null;
  late: boolean;
  silentReason: "quiet" | "cap" | "stale" | null;
  costPerTrade: number | null;
  costPerTrigger: number | null;
  minutes: number | null;
  ackedAt: string | null;
  escalatedAt: string | null;
  riskNotifiedAt: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  outcome: GuardOutcome | null;
  outcomeNet: number | null;
  saved: number | null;
  lost: number | null;
  atRiskTradeIds: number[];
  lagSec: number | null;
};

export type ImpactTotals = {
  events: number; settled: number; complied: number; ignored: number; late: number; noTrades: number;
  saved: number; lost: number; compliance: number | null;
};
export type ImpactSummary = ImpactTotals & {
  medianLagSec: number | null;
  byPattern: Array<{ pattern: GuardPattern } & ImpactTotals>;
  weekly: Array<{ week: string; saved: number; lost: number; complied: number; ignored: number }>;
};

export type PatternStat = {
  pattern: GuardPattern;
  triggers: number;
  atRisk: number;
  atRiskAvg: number | null;
  baselineAvg: number | null;
  costPerTrade: number | null;
  costPerTrigger: number | null;
  tStat: number | null;
  costly: boolean;
};

export type GuardActive = { now: string; events: GuardEvent[] };

export type GuardImpact = {
  trader: string;
  from: string;
  to: string;
  enabled: boolean;
  level: { effective: LevelChoice; override: LevelChoice | null; stage: Stage; stageDefault: LevelChoice };
  summary: ImpactSummary;
  patterns: PatternStat[];
  recent: GuardEvent[];
};

export type GuardDesk = {
  day: string;
  from: string;
  enabled: boolean;
  levelByStage: Record<Stage, LevelChoice>;
  active: Array<GuardEvent & { trader: string }>;
  traders: Array<{ trader: string; stage: Stage; override: LevelChoice | null; level: LevelChoice; today: number; summary: ImpactSummary }>;
  desk: ImpactSummary;
};

/** Firm and hard events wait for the trader's acknowledgement. */
export function needsAck(e: Pick<GuardEvent, "level" | "ackedAt">): boolean {
  return (e.level === "firm" || e.level === "hard") && !e.ackedAt;
}

const RANK: Record<GuardLevel, number> = { hard: 3, firm: 2, soft: 1 };

/**
 * The one event the banner shows: an unacknowledged firm / hard first, then the higher level, then the newest.
 * Events the trader hid (soft, or already acknowledged) are skipped.
 */
export function pickBannerEvent(events: readonly GuardEvent[], hidden: ReadonlySet<number>): GuardEvent | null {
  const shown = events.filter((e) => needsAck(e) || !hidden.has(e.id));
  if (!shown.length) return null;
  return [...shown].sort((a, b) =>
    Number(needsAck(b)) - Number(needsAck(a)) || RANK[b.level] - RANK[a.level] || Date.parse(b.detectedAt) - Date.parse(a.detectedAt),
  )[0]!;
}

/** Milliseconds left of the pause on the server's clock (`offsetMs` = server − client); null without a pause. */
export function remainingMs(pauseUntil: string | null, clientNow: number, offsetMs: number): number | null {
  if (!pauseUntil) return null;
  return Math.max(0, Date.parse(pauseUntil) - (clientNow + offsetMs));
}

/** «9:05», «1:02:09» (no language: digits and colons). */
export function fmtCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The status word of an event in a list: its outcome, or «open» while it runs. */
export function statusOf(e: Pick<GuardEvent, "outcome">): GuardOutcome | "open" {
  return e.outcome ?? "open";
}
