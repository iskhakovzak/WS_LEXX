/**
 * Escalation to the human (pure): patterns the mentor should not handle alone. When one fires, the trader's curator
 * gets a short notice (lib/mentor/escalate.ts) and the mentor's notes are one click away.
 *
 *   tilt_streak          the last `tiltDays` traded days in a row each had a tilt / revenge / martingale trade
 *   rule_breaks          ≥ `breakCount` breaks of active commitments within the last `breakWindow` weekdays
 *   drawdown_near_limit  the drawdown from the equity peak reached `ddShare` of the trader's max drawdown limit
 *   silence              a trader active in the last 30 days has not traded, checked in or talked to the mentor for
 *                        `silenceDays` weekdays
 * The same rule does not fire again for a trader within `cooldownDays` weekdays of the previous one (open or
 * acknowledged). Days are New York trading days (weekdays; holidays count as days here — a small, safe overcount).
 */
import { addDays, isWeekend } from "../tradingDate";

export const ESCALATION_RULES = ["tilt_streak", "rule_breaks", "drawdown_near_limit", "silence"] as const;
export type EscalationRule = (typeof ESCALATION_RULES)[number];

export type EscalationCfg = { tiltDays: number; breakCount: number; breakWindow: number; ddShare: number; silenceDays: number; cooldownDays: number };
export const DEFAULT_ESCALATION_CFG: EscalationCfg = { tiltDays: 3, breakCount: 4, breakWindow: 5, ddShare: 0.8, silenceDays: 3, cooldownDays: 5 };

export type TradedDay = { day: string; trades: number; net: number; tilt: boolean };

export type EscalationInput = {
  today: string;
  /** Days the trader traded (any order). */
  days: readonly TradedDay[];
  /** Commitment breaks per day (lib/mentor/commitments breaksByDay). */
  breaks: ReadonlyMap<string, number>;
  /** The trader's max drawdown limit in $ (positive), null = none set. */
  maxDrawdown: number | null;
  /** Latest day with any sign of life: a trade, a check-in, a message to the mentor. */
  lastActivity: string | null;
};

export type Detected = { rule: EscalationRule; params: Record<string, number> };

/** Weekdays strictly after `from` up to and including `to`. */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (!isWeekend(d)) n++;
  return n;
}

/** The last `n` weekdays up to and including `today`, oldest first. */
export function lastWeekdays(today: string, n: number): string[] {
  const out: string[] = [];
  for (let d = today; out.length < n; d = addDays(d, -1)) if (!isWeekend(d)) out.unshift(d);
  return out;
}

/** Peak-to-now drawdown in $ of the cumulative day nets (oldest first), ≥ 0. */
export function currentDrawdown(nets: readonly number[]): number {
  let cum = 0;
  let peak = 0;
  for (const n of nets) {
    cum += n;
    if (cum > peak) peak = cum;
  }
  return Math.round((peak - cum) * 100) / 100;
}

export function detectEscalations(i: EscalationInput, cfg: EscalationCfg = DEFAULT_ESCALATION_CFG): Detected[] {
  const out: Detected[] = [];
  const traded = [...i.days].filter((d) => d.day <= i.today && d.trades > 0).sort((a, b) => a.day.localeCompare(b.day));

  let tilt = 0;
  for (let k = traded.length - 1; k >= 0 && traded[k]!.tilt; k--) tilt++;
  if (tilt >= cfg.tiltDays) out.push({ rule: "tilt_streak", params: { days: tilt } });

  const window = new Set(lastWeekdays(i.today, cfg.breakWindow));
  let breaks = 0;
  for (const [day, n] of i.breaks) if (window.has(day)) breaks += n;
  if (breaks >= cfg.breakCount) out.push({ rule: "rule_breaks", params: { count: breaks, days: cfg.breakWindow } });

  if (i.maxDrawdown != null && i.maxDrawdown > 0) {
    const dd = currentDrawdown(traded.map((d) => d.net));
    if (dd >= cfg.ddShare * i.maxDrawdown) out.push({ rule: "drawdown_near_limit", params: { drawdown: dd, limit: i.maxDrawdown, pct: Math.round((dd / i.maxDrawdown) * 100) } });
  }

  const lastTrade = traded[traded.length - 1]?.day ?? null;
  const active = lastTrade != null && weekdaysBetween(lastTrade, i.today) <= 22; // traded within ~30 calendar days
  const last = [lastTrade, i.lastActivity].filter((d): d is string => !!d).sort().at(-1) ?? null;
  if (active && last) {
    const quiet = weekdaysBetween(last, i.today);
    if (quiet >= cfg.silenceDays) out.push({ rule: "silence", params: { days: quiet } });
  }
  return out;
}

export type OpenEscalation = { rule: EscalationRule; day: string; status: "open" | "acknowledged" };

/** Detected rules that are not already covered by an earlier escalation within the cooldown. */
export function freshEscalations(detected: readonly Detected[], existing: readonly OpenEscalation[], today: string, cfg: Pick<EscalationCfg, "cooldownDays"> = DEFAULT_ESCALATION_CFG): Detected[] {
  return detected.filter((d) => !existing.some((e) => e.rule === d.rule && weekdaysBetween(e.day, today) < cfg.cooldownDays));
}
