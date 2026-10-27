/**
 * Achievements v2 — glue between the loaders and the pure engine, and the small views (PURE apart from settings):
 *   v2Part(inputs, awarded)        the AchievementInput fields of the v2 lines
 *   nearestWin(achievements)       «Ближайшая победа»: the in-progress tier with the fewest days-equivalent left
 *   pendingCeremonies(…)           big wins of the last NOTIFY days the trader has not seen
 *   disabledLines()                lines an admin switched off (settings achievements.disabled, comma-separated)
 */
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import type { Achievement, AchievementTier, AchievementUnit, NearestWin, QuestsMe, TextItem } from "../quests/types";
import { isBigTier, lineDef, type AchievementInput, type NewAward } from "../quests/achievements";
import type { StoredAward } from "./dynamic";
import type { V2Inputs } from "./load";
import type { AwardExtra } from "./store";

export function disabledLines(raw: string = setting("achievements.disabled")): Set<string> {
  return new Set(String(raw ?? "").split(",").map((x) => x.trim()).filter(Boolean));
}

export function v2Part(v2: V2Inputs | null, awarded: ReadonlyMap<string, StoredAward>): Partial<AchievementInput> {
  const disabled = disabledLines();
  const masteryTargets = [setting("achievements.masteryTrades1"), setting("achievements.masteryTrades2"), setting("achievements.masteryTrades3")]
    .map((v) => Math.max(1, Math.round(v))).sort((a, b) => a - b) as [number, number, number];
  if (!v2) return { awarded, disabled, masteryTargets };
  return {
    awarded, disabled, masteryTargets,
    process: {
      violationDays: v2.violationDays, breachDays: v2.breachDays, guardComplied: v2.guardComplied, trades: v2.trades, disciplineDays: v2.disciplineDays,
      rules: { cleanWeekMinDays: setting("achievements.cleanWeekMinDays"), revengeMinutes: setting("achievements.revengeMinutes"), comebackDays: setting("achievements.comebackDays") },
    },
    dynamic: { mastery: v2.mastery, setupNames: v2.setupNames, leaks: v2.leaks, path: v2.path },
    kudos: v2.kudos,
    seasonTop: v2.seasonTop,
  };
}

/** Trading days one unit stands for (to compare «2 days» with «1 week» and «3 losses»). */
const UNIT_DAYS: Partial<Record<AchievementUnit, number>> = { days: 1, weeks: 5, months: 21, losses: 1, count: 3, steps: 5, comebacks: 5, games: 3 };
const SKIP_UNITS: ReadonlySet<AchievementUnit> = new Set(["ranks", "seasons", "exams", "lessons", "kudos", "setups", "leaks", "trades"]);

export function nearestWin(list: readonly Achievement[]): NearestWin | null {
  let best: { n: NearestWin; cost: number } | null = null;
  for (const a of list) {
    if (a.secret || !a.unit || SKIP_UNITS.has(a.unit) || a.horizon === "career") continue;
    const next = a.tiers.find((t) => !t.earnedAt);
    if (!next || next.target <= 0) continue;
    const left = Math.max(1, next.target - a.current);
    // Nothing done yet on a long line is not «near».
    if (a.current <= 0 && next.target > 3) continue;
    const cost = left * (UNIT_DAYS[a.unit] ?? 10);
    if (!best || cost < best.cost || (cost === best.cost && a.id < best.n.id)) {
      best = { cost, n: { id: a.id, title: a.title, tier: next.tier, left, unit: a.unit, current: a.current, target: next.target } };
    }
  }
  return best?.n ?? null;
}

/** The title of a stored line (dynamic lines carry their subject in `detail`). */
export function titleFor(line: string, detail: Record<string, unknown> | null | undefined): TextItem {
  const d = detail ?? {};
  if (line.startsWith("setup:")) return { key: "ach.setup.title", params: { name: String(d.name ?? "") } };
  if (line.startsWith("leak:")) return { key: "ach.leak.title", params: { slice: String(d.slice ?? line.slice(5)) } };
  if (line.startsWith("path:")) return { key: "ach.path.title", params: { metric: String(d.metric ?? line.split(":")[2] ?? ""), stage: String(d.stage ?? line.split(":")[1] ?? "") } };
  return { key: `ach.${line}.title` };
}

/** Big tiers awarded in the last `days` days the trader has not seen yet (stored rows + this run's fresh ones). */
export function pendingCeremonies(extras: readonly AwardExtra[], fresh: readonly NewAward[], asOf: string, days = 7): NonNullable<QuestsMe["celebrate"]> {
  if (!setting("achievements.ceremony")) return [];
  const from = addDays(asOf, -days);
  const createdFrom = Date.now() - days * 86_400_000;
  const out = new Map<string, NonNullable<QuestsMe["celebrate"]>[number]>();
  // Stored unseen rows were stored for the ceremony (small and history tiers are stored seen).
  for (const x of extras) {
    if (x.seen || Date.parse(x.createdAt) < createdFrom) continue;
    const k = `${x.line}|${x.tier}`;
    out.set(k, { key: k, id: x.line, tier: x.tier as AchievementTier, date: asOf, title: titleFor(x.line, x.detail) });
  }
  for (const a of fresh) {
    const line = String(a.line);
    if (a.date < from || !isBigTier(lineDef(line), line, a.tier)) continue;
    const k = `${line}|${a.tier}`;
    out.set(k, { key: k, id: line, tier: a.tier, date: a.date, title: titleFor(line, a.detail) });
  }
  return [...out.values()].slice(0, 5);
}
