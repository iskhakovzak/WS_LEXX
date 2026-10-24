/**
 * Quests and achievements — the entry points (routes/quests.ts, lib/daily/rewards.ts, the nightly job).
 *
 *   evaluationFor(trader)   one load (lib/quests/load.ts) → quests synced for the current periods (engine.ts, created
 *                           lazily, expired / failed past ones, notifications on a status change), achievements awarded
 *                           once (achievements.ts), discipline summary with the quest points; cached per trader for
 *                           CACHE_MS and per last finished day (forgetQuests drops it after a review / an assignment)
 *   questsMe(trader)        the QuestsMe answer
 *   assignQuest / cancelQuest / completeQuest   curator quests (permissions are checked by the route)
 *
 * Notifications (type + params, rendered per reader — lib/notificationRenderers/quests.ts):
 *   quest_done           → the trader IN THE NIGHTLY BATCH (lib/notificationBatch, roadmap R3: one in-app notice a day,
 *                          not a ping per quest); for curator quests also the assigner (variant «staff», at once). A
 *                          manual task the curator marks done reaches the trader at once (a person's answer).
 *   quest_failed         → the assigner when a curator quest failed or expired
 *   quest_assigned       → the trader
 *   quest_cancelled      → the trader when the curator cancels an active curator quest (the «assigned» one is marked read)
 *   achievement_earned   → the trader in the nightly batch (the highest new tier per line; only tiers earned in the last
 *                          NOTIFY_DAYS days, so the first run after the rollout awards history quietly)
 */
import { logger } from "../logger";
import { notifyUser } from "../notifyUtils";
import { enqueueBatch } from "../notificationBatch";
import { setting } from "../settings/registry";
import { addDays, nyDate } from "../tradingDate";
import { lastFinishedDay, levelThresholds, windowStart, withQuestPoints } from "../daily/discipline";
import type { BadgeState, DisciplineSummary } from "../daily/types";
import {
  achievementStates, awardKey, badgeAward, badgesOf, dateFixes, evaluateAchievements, newAwards, TIERS, type NewAward,
} from "./achievements";
import { curatorTemplate, fridayOf, MANUAL_TEMPLATE, monthOf, questWeekOf, type QuestData, type StoredQuest } from "./catalog";
import { onboardingFor, onboardingState, planQuests, questPoints, switches, toQuest, visibleQuests, weekSummary } from "./engine";
import { loadTraderInputs } from "./load";
import { afterEvaluation } from "../gamification/hooks";
import { taskDoneBonuses } from "../gamification/taskDone";
import { evaluationCache, forgetQuests, generationOf } from "./cache";
import {
  achievementsOf, activeCuratorQuests, closeQuest, createQuests, fixAchievementDate, insertAchievement, insertCuratorQuest, legacyBadges, markAssignedNoticeRead, questsOf,
  updateQuests, type StoredAchievement,
} from "./store";
import type { Achievement, AssignQuestBody, Quest, QuestsMe } from "./types";
import { logInterventionSafe } from "../interventions/log";

export const CACHE_MS = 5 * 60_000;
export const NOTIFY_DAYS = 7;

export type Evaluation = {
  today: string;
  asOf: string;
  discipline: DisciplineSummary;
  badges: BadgeState[];
  achievements: Achievement[];
  quests: StoredQuest[];
  data: QuestData;
  /** First steps are offered / shown (a new trader: tier below Трейдер). */
  onboarding: boolean;
};

const questLink = (id: number) => `/ratings?tab=quests&quest=${id}`;
const curatorLink = (trader: string) => `/curator?trader=${encodeURIComponent(trader)}`;

// ─── notifications ──────────────────────────────────────────────────────────

async function notifyFinished(q: StoredQuest): Promise<void> {
  const base = { template: q.template, scope: q.scope, target: q.target, points: q.rewardPoints, questId: q.id, note: q.template === MANUAL_TEMPLATE ? q.note : null };
  if (q.status === "done") {
    await enqueueBatch(q.trader, "quest_done", base, String(q.id));
  }
  if (q.scope !== "curator" || !q.assignedBy || q.assignedBy === q.trader) return;
  const staff = { ...base, trader: q.trader, variant: "staff", statusCode: q.status };
  await notifyUser({
    userName: q.assignedBy, type: q.status === "done" ? "quest_done" : "quest_failed", params: staff, link: curatorLink(q.trader),
    entityType: "quest", entityId: String(q.id), source: "quests",
  });
}

/** Stores the new tiers once and notifies; false when another process stored one of them first (its row then wins). */
async function awardAchievements(trader: string, news: readonly NewAward[], asOf: string): Promise<boolean> {
  const notifyFrom = addDays(asOf, -NOTIFY_DAYS);
  const best = new Map<string, NewAward>();
  let all = true;
  for (const a of news) {
    if (!(await insertAchievement(trader, { line: a.line, tier: a.tier, date: a.date, target: a.target }))) {
      all = false; // a racing process won
      continue;
    }
    if (a.date < notifyFrom) continue;
    const prev = best.get(a.line);
    if (!prev || TIERS.indexOf(a.tier) > TIERS.indexOf(prev.tier)) best.set(a.line, a);
  }
  for (const a of best.values()) {
    await enqueueBatch(trader, "achievement_earned", { line: a.line, tier: a.tier, target: a.target }, `${a.line}:${a.tier}`);
  }
  return all;
}

/** Stored tiers (+ badges an older process wrote to trader_badges, mapped and stored without a notification). */
async function awardedMap(trader: string): Promise<Map<string, { date: string; target: number }>> {
  const stored = await achievementsOf(trader);
  const map = new Map(stored.map((a) => [awardKey(a.line, a.tier), { date: a.date, target: a.target }]));
  for (const b of await legacyBadges(trader)) {
    const m = badgeAward(b.badge);
    if (!m || map.has(awardKey(m.line, m.tier))) continue;
    // clean_month's badge number was the traded days a month needed; the tier counts months.
    const a: StoredAchievement = { line: m.line, tier: m.tier, date: b.date, target: m.line === "clean_month" ? 1 : b.target };
    await insertAchievement(trader, a).catch(() => false);
    map.set(awardKey(a.line, a.tier), { date: a.date, target: a.target });
  }
  return map;
}

// ─── evaluation ─────────────────────────────────────────────────────────────

/** Syncs the trader's quests with the data: creates the current periods' ones, moves finished ones, notifies. */
async function syncQuests(trader: string, data: QuestData, onboarding: boolean): Promise<StoredQuest[]> {
  const existing = await questsOf(trader);
  const plan = planQuests(data, existing, { onboarding });
  if (!plan.create.length && !plan.update.length) return existing;
  await createQuests(trader, plan.create);
  for (const q of await updateQuests(plan.update)) {
    await notifyFinished(q).catch((err) => logger.warn({ err: (err as Error)?.message, trader }, "quests: notify failed"));
  }
  return questsOf(trader);
}

/** Recomputes everything for one trader (no cache). */
export async function evaluateTrader(trader: string, now = new Date()): Promise<Evaluation> {
  const awarded = await awardedMap(trader);
  const fullStops = !awarded.has(awardKey("clean_month", "gold"));
  const inputs = await loadTraderInputs(trader, now, { fullStops });
  const onboarding = onboardingFor(inputs.role, inputs.tier);
  const quests = await syncQuests(trader, inputs.quests, onboarding);
  let achievements: Achievement[] = [];
  let news: NewAward[] = [];
  if (setting("achievements.enabled")) {
    const results = evaluateAchievements({ ...inputs.achievements, onboarding: onboardingState(quests) });
    // Stored tiers on a wrong day move to the day their own target was reached (no new notification).
    for (const f of dateFixes(results, awarded)) {
      if (await fixAchievementDate(trader, f).catch(() => false)) awarded.set(awardKey(f.line, f.tier), { date: f.date, target: f.target });
    }
    news = newAwards(results, awarded);
    if (await awardAchievements(trader, news, inputs.asOf)) {
      for (const a of news) if (!awarded.has(awardKey(a.line, a.tier))) awarded.set(awardKey(a.line, a.tier), { date: a.date, target: a.target });
    } else {
      // Another process stored a tier first (maybe with another day): answer what is stored, never this run's guess.
      for (const a of await achievementsOf(trader)) awarded.set(awardKey(a.line, a.tier), { date: a.date, target: a.target });
    }
    achievements = achievementStates(results, awarded);
  }
  const windowDays = setting("discipline.pointsWindowDays");
  // «Выполнил задание куратора» (2.13): small per-day points, counted like a done quest's bonus.
  const scored = [...quests, ...(await taskDoneBonuses(trader))];
  const discipline = withQuestPoints(inputs.summary, questPoints(scored, windowStart(inputs.asOf, windowDays)), levelThresholds());
  // Season scores and recognition (lib/gamification/hooks; never throws).
  await afterEvaluation(trader, {
    today: inputs.quests.today, asOf: inputs.asOf, ledger: inputs.ledger, quests: scored, tradedDays: inputs.quests.reviews.map((r) => r.date), awarded: news,
  });
  return { today: inputs.quests.today, asOf: inputs.asOf, discipline, badges: badgesOf(achievements), achievements, quests, data: inputs.quests, onboarding };
}

const inflight = new Map<string, { gen: number; p: Promise<Evaluation> }>();
export { forgetQuests };

/**
 * Cached evaluation (recomputed after CACHE_MS, on a new day, or after forgetQuests). One run per trader at a time; a run
 * that started before a forget is not reused or cached (its data may predate the change).
 */
export async function evaluationFor(trader: string, now = new Date()): Promise<Evaluation> {
  const gen = generationOf(trader);
  const hit = evaluationCache.get(trader);
  // Also per last finished day: at the close (16:00 NY) today becomes the judged day at once, not CACHE_MS later.
  if (hit && hit.gen === gen && hit.today === nyDate(now) && (hit.value as Evaluation).asOf === lastFinishedDay(now) && Date.now() - hit.at < CACHE_MS) {
    return hit.value as Evaluation;
  }
  const running = inflight.get(trader);
  if (running && running.gen === gen) return running.p;
  const p = evaluateTrader(trader, now)
    .then((value) => {
      if (generationOf(trader) === gen) evaluationCache.set(trader, { at: Date.now(), today: value.today, gen, value });
      return value;
    })
    .finally(() => {
      if (inflight.get(trader)?.p === p) inflight.delete(trader);
    });
  inflight.set(trader, { gen, p });
  return p;
}

/** GET /quests/me and /quests/trader/:name. */
export async function questsMe(trader: string, now = new Date()): Promise<QuestsMe> {
  const e = await evaluationFor(trader, now);
  const monday = questWeekOf(e.today);
  const shown = visibleQuests(e.quests, e.today, monday, monthOf(e.today), e.onboarding);
  const ob = onboardingState(e.quests);
  const started = e.onboarding && e.quests.some((q) => q.scope === "onboarding");
  const tiers = e.achievements.flatMap((a) => a.tiers);
  return {
    today: e.today,
    quests: shown.map((q): Quest => toQuest(q, e.data)),
    achievements: e.achievements,
    summary: {
      ...weekSummary(e.quests, monday, fridayOf(monday)),
      achievementsEarned: tiers.filter((t) => t.earnedAt).length,
      achievementsTotal: tiers.length,
      onboarding: started && ob.doneOn == null ? { done: ob.done, total: ob.total } : null,
    },
  };
}

// ─── curator quests ─────────────────────────────────────────────────────────

export type AssignProblem =
  | { code: "QUESTS_DISABLED" } | { code: "QUEST_TEMPLATE_UNKNOWN" } | { code: "QUEST_TARGET_RANGE"; min: number; max: number }
  | { code: "QUEST_DEADLINE_INVALID"; max: string } | { code: "QUEST_POINTS_RANGE"; max: number } | { code: "QUEST_LIMIT"; max: number };

export const MAX_DEADLINE_DAYS = 92;

/** Checks an assignment (pure apart from settings). Null = fine. */
export function checkAssign(body: AssignQuestBody, today: string, activeNow: number): AssignProblem | null {
  if (!switches().curator) return { code: "QUESTS_DISABLED" };
  const t = curatorTemplate(body.template);
  if (!t) return { code: "QUEST_TEMPLATE_UNKNOWN" };
  if (body.target < t.assign.minTarget || body.target > t.assign.maxTarget) return { code: "QUEST_TARGET_RANGE", min: t.assign.minTarget, max: t.assign.maxTarget };
  const maxEnd = addDays(today, MAX_DEADLINE_DAYS);
  if (body.endsOn < today || body.endsOn > maxEnd) return { code: "QUEST_DEADLINE_INVALID", max: maxEnd };
  const maxPoints = setting("quests.curatorMaxPoints");
  if (body.rewardPoints != null && (body.rewardPoints < 0 || body.rewardPoints > maxPoints)) return { code: "QUEST_POINTS_RANGE", max: maxPoints };
  const maxActive = setting("quests.curatorMaxActive");
  if (activeNow >= maxActive) return { code: "QUEST_LIMIT", max: maxActive };
  return null;
}

export async function activeCuratorCount(trader: string): Promise<number> {
  return activeCuratorQuests(trader);
}

/** Stores a curator quest and tells the trader. Progress is counted from today (the next read evaluates it). */
export async function assignQuest(body: AssignQuestBody, by: string, today = nyDate()): Promise<Quest> {
  const q = await insertCuratorQuest({
    trader: body.trader, template: body.template, target: body.target, startsOn: today, endsOn: body.endsOn, assignedBy: by,
    rewardPoints: body.rewardPoints ?? setting("quests.curatorDefaultPoints"), note: body.note?.trim() || null,
  });
  forgetQuests(body.trader);
  await logInterventionSafe({
    trader: body.trader, kind: "quest", author: by, params: { template: q.template, target: q.target }, targetSlice: `quest:${q.template}`,
    startedOn: today, endsOn: body.endsOn, sourceTable: "quest_instances", sourceId: q.id,
  });
  await notifyUser({
    userName: body.trader, type: "quest_assigned", actor: by, link: questLink(q.id), entityType: "quest", entityId: String(q.id), source: "quests",
    params: { template: q.template, target: q.target, points: q.rewardPoints, curator: by, endsDate: body.endsOn, note: q.note, questId: q.id },
  }).catch((err) => logger.warn({ err: (err as Error)?.message }, "quests: assign notify failed"));
  return toQuest(q, null);
}

export async function cancelQuest(q: StoredQuest, by: string): Promise<Quest | null> {
  const closed = await closeQuest(q.id, "cancelled", by, nyDate());
  if (!closed) return null;
  forgetQuests(q.trader);
  await markAssignedNoticeRead(q.trader, q.id);
  if (q.trader !== by) {
    await notifyUser({
      userName: q.trader, type: "quest_cancelled", actor: by, link: questLink(q.id), entityType: "quest", entityId: String(q.id), source: "quests",
      params: { template: closed.template, target: closed.target, curator: by, note: closed.note, questId: closed.id },
    }).catch((err) => logger.warn({ err: (err as Error)?.message }, "quests: cancel notify failed"));
  }
  return toQuest(closed, null);
}

/** The curator marks a manual quest done: the trader gets the points and a notification. */
export async function completeQuest(q: StoredQuest, by: string): Promise<Quest | null> {
  const closed = await closeQuest(q.id, "done", by, nyDate());
  if (!closed) return null;
  forgetQuests(q.trader);
  await notifyUser({
    userName: q.trader, type: "quest_done", actor: by, link: questLink(q.id), entityType: "quest", entityId: String(q.id), source: "quests",
    params: { template: closed.template, scope: closed.scope, target: closed.target, points: closed.rewardPoints, questId: closed.id, note: closed.note },
  }).catch(() => null);
  return toQuest(closed, null);
}

export const isManual = (q: StoredQuest) => q.scope === "curator" && q.template === MANUAL_TEMPLATE;
