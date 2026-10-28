/**
 * Idea tiers of the morning plan (pure; tests in __tests__/gates.test.ts). Per planned ticker the trader marks a tier
 * (1 best … 3) and «authored» (an own idea, not the desk plan's); table plan_idea_marks.
 *
 *   linkIdeas(trades, marks)          each PropReports trade → its idea by (trader, NY entry day, ticker) and side (an
 *                                     idea without a side takes both) — the way catalyst marks link
 *   isLimited(mark)                   authored or tier 3: at most flow.ideaStopShare of the daily stop, no re-entries
 *   ideaBreaches(day, marks, …)       per limited idea: the re-entry (its 2nd entry) and the loss cap (the exit that took
 *                                     the ticker's realised net to −cap) → the guard's idea_limit stop on that ticker
 *   tierStats / bandStats             P&L, win rate, count by tier and by checklist score band (shared $ math)
 *   missedIdeas(marks, traded, moves) tier 1–2 ideas without a trade whose ticker moved ≥ flow.missedMovePct that day
 */
import { computeUsdStats, type UsdStats } from "../playbookEdge";
import { bandOf, SCORE_BANDS, type ScoreBand } from "./checklist";
import { entryNumbers } from "./flow";
import { round2, type FlowTrade } from "./types";
import type { RuleBreach } from "../leakGuard/rules";

export type IdeaMark = {
  trader: string;
  day: string;
  ticker: string;
  side: "long" | "short" | null;
  tier: 1 | 2 | 3 | null;
  authored: boolean;
  setupId: number | null;
  score: number | null;
  maxScore: number | null;
  threshold: number | null;
};

const key = (trader: string, day: string, ticker: string) => `${trader}\u0000${day}\u0000${ticker.toUpperCase()}`;

export function linkIdeas<T extends Pick<FlowTrade, "id" | "trader" | "day" | "ticker" | "side">>(trades: readonly T[], marks: readonly IdeaMark[]): Map<number, IdeaMark | null> {
  const by = new Map(marks.map((m) => [key(m.trader, m.day, m.ticker), m]));
  return new Map(trades.map((t) => {
    const m = by.get(key(t.trader, t.day, t.ticker)) ?? null;
    return [t.id, m && (m.side == null || t.side == null || m.side === t.side) ? m : null];
  }));
}

export const isLimited = (m: Pick<IdeaMark, "authored" | "tier">): boolean => m.authored || m.tier === 3;

/** The loss cap of a limited idea in $ (null without a daily limit). */
export const ideaCap = (dailyLimit: number | null, stopShare: number): number | null =>
  dailyLimit != null && dailyLimit > 0 && stopShare > 0 ? round2(dailyLimit * stopShare) : null;

export function ideaBreaches(dayTrades: readonly FlowTrade[], marks: readonly IdeaMark[], dailyLimit: number | null, stopShare: number, closeAt: number): RuleBreach[] {
  const link = linkIdeas(dayTrades, marks);
  const cap = ideaCap(dailyLimit, stopShare);
  const out: RuleBreach[] = [];
  for (const m of marks.filter(isLimited)) {
    const mine = dayTrades.filter((t) => link.get(t.id) === m);
    if (!mine.length) continue;
    const stats = { ticker: m.ticker, side: m.side, limit: cap, tier: m.tier, authored: m.authored ? 1 : 0 };
    const nums = entryNumbers(mine);
    const second = mine.filter((t) => (nums.get(t.id) ?? 1) === 2 && t.entryAt != null).sort((a, b) => a.entryAt! - b.entryAt!)[0];
    if (second) out.push({ pattern: "idea_limit", sourceKey: `${m.ticker}:reentry`, at: second.entryAt!, pauseUntil: closeAt, tradeId: second.id, stats: { ...stats, kind: "reentry" } });
    if (cap != null) {
      let cum = 0;
      for (const t of mine.filter((x) => x.net != null && x.exitAt != null).sort((a, b) => a.exitAt! - b.exitAt! || a.id - b.id)) {
        cum += t.net!;
        if (cum <= -cap) { out.push({ pattern: "idea_limit", sourceKey: `${m.ticker}:loss`, at: t.exitAt!, pauseUntil: closeAt, tradeId: t.id, stats: { ...stats, kind: "loss" } }); break; }
      }
    }
  }
  return out;
}

export type TierKey = "1" | "2" | "3" | "none";
export type TierRow = UsdStats & { tier: TierKey };
export type BandRow = UsdStats & { band: ScoreBand };

export function tierStats(trades: readonly FlowTrade[], marks: readonly IdeaMark[]): { tiers: TierRow[]; authored: UsdStats; bands: BandRow[] } {
  const link = linkIdeas(trades, marks);
  const byTier = new Map<TierKey, FlowTrade[]>();
  const byBand = new Map<ScoreBand, FlowTrade[]>();
  const authored: FlowTrade[] = [];
  for (const t of trades) {
    const m = link.get(t.id) ?? null;
    const k: TierKey = m?.tier ? (String(m.tier) as TierKey) : "none";
    byTier.set(k, [...(byTier.get(k) ?? []), t]);
    if (m?.authored) authored.push(t);
    const b = bandOf(m && m.score != null && m.threshold != null ? { score: m.score, threshold: m.threshold } : null);
    byBand.set(b, [...(byBand.get(b) ?? []), t]);
  }
  const tiers = (["1", "2", "3", "none"] as const).filter((k) => byTier.has(k)).map((tier) => ({ tier, ...computeUsdStats(byTier.get(tier)!) }));
  const bands = SCORE_BANDS.filter((k) => byBand.has(k)).map((band) => ({ band, ...computeUsdStats(byBand.get(band)!) }));
  return { tiers: tiers.filter((r) => r.n > 0), authored: computeUsdStats(authored), bands: bands.filter((r) => r.n > 0) };
}

export type MissedIdea = { day: string; ticker: string; tier: 1 | 2; movePct: number };

/** Tier 1–2 ideas without any trade in the ticker that day whose close-to-close move was ≥ minMovePct (either way). */
export function missedIdeas(marks: readonly IdeaMark[], traded: ReadonlySet<string>, moves: ReadonlyMap<string, number>, minMovePct: number): MissedIdea[] {
  const out: MissedIdea[] = [];
  for (const m of marks) {
    if (m.tier !== 1 && m.tier !== 2) continue;
    if (traded.has(key(m.trader, m.day, m.ticker))) continue;
    const mv = moves.get(`${m.day}|${m.ticker}`);
    if (mv != null && Math.abs(mv) >= minMovePct) out.push({ day: m.day, ticker: m.ticker, tier: m.tier, movePct: mv });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || Math.abs(b.movePct) - Math.abs(a.movePct));
}

export const tradedKey = key;
