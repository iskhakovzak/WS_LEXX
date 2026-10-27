/**
 * Big achievements → a positive signal of the capital allocation engine (PURE). Desk settings `achievements.signal*`
 * (weights, window, reset days) and `capital.achievementsEnabled` / `capital.weightAchievements` (lib/capital).
 *
 *   counts      a setup mastery tier HELD now (gold / silver / bronze weights; the best setup only), each leak closed in
 *               the window and not reopened, a clean month in the window, a comeback after a stop in the window
 *   value       Σ weights, capped at 1 (0 … 1)
 *   reset       any rule violation / logged error / risk-desk stop in the last `resetDays` trading days → 0: a fresh
 *               violation removes the bonus at once; losing the mastery (decay) or a reopened leak drops that part
 *
 * The engine (lib/capital/engine compositeOf) adds it as a 4th part ONLY when it is above zero: it can strengthen a
 * raise the edge already proves, but never causes a raise (the «proven edge» and discipline gates stay) or a cut.
 */
import { pool } from "@workspace/db";
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import { violationDaySql } from "../violationWindow";

export type SignalAward = { line: string; tier: string; date: string; lostOn: string | null };

export type SignalWeights = { setupBronze: number; setupSilver: number; setupGold: number; leakClosed: number; cleanMonth: number; comeback: number };
export type SignalRules = { weights: SignalWeights; windowDays: number; resetDays: number };

export type SignalPart = { kind: "setup" | "leak" | "cleanMonth" | "comeback"; line: string; tier: string; date: string; weight: number };

export type AchievementSignal = {
  value: number;
  parts: SignalPart[];
  /** The last violation day that zeroed the signal (null = none in the reset window). */
  resetBy: string | null;
};

const TIER_W = (w: SignalWeights, tier: string) => (tier === "gold" ? w.setupGold : tier === "silver" ? w.setupSilver : tier === "bronze" ? w.setupBronze : 0);
const TIER_RANK: Record<string, number> = { bronze: 1, silver: 2, gold: 3 };

/** Highest stored setup tier per setup line, kept only when not lost. */
function heldSetups(awards: readonly SignalAward[]): SignalAward[] {
  const best = new Map<string, SignalAward>();
  for (const a of awards) {
    if (!a.line.startsWith("setup:") || a.lostOn) continue;
    const prev = best.get(a.line);
    if (!prev || (TIER_RANK[a.tier] ?? 0) > (TIER_RANK[prev.tier] ?? 0)) best.set(a.line, a);
  }
  return [...best.values()];
}

export function achievementSignal(awards: readonly SignalAward[], violationDays: readonly string[], today: string, rules: SignalRules): AchievementSignal {
  const resetFrom = addDays(today, -Math.round(rules.resetDays * 7 / 5));
  const resetBy = rules.resetDays > 0 ? ([...violationDays].filter((d) => d >= resetFrom && d <= today).sort().pop() ?? null) : null;
  if (resetBy) return { value: 0, parts: [], resetBy };
  const from = addDays(today, -rules.windowDays);
  const w = rules.weights;
  const parts: SignalPart[] = [];
  const setups = heldSetups(awards).map((a) => ({ a, weight: TIER_W(w, a.tier) })).sort((x, y) => y.weight - x.weight);
  if (setups[0] && setups[0].weight > 0) parts.push({ kind: "setup", line: setups[0].a.line, tier: setups[0].a.tier, date: setups[0].a.date, weight: setups[0].weight });
  for (const a of awards) {
    if (a.lostOn || a.date < from || a.date > today) continue;
    if (a.line.startsWith("leak:") && w.leakClosed > 0) parts.push({ kind: "leak", line: a.line, tier: a.tier, date: a.date, weight: w.leakClosed });
  }
  // Count lines: one part per tier earned in the window (a 2nd clean month in the window is the silver tier's day).
  for (const a of awards) {
    if (a.date < from || a.date > today) continue;
    if (a.line === "clean_month" && w.cleanMonth > 0) parts.push({ kind: "cleanMonth", line: a.line, tier: a.tier, date: a.date, weight: w.cleanMonth });
    if (a.line === "stop_comeback" && w.comeback > 0) parts.push({ kind: "comeback", line: a.line, tier: a.tier, date: a.date, weight: w.comeback });
  }
  const value = Math.min(1, parts.reduce((s, p) => s + p.weight, 0));
  return { value: Math.round(value * 100) / 100, parts, resetBy: null };
}

// ─── loader (the capital engine's input) ────────────────────────────────────

export function signalRules(): SignalRules {
  return {
    weights: {
      setupBronze: setting("achievements.signalSetupBronze"), setupSilver: setting("achievements.signalSetupSilver"), setupGold: setting("achievements.signalSetupGold"),
      leakClosed: setting("achievements.signalLeakClosed"), cleanMonth: setting("achievements.signalCleanMonth"), comeback: setting("achievements.signalComeback"),
    },
    windowDays: setting("achievements.signalWindowDays"),
    resetDays: setting("achievements.signalResetDays"),
  };
}

const lineOn = (line: string, off: ReadonlySet<string>) =>
  !(line.startsWith("setup:") ? off.has("setups_confirmed") : line.startsWith("leak:") ? off.has("leaks_closed") : off.has(line));

/** Every trader's signal (empty when the capital link or achievements are off). */
export async function loadAchievementSignals(names: readonly string[], today: string, off: ReadonlySet<string>): Promise<Map<string, AchievementSignal>> {
  const out = new Map<string, AchievementSignal>();
  if (!names.length || !setting("achievements.enabled") || !setting("capital.achievementsEnabled") || !(setting("capital.weightAchievements") > 0)) return out;
  const rules = signalRules();
  const from = addDays(today, -Math.max(rules.windowDays, Math.round(rules.resetDays * 7 / 5) + 1));
  const soft = <T>(p: Promise<{ rows: T[] }>) => p.catch(() => ({ rows: [] as T[] }));
  const [aw, viol] = await Promise.all([
    soft(pool.query<{ trader: string; line: string; tier: string; earned_on: string; lost_on: string | null }>(
      `SELECT trader, line, tier, earned_on, lost_on FROM trader_achievements
        WHERE trader = ANY($1::text[]) AND (line LIKE 'setup:%' OR line LIKE 'leak:%' OR line IN ('clean_month', 'stop_comeback'))`,
      [[...names]],
    )),
    soft(pool.query<{ trader: string; d: string }>(
      `SELECT trader, ${violationDaySql("")} AS d FROM rule_violations WHERE trader = ANY($1::text[]) AND archived_at IS NULL AND ${violationDaySql("")} >= $2
       UNION SELECT trader, to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') FROM trading_errors WHERE trader = ANY($1::text[]) AND created_at >= $2::date
       UNION SELECT trader, date::text FROM risk_alert_log WHERE trader = ANY($1::text[]) AND level = 'breach' AND date::text >= $2`,
      [[...names], from],
    )),
  ]);
  const awards = new Map<string, SignalAward[]>();
  for (const r of aw.rows) {
    if (!lineOn(r.line, off)) continue;
    (awards.get(r.trader) ?? awards.set(r.trader, []).get(r.trader)!).push({ line: r.line, tier: r.tier, date: String(r.earned_on), lostOn: r.lost_on ?? null });
  }
  const vd = new Map<string, string[]>();
  for (const r of viol.rows) (vd.get(r.trader) ?? vd.set(r.trader, []).get(r.trader)!).push(String(r.d).slice(0, 10));
  for (const name of names) out.set(name, achievementSignal(awards.get(name) ?? [], vd.get(name) ?? [], today, rules));
  return out;
}
