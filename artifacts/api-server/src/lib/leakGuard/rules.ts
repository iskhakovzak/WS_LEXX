/**
 * Rule patterns of the leak guard (pure, no I/O; lib/leakGuard/ruleScan.ts feeds them). Unlike the personal patterns
 * (profile.ts: «this costs YOU money»), these are desk rules that hold for everyone with trades today:
 *
 *   reentry       the second re-entry in the same ticker and side (lib/sessionFlow entry numbers) → a soft stop on
 *                 that ticker / side for the rest of the day (at-risk = further entries in it)
 *   green_to_red  the day crossed from green to red and the size or the pace went up after the cross → pause N minutes
 *   open_window   the realised loss of trades entered 09:30–10:00 reached the opening-window limit → no entries until
 *                 10:00 (lib/sessionFlow/openWindow)
 *   idea_limit    a ticker the plan marks authored or tier 3: its loss reached the cap (a share of the daily stop) or it
 *                 was re-entered → stop that ticker for the day (lib/sessionFlow/ideas)
 * A day-long stop has pauseUntil = the session close; ticker-scoped events carry `ticker` / `side` in their stats so the
 * at-risk trades are the later entries in that ticker only.
 */
import { greenToRed, reentryBreaches, type GreenToRedCfg } from "../sessionFlow/flow";
import type { FlowTrade } from "../sessionFlow/types";
import type { GuardDraft, GuardPattern } from "./types";

const MIN_MS = 60_000;

export type RulesCfg = {
  reentry: boolean;
  greenToRed: boolean;
  openWindow: boolean;
  ideaLimits: boolean;
  maxReentries: number;
  g2r: GreenToRedCfg;
  g2rPauseMinutes: number;
};

/** An opening-window or idea-limit breach found by its own calculator (group 4), ready to become a draft. */
export type RuleBreach = {
  pattern: Extract<GuardPattern, "open_window" | "idea_limit">;
  sourceKey: string;
  at: number;
  pauseUntil: number;
  tradeId: number | null;
  stats: Record<string, number | string | null>;
};

export type RulesInput = {
  trader: string;
  day: string;
  now: number;
  /** Epoch ms of the session close of `day` (the end of a day-long stop). */
  closeAt: number;
  /** The trader's trades of `day` (entries today). */
  today: readonly FlowTrade[];
  cfg: RulesCfg;
  /** Breaches the opening-window gate and the idea-tier limits found (empty when off). */
  breaches?: readonly RuleBreach[];
};

function draft(input: RulesInput, pattern: GuardPattern, sourceKey: string, at: number, pauseUntil: number, tradeId: number | null, stats: GuardDraft["stats"], scoped: { ticker: string; side: string | null } | null): GuardDraft {
  const after = input.today.filter((t) => t.entryAt != null && t.entryAt > at && t.entryAt <= pauseUntil
    && (!scoped || (t.ticker.toUpperCase() === scoped.ticker && (scoped.side == null || t.side === scoped.side))));
  const late = after.length > 0;
  return {
    trader: input.trader, day: input.day, pattern, sourceKey, triggerTradeId: tradeId, triggeredAt: at, pauseUntil, late,
    stale: input.now >= pauseUntil, costPerTrade: null, costPerTrigger: null,
    stats: { ...stats, minutes: Math.max(0, Math.round((pauseUntil - at) / MIN_MS)) },
  };
}

/** Every rule event the trader's day calls for now (the store keeps one per trader / day / pattern / source key). */
export function detectRules(input: RulesInput): GuardDraft[] {
  const { cfg } = input;
  const out: GuardDraft[] = [];
  if (cfg.reentry) {
    for (const b of reentryBreaches(input.today, cfg.maxReentries)) {
      if (b.at == null) continue;
      out.push(draft(input, "reentry", `${b.ticker}:${b.side ?? "any"}`, b.at, input.closeAt, b.tradeId,
        { ticker: b.ticker, side: b.side, entries: b.entries, max: cfg.maxReentries }, { ticker: b.ticker, side: b.side }));
    }
  }
  if (cfg.greenToRed) {
    const g = greenToRed(input.today, cfg.g2r, input.now);
    if (g?.material) {
      // The moment it became material: the minAfter-th entry after the cross.
      const after = input.today.filter((t) => t.entryAt != null && t.entryAt > g.crossAt).sort((a, b) => a.entryAt! - b.entryAt! || a.id - b.id);
      const trigger = after[cfg.g2r.minAfter - 1] ?? after[after.length - 1];
      if (trigger?.entryAt != null) {
        const until = Math.min(input.closeAt, trigger.entryAt + cfg.g2rPauseMinutes * MIN_MS);
        out.push(draft(input, "green_to_red", "day", trigger.entryAt, until, trigger.id,
          { peak: g.peak, sizeRatio: g.sizeRatio, paceRatio: g.paceRatio, after: g.after.trades }, null));
      }
    }
  }
  for (const b of input.breaches ?? []) {
    const scoped = typeof b.stats.ticker === "string" ? { ticker: b.stats.ticker, side: typeof b.stats.side === "string" ? b.stats.side : null } : null;
    out.push(draft(input, b.pattern, b.sourceKey, b.at, b.pauseUntil, b.tradeId, b.stats, scoped));
  }
  return out;
}

/** Ticker / side of a ticker-scoped event (from its stats), null for a whole-day event. */
export function scopeOf(stats: Record<string, unknown>): { ticker: string; side: string | null } | null {
  return typeof stats.ticker === "string" && stats.ticker ? { ticker: stats.ticker, side: typeof stats.side === "string" ? stats.side : null } : null;
}
