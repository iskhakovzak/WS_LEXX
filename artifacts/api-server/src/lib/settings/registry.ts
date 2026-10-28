/**
 * Desk settings an admin changes on the site (owner decision 2026-10-18: «легко настраивать, всё на сайте»).
 * One typed registry: every tunable number / time / switch is declared here with its default, bounds and group; the
 * admin page renders its form from this list, and code reads values with `setting(key)` (sync: the store keeps a warm
 * cache, filled at start-up and after every save; until then the default). Labels live in the server/web i18n under
 * `settings.<key>` — never hard-code texts here.
 *
 * Adding a setting: append to SETTINGS (keep keys stable — they are stored in app_settings), read it with setting().
 */

export type SettingGroup = "daily" | "coach" | "alerts" | "discipline" | "rewards" | "quests" | "achievements" | "telegram" | "curator" | "privacy" | "gamification" | "trainer" | "nav" | "usage" | "finviz" | "newsChannel" | "trades" | "access" | "academy" | "assistant" | "aiBatch" | "regime" | "leakGuard" | "capital" | "mentor" | "dayState" | "catalyst" | "pods" | "flow" | "season" | "em" | "pulse";
export type SettingUnit = "usd" | "pct" | "days" | "points" | "minutes" | "count" | "ratio" | "places" | "people" | "shares" | "bars" | "times" | "bp" | "atr" | "quests" | "trades" | "months" | "lessons" | "exams" | "tasks" | "teams" | "tokens";

/**
 * `pilot: true` = one of the ~10 settings the pilot needs (docs/PILOT.md §2.5 / §3): the admin page shows only these
 * by default, the rest under «Показать все» (Волна 2 п. 2.4; the web list PILOT_KEYS must agree, test there).
 */
/**
 * `hidden: true` = edited on its own admin screen (e.g. «Доступ по ступеням» in «Роли и права»), not in the generic
 * «Настройки деска» form; still validated, stored and audited here like every other key.
 */
type Base = { group: SettingGroup; unit?: SettingUnit; pilot?: true; hidden?: true };
export type NumberDef = Base & { type: "number"; default: number; min: number; max: number; step?: number };
export type TimeDef = Base & { type: "time"; default: string /* "HH:MM", New York time */ };
export type BoolDef = Base & { type: "boolean"; default: boolean };
export type SelectDef = Base & { type: "select"; default: string; options: readonly string[] };
/** Free text (one line, trimmed, ≤ maxLength): e.g. a comma-separated list of stored names. */
export type TextDef = Base & { type: "text"; default: string; maxLength: number };
/** Ladder stages a stage-dependent rule applies to (lib/access/stages.ts ACCESS_STAGES). */
export type AccessStage = "junior" | "trader" | "senior";
/** A list of ladder stages: each once, stored in ladder order. */
export type StagesDef = Base & { type: "stages"; default: readonly AccessStage[] };
/** Web section href («/top-results») → the stages it is closed for; stored with sorted hrefs, empty lists dropped. */
export type SectionStagesDef = Base & { type: "sectionStages"; default: Readonly<Record<string, readonly AccessStage[]>>; maxSections: number };
export type SettingDef = NumberDef | TimeDef | BoolDef | SelectDef | TextDef | StagesDef | SectionStagesDef;

export const SETTINGS = {
  // Daily focus (lib/daily/detectors + engine)
  "daily.focusWindowDays": { group: "daily", type: "number", default: 10, min: 3, max: 30, step: 1, unit: "days", pilot: true },
  "daily.focusMinDays": { group: "daily", type: "number", default: 2, min: 1, max: 10, step: 1, unit: "days", pilot: true },
  "daily.focusMinCostUsd": { group: "daily", type: "number", default: 10, min: 0, max: 1000, step: 5, unit: "usd" },
  "daily.feesShare": { group: "daily", type: "number", default: 0.5, min: 0.1, max: 1, step: 0.05, unit: "ratio" },
  "daily.feesHealthyShare": { group: "daily", type: "number", default: 0.25, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "daily.feesMinUsd": { group: "daily", type: "number", default: 5, min: 0, max: 500, step: 1, unit: "usd" },
  // Fees judged per NY week (roadmap R2): Σ fees ≥ max(feesWeeklyMinUsd, feesShare × max(Σ gross, 0)), one hit per week;
  // off = per day against feesMinUsd. A week / day with gross ≤ 0 counts (the fees were paid for nothing).
  "daily.feesWeekly": { group: "daily", type: "boolean", default: true },
  "daily.feesWeeklyMinUsd": { group: "daily", type: "number", default: 25, min: 0, max: 5000, step: 5, unit: "usd" },
  "daily.givebackMinPeakUsd": { group: "daily", type: "number", default: 50, min: 0, max: 5000, step: 10, unit: "usd" },
  "daily.givebackKeepShare": { group: "daily", type: "number", default: 0.2, min: 0, max: 1, step: 0.05, unit: "ratio" },

  // Coaching (roadmap R2): the per-trader fee model by price band (lib/feeModel) — rolling window, trades a band needs,
  // and the gross-per-share ÷ fees-per-share ratio below which a band is flagged.
  "coach.feeWindowDays": { group: "coach", type: "number", default: 60, min: 20, max: 250, step: 5, unit: "days" },
  "coach.feeBandMinTrades": { group: "coach", type: "number", default: 30, min: 5, max: 500, step: 5, unit: "trades" },
  "coach.feeBandRatioMin": { group: "coach", type: "number", default: 1.5, min: 1, max: 5, step: 0.1, unit: "times" },

  // Own contract → discipline (lib/daily/discipline)
  "discipline.contractKeptPoints": { group: "discipline", type: "number", default: 5, min: 0, max: 50, step: 1, unit: "points" },
  "discipline.contractBrokenPoints": { group: "discipline", type: "number", default: -15, min: -100, max: 0, step: 1, unit: "points" },
  // Progressive scale: a kept day adds step × (kept days in a row before it), at most the cap, on top of the item points.
  "discipline.streakStepPoints": { group: "discipline", type: "number", default: 1, min: 0, max: 20, step: 1, unit: "points" },
  "discipline.streakBonusCapPoints": { group: "discipline", type: "number", default: 10, min: 0, max: 100, step: 1, unit: "points" },
  // A broken day: «reset» = the streak starts again from 0; «halve» = it keeps half (rounded down).
  "discipline.streakOnBreak": { group: "discipline", type: "select", default: "reset", options: ["reset", "halve"], pilot: true },
  "discipline.pointsWindowDays": { group: "discipline", type: "number", default: 30, min: 5, max: 120, step: 1, unit: "days" },
  // Discipline index thresholds of the ladder seeds (roadmap R3): one key per place, current values kept — promotion
  // (academy criteria, lib/promotionEngine) 75, scaling plan (lib/scalingSeed) 70. Choosing one number is an owner
  // decision; stored criteria / rules stay authoritative once seeded (editable on their own screens).
  "discipline.promotionMinIndex": { group: "discipline", type: "number", default: 75, min: 0, max: 100, step: 1, unit: "points" },
  "discipline.scalingMinIndex": { group: "discipline", type: "number", default: 70, min: 0, max: 100, step: 1, unit: "points" },

  // Rewards: levels by all-time discipline points (contract + quest points); traded days a clean month needs
  "rewards.level1Points": { group: "rewards", type: "number", default: 50, min: 1, max: 100000, step: 10, unit: "points" },
  "rewards.level2Points": { group: "rewards", type: "number", default: 150, min: 1, max: 100000, step: 10, unit: "points" },
  "rewards.level3Points": { group: "rewards", type: "number", default: 400, min: 1, max: 100000, step: 10, unit: "points" },
  "rewards.level4Points": { group: "rewards", type: "number", default: 800, min: 1, max: 100000, step: 10, unit: "points" },
  "rewards.cleanMonthMinDays": { group: "rewards", type: "number", default: 15, min: 1, max: 23, step: 1, unit: "days" },

  // Quests (lib/quests/catalog.ts, engine.ts): switches per scope, targets, reward points (bonus discipline points -> level)
  "quests.enabled": { group: "quests", type: "boolean", default: true },
  "quests.onboardingEnabled": { group: "quests", type: "boolean", default: true },
  "quests.dailyEnabled": { group: "quests", type: "boolean", default: true },
  "quests.weeklyEnabled": { group: "quests", type: "boolean", default: true },
  "quests.monthlyEnabled": { group: "quests", type: "boolean", default: true },
  "quests.curatorEnabled": { group: "quests", type: "boolean", default: true },
  "quests.onboardingPoints": { group: "quests", type: "number", default: 10, min: 0, max: 200, step: 1, unit: "points" },
  "quests.dailyPoints": { group: "quests", type: "number", default: 3, min: 0, max: 100, step: 1, unit: "points" },
  "quests.weeklyPoints": { group: "quests", type: "number", default: 10, min: 0, max: 200, step: 1, unit: "points" },
  "quests.monthlyPoints": { group: "quests", type: "number", default: 25, min: 0, max: 500, step: 1, unit: "points" },
  "quests.weeklyCount": { group: "quests", type: "number", default: 3, min: 1, max: 5, step: 1, unit: "quests" },
  "quests.monthlyCount": { group: "quests", type: "number", default: 2, min: 1, max: 2, step: 1, unit: "quests" },
  "quests.weeklyContractDays": { group: "quests", type: "number", default: 4, min: 1, max: 5, step: 1, unit: "days" },
  "quests.weeklyFocusDays": { group: "quests", type: "number", default: 3, min: 1, max: 5, step: 1, unit: "days" },
  "quests.weeklyReplays": { group: "quests", type: "number", default: 2, min: 1, max: 10, step: 1, unit: "count" },
  "quests.weeklyGamePlanReads": { group: "quests", type: "number", default: 3, min: 1, max: 5, step: 1, unit: "days" },
  "quests.monthlyReviewPct": { group: "quests", type: "number", default: 90, min: 50, max: 100, step: 5, unit: "pct" },
  "quests.curatorDefaultPoints": { group: "quests", type: "number", default: 10, min: 0, max: 200, step: 1, unit: "points" },
  "quests.curatorMaxPoints": { group: "quests", type: "number", default: 50, min: 0, max: 500, step: 5, unit: "points" },
  "quests.curatorMaxActive": { group: "quests", type: "number", default: 5, min: 1, max: 20, step: 1, unit: "quests" },
  // Daily «tag yesterday's trades» (playbook setups on the last finished day's own trades; lib/playbookToday/untagged)
  "quests.tagYesterdayEnabled": { group: "quests", type: "boolean", default: true },
  "quests.tagYesterdayPoints": { group: "quests", type: "number", default: 2, min: 0, max: 100, step: 1, unit: "points" },
  "quests.tagYesterdayMax": { group: "quests", type: "number", default: 10, min: 1, max: 50, step: 1, unit: "trades" },
  // Playbook tier locks: graded-A trades on the gateway setup that open a Джун setup early for a Стажёр (0 = tier only)
  "quests.setupUnlockGradeA": { group: "quests", type: "number", default: 10, min: 0, max: 100, step: 1, unit: "trades" },

  // Achievements (lib/quests/achievements.ts): tier targets of each line (1 bronze, 2 silver, 3 gold, 4 platinum)
  "achievements.enabled": { group: "achievements", type: "boolean", default: true },
  "achievements.contractStreak1": { group: "achievements", type: "number", default: 5, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.contractStreak2": { group: "achievements", type: "number", default: 10, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.contractStreak3": { group: "achievements", type: "number", default: 20, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.contractStreak4": { group: "achievements", type: "number", default: 50, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.reviewsTotal1": { group: "achievements", type: "number", default: 10, min: 1, max: 2000, step: 1, unit: "days" },
  "achievements.reviewsTotal2": { group: "achievements", type: "number", default: 50, min: 1, max: 2000, step: 1, unit: "days" },
  "achievements.reviewsTotal3": { group: "achievements", type: "number", default: 100, min: 1, max: 2000, step: 1, unit: "days" },
  "achievements.reviewsTotal4": { group: "achievements", type: "number", default: 250, min: 1, max: 2000, step: 1, unit: "days" },
  "achievements.reviewStreak1": { group: "achievements", type: "number", default: 5, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.reviewStreak2": { group: "achievements", type: "number", default: 10, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.reviewStreak3": { group: "achievements", type: "number", default: 20, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.reviewStreak4": { group: "achievements", type: "number", default: 40, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.focusBeaten1": { group: "achievements", type: "number", default: 5, min: 1, max: 200, step: 1, unit: "days" },
  "achievements.focusBeaten2": { group: "achievements", type: "number", default: 10, min: 1, max: 200, step: 1, unit: "days" },
  "achievements.focusBeaten3": { group: "achievements", type: "number", default: 20, min: 1, max: 200, step: 1, unit: "days" },
  "achievements.cleanMonth1": { group: "achievements", type: "number", default: 1, min: 1, max: 60, step: 1, unit: "months" },
  "achievements.cleanMonth2": { group: "achievements", type: "number", default: 3, min: 1, max: 60, step: 1, unit: "months" },
  "achievements.cleanMonth3": { group: "achievements", type: "number", default: 6, min: 1, max: 60, step: 1, unit: "months" },
  "achievements.planBeforeOpen1": { group: "achievements", type: "number", default: 10, min: 1, max: 1000, step: 1, unit: "days" },
  "achievements.planBeforeOpen2": { group: "achievements", type: "number", default: 30, min: 1, max: 1000, step: 1, unit: "days" },
  "achievements.planBeforeOpen3": { group: "achievements", type: "number", default: 100, min: 1, max: 1000, step: 1, unit: "days" },
  "achievements.ownReplays1": { group: "achievements", type: "number", default: 1, min: 1, max: 1000, step: 1, unit: "days" },
  "achievements.ownReplays2": { group: "achievements", type: "number", default: 10, min: 1, max: 1000, step: 1, unit: "days" },
  "achievements.ownReplays3": { group: "achievements", type: "number", default: 50, min: 1, max: 1000, step: 1, unit: "days" },
  "achievements.beatYourself1": { group: "achievements", type: "number", default: 3, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.beatYourself2": { group: "achievements", type: "number", default: 10, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.beatYourself3": { group: "achievements", type: "number", default: 25, min: 1, max: 500, step: 1, unit: "days" },
  "achievements.lessons1": { group: "achievements", type: "number", default: 5, min: 1, max: 500, step: 1, unit: "lessons" },
  "achievements.lessons2": { group: "achievements", type: "number", default: 20, min: 1, max: 500, step: 1, unit: "lessons" },
  "achievements.lessons3": { group: "achievements", type: "number", default: 50, min: 1, max: 500, step: 1, unit: "lessons" },
  "achievements.exams1": { group: "achievements", type: "number", default: 1, min: 1, max: 20, step: 1, unit: "exams" },
  "achievements.exams2": { group: "achievements", type: "number", default: 2, min: 1, max: 20, step: 1, unit: "exams" },
  "achievements.exams3": { group: "achievements", type: "number", default: 3, min: 1, max: 20, step: 1, unit: "exams" },
  // Secret lines: comebacks (kept contract on the contract day right after a broken one) and full-loop days (plan before
  // the open + kept contract + reviewed on time)
  "achievements.comebackCount": { group: "achievements", type: "number", default: 5, min: 1, max: 100, step: 1, unit: "count" },
  "achievements.fullLoopDays": { group: "achievements", type: "number", default: 20, min: 1, max: 500, step: 1, unit: "days" },
  // Achievements v2 (lib/achievements/*, docs/achievements/CATALOG.md): the rules of the new lines (their tier numbers
  // live in the catalog), lines switched off by an admin (comma-separated ids from the catalog), kudos, the ceremony.
  "achievements.disabled": { group: "achievements", type: "text", default: "", maxLength: 2000, hidden: true },
  "achievements.cleanWeekMinDays": { group: "achievements", type: "number", default: 3, min: 1, max: 5, step: 1, unit: "days" },
  "achievements.revengeMinutes": { group: "achievements", type: "number", default: 10, min: 1, max: 120, step: 1, unit: "minutes" },
  "achievements.comebackDays": { group: "achievements", type: "number", default: 5, min: 2, max: 30, step: 1, unit: "days" },
  "achievements.masteryTrades1": { group: "achievements", type: "number", default: 30, min: 10, max: 1000, step: 5, unit: "trades" },
  "achievements.masteryTrades2": { group: "achievements", type: "number", default: 60, min: 10, max: 1000, step: 5, unit: "trades" },
  "achievements.masteryTrades3": { group: "achievements", type: "number", default: 100, min: 10, max: 2000, step: 5, unit: "trades" },
  "achievements.masteryTagShare": { group: "achievements", type: "number", default: 0.8, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "achievements.leakMinTrades": { group: "achievements", type: "number", default: 30, min: 10, max: 500, step: 5, unit: "trades" },
  "achievements.kudosEnabled": { group: "achievements", type: "boolean", default: true },
  "achievements.ceremony": { group: "achievements", type: "boolean", default: true },
  // Big achievements as a positive signal of the capital engine (lib/achievements/signal.ts → lib/capital): what each one
  // is worth (the sum is capped at 1), how long it counts, and the quiet days after a violation the signal needs.
  "achievements.signalSetupBronze": { group: "achievements", type: "number", default: 0.3, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "achievements.signalSetupSilver": { group: "achievements", type: "number", default: 0.6, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "achievements.signalSetupGold": { group: "achievements", type: "number", default: 1, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "achievements.signalLeakClosed": { group: "achievements", type: "number", default: 0.4, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "achievements.signalCleanMonth": { group: "achievements", type: "number", default: 0.3, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "achievements.signalComeback": { group: "achievements", type: "number", default: 0.2, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "achievements.signalWindowDays": { group: "achievements", type: "number", default: 90, min: 20, max: 365, step: 5, unit: "days" },
  "achievements.signalResetDays": { group: "achievements", type: "number", default: 10, min: 0, max: 60, step: 1, unit: "days" },

  // Telegram daily loop (lib/daily/telegramJobs; New York time, weekdays)
  "telegram.morningEnabled": { group: "telegram", type: "boolean", default: true },
  "telegram.morningTime": { group: "telegram", type: "time", default: "08:45", pilot: true },
  "telegram.eveningEnabled": { group: "telegram", type: "boolean", default: true },
  "telegram.eveningTime": { group: "telegram", type: "time", default: "16:30", pilot: true },
  "telegram.contractAlertsEnabled": { group: "telegram", type: "boolean", default: true },

  // Coaching evidence (roadmap R4, lib/edgeMap.ts): τ of the fallback desk prior (bps of notional) when a slice has
  // fewer than 5 traders with 30+ trades, and the smallest |$ per active day| an edge-map verdict needs.
  "coach.tauDefaultBps": { group: "coach", type: "number", default: 3, min: 1, max: 50, step: 0.5, unit: "bp" },
  "coach.leakMinUsdPerDay": { group: "coach", type: "number", default: 3, min: 0, max: 100, step: 0.5, unit: "usd" },

  // Plateau detector (roadmap R6, lib/plateau.ts): active days at a stage before «not at the pace yet» is judged.
  "academy.plateau.minTenure": { group: "academy", type: "number", default: 120, min: 40, max: 500, step: 10, unit: "days" },
  // «Цена джуна до безубытка» (lib/juniorCost): the desk's cost of one seat per month (software, data, desk; 0 = only the
  // trading loss counts) and the window of own trading days the cumulative net must stay ≥ 0 to count as breakeven.
  "academy.juniorCost.seatUsdMonth": { group: "academy", type: "number", default: 0, min: 0, max: 100000, step: 50, unit: "usd" },
  "academy.juniorCost.stableDays": { group: "academy", type: "number", default: 20, min: 5, max: 60, step: 1, unit: "days" },

  // Telegram push budget per person and New York day (roadmap R3; lib/notificationCore pushVerdict, lib/pushBudget):
  // all non-risk pushes, of them coaching nudges; a contract alert waits while a risk alert is this fresh. Risk alerts
  // are never capped, only deduplicated.
  "alerts.budget.dailyPush": { group: "alerts", type: "number", default: 3, min: 1, max: 20, step: 1, unit: "count" },
  "alerts.budget.coachingPush": { group: "alerts", type: "number", default: 1, min: 0, max: 10, step: 1, unit: "count" },
  "alerts.budget.riskQuietMinutes": { group: "alerts", type: "number", default: 30, min: 0, max: 240, step: 5, unit: "minutes" },

  // Curator queue (lib/daily/costQueue)
  "curator.queueCarryDays": { group: "curator", type: "number", default: 2, min: 0, max: 10, step: 1, unit: "days" },
  // Curator evening digest (roadmap R3; lib/curatorDigest, job curator.digest): one Telegram + one in-app notice per
  // curator, weekdays at this New York time — closed days to review and the top items of the queue.
  "curator.digestEnabled": { group: "curator", type: "boolean", default: true },
  "curator.digestTime": { group: "curator", type: "time", default: "17:30" },
  "curator.digestTopN": { group: "curator", type: "number", default: 3, min: 1, max: 10, step: 1, unit: "count" },
  // R11: «Следующие шаги» keep this many steps (urgent ones ≥ 80 always); the rest waits for the 17:30 digest.
  "curator.capacity": { group: "curator", type: "number", default: 6, min: 1, max: 30, step: 1, unit: "count" },

  // Gamification (lib/gamification/*): monthly seasons, curator league, recognition, setup mastery, streak freeze
  "gamification.enabled": { group: "gamification", type: "boolean", default: true },
  "gamification.seasonTopN": { group: "gamification", type: "number", default: 10, min: 3, max: 50, step: 1, unit: "places" },
  // League: a curator team is ranked only with at least this many active members in the season
  "gamification.leagueMinMembers": { group: "gamification", type: "number", default: 3, min: 1, max: 20, step: 1, unit: "people" },
  // Ranked teams a league needs to be shown (lib/gamification/league.ts visibleTeams).
  "gamification.leagueMinTeams": { group: "gamification", type: "number", default: 2, min: 1, max: 10, step: 1, unit: "teams" },
  // A traded day without a contract breaks the contract streak (off = it neither grows nor breaks it, as before);
  // a freeze (N per NY month) covers the first such day of a running streak automatically. A broken contract is never covered.
  "gamification.missedDayBreaksStreak": { group: "gamification", type: "boolean", default: true, pilot: true },
  "gamification.freezePerMonth": { group: "gamification", type: "number", default: 1, min: 0, max: 5, step: 1, unit: "count" },
  // Recognition of long contract streaks: every N kept days in a row (on top of the achievement tiers)
  "gamification.streakMilestoneStep": { group: "gamification", type: "number", default: 25, min: 5, max: 100, step: 5, unit: "days" },
  // Post recognition to the desk Telegram group (TELEGRAM_GROUP_CHAT_ID; production only, never from a dev API)
  "gamification.telegramGroup": { group: "gamification", type: "boolean", default: false },
  // Setup mastery points = graded-A trades on the setup + passed «Найди вход» drills / masteryDrillsPerPoint; levels 1..4
  "gamification.mastery1": { group: "gamification", type: "number", default: 3, min: 1, max: 1000, step: 1, unit: "points" },
  "gamification.mastery2": { group: "gamification", type: "number", default: 10, min: 1, max: 1000, step: 1, unit: "points" },
  "gamification.mastery3": { group: "gamification", type: "number", default: 25, min: 1, max: 1000, step: 1, unit: "points" },
  "gamification.mastery4": { group: "gamification", type: "number", default: 50, min: 1, max: 1000, step: 1, unit: "points" },
  "gamification.masteryDrillsPerPoint": { group: "gamification", type: "number", default: 2, min: 1, max: 20, step: 1, unit: "tasks" },

  // Simple menu for new traders (web shell, GET /api/permissions/me → nav): a short primary menu + one «Ещё» group for
  // traders up to `simpleUntilTier` (tier as for the playbook locks, lib/playbookToday/tier); staff always get the full menu.
  // The ladder starts at Джун (Волна 1 п. 1.21): the only value left is «junior» (a stored «trainee» falls back to it).
  "nav.simpleForTrainees": { group: "nav", type: "boolean", default: true, pilot: true },
  "nav.simpleUntilTier": { group: "nav", type: "select", default: "junior", options: ["junior"] },
  // «Сводка автора» (/author-notes, Волна 2 п. 2.15): off until someone on the desk writes it — the menu row, the page
  // and every /api/author-notes route (404) follow this switch.
  "nav.authorNotes": { group: "nav", type: "boolean", default: false },

  // Privacy of cross-trader views (desk-day, top of the day, season ranking, recognition, trainer daily ranking).
  // Legacy switch: read only while privacy.namesVisibleTo has never been saved (lib/access/names.ts) — on → nobody,
  // off → every stage. Edited on the «Доступ по ступеням» screen now, so hidden from the generic form.
  "privacy.hideNamesFromTraders": { group: "privacy", type: "boolean", default: true, hidden: true },
  // Ladder stages that see other traders' real names (staff always do); unsaved → derived from the legacy switch above.
  "privacy.namesVisibleTo": { group: "privacy", type: "stages", default: [], hidden: true },
  // Share cards (web components/trades/share-card: a PNG of one own trade, drawn in the browser, nothing uploaded).
  // Off → no «Картинка» button anywhere. «r_only» → the card never shows $ (result in R or %, the $ switch is gone).
  // Read by the web from GET /permissions/me → shareCards.
  "shareCards.enabled": { group: "privacy", type: "boolean", default: true },
  "shareCards.money": { group: "privacy", type: "select", default: "usd", options: ["usd", "r_only"] },

  // Sections closed per ladder stage (owner 2026-10-21): web nav href → blocked stages. {} = everything open. Staff are
  // never blocked. The web menu / route guard read GET /permissions/me → nav.blocked; the API answers 403
  // SECTION_BLOCKED on the sections' data endpoints (lib/access/sections.ts).
  "access.sections": { group: "access", type: "sectionStages", default: {}, maxSections: 60, hidden: true },

  // «Тренажёр» (lib/trainer, lib/sim/exec): fills (spread + slippage, frozen into each new game), 1R fallback for sizing,
  // «Задача дня» (pick time NY, play length, liquidity / range filters, no-repeat window, ranking size) and «Найди вход»
  // drills (answer window, score tolerances, mastery pass score, sources per setup)
  "trainer.execEnabled": { group: "trainer", type: "boolean", default: true },
  "trainer.spreadUsd": { group: "trainer", type: "number", default: 0.02, min: 0, max: 0.5, step: 0.005, unit: "usd" },
  "trainer.spreadBps": { group: "trainer", type: "number", default: 3, min: 0, max: 100, step: 0.5, unit: "bp" },
  "trainer.lowPriceUsd": { group: "trainer", type: "number", default: 10, min: 0, max: 100, step: 1, unit: "usd" },
  "trainer.lowPriceSpreadMult": { group: "trainer", type: "number", default: 2, min: 1, max: 10, step: 0.5, unit: "times" },
  "trainer.lowAdvShares": { group: "trainer", type: "number", default: 1_000_000, min: 0, max: 100_000_000, step: 100_000, unit: "shares" },
  "trainer.lowAdvSpreadMult": { group: "trainer", type: "number", default: 2, min: 1, max: 10, step: 0.5, unit: "times" },
  "trainer.slipUsd": { group: "trainer", type: "number", default: 0.01, min: 0, max: 0.5, step: 0.005, unit: "usd" },
  "trainer.stopSlipUsd": { group: "trainer", type: "number", default: 0.02, min: 0, max: 1, step: 0.005, unit: "usd" },
  "trainer.oneRUsd": { group: "trainer", type: "number", default: 50, min: 1, max: 10_000, step: 5, unit: "usd" },
  // Every trainer ticker-day opens at least this far from the previous close, up or down, with a catalyst (lib/sim/catalyst.ts).
  "trainer.minGapPct": { group: "trainer", type: "number", default: 7, min: 1, max: 50, step: 0.5, unit: "pct" },
  "trainer.dailyEnabled": { group: "trainer", type: "boolean", default: true },
  "trainer.dailyPickTime": { group: "trainer", type: "time", default: "08:30" },
  "trainer.dailyPlayMinutes": { group: "trainer", type: "number", default: 120, min: 30, max: 390, step: 15, unit: "minutes", pilot: true },
  "trainer.dailyNoRepeatDays": { group: "trainer", type: "number", default: 90, min: 7, max: 365, step: 1, unit: "days" },
  "trainer.dailyMinVolume": { group: "trainer", type: "number", default: 2_000_000, min: 0, max: 500_000_000, step: 100_000, unit: "shares" },
  "trainer.dailyMinPriceUsd": { group: "trainer", type: "number", default: 5, min: 0, max: 1000, step: 1, unit: "usd" },
  "trainer.dailyMinRangePct": { group: "trainer", type: "number", default: 1.5, min: 0, max: 50, step: 0.5, unit: "pct" },
  "trainer.dailyMaxRangePct": { group: "trainer", type: "number", default: 15, min: 1, max: 100, step: 0.5, unit: "pct" },
  "trainer.dailyRankingTop": { group: "trainer", type: "number", default: 10, min: 3, max: 50, step: 1, unit: "places" },
  "trainer.drillWindowBars": { group: "trainer", type: "number", default: 12, min: 4, max: 40, step: 1, unit: "bars" },
  "trainer.drillBarTolerance": { group: "trainer", type: "number", default: 6, min: 1, max: 30, step: 1, unit: "bars" },
  "trainer.drillAtrTolerance": { group: "trainer", type: "number", default: 1.5, min: 0.25, max: 10, step: 0.25, unit: "atr" },
  "trainer.drillPassScore": { group: "trainer", type: "number", default: 70, min: 1, max: 100, step: 1, unit: "points" },
  "trainer.drillMinExamples": { group: "trainer", type: "number", default: 8, min: 0, max: 100, step: 1, unit: "tasks" },
  "trainer.drillMaxPerSetup": { group: "trainer", type: "number", default: 40, min: 1, max: 500, step: 1, unit: "tasks" },

  // Internal usage tracking (lib/usage, admin console → «Использование»; staff-only, never for rewards or rankings):
  // the switch, how long events are kept (nightly job usage.prune) and the pilot participants the funnel filters by
  "usage.enabled": { group: "usage", type: "boolean", default: true, pilot: true },
  "usage.retentionDays": { group: "usage", type: "number", default: 120, min: 14, max: 730, step: 1, unit: "days" },
  "usage.pilotUsers": { group: "usage", type: "text", default: "", maxLength: 2000, pilot: true },

  // Finviz Elite (lib/finviz; token = env FINVIZ_AUTH, without it everything here is idle): the switch, the screener
  // presets (comma-separated Finviz filter codes, e.g. "geo_usa,sh_price_o2,ta_gap_u4"), rows kept per preset, the
  // staff «Обновить» cooldown, and how old a ticker snapshot may be before offerings / watchlist / catalyst code falls
  // back to its old source
  "finviz.enabled": { group: "finviz", type: "boolean", default: true },
  "finviz.gappersFilters": { group: "finviz", type: "text", default: "geo_usa,sh_price_o2,sh_avgvol_o500,ta_gap_u4", maxLength: 400 },
  "finviz.relvolFilters": { group: "finviz", type: "text", default: "geo_usa,sh_price_o2,sh_avgvol_o500,sh_relvol_o2", maxLength: 400 },
  "finviz.earningsFilters": { group: "finviz", type: "text", default: "geo_usa,sh_price_o2,sh_avgvol_o300,earningsdate_today", maxLength: 400 },
  "finviz.maxRows": { group: "finviz", type: "number", default: 50, min: 5, max: 200, step: 5 },
  "finviz.refreshCooldownMinutes": { group: "finviz", type: "number", default: 5, min: 1, max: 60, step: 1, unit: "minutes" },
  "finviz.snapshotMaxAgeDays": { group: "finviz", type: "number", default: 3, min: 1, max: 30, step: 1, unit: "days" },

  // WS_NEWS Telegram channel briefs (lib/newsChannel; env NEWS_CHANNEL_BOT_TOKEN + NEWS_CHANNEL_CHAT_ID, without them
  // everything here is idle): the switch (off until the owner turns it on), each post's switch and New York time
  // (trading days; premarket ≤ 09:25, «от открытия» 09:35–15:55, «итоги дня» ≥ 16:05) and the list sizes
  "newsChannel.enabled": { group: "newsChannel", type: "boolean", default: false },
  "newsChannel.premarketEnabled": { group: "newsChannel", type: "boolean", default: true },
  "newsChannel.premarketTime": { group: "newsChannel", type: "time", default: "08:30" },
  "newsChannel.openEnabled": { group: "newsChannel", type: "boolean", default: true },
  "newsChannel.openTime": { group: "newsChannel", type: "time", default: "10:00" },
  "newsChannel.closeEnabled": { group: "newsChannel", type: "boolean", default: true },
  "newsChannel.closeTime": { group: "newsChannel", type: "time", default: "16:15" },
  "newsChannel.gappersCount": { group: "newsChannel", type: "number", default: 5, min: 3, max: 7, step: 1 },
  "newsChannel.earningsCount": { group: "newsChannel", type: "number", default: 8, min: 3, max: 20, step: 1 },
  "newsChannel.moversCount": { group: "newsChannel", type: "number", default: 5, min: 3, max: 5, step: 1 },

  // IMX = close-auction (imbalance) trades (lib/imx, lib/tradeStrategy): a trade with any fill in this New York window
  // is IMX (trades.is_imx, apart from the strategy: a regular-session entry is MOC, a pre-market one OPGtoDAY) and carries
  // the desk tag «IMX». The end minute is inclusive (16:00 covers the 16:00:xx cross print).
  // A change re-derives every trade (job trades.strategy-backfill).
  "trades.imxWindowStart": { group: "trades", type: "time", default: "15:50" },
  "trades.imxWindowEnd": { group: "trades", type: "time", default: "16:00" },

  // «Ассистент WS» (lib/assistant, docs/AI_ASSISTANT.md; key = env AI_INTEGRATIONS_ANTHROPIC_API_KEY, without it the
  // assistant answers 503 AI_NOT_CONFIGURED): the switch, the default (cheap) model and the escalation model with the
  // auto-escalation switch (owner 2026-10-25: «большинство задач — Haiku, если нужно умнее — Sonnet»), juniors on / off
  // (who else may use it: the roles matrix, capability assistant.use), daily token budgets per user and model class
  // (input + cache writes + output; cache reads not counted), the per-user request rate, and whether the audit keeps
  // message bodies (off: only who / when / tokens / tools)
  "assistant.enabled": { group: "assistant", type: "boolean", default: true },
  "assistant.defaultModel": { group: "assistant", type: "select", default: "claude-haiku-5-5", options: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] },
  "assistant.smartModel": { group: "assistant", type: "select", default: "claude-sonnet-5-5", options: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] },
  "assistant.autoEscalate": { group: "assistant", type: "boolean", default: true },
  "assistant.juniorsEnabled": { group: "assistant", type: "boolean", default: true },
  // One daily budget per user in units (owner 2026-10-25: 1M): default-model tokens count 1x, boosted / escalated /
  // advisor tokens count boostMultiplier x (the «x5» badge). Replaces the per-model budgets (migration 0261). 0 = off.
  "assistant.dailyUnits": { group: "assistant", type: "number", default: 1_000_000, min: 0, max: 50_000_000, step: 50_000, unit: "tokens" },
  "assistant.boostMultiplier": { group: "assistant", type: "number", default: 5, min: 1, max: 50, step: 1, unit: "count" },
  // Advisor tool (beta advisor-tool-2026-03-01): heavy tasks stay on the default model, which consults the advisor model
  // mid-answer instead of re-running on the escalation model. Off = the old routing (re-run on assistant.smartModel).
  "assistant.advisorEnabled": { group: "assistant", type: "boolean", default: true },
  "assistant.advisorModel": { group: "assistant", type: "select", default: "claude-sonnet-5-5", options: ["claude-sonnet-5-5", "claude-opus-5-5"] },
  "assistant.requestsPer10Min": { group: "assistant", type: "number", default: 20, min: 1, max: 200, step: 1, unit: "count" },
  "assistant.auditBodies": { group: "assistant", type: "boolean", default: false },

  // Nightly AI reviews at half price (lib/assistant/batch, job ai.batch-reviews; Message Batches API, −50%): when the
  // day closes (every EOD of the day closed, at the latest aiBatch.time NY) ONE batch carries an «AI-разбор дня» for
  // every trader who traded; Fridays optionally the weekly summary per trader, the 1st of the month the monthly one.
  // Off until the owner turns it on. They never spend a trader's personal budget (assistant.dailyUnits): they count
  // against the desk-wide nightly cap in the same units; over the cap, traders without a day review come first, then
  // juniors. The model writes the reviews; the advisor follows assistant.advisorEnabled / assistant.advisorModel.
  "aiBatch.enabled": { group: "aiBatch", type: "boolean", default: false },
  "aiBatch.time": { group: "aiBatch", type: "time", default: "21:00" },
  "aiBatch.day": { group: "aiBatch", type: "boolean", default: true },
  "aiBatch.week": { group: "aiBatch", type: "boolean", default: false },
  "aiBatch.month": { group: "aiBatch", type: "boolean", default: false },
  "aiBatch.nightlyUnits": { group: "aiBatch", type: "number", default: 2_000_000, min: 0, max: 100_000_000, step: 100_000, unit: "tokens" },
  "aiBatch.model": { group: "aiBatch", type: "select", default: "claude-haiku-5-5", options: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] },

  // Market regime (lib/marketRegime): the daily loss limit multiplier of each desk regime. By default it is only a
  // suggestion (base × multiplier on the risk screen and the trader's day); applyLimits = the effective daily limits
  // of /risk and the stop alerts use it (stored limits never change, so switching it off restores them).
  "regime.mult.theme_bull": { group: "regime", type: "number", default: 1, min: 0.1, max: 2, step: 0.05, unit: "times" },
  "regime.mult.macro": { group: "regime", type: "number", default: 0.75, min: 0.1, max: 2, step: 0.05, unit: "times" },
  "regime.mult.range": { group: "regime", type: "number", default: 0.5, min: 0.1, max: 2, step: 0.05, unit: "times" },
  "regime.mult.panic": { group: "regime", type: "number", default: 1, min: 0.1, max: 2, step: 0.05, unit: "times" },
  "regime.mult.idiosyncratic": { group: "regime", type: "number", default: 1, min: 0.1, max: 2, step: 0.05, unit: "times" },
  "regime.mult.euphoria": { group: "regime", type: "number", default: 1, min: 0.1, max: 2, step: 0.05, unit: "times" },
  "regime.applyLimits": { group: "regime", type: "boolean", default: false },

  // Live leak guard (lib/leakGuard): personal leak patterns caught at the first PropReports sync that shows them →
  // intervention ladder (soft: banner + notice with a countdown; firm: + required acknowledgement, the curator is told
  // when it is ignored; hard: + «на паузе» on the risk desk, the risk manager is told to act — PropReports is a
  // back office and cannot block orders). Ladder per stage (default: Джун firm, Трейдер / Сеньор soft) with a
  // per-trader override on the risk desk. Telegram off by default and never from a non-production API.
  "leakGuard.enabled": { group: "leakGuard", type: "boolean", default: true },
  "leakGuard.afterLoss": { group: "leakGuard", type: "boolean", default: true },
  "leakGuard.firstTrade": { group: "leakGuard", type: "boolean", default: true },
  "leakGuard.ruleViolation": { group: "leakGuard", type: "boolean", default: true },
  "leakGuard.nearStop": { group: "leakGuard", type: "boolean", default: true },
  "leakGuard.pauseMinutes": { group: "leakGuard", type: "number", default: 10, min: 1, max: 60, step: 1, unit: "minutes" },
  "leakGuard.violationPauseMinutes": { group: "leakGuard", type: "number", default: 30, min: 5, max: 240, step: 5, unit: "minutes" },
  "leakGuard.nearStopPauseMinutes": { group: "leakGuard", type: "number", default: 15, min: 5, max: 240, step: 5, unit: "minutes" },
  "leakGuard.firstTradeSizeRatio": { group: "leakGuard", type: "number", default: 0.6, min: 0.1, max: 1, step: 0.05, unit: "ratio" },
  "leakGuard.minOccurrences": { group: "leakGuard", type: "number", default: 5, min: 2, max: 100, step: 1, unit: "trades" },
  "leakGuard.minCostUsd": { group: "leakGuard", type: "number", default: 10, min: 0, max: 1000, step: 5, unit: "usd" },
  "leakGuard.minTStat": { group: "leakGuard", type: "number", default: 1, min: 0, max: 5, step: 0.1 },
  "leakGuard.lookbackDays": { group: "leakGuard", type: "number", default: 90, min: 20, max: 365, step: 5, unit: "days" },
  "leakGuard.ackMinutes": { group: "leakGuard", type: "number", default: 3, min: 1, max: 30, step: 1, unit: "minutes" },
  "leakGuard.maxEventsPerDay": { group: "leakGuard", type: "number", default: 6, min: 1, max: 50, step: 1, unit: "count" },
  "leakGuard.levelJunior": { group: "leakGuard", type: "select", default: "firm", options: ["off", "soft", "firm", "hard"] },
  "leakGuard.levelTrader": { group: "leakGuard", type: "select", default: "soft", options: ["off", "soft", "firm", "hard"] },
  "leakGuard.levelSenior": { group: "leakGuard", type: "select", default: "soft", options: ["off", "soft", "firm", "hard"] },
  "leakGuard.quietEnabled": { group: "leakGuard", type: "boolean", default: false },
  "leakGuard.quietFrom": { group: "leakGuard", type: "time", default: "15:50" },
  "leakGuard.quietTo": { group: "leakGuard", type: "time", default: "16:00" },
  "leakGuard.telegram": { group: "leakGuard", type: "boolean", default: false },
  // Desk rule patterns of the guard (lib/leakGuard/rules.ts): for everyone with trades today, not gated by personal cost.
  "leakGuard.reentry": { group: "leakGuard", type: "boolean", default: true },
  "leakGuard.greenToRed": { group: "leakGuard", type: "boolean", default: true },
  "leakGuard.openWindow": { group: "leakGuard", type: "boolean", default: true },
  "leakGuard.ideaLimits": { group: "leakGuard", type: "boolean", default: true },
  // Session flow (lib/sessionFlow): re-entries, give-back from the peak, green-to-red, the opening window 09:30–10:00,
  // the idea tiers of the morning plan and the setup checklist score. Everything is derived from PropReports fills.
  "flow.maxReentries": { group: "flow", type: "number", default: 2, min: 1, max: 10, step: 1, unit: "count" },
  "flow.givebackStops": { group: "flow", type: "number", default: 1.5, min: 0.5, max: 10, step: 0.1, unit: "times" },
  "flow.givebackNearPeakShare": { group: "flow", type: "number", default: 0.1, min: 0, max: 0.5, step: 0.05, unit: "ratio" },
  "flow.g2rSizeRatio": { group: "flow", type: "number", default: 1.3, min: 1, max: 5, step: 0.05, unit: "times" },
  "flow.g2rPaceRatio": { group: "flow", type: "number", default: 1.5, min: 1, max: 5, step: 0.1, unit: "times" },
  "flow.g2rMinAfter": { group: "flow", type: "number", default: 2, min: 1, max: 20, step: 1, unit: "trades" },
  "flow.g2rPauseMinutes": { group: "flow", type: "number", default: 15, min: 5, max: 120, step: 5, unit: "minutes" },
  // Opening window 09:30–10:00: its own loss limit as a share of the daily one per stage (lower for juniors), lifted
  // automatically once the trader has a proven edge there (≥ openLiftMinTrades in openLiftDays, positive robust P&L).
  "flow.openShareJunior": { group: "flow", type: "number", default: 0.25, min: 0.05, max: 1, step: 0.05, unit: "ratio" },
  "flow.openShareTrader": { group: "flow", type: "number", default: 0.5, min: 0.05, max: 1, step: 0.05, unit: "ratio" },
  "flow.openShareSenior": { group: "flow", type: "number", default: 0.5, min: 0.05, max: 1, step: 0.05, unit: "ratio" },
  "flow.openLiftMinTrades": { group: "flow", type: "number", default: 30, min: 5, max: 500, step: 5, unit: "trades" },
  "flow.openLiftDays": { group: "flow", type: "number", default: 90, min: 20, max: 365, step: 5, unit: "days" },
  // Idea tiers (plan): an authored or tier-3 idea may lose at most this share of the daily stop and is never re-entered.
  "flow.ideaStopShare": { group: "flow", type: "number", default: 0.5, min: 0.1, max: 1, step: 0.05, unit: "ratio" },
  "flow.missedMovePct": { group: "flow", type: "number", default: 5, min: 1, max: 50, step: 0.5, unit: "pct" },
  // Setup checklist score below the setup's threshold: the suggested risk per trade × this factor.
  "flow.checklistRiskFactor": { group: "flow", type: "number", default: 0.5, min: 0.1, max: 1, step: 0.05, unit: "ratio" },
  // Checklist auto-prefill: an item marked «gap» is ticked from a |gap| ≥ autoGapPct, «rvol» from relative volume ≥ autoRvol.
  "flow.autoGapPct": { group: "flow", type: "number", default: 3, min: 0.5, max: 50, step: 0.5, unit: "pct" },
  "flow.autoRvol": { group: "flow", type: "number", default: 2, min: 1, max: 20, step: 0.5, unit: "times" },
  // Season calendar of the regime layer (lib/sessionFlow/season): the off-season (MM-DD … MM-DD, New York), prime
  // earnings weeks, quad witching, S&P and MSCI rebalances. On a quiet day the daily loss limit × quietFactor.
  "season.enabled": { group: "season", type: "boolean", default: true },
  "season.offFrom": { group: "season", type: "text", default: "08-15", maxLength: 5 },
  "season.offTo": { group: "season", type: "text", default: "10-05", maxLength: 5 },
  "season.quietFactor": { group: "season", type: "number", default: 0.75, min: 0.1, max: 1, step: 0.05, unit: "ratio" },
  "season.trimLimits": { group: "season", type: "boolean", default: true },
  "season.holidayEves": { group: "season", type: "boolean", default: true },
  "season.primeStartDay": { group: "season", type: "number", default: 12, min: 1, max: 28, step: 1, unit: "days" },
  "season.primeWeeks": { group: "season", type: "number", default: 4, min: 1, max: 8, step: 1, unit: "count" },
  // Expected move (lib/expectedMove): the options-implied move (ATM straddle of the free chain the desk already reads)
  // snapshotted before a report, else the historical average earnings move from the candle archive (labelled so).
  "em.implied": { group: "em", type: "boolean", default: true },
  "em.maxSnapshots": { group: "em", type: "number", default: 40, min: 0, max: 200, step: 5, unit: "count" },
  "em.historyQuarters": { group: "em", type: "number", default: 8, min: 2, max: 20, step: 1, unit: "count" },
  // Desk pulse, easy money of the day, the season report (lib/deskPulse): the desk window of the pulse, its minimum
  // sample (trades and people — never below the desk's three-people privacy rule), the gap that makes a setup family,
  // what counts as a clean move, how many in-play tickers a day checks, the missed lines of the debrief, and the
  // trades a season-report row needs before it is judged.
  "pulse.windowDays": { group: "pulse", type: "number", default: 21, min: 5, max: 120, step: 1, unit: "days" },
  "pulse.minTrades": { group: "pulse", type: "number", default: 12, min: 3, max: 500, step: 1, unit: "trades" },
  "pulse.minTraders": { group: "pulse", type: "number", default: 3, min: 3, max: 20, step: 1, unit: "people" },
  "pulse.gapPct": { group: "pulse", type: "number", default: 2, min: 0.5, max: 20, step: 0.5, unit: "pct" },
  "pulse.easyMovePct": { group: "pulse", type: "number", default: 4, min: 1, max: 50, step: 0.5, unit: "pct" },
  "pulse.easyCleanShare": { group: "pulse", type: "number", default: 0.6, min: 0.3, max: 1, step: 0.05, unit: "ratio" },
  "pulse.easyMaxTickers": { group: "pulse", type: "number", default: 40, min: 5, max: 150, step: 5, unit: "count" },
  "pulse.easyDebriefMissed": { group: "pulse", type: "number", default: 2, min: 0, max: 10, step: 1, unit: "count" },
  "pulse.reportMinTrades": { group: "pulse", type: "number", default: 5, min: 1, max: 100, step: 1, unit: "trades" },
  // Capital allocation (lib/capital): weekly (Fri 19:30 NY) and on demand, per trader raise / keep / cut of the daily loss
  // limit (BP in the same ratio) from the shrunk edge, the edge in the current regime and discipline. Proposals land in
  // the scaling queue; autoApply (off by default) lets the weekly job apply them itself. Weights are relative shares.
  "capital.weightEdge": { group: "capital", type: "number", default: 0.5, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "capital.weightRegime": { group: "capital", type: "number", default: 0.25, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "capital.weightDiscipline": { group: "capital", type: "number", default: 0.25, min: 0, max: 1, step: 0.05, unit: "ratio" },
  "capital.maxStepUpPct": { group: "capital", type: "number", default: 20, min: 0, max: 100, step: 1, unit: "pct" },
  "capital.maxStepDownPct": { group: "capital", type: "number", default: 25, min: 0, max: 90, step: 1, unit: "pct" },
  "capital.minStepPct": { group: "capital", type: "number", default: 5, min: 1, max: 50, step: 1, unit: "pct" },
  "capital.minTrades": { group: "capital", type: "number", default: 30, min: 5, max: 1000, step: 5, unit: "trades" },
  "capital.windowDays": { group: "capital", type: "number", default: 60, min: 20, max: 250, step: 5, unit: "days" },
  "capital.includeJuniors": { group: "capital", type: "boolean", default: false },
  "capital.disciplineGate": { group: "capital", type: "number", default: 60, min: 0, max: 100, step: 1, unit: "points" },
  "capital.disciplineCut": { group: "capital", type: "number", default: 35, min: 0, max: 100, step: 1, unit: "points" },
  "capital.floorPctOfTier": { group: "capital", type: "number", default: 50, min: 10, max: 100, step: 5, unit: "pct" },
  "capital.capPctOfTier": { group: "capital", type: "number", default: 150, min: 100, max: 500, step: 5, unit: "pct" },
  "capital.maxDeskGrowthPct": { group: "capital", type: "number", default: 10, min: 0, max: 100, step: 1, unit: "pct" },
  "capital.autoApply": { group: "capital", type: "boolean", default: false },
  // Big achievements (a confirmed setup edge, a closed leak, a clean month, a comeback after a stop) as a 4th, positive-only
  // part of the composite: it can strengthen a raise the edge already proves, never cause one or a cut by itself.
  "capital.achievementsEnabled": { group: "capital", type: "boolean", default: true },
  "capital.weightAchievements": { group: "capital", type: "number", default: 0.15, min: 0, max: 1, step: 0.05, unit: "ratio" },
  // «Ментор» — the personal AI mentor (lib/mentor). It runs on the assistant's models and the member's daily budget
  // (assistant.dailyUnits); the daily rhythm is generated on demand when the trader opens the mentor. Escalation to the
  // curator is deterministic (no model): a tilt streak, repeated commitment breaks, drawdown near the limit, silence.
  // Scheduled pushes (a pre-market brief and a post-session debrief written ahead through the Message Batches API at
  // half price) are off by default; they count against mentor.pushDailyUnits, never a trader's personal budget.
  "mentor.enabled": { group: "mentor", type: "boolean", default: true },
  "mentor.escalationsEnabled": { group: "mentor", type: "boolean", default: true },
  "mentor.escTiltDays": { group: "mentor", type: "number", default: 3, min: 2, max: 10, step: 1, unit: "days" },
  "mentor.escBreakCount": { group: "mentor", type: "number", default: 4, min: 2, max: 20, step: 1, unit: "count" },
  "mentor.escDrawdownShare": { group: "mentor", type: "number", default: 0.8, min: 0.5, max: 1, step: 0.05, unit: "ratio" },
  "mentor.escSilenceDays": { group: "mentor", type: "number", default: 3, min: 2, max: 15, step: 1, unit: "days" },
  // «Day two after a strong catalyst» in the brief (lib/catalyst dayTwoHints): the smallest close-to-close move of
  // yesterday, in %, that makes a strong catalyst a day-two candidate today.
  "mentor.dayTwoMovePct": { group: "mentor", type: "number", default: 4, min: 1, max: 30, step: 0.5, unit: "pct" },
  // Catalyst strength from the analyst feed (lib/catalyst/analystSignal): a cluster of same-direction calls from this
  // many firms within the window, or one price-target change this large, pre-fills the catalyst mark as «strong» (the
  // trader confirms). analystDayTwo: analyst comments the day after a catalyst make it a «day two» line.
  "catalyst.analystClusterMin": { group: "catalyst", type: "number", default: 3, min: 2, max: 10, step: 1, unit: "count" },
  "catalyst.analystClusterHours": { group: "catalyst", type: "number", default: 24, min: 1, max: 120, step: 1 },
  "catalyst.analystTargetPct": { group: "catalyst", type: "number", default: 50, min: 10, max: 150, step: 5, unit: "pct" },
  "catalyst.analystDayTwo": { group: "catalyst", type: "boolean", default: true },
  // Corporate and index events (lib/corpEvents): a lock-up without a stated term ends this long after the IPO (an
  // estimate, marked so); the calendar shows this far ahead.
  "catalyst.lockupDefaultDays": { group: "catalyst", type: "number", default: 180, min: 30, max: 730, step: 15, unit: "days" },
  "catalyst.corpLookaheadDays": { group: "catalyst", type: "number", default: 45, min: 7, max: 180, step: 1, unit: "days" },
  // Library of analogues (lib/analogues): how many similar past cases, how far back, the gap bands (% edges) and the
  // points per matching trait; a case below analogueMinScore is not shown.
  "catalyst.analogueLimit": { group: "catalyst", type: "number", default: 8, min: 3, max: 30, step: 1, unit: "count" },
  "catalyst.analogueLookbackDays": { group: "catalyst", type: "number", default: 730, min: 30, max: 2000, step: 30, unit: "days" },
  "catalyst.analogueGapBands": { group: "catalyst", type: "text", default: "2,5,10,20", maxLength: 60 },
  "catalyst.analogueMinScore": { group: "catalyst", type: "number", default: 3, min: 0, max: 30, step: 0.5, unit: "points" },
  "catalyst.analogueWeightSetup": { group: "catalyst", type: "number", default: 3, min: 0, max: 10, step: 0.5, unit: "points" },
  "catalyst.analogueWeightKind": { group: "catalyst", type: "number", default: 2, min: 0, max: 10, step: 0.5, unit: "points" },
  "catalyst.analogueWeightGap": { group: "catalyst", type: "number", default: 2, min: 0, max: 10, step: 0.5, unit: "points" },
  "catalyst.analogueWeightDirection": { group: "catalyst", type: "number", default: 2, min: 0, max: 10, step: 0.5, unit: "points" },
  "catalyst.analogueWeightStrength": { group: "catalyst", type: "number", default: 1, min: 0, max: 10, step: 0.5, unit: "points" },
  "catalyst.analogueWeightRegime": { group: "catalyst", type: "number", default: 1, min: 0, max: 10, step: 0.5, unit: "points" },
  // Trading pods (lib/pods): 2–4 traders of one curator's group by default.
  "pods.minMembers": { group: "pods", type: "number", default: 2, min: 2, max: 4, step: 1, unit: "people" },
  "pods.maxMembers": { group: "pods", type: "number", default: 4, min: 2, max: 8, step: 1, unit: "people" },
  "mentor.pushesEnabled": { group: "mentor", type: "boolean", default: false },
  "mentor.briefTime": { group: "mentor", type: "time", default: "08:45" },
  "mentor.debriefTime": { group: "mentor", type: "time", default: "16:30" },
  "mentor.pushDailyUnits": { group: "mentor", type: "number", default: 1_000_000, min: 0, max: 50_000_000, step: 50_000, unit: "tokens" },
  // The trader's day state (lib/dayState): what the dashboard leads with — stopped > newcomer / paused > the time of day —
  // and the silence signal (job traders.silence, 18:45 NY Mon–Fri): curators get one in-app notice per silence episode
  // and a weekly one for unclosed day reviews. Telegram is off by default (the template exists; nothing is sent).
  "dayState.pausedDays": { group: "dayState", type: "number", default: 3, min: 1, max: 30, step: 1, unit: "days" },
  "dayState.newcomerTrades": { group: "dayState", type: "number", default: 20, min: 0, max: 500, step: 1, unit: "trades" },
  "dayState.newcomerMaxDays": { group: "dayState", type: "number", default: 45, min: 0, max: 365, step: 1, unit: "days" },
  "dayState.staleStepDays": { group: "dayState", type: "number", default: 3, min: 1, max: 20, step: 1, unit: "days" },
  "dayState.silenceEnabled": { group: "dayState", type: "boolean", default: true },
  "dayState.missedReviewDays": { group: "dayState", type: "number", default: 3, min: 1, max: 20, step: 1, unit: "days" },
  "dayState.silenceTelegram": { group: "dayState", type: "boolean", default: false },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
type DefOf<K extends SettingKey> = (typeof SETTINGS)[K];
export type SettingValue<K extends SettingKey> =
  DefOf<K> extends { type: "number" } ? number
    : DefOf<K> extends { type: "boolean" } ? boolean
    : DefOf<K> extends { type: "stages" } ? readonly AccessStage[]
    : DefOf<K> extends { type: "sectionStages" } ? Readonly<Record<string, readonly AccessStage[]>>
    : string;

const cache = new Map<string, unknown>();

/** Current value (stored value from the warm cache, else the default). Sync — safe in pure engine code paths. */
export function setting<K extends SettingKey>(key: K): SettingValue<K> {
  const v = cache.get(key);
  return (v === undefined ? SETTINGS[key].default : v) as SettingValue<K>;
}

/** Is a stored value in force for `key` (false = the default is read)? lib/access/names.ts: legacy fallback. */
export function settingStored(key: SettingKey): boolean {
  return cache.has(key);
}

/** Replace the cache with stored values (the store calls this on warm-up and after saves). Unknown keys are ignored. */
export function __loadSettingsCache(values: Record<string, unknown>): void {
  cache.clear();
  for (const [k, v] of Object.entries(values)) if (k in SETTINGS) cache.set(k, v);
}
