/**
 * The trader's risk state — ONE loader for every reader of «can this trader trade now?»: the dashboard hero
 * (GET /risk/me), the AI mentor (lib/mentor/facts), the mentor's escalations. Same rows, same limits, same baseline:
 *
 *   limits     loadEffectiveLimits — the stored limits with the regime multiplier on the daily limit (what the stop uses)
 *   days       loadDaily — per day, broker rows win over journal rows; net = pnl − |fees| on the close date
 *   drawdown   from the equity PEAK (lifetime, reset by a curator's review of a drawdown breach), live unrealized added
 *   stop       computeStop: drawdown ≥ 100% → weekly ≥ 100% → daily ≥ 100% → warn ≥ 70% → ok
 *
 * Two honestly different numbers, never to be confused (and never shown under the same label):
 *   drawdownFromPeakUsd   how far equity is below its peak (vs maxDrawdown, «Просадка от пика»)
 *   todayLossUsd          today's loss (vs dailyLossLimit, «Дневной лимит убытка»)
 */
import type { Lang } from "../../i18n";
import { computeMetrics, drawdownSince, liveRisk, round2, type DayRow, type Limits, type LiveRisk, type Metrics, type StopState } from "../riskMetrics";
import { loadDaily, loadDdResets, loadEffectiveLimits, loadLiveSnapshots, loadPositions } from "../riskData";

export type RiskState = { trader: string; today: string; limits: Limits | null; days: DayRow[]; live: LiveRisk | null; metrics: Metrics };

/** The risk state of `trader` on `today` (NY trading date) — exactly what GET /risk/me answers. */
export async function riskStateOf(trader: string, today: string, lang: Lang = "ru"): Promise<RiskState> {
  const [limitsMap, days, positions, resets, snaps] = await Promise.all([
    loadEffectiveLimits(trader, today), loadDaily(trader, today), loadPositions(trader, today), loadDdResets(trader), loadLiveSnapshots(today, [trader]),
  ]);
  const limits = limitsMap.get(trader) ?? null;
  const live = liveRisk(snaps.get(trader), today);
  const metrics = computeMetrics(trader, days, positions, limits, today, lang, drawdownSince(resets.get(trader), today), live);
  return { trader, today, limits, days, live, metrics };
}

/** States in which trading is stopped (computeStop sets `halted` exactly for these). */
export type HaltState = Extract<StopState, "drawdown" | "weekly" | "stop">;

/** The compact, label-safe summary a non-risk reader (the mentor, a text) gets: names say what each number is. */
export type RiskSummary = {
  /** Trading is stopped now (drawdown from peak, weekly or daily limit reached). */
  stopped: boolean;
  /** Which stop (null when not stopped). drawdown = until the curator decides; weekly = until Monday; stop = today. */
  stopReason: HaltState | null;
  state: StopState;
  /** The stop's own one-liner (server `risk` texts, the reader's language). */
  stopMessage: string;
  /** Drawdown from the equity peak, $ ≥ 0 (lifetime peak or since the last curator review). */
  drawdownFromPeakUsd: number;
  /** Max drawdown limit, $ (positive), null = not set. */
  maxDrawdownUsd: number | null;
  /** Daily loss limit in effect today, $ (positive), null = not set. */
  dailyLossLimitUsd: number | null;
  weeklyLossLimitUsd: number | null;
  /** Today's net incl. counted live unrealized (null = no $ data today). */
  todayNetUsd: number | null;
  /** Room left to the daily stop, $ (null = no daily limit). */
  dailyRemainingUsd: number | null;
  /** This week's net (Monday → today) incl. counted live unrealized (null = no $ data). */
  weekNetUsd: number | null;
};

const abs = (v: number | null | undefined): number | null => (v == null ? null : Math.abs(v));

/** Pure: the summary of a risk state. */
export function riskSummary(s: Pick<RiskState, "limits" | "metrics">): RiskSummary {
  const m = s.metrics;
  const halted = m.stop.halted && (m.stop.state === "drawdown" || m.stop.state === "weekly" || m.stop.state === "stop");
  return {
    stopped: halted,
    stopReason: halted ? (m.stop.state as HaltState) : null,
    state: m.stop.state,
    stopMessage: m.stop.message,
    drawdownFromPeakUsd: round2(m.drawdown.currentUsd),
    maxDrawdownUsd: abs(s.limits?.maxDrawdown),
    dailyLossLimitUsd: abs(s.limits?.dailyLossLimit),
    weeklyLossLimitUsd: abs(s.limits?.weeklyLossLimit),
    todayNetUsd: m.today.pnlNet,
    dailyRemainingUsd: m.stop.dailyRemainingUsd,
    weekNetUsd: m.week.pnlNet,
  };
}

/** A summary for «no data» (a failed load): not stopped, nothing known. */
export const UNKNOWN_RISK: RiskSummary = {
  stopped: false, stopReason: null, state: "no_limits", stopMessage: "", drawdownFromPeakUsd: 0,
  maxDrawdownUsd: null, dailyLossLimitUsd: null, weeklyLossLimitUsd: null, todayNetUsd: null, dailyRemainingUsd: null, weekNetUsd: null,
};
