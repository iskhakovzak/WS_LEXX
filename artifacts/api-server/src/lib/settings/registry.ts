/**
 * Desk settings an admin changes on the site (owner decision 2026-10-18: «легко настраивать, всё на сайте»).
 * One typed registry: every tunable number / time / switch is declared here with its default, bounds and group; the
 * admin page renders its form from this list, and code reads values with `setting(key)` (sync: the store keeps a warm
 * cache, filled at start-up and after every save; until then the default). Labels live in the server/web i18n under
 * `settings.<key>` — never hard-code texts here.
 *
 * Adding a setting: append to SETTINGS (keep keys stable — they are stored in app_settings), read it with setting().
 */

export type SettingGroup = "daily" | "discipline" | "rewards" | "quests" | "achievements" | "telegram" | "curator" | "privacy" | "gamification" | "trainer" | "nav" | "usage" | "finviz" | "newsChannel" | "trades" | "access";
export type SettingUnit = "usd" | "pct" | "days" | "points" | "minutes" | "count" | "ratio" | "places" | "people" | "shares" | "bars" | "times" | "bp" | "atr" | "quests" | "trades" | "months" | "lessons" | "exams" | "tasks" | "teams";

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
  "daily.givebackMinPeakUsd": { group: "daily", type: "number", default: 50, min: 0, max: 5000, step: 10, unit: "usd" },
  "daily.givebackKeepShare": { group: "daily", type: "number", default: 0.2, min: 0, max: 1, step: 0.05, unit: "ratio" },

  // Own contract → discipline (lib/daily/discipline)
  "discipline.contractKeptPoints": { group: "discipline", type: "number", default: 5, min: 0, max: 50, step: 1, unit: "points" },
  "discipline.contractBrokenPoints": { group: "discipline", type: "number", default: -15, min: -100, max: 0, step: 1, unit: "points" },
  // Progressive scale: a kept day adds step × (kept days in a row before it), at most the cap, on top of the item points.
  "discipline.streakStepPoints": { group: "discipline", type: "number", default: 1, min: 0, max: 20, step: 1, unit: "points" },
  "discipline.streakBonusCapPoints": { group: "discipline", type: "number", default: 10, min: 0, max: 100, step: 1, unit: "points" },
  // A broken day: «reset» = the streak starts again from 0; «halve» = it keeps half (rounded down).
  "discipline.streakOnBreak": { group: "discipline", type: "select", default: "reset", options: ["reset", "halve"], pilot: true },
  "discipline.pointsWindowDays": { group: "discipline", type: "number", default: 30, min: 5, max: 120, step: 1, unit: "days" },

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

  // Telegram daily loop (lib/daily/telegramJobs; New York time, weekdays)
  "telegram.morningEnabled": { group: "telegram", type: "boolean", default: true },
  "telegram.morningTime": { group: "telegram", type: "time", default: "08:45", pilot: true },
  "telegram.eveningEnabled": { group: "telegram", type: "boolean", default: true },
  "telegram.eveningTime": { group: "telegram", type: "time", default: "16:30", pilot: true },
  "telegram.contractAlertsEnabled": { group: "telegram", type: "boolean", default: true },

  // Curator queue (lib/daily/costQueue)
  "curator.queueCarryDays": { group: "curator", type: "number", default: 2, min: 0, max: 10, step: 1, unit: "days" },

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
