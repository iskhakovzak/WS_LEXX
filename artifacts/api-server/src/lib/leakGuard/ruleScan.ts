/**
 * I/O of the guard's desk rule patterns (pure detection in rules.ts): today's trades of every trader as session-flow
 * trades (lib/sessionFlow/load), plus — when those rules are on — the opening-window gate and the plan's idea limits
 * (lib/sessionFlow/gates.ts). Called by the scan (scan.ts) on every run; nothing is written here.
 */
import { etWallIsoToMs } from "../../routes/behavior";
import { flowTrades, groupBy } from "../sessionFlow/load";
import type { FlowTrade } from "../sessionFlow/types";
import { detectRules } from "./rules";
import type { GuardConfig, GuardDraft, GuardLevel, LevelChoice } from "./types";

/** The level a rule event is told at: re-entry is a soft stop; the opening window is hard for juniors, soft otherwise. */
export function ruleLevel(pattern: GuardDraft["pattern"], stage: "junior" | "trader" | "senior", ladder: LevelChoice): GuardLevel | null {
  if (ladder === "off") return null;
  if (pattern === "reentry") return "soft";
  if (pattern === "open_window") return stage === "junior" ? "hard" : "soft";
  return ladder;
}

/** Drafts of every trader with trades today (empty when every rule pattern is off). */
export async function ruleDrafts(day: string, now: number, cfg: GuardConfig): Promise<Map<string, GuardDraft[]>> {
  const r = cfg.rules;
  const out = new Map<string, GuardDraft[]>();
  if (!r.reentry && !r.greenToRed && !r.openWindow && !r.ideaLimits) return out;
  const trades = await flowTrades(null, day, day);
  if (!trades.length) return out;
  const by = groupBy(trades, (t: FlowTrade) => t.trader);
  const closeAt = etWallIsoToMs(`${day}T16:00:00`) ?? now;
  for (const [trader, today] of by) {
    const drafts = detectRules({ trader, day, now, closeAt, today, cfg: r, breaches: [] });
    if (drafts.length) out.set(trader, drafts);
  }
  return out;
}
