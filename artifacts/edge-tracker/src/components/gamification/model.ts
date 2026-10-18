/**
 * Pure helpers for the gamification views: reward condition text, the trader's reward lists, the season table rows
 * (top + own place with a gap), league ordering, the admin editor's draft ↔ RewardItem.
 */
import type { GamificationMe, RewardGrant, RewardItem, SeasonState } from "@/lib/gamification/types";
import { levelName } from "@/components/shared/badges";
import { masteryLevelName } from "@/components/shared/gamification-labels";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { questsI18n } from "@/i18n/ns/quests";
import type { LeagueView, RewardItemInput } from "./api";

export type ConditionKind = RewardItem["condition"]["kind"];
export const CONDITION_KINDS: readonly ConditionKind[] = ["achievement", "level", "season_rank", "mastery"];
export const ACH_TIERS = ["bronze", "silver", "gold", "platinum"] as const;

/** Achievement lines the server knows (fallback for the admin picker before GET …/items serves `options`). */
export const KNOWN_ACHIEVEMENTS: readonly string[] = [
  "contract_streak", "clean_month", "comeback", "reviews_total", "review_streak", "focus_beaten", "plan_before_open",
  "full_loop", "own_replays", "beat_yourself", "lessons", "exams", "tier_up", "onboarding",
];

export function achievementName(line: string): string {
  return questsI18n.tryT(`ach.${line}.title`) ?? line;
}

export function tierName(tier: string): string {
  return questsI18n.tryT(`achievements.tier.${tier}`) ?? tier;
}

/** «Достижение «Серия контракта» — Золото», «Место в сезоне не ниже 3-го» … */
export function conditionText(c: RewardItem["condition"]): string {
  const t = gamificationI18n.t;
  switch (c.kind) {
    case "achievement":
      return c.tier ? t("rewards.condition.achievementTier", { name: achievementName(c.ref), tier: tierName(c.tier) }) : t("rewards.condition.achievement", { name: achievementName(c.ref) });
    case "level":
      return t("rewards.condition.level", { name: levelName(Number(c.ref) || 0) });
    case "season_rank":
      return t("rewards.condition.season_rank", { rank: c.rank ?? 1 });
    case "mastery": {
      const level = masteryLevelName(Number(c.tier) || 4);
      return c.ref ? t("rewards.condition.mastery", { level, setup: c.ref }) : t("rewards.condition.masteryAny", { level });
    }
  }
}

export type RewardRow = {
  item: RewardItem;
  /** The latest grant of this item for the viewer, if any. */
  grant: RewardGrant | null;
  state: "eligible" | "requested" | "granted" | "declined" | "locked";
};

const STATE_ORDER: Record<RewardRow["state"], number> = { eligible: 0, requested: 1, locked: 2, granted: 3, declined: 4 };

/**
 * One row per active catalog item: eligible ones first («Запросить»), then requested, locked, granted, declined. An item
 * granted / requested earlier stays visible even when it was deactivated later (history).
 */
export function rewardRows(r: GamificationMe["rewards"]): RewardRow[] {
  const all = [...r.eligible, ...r.requested, ...r.granted];
  const latest = new Map<number, RewardGrant>();
  for (const g of all) {
    const prev = latest.get(g.itemId);
    if (!prev || g.at > prev.at) latest.set(g.itemId, g);
  }
  const rows: RewardRow[] = [];
  for (const item of r.catalog) {
    const grant = latest.get(item.id) ?? null;
    if (!item.active && !grant) continue;
    rows.push({ item, grant, state: grant ? grant.status : "locked" });
  }
  return rows.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.item.title.localeCompare(b.item.title));
}

export function outOfStock(item: RewardItem): boolean {
  return item.stock != null && item.stock <= 0;
}

export type SeasonRow = SeasonState["top"][number] & { rank: number };

/**
 * Season table: the top as sent (rank = position), plus the viewer's own row after a gap when the viewer is outside
 * the top. No other rows — rankings never show the bottom of the desk.
 */
export function seasonRows(s: SeasonState): { rows: SeasonRow[]; own: SeasonRow | null } {
  const rows = s.top.map((r, i) => ({ ...r, rank: i + 1 }));
  const inTop = rows.some((r) => r.me);
  const own = !inTop && s.myRank != null ? { label: "", me: true, points: s.myPoints, title: null, rank: s.myRank } : null;
  return { rows, own };
}

export function leagueTeams(l: LeagueView): LeagueView["teams"] {
  return [...l.teams].sort((a, b) => a.rank - b.rank || b.score - a.score);
}

/* ─────────────── admin editor draft ─────────────── */

export type RewardDraft = {
  title: string;
  description: string;
  kind: ConditionKind;
  ref: string;
  tier: string;
  rank: string;
  stock: string;
  active: boolean;
};

export function draftOf(item: RewardItem | null): RewardDraft {
  if (!item) return { title: "", description: "", kind: "achievement", ref: "", tier: "", rank: "3", stock: "", active: true };
  const c = item.condition;
  return {
    title: item.title,
    description: item.description ?? "",
    kind: c.kind,
    ref: c.kind === "season_rank" ? "season" : c.ref,
    tier: c.tier ?? (c.kind === "mastery" ? "4" : ""),
    rank: c.rank != null ? String(c.rank) : "3",
    stock: item.stock != null ? String(item.stock) : "",
    active: item.active,
  };
}

export type DraftProblem = "titleRequired" | "refRequired";

/** Draft → request body, or the first problem. Refs: achievement = line (+tier | null = any); level = "n";
 * season_rank = "season" + rank; mastery = setup code ("" = any) + tier "1".."4". */
export function bodyOf(d: RewardDraft): { ok: true; body: RewardItemInput } | { ok: false; problem: DraftProblem } {
  const title = d.title.trim();
  if (!title) return { ok: false, problem: "titleRequired" };
  const stockN = d.stock.trim() === "" ? null : Math.max(0, Math.floor(Number(d.stock)));
  const stock = stockN == null || !Number.isFinite(stockN) ? null : stockN;
  const base = { title, description: d.description.trim() || null, active: d.active, stock };
  switch (d.kind) {
    case "achievement":
      if (!d.ref) return { ok: false, problem: "refRequired" };
      return { ok: true, body: { ...base, condition: { kind: "achievement", ref: d.ref, tier: d.tier || null, rank: null } } };
    case "level":
      if (d.ref === "") return { ok: false, problem: "refRequired" };
      return { ok: true, body: { ...base, condition: { kind: "level", ref: d.ref, tier: null, rank: null } } };
    case "season_rank": {
      const rank = Math.max(1, Math.floor(Number(d.rank) || 1));
      return { ok: true, body: { ...base, condition: { kind: "season_rank", ref: "season", tier: null, rank } } };
    }
    case "mastery":
      return { ok: true, body: { ...base, condition: { kind: "mastery", ref: d.ref.trim(), tier: d.tier || "4", rank: null } } };
  }
}
