/**
 * The mentor's deterministic stop guard (pure). The model is told when the risk desk has stopped the trader
 * (prompt «Risk state»), but a model can still write «stop after a $150 daily loss» to a trader who must not trade at
 * all. So after every model answer — and again when a stored digest is shown — a stopped trader's texts are overridden:
 *
 *   brief    headline = the stop, points = the risk desk's own stop line (the hero's numbers), ruleToday = «do not
 *            trade — write to your curator», no setups
 *   debrief  the summary opens with the stop; while the stop outlasts today (drawdown, weekly) there is no rule for
 *            tomorrow (no trading commitment is saved)
 *   weekly   the summary opens with the stop; a drawdown stop makes «do not trade until the curator decides» the focus
 *            and drops a new commitment
 *   chat     the reply opens with the stop and the rule
 *
 * The stop is read from lib/coreMetrics/risk (the same loader as the dashboard hero), never from the model.
 */
import type { Lang } from "../../i18n";
import { riskT } from "../../i18n/ns";
import { fmtMoney } from "../notifyEventsCore";
import type { RiskSummary } from "../coreMetrics/risk";
import type { MentorKind } from "./schema";

export type StopInput = Pick<RiskSummary, "stopped" | "stopReason" | "drawdownFromPeakUsd" | "maxDrawdownUsd" | "dailyLossLimitUsd" | "weeklyLossLimitUsd" | "todayNetUsd" | "weekNetUsd">;

export type StopTexts = { headline: string; rule: string; detail: string };

/** The stop's texts in `lang`, or null when the trader is not stopped. */
export function stopTexts(r: StopInput, lang: Lang): StopTexts | null {
  if (!r.stopped || !r.stopReason) return null;
  const t = riskT.tFor(lang);
  const reason = r.stopReason;
  const [used, limit] = reason === "drawdown"
    ? [r.drawdownFromPeakUsd, r.maxDrawdownUsd]
    : reason === "weekly"
      ? [Math.max(0, -(r.weekNetUsd ?? 0)), r.weeklyLossLimitUsd]
      : [Math.max(0, -(r.todayNetUsd ?? 0)), r.dailyLossLimitUsd];
  return {
    headline: t(`mentorStop.headline.${reason}`),
    rule: t(`mentorStop.rule.${reason}`),
    detail: t(`stop.${reason}.message`, { used: fmtMoney(used), limit: fmtMoney(limit ?? 0) }),
  };
}

const lead = (s: StopTexts) => `${s.headline}. ${s.rule}`;
const opens = (text: string, s: StopTexts) => (text.startsWith(s.headline) ? text : `${lead(s)}\n${text}`);

type Obj = Record<string, unknown>;

/**
 * A stopped trader's mentor answer / stored digest content with the stop forced in (anything else unchanged).
 * Works on the model answer and on the stored content (brief content also carries `setups`).
 */
export function guardStopped<T extends Obj>(kind: MentorKind, value: T, risk: StopInput, lang: Lang): T {
  const s = stopTexts(risk, lang);
  if (!s) return value;
  const v: Obj = { ...value };
  if (kind === "brief") {
    v.headline = s.headline;
    v.points = [s.detail];
    v.ruleToday = s.rule;
    v.setupIds = [];
    if ("setups" in v) v.setups = [];
  } else if (kind === "debrief") {
    if (typeof v.summary === "string") v.summary = opens(v.summary, s);
    if (risk.stopReason !== "stop") v.ruleTomorrow = null;
  } else if (kind === "weekly") {
    if (typeof v.summary === "string") v.summary = opens(v.summary, s);
    if (risk.stopReason === "drawdown") {
      v.nextFocus = s.rule;
      v.newCommitment = null;
    }
  } else if (typeof v.reply === "string") {
    v.reply = opens(v.reply, s);
  }
  return v as T;
}
