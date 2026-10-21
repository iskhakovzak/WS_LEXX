/**
 * Every background job of the API, in one list. `registerAllJobs()` is called by index.ts (and the admin route reads
 * the registry). Importing this module registers nothing and starts nothing. Cron is New York wall-clock time.
 *
 * Former timers (backend.md §1.9) → jobs:
 *   sector poller (boot + 15 min, weekdays 9–16 NY) → market.sectors
 *   analyst-actions poller (30 s after boot + 20 min) → market.analyst-actions
 *   digest 09:00 / 18:00 UTC                          → removed (wave 1, 1.16): the Telegram daily loop replaces it
 *   weekly psychology report (Fri ≥ 17:00 server-local) → psychology.weekly-report Fri 17:00 NY
 *   daily quote (15 s after boot + 06:00 MSK)          → quotes.daily 23:00 NY (≈ 06:00 MSK) + 15 s after boot
 *   DB backup (3 min after EVERY boot + 48 h)          → db.backup daily BACKUP_CRON (03:15 NY) + catch-up only if > 20 h old
 *   academy challenges (60 s after boot + 15 min)      → academy.challenges
 *   «готов к переводу» notices (were sent by GET)      → academy.readiness (15 min + after each PropReports sync)
 *   PropReports scheduled sync (module-level timer)    → propreports.sync (tick, 5 min NY RTH) + propreports.tick-hourly
 *                                                        + propreports.outbox (side effects, every 2 min)
 *   trade-structure back-fill (once at boot)           → trades.structure-backfill
 *   (new) job_runs retention                           → jobs.prune daily
 */
import { pool } from "@workspace/db";
import { config } from "../config";
import { registerJob, listJobs } from "./registry";
import { DESK_TICK_CRON, OFF_HOURS_CRON, offHoursCron, syncCron } from "../lib/propreports/scheduler";
import { dailyTelegramEnabled, intradayAlertsEnabled } from "../lib/daily/telegramGuard";
import { contractAlertsEnabled, eveningCron, eveningEnabled, morningCron, morningEnabled } from "../lib/daily/telegramSchedule";
import { dailyPickCron } from "../lib/trainer/schedule";
import { registerFinvizJobs } from "../lib/finviz/jobDefs";
import { registerNewsChannelJobs } from "../lib/newsChannel/jobDefs";

const MIN = 60_000;
let registered = false;

export function registerAllJobs(): void {
  if (registered || listJobs().length) return;
  registered = true;

  registerJob({
    name: "market.sectors",
    cron: "*/15 9-16 * * 1-5",
    runOnStartMs: 0,
    timeoutMs: 5 * MIN,
    async run({ trigger }) {
      const { runSectorRefresh } = await import("../lib/marketDataService");
      if (trigger === "startup") {
        const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date());
        const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date())) % 24;
        if (wd === "Sat" || wd === "Sun" || hour < 9 || hour > 16) return { skipped: "outside market hours" };
      }
      return runSectorRefresh();
    },
  });

  registerJob({
    name: "market.analyst-actions",
    cron: "*/20 * * * *",
    runOnStartMs: 30_000,
    timeoutMs: 18 * MIN,
    async run() {
      const { runAnalystActionsScan } = await import("../lib/marketDataService");
      return runAnalystActionsScan();
    },
  });

  // Daily loop in the Telegram bot (lib/daily/telegramJobs.ts): production + bot token only; every send once per
  // trader and day (notification_dedup). Time and on/off = desk settings (lib/daily/telegramSchedule: cron getters read
  // every tick). Default morning 08:45 NY = premarket, 45 min before the open, the previous day synced.
  registerJob({
    name: "telegram.daily-morning",
    cron: morningCron,
    timeoutMs: 10 * MIN,
    enabled: () => dailyTelegramEnabled() && morningEnabled(),
    async run({ signal }) {
      const { runMorningFocus } = await import("../lib/daily/telegramJobs");
      return runMorningFocus({ signal });
    },
  });

  // Evening card: the evening time (default 16:30 NY, never before 16:15 — the session's trades are in after the
  // post-close sync) + every PropReports sync after it, so a later / manual sync sends the cards it unlocks; a trader
  // without trades that day gets none.
  registerJob({
    name: "telegram.daily-evening",
    cron: eveningCron,
    on: ["propreports.synced"],
    timeoutMs: 10 * MIN,
    enabled: () => dailyTelegramEnabled() && eveningEnabled(),
    async run({ signal }) {
      const { runEveningCards } = await import("../lib/daily/telegramJobs");
      return runEveningCards({ signal });
    },
  });

  // Intraday own-contract alerts (daily stop / max trades): only with the scheduled PropReports sync, after each sync +
  // every 5 min in the alert window as a fallback (the event is fire-and-forget; each alert is deduped per day).
  registerJob({
    name: "telegram.contract-alerts",
    on: ["propreports.synced"],
    cron: "3-58/5 4-16 * * 1-5",
    timeoutMs: 5 * MIN,
    enabled: () => intradayAlertsEnabled() && contractAlertsEnabled(),
    async run({ signal }) {
      const { runContractAlerts } = await import("../lib/daily/telegramJobs");
      return runContractAlerts({ signal });
    },
  });

  // Discipline rewards (lib/daily/rewardsJob.ts): evening snapshots + badges for every trader of the finished day, so
  // badges do not wait for a visit. Idempotent (trader_badges primary key); reads only the local DB.
  registerJob({
    name: "rewards.nightly",
    cron: "30 18 * * 1-5",
    timeoutMs: 20 * MIN,
    async run({ signal }) {
      const { runRewardsNightly } = await import("../lib/daily/rewardsJob");
      return runRewardsNightly({ signal });
    },
  });

  // Quests rollover (lib/quests/job.ts): closes finished periods, creates the new day's / week's / month's quests and
  // awards achievements for every active trader, so nothing waits for a visit. Idempotent; reads only the local DB.
  registerJob({
    name: "quests.nightly",
    cron: "50 18 * * *",
    timeoutMs: 20 * MIN,
    async run({ signal }) {
      const { runQuestsNightly } = await import("../lib/quests/job");
      return runQuestsNightly({ signal });
    },
  });

  // Gamification (lib/gamification/service.ts): season scores of every active trader, the finished season finalized
  // once (top-3 recognition), setup mastery (level-up recognition) and reward eligibility (notified once). Idempotent;
  // local DB only (a Telegram group post needs gamification.telegramGroup + production).
  registerJob({
    name: "gamification.nightly",
    cron: "10 19 * * *",
    timeoutMs: 20 * MIN,
    async run({ signal }) {
      const { runGamificationNightly } = await import("../lib/gamification/service");
      return runGamificationNightly({ signal });
    },
  });

  registerJob({
    name: "psychology.weekly-report",
    cron: "0 17 * * 5",
    timeoutMs: 30 * MIN,
    async run() {
      const { runWeeklyReports } = await import("../lib/weeklyPsychologyReport");
      return runWeeklyReports();
    },
  });

  registerJob({
    name: "quotes.daily",
    cron: "0 23 * * *",
    runOnStartMs: 15_000,
    timeoutMs: 5 * MIN,
    async run({ trigger }) {
      const { ensureTodayQuote } = await import("../lib/dailyQuoteCron");
      return ensureTodayQuote(trigger === "startup" ? "startup" : "23:00 NY");
    },
  });

  registerJob({
    name: "db.backup",
    cron: config.backupCron,
    runOnStartMs: 5 * MIN,
    timeoutMs: 60 * MIN,
    enabled: () => !!config.storage.bucketId || !!config.backupDir,
    async run({ trigger }) {
      const { backupJob } = await import("../lib/dbBackupCron");
      return backupJob(trigger);
    },
  });

  registerJob({
    name: "academy.challenges",
    cron: "*/15 * * * *",
    runOnStartMs: 60_000,
    timeoutMs: 10 * MIN,
    async run() {
      const { refreshChallenges } = await import("../routes/academy-path");
      return refreshChallenges();
    },
  });

  registerJob({
    name: "academy.readiness",
    cron: "7-59/15 * * * *",
    on: ["propreports.synced"],
    timeoutMs: 10 * MIN,
    async run({ trigger, payload }) {
      const { refreshReadinessNotices } = await import("../routes/academy-path");
      const traders = trigger === "event" ? ((payload as { traders?: string[] } | undefined)?.traders ?? []) : null;
      if (traders && traders.length === 0) return { skipped: "no changed traders" };
      return refreshReadinessNotices(traders);
    },
  });

  registerJob({
    name: "propreports.sync",
    cron: () => syncCron() ?? DESK_TICK_CRON, // getter: env read on every registry tick; off via enabled()
    timeoutMs: 15 * MIN,
    enabled: () => syncCron() != null,
    async run() {
      // the same tick as POST /api/cron/tick (steps + outbox), with a classic-server budget; the DB lease keeps them apart
      const { runScheduledSync } = await import("../lib/propreports");
      return runScheduledSync();
    },
  });

  // Outside RTH: the same tick hourly (after-hours corrections, history backfill, nightly reconcile steps).
  registerJob({
    name: "propreports.tick-hourly",
    cron: () => offHoursCron() ?? OFF_HOURS_CRON,
    timeoutMs: 15 * MIN,
    enabled: () => offHoursCron() != null,
    async run() {
      const { runScheduledSync } = await import("../lib/propreports");
      return runScheduledSync();
    },
  });

  // PropReports outbox (post-sync side effects): drained every 2 minutes on a classic server (on Vercel by the tick);
  // a sync started from the UI also drains it right away (kickOutbox).
  registerJob({
    name: "propreports.outbox",
    cron: "*/2 * * * *",
    timeoutMs: 2 * MIN,
    async run() {
      const { drainOutbox } = await import("../lib/propreports/tick/outbox");
      return drainOutbox(Date.now() + 50_000);
    },
  });

  registerJob({
    name: "trades.structure-backfill",
    runOnStartMs: 0,
    timeoutMs: 30 * MIN,
    async run() {
      const { backfillTradeStructures } = await import("../lib/tradeStructureStore");
      return backfillTradeStructures();
    },
  });

  // Strategy + IMX tag of every trade (lib/tradeStrategyStore, migration 0237): the first run back-fills the book, later
  // runs pick rows the triggers marked stale (manual edits, fills changed) and re-derive all after an IMX window change.
  registerJob({
    name: "trades.strategy-backfill",
    cron: "*/5 * * * *",
    runOnStartMs: 2 * MIN,
    timeoutMs: 20 * MIN,
    async run() {
      const { backfillTradeStrategies } = await import("../lib/tradeStrategyStore");
      const r = await backfillTradeStrategies();
      if (r.changed) (await import("../lib/propreports/tradesVersion")).invalidateTradeCaches();
      return r;
    },
  });

  registerJob({
    name: "jobs.prune",
    cron: "40 3 * * *",
    timeoutMs: 5 * MIN,
    async run() {
      const r = await pool.query(`DELETE FROM job_runs WHERE started_at < now() - interval '30 days'`);
      return { deleted: r.rowCount ?? 0 };
    },
  });

  // Permanent candle archive (lib/candleArchive): every finished symbol-day with trades / playbook examples / ideas /
  // simulator games, once for the whole desk. After each PropReports sync, nightly after the post-market (21:15 NY,
  // every day so weekends finish a backfill), and 2 min after boot. ≤ 400 provider calls per run; the next run resumes.
  // Then the setup auto-classifier (wave 1, 1.2; lib/setupsAuto) suggests a setup for the new broker trades without a
  // playbook link — on the bars just archived; suggestions only, accepting stays one tap (journal, /trades).
  registerJob({
    name: "candles.archive",
    cron: "15 21 * * *",
    on: ["propreports.synced"],
    runOnStartMs: 2 * MIN,
    timeoutMs: 30 * MIN,
    async run({ signal, logger }) {
      const { runArchiveFill } = await import("../lib/candleArchive");
      const archive = await runArchiveFill({ signal, logger, budget: 400, gapMs: 400 });
      const { runAutoClassify } = await import("../lib/setupsAuto");
      const setups = signal.aborted ? null : await runAutoClassify({ signal }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
      return { archive, setups };
    },
  });

  // Internal usage tracking (lib/usage): events older than usage.retentionDays (default 120) are deleted every night —
  // configuration-driven data hygiene; plans, reviews and trades are never touched.
  registerJob({
    name: "usage.prune",
    cron: "55 3 * * *",
    timeoutMs: 5 * MIN,
    async run() {
      const { setting } = await import("../lib/settings/registry");
      const { pruneUsageEvents } = await import("../lib/usage/store");
      return pruneUsageEvents(setting("usage.retentionDays"));
    },
  });

  registerJob({
    name: "candles.prune",
    cron: "50 3 * * *",
    timeoutMs: 10 * MIN,
    async run({ signal }) {
      const { pruneCandleCaches } = await import("../lib/candleArchive/prune");
      return pruneCandleCaches({ signal });
    },
  });

  // «Тренажёр» (lib/trainer): the «Задача дня» pick for the whole desk at trainer.dailyPickTime (08:30 NY, weekdays;
  // idempotent — the pick is a row per date, a re-run or a lazy read picks nothing new) + the «Найди вход» drill
  // refresh (new playbook examples / setup-linked desk trades with archived bars). Local DB only.
  registerJob({
    name: "trainer.daily-pick",
    cron: dailyPickCron,
    timeoutMs: 5 * MIN,
    async run() {
      const { runDailyPick } = await import("../lib/trainer/daily");
      const { ensureDrillsThrottled } = await import("../lib/trainer/drillService");
      const pick = await runDailyPick();
      await ensureDrillsThrottled(true);
      return pick;
    },
  });

  registerModuleJobs();
}

/** Feature modules that declare their own jobs (kept out of registerAllJobs, which is at the function-size limit). */
function registerModuleJobs(): void {
  registerFinvizJobs(registerJob); // Finviz Elite screener / snapshot / earnings (lib/finviz/jobDefs.ts)
  registerNewsChannelJobs(registerJob); // WS_NEWS channel briefs: premarket / from the open / day recap (lib/newsChannel/jobDefs.ts)
}
