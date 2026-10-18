/**
 * Rewards catalog — PURE rules (no I/O), unit-tested. Admin-defined REAL rewards; a condition makes a trader eligible
 * (never bought with points). Condition refs (the admin editor sends them):
 *   achievement  ref = line id, tier = tier or null (any tier of the line)
 *   level        ref = String(level) — the all-time discipline level (lib/daily/discipline)
 *   season_rank  ref = "season", rank = N — top N of a FINISHED season; every season is its own grant (grant ref = season)
 *   mastery      ref = setup code ("1.3") or "" (any setup), tier = String(level 1..4)
 * Flow: eligible → requested (trader) → granted | declined (staff). One grant per (item, trader, ref).
 */
import { TIERS } from "../quests/achievements";
import type { RewardItem } from "./types";

export type EligibilityInput = {
  achievements: readonly { line: string; tier: string }[];
  level: number;
  seasons: readonly { season: string; rank: number }[];
  mastery: readonly { setupId: number; code: string | null; level: number }[];
};

const tierIdx = (t: string | null | undefined) => (t ? TIERS.indexOf(t as (typeof TIERS)[number]) : -1);

/** Grant refs the trader qualifies for under `item` ('' for one-off conditions, the season key for season ranks). */
export function eligibleRefs(item: Pick<RewardItem, "condition">, i: EligibilityInput): string[] {
  const c = item.condition;
  switch (c.kind) {
    case "achievement": {
      const need = c.tier ? tierIdx(c.tier) : 0;
      return i.achievements.some((a) => a.line === c.ref && tierIdx(a.tier) >= Math.max(0, need)) ? [""] : [];
    }
    case "level": {
      const need = Number(c.ref);
      return Number.isFinite(need) && need > 0 && i.level >= need ? [""] : [];
    }
    case "season_rank": {
      const top = c.rank ?? 0;
      return top > 0 ? i.seasons.filter((s) => s.rank >= 1 && s.rank <= top).map((s) => s.season).sort() : [];
    }
    case "mastery": {
      const need = Math.max(1, Math.min(4, Number(c.tier) || 4));
      const ref = (c.ref ?? "").trim();
      return i.mastery.some((m) => m.level >= need && (!ref || m.code === ref || String(m.setupId) === ref)) ? [""] : [];
    }
    default:
      return [];
  }
}

export type ItemProblem = "kind" | "ref" | "tier" | "rank" | "title" | "stock";

/** Checks an item from the admin editor (null = fine). `lines` = achievement line ids, `levels` = the highest level. */
export function itemProblem(item: Omit<RewardItem, "id">, o: { lines: readonly string[]; levels: number }): ItemProblem | null {
  if (!item.title.trim()) return "title";
  if (item.stock != null && (!Number.isInteger(item.stock) || item.stock < 0)) return "stock";
  const c = item.condition;
  switch (c.kind) {
    case "achievement":
      if (!o.lines.includes(c.ref)) return "ref";
      if (c.tier != null && tierIdx(c.tier) < 0) return "tier";
      return null;
    case "level": {
      const n = Number(c.ref);
      return Number.isInteger(n) && n >= 1 && n <= o.levels ? null : "ref";
    }
    case "season_rank":
      return c.rank != null && Number.isInteger(c.rank) && c.rank >= 1 && c.rank <= 50 ? null : "rank";
    case "mastery": {
      const n = Number(c.tier);
      if (!(Number.isInteger(n) && n >= 1 && n <= 4)) return "tier";
      return (c.ref ?? "").length <= 20 ? null : "ref";
    }
    default:
      return "kind";
  }
}
