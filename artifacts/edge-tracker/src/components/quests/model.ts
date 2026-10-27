/**
 * Quests and achievements — pure view logic over the contract (lib/quests/types): texts from keys, the dashboard strip
 * («Квесты 1/3» / «Первые шаги 3/7»), grouping by scope, history, deadlines, achievement tiers. No React, no fetching,
 * so the tests cover every rule with fixtures.
 */
import type { Params } from "@/i18n/core";
import { questsI18n } from "@/i18n/ns/quests";
import { academyPathI18n } from "@/i18n/ns/academyPath";
import { sliceLabel } from "@/components/shared/edge-map/model";
import type { Achievement, AchievementCategory, AchievementItem, AchievementTier, AchievementTierState, Quest, QuestScope, QuestsMe, TextItem } from "@/lib/quests/types";
import { addDays } from "@/lib/trading-date";

export const SCOPE_ORDER: readonly QuestScope[] = ["onboarding", "curator", "daily", "weekly", "monthly"];
/** First steps in display order (api lib/quests/catalog ONBOARDING); every step is independent. */
export const ONBOARDING_ORDER: readonly string[] = ["set_pin", "first_plan_stop", "first_review", "open_desk_day", "replay_own_day", "set_own_rule", "link_telegram"];
/** Optional first steps: shown, rewarded, never needed to finish the list (Telegram). */
export const OPTIONAL_STEPS: ReadonlySet<string> = new Set(["link_telegram"]);
export const isOptionalStep = (q: Pick<Quest, "scope" | "template">) => q.scope === "onboarding" && OPTIONAL_STEPS.has(q.template);
const stepOrder = (template: string) => {
  const i = ONBOARDING_ORDER.indexOf(template);
  return i < 0 ? ONBOARDING_ORDER.length : i;
};
export const TIER_ORDER: readonly AchievementTier[] = ["bronze", "silver", "gold", "platinum"];
export const CATEGORY_ORDER: readonly AchievementCategory[] = ["discipline", "risk", "review", "focus", "planning", "records", "leaks", "mastery", "learning", "growth", "social"];

// ─── texts ──────────────────────────────────────────────────────────────────

function cleanParams(p: TextItem["params"], extra: Params): Params {
  const out: Params = { ...extra };
  for (const [k, v] of Object.entries(p ?? {})) if (v != null) out[k] = v;
  if (out.count == null && out.target != null) out.count = out.target;
  // Dynamic lines (achievements v2) carry codes: an edge-map slice key, an academy-path metric.
  if (typeof out.slice === "string" && out.slice.includes(":")) out.slice = sliceLabel(out.slice);
  if (typeof out.metric === "string") out.metric = academyPathI18n.tryT(`metrics.${out.metric}.label`) ?? out.metric;
  return out;
}

/** A server text item in the UI language: its own key, then the template / line key, else undefined. */
export function textOf(item: TextItem | null | undefined, fallbackKey: string | null, extra: Params = {}): string | undefined {
  const params = cleanParams(item?.params, extra);
  return (item?.key ? questsI18n.tryT(item.key, params) : undefined) ?? (fallbackKey ? questsI18n.tryT(fallbackKey, params) : undefined);
}

export function questTitle(q: Pick<Quest, "title" | "template" | "target">): string {
  return textOf(q.title, `quest.${q.template}.title`, { count: q.target }) ?? questsI18n.t("quest.fallback");
}

export function questDescription(q: Pick<Quest, "description" | "template" | "target">): string {
  return textOf(q.description, `quest.${q.template}.desc`, { count: q.target }) ?? "";
}

export function achievementTitle(a: Pick<Achievement, "title" | "id">): string {
  return textOf(a.title, `ach.${a.id}.title`) ?? questsI18n.t("ach.fallback");
}

/** How to earn the next tier (the hint with the next target as `count`). */
export function achievementHint(a: Pick<Achievement, "hint" | "id">, target: number): string {
  return textOf(a.hint, `ach.${a.id}.hint`, { count: target }) ?? "";
}

export function tierLabel(t: AchievementTier): string {
  return questsI18n.t(`achievements.tier.${t}`);
}

// ─── dates ──────────────────────────────────────────────────────────────────

const dayNum = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / 86_400_000);

/** Calendar days from `today` to the inclusive deadline (0 = ends today, negative = past). */
export function daysLeft(endsOn: string, today: string): number {
  return dayNum(endsOn) - dayNum(today);
}

/**
 * Default deadline of a curator quest: Friday of this week, or of the next week when fewer than two days are left
 * (Thu → next Fri, Fri/Sat/Sun → the coming Friday).
 */
export function defaultDeadline(today: string): string {
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  let d = (5 - wd + 7) % 7;
  if (d < 2 && wd !== 6 && wd !== 0) d += 7;
  return addDays(today, d);
}

// ─── quests ─────────────────────────────────────────────────────────────────

const doneDay = (q: Quest) => q.completedAt?.slice(0, 10) ?? null;
const pct = (n: number, of: number) => Math.max(0, Math.min(100, Math.round((n / Math.max(1, of)) * 100)));
export const questPct = (q: Pick<Quest, "progress" | "target">) => pct(q.progress, q.target);

/** Today's set: today's daily quests (incl. a review quest still open or finished today) plus curator quests still running or finished today. */
export function todayQuests(me: QuestsMe): Quest[] {
  return me.quests.filter((q) =>
    (q.scope === "daily" && (q.startsOn === me.today || doneDay(q) === me.today || (q.status === "active" && (q.endsOn == null || q.endsOn >= me.today))))
    || (q.scope === "curator" && (q.status === "active" || doneDay(q) === me.today)));
}

export type StripView = {
  /** «Первые шаги 3/6» while the required first steps are unfinished, else «Квесты 1/3». */
  kind: "onboarding" | "today";
  done: number;
  total: number;
  /** The next first step: the first active required one in display order (the optional Telegram step last). */
  next: Quest | null;
  steps: Quest[];
  today: Quest[];
};

export function stripView(me: QuestsMe | null | undefined): StripView | null {
  if (!me) return null;
  const today = todayQuests(me);
  const steps = me.quests.filter((q) => q.scope === "onboarding").sort((a, b) => stepOrder(a.template) - stepOrder(b.template) || a.id - b.id);
  const required = steps.filter((q) => !isOptionalStep(q));
  const ob = me.summary.onboarding ?? (required.length ? { done: required.filter((q) => q.status === "done").length, total: required.length } : null);
  if (ob && ob.total > 0 && ob.done < ob.total) {
    const next = required.find((q) => q.status === "active") ?? steps.find((q) => q.status === "active") ?? null;
    return { kind: "onboarding", done: ob.done, total: ob.total, next, steps, today };
  }
  if (today.length === 0) return null;
  return { kind: "today", done: today.filter((q) => q.status === "done").length, total: today.length, next: null, steps: [], today };
}

/** Active quests grouped by scope (fixed order; empty scopes dropped). Curator quests: nearest deadline first. */
export function activeByScope(quests: readonly Quest[]): { scope: QuestScope; quests: Quest[] }[] {
  return SCOPE_ORDER.map((scope) => ({
    scope,
    quests: quests
      .filter((q) => q.scope === scope && q.status === "active")
      .sort((a, b) => (scope === "onboarding" ? stepOrder(a.template) - stepOrder(b.template) : 0)
        || (a.endsOn ?? "9999").localeCompare(b.endsOn ?? "9999") || a.id - b.id),
  })).filter((g) => g.quests.length > 0);
}

/** Finished quests (done / failed / expired), newest first. */
export function questHistory(quests: readonly Quest[]): Quest[] {
  const key = (q: Quest) => doneDay(q) ?? q.endsOn ?? q.startsOn;
  return quests.filter((q) => q.status !== "active").sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id);
}

/**
 * Quests finished since the viewer last saw them (completed today or yesterday, id not in `seen`): the strip
 * celebrates them once. Older completions are never celebrated.
 */
export function freshlyDone(quests: readonly Quest[], today: string, seen: ReadonlySet<number>): Quest[] {
  const from = addDays(today, -1);
  return quests.filter((q) => q.status === "done" && !seen.has(q.id) && (doneDay(q) ?? "") >= from);
}

// ─── achievements ───────────────────────────────────────────────────────────

export function nextTier(a: Pick<Achievement, "tiers">): AchievementTierState | null {
  return [...a.tiers].sort((x, y) => TIER_ORDER.indexOf(x.tier) - TIER_ORDER.indexOf(y.tier)).find((t) => !t.earnedAt) ?? null;
}

/** Earned tiers, highest first. */
export function earnedTiers(a: Pick<Achievement, "tiers">): AchievementTierState[] {
  return a.tiers.filter((t) => t.earnedAt).sort((x, y) => TIER_ORDER.indexOf(y.tier) - TIER_ORDER.indexOf(x.tier));
}

export const achievementPct = (a: Achievement) => {
  const n = nextTier(a);
  return n ? pct(a.current, n.target) : 100;
};

/** A secret line stays «???» until its first tier is earned. */
export const isHidden = (a: Pick<Achievement, "secret" | "tier">) => a.secret && !a.tier;

/** Category order; inside: earned (higher tier first), then closest to the next tier; hidden secrets last. */
export function sortAchievements(list: readonly Achievement[]): Achievement[] {
  const rank = (a: Achievement) => (a.tier ? TIER_ORDER.indexOf(a.tier) + 1 : 0);
  return [...list].sort((a, b) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || Number(isHidden(a)) - Number(isHidden(b))
    || STATUS_ORDER.indexOf(achievementStatus(a)) - STATUS_ORDER.indexOf(achievementStatus(b))
    || rank(b) - rank(a)
    || achievementPct(b) - achievementPct(a)
    || a.id.localeCompare(b.id));
}

export function categoriesOf(list: readonly Achievement[]): AchievementCategory[] {
  return CATEGORY_ORDER.filter((c) => list.some((a) => a.category === c));
}

// ─── achievements v2: status, «ещё N …», items ──────────────────────────────

export type AchievementStatus = "earned" | "progress" | "locked";
const STATUS_ORDER: readonly AchievementStatus[] = ["earned", "progress", "locked"];

/** Earned = a tier is held; in progress = some progress toward the next tier; locked = nothing yet. */
export function achievementStatus(a: Pick<Achievement, "tier" | "current" | "tiers" | "items">): AchievementStatus {
  if (a.tier) return "earned";
  if (a.current > 0 || (a.items ?? []).some((i) => i.state === "open")) return "progress";
  return "locked";
}

/** «ещё 2 дня» for the next tier (null when every tier is earned). */
export function leftText(a: Pick<Achievement, "unit" | "current" | "tiers">): string | null {
  const next = nextTier(a);
  if (!next) return null;
  const left = Math.max(1, next.target - a.current);
  return questsI18n.tryT(`achievements.left.${a.unit ?? "count"}`, { count: left }) ?? null;
}

export function shelfSummary(list: readonly Achievement[]): Record<AchievementStatus, number> {
  const out: Record<AchievementStatus, number> = { earned: 0, progress: 0, locked: 0 };
  for (const a of list) out[achievementStatus(a)]++;
  return out;
}

/** «Ближайшая победа: Разбор без пропусков — ещё 2 дня». */
export function nearestText(me: Pick<QuestsMe, "nearest">): string | null {
  const n = me.nearest;
  if (!n) return null;
  const title = textOf(n.title, `ach.${n.id}.title`) ?? questsI18n.t("ach.fallback");
  const left = questsI18n.tryT(`achievements.left.${n.unit}`, { count: n.left }) ?? String(n.left);
  return questsI18n.t("nearest.label", { title, left });
}

export function itemLabel(i: AchievementItem): string {
  return textOf(i.label, null) ?? i.key;
}
