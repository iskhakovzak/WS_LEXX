/**
 * Coaching jobs (roadmap waves 0 and 1) for the in-process scheduler (jobs/definitions.ts calls registerCoachJobs once).
 * Cron = New York time. Importing this module loads nothing heavy: the bodies are imported on the first run. Every run
 * takes the registry's advisory lock and writes job_runs; JOBS_ENABLED=false keeps them off with the rest of the
 * scheduler (the admin console «Запустить» still runs them by hand).
 *
 *   notifications.rewards-batch  19:25 daily — one in-app notice per person for the day's quest_done /
 *                                achievement_earned (lib/notificationBatch), after the quests and gamification runs.
 *                                Never Telegram. Idempotent (items are claimed).
 *   curator.digest               curator.digestTime (default 17:30), weekdays — one Telegram + one in-app notice per
 *                                curator with wards (lib/curatorDigest). The in-app notice everywhere; Telegram only in
 *                                production with a bot token. Once per curator and day (notification_dedup). The top
 *                                items are ranked by the R11 priority score (routes/curator r11DigestRanker).
 *   edgemap.nightly              18:40 Mon–Fri — R4 edge map with desk shrinkage (lib/edgeMapStore runEdgeMapNightly)
 *   academy.plateau-monthly      07:00 Mon–Fri — R6 plateau detector: the 1st trading day of a month = the monthly run,
 *                                Mondays = the weekly refresh, other days only catch up missing monthly runs; a manual
 *                                run refreshes today (lib/plateauStore runPlateau)
 */
import type { JobDef } from "../jobs/registry";
import { setting } from "./settings/registry";
import { curatorDigestCron } from "./daily/telegramSchedule";

const MIN = 60_000;

export const EDGEMAP_JOB = "edgemap.nightly";
export const PLATEAU_JOB = "academy.plateau-monthly";

export function registerCoachJobs(register: (def: JobDef) => void): void {
  register({
    name: "notifications.rewards-batch",
    cron: "25 19 * * *",
    timeoutMs: 10 * MIN,
    async run({ signal }) {
      const { flushBatches } = await import("./notificationBatch");
      return flushBatches({ signal });
    },
  });
  register({
    name: "curator.digest",
    cron: curatorDigestCron,
    timeoutMs: 10 * MIN,
    enabled: () => setting("curator.digestEnabled"),
    async run({ signal }) {
      const { runCuratorDigest } = await import("./curatorDigest");
      const { r11DigestRanker } = await import("../routes/curator"); // R11 score (lib/curatorLogic) ranks the top items
      return runCuratorDigest({ signal, rank: r11DigestRanker });
    },
  });
  register({
    name: EDGEMAP_JOB,
    cron: "40 18 * * 1-5",
    timeoutMs: 20 * MIN,
    async run({ signal }) {
      const { runEdgeMapNightly } = await import("./edgeMapStore");
      return runEdgeMapNightly({ signal });
    },
  });
  register({
    name: PLATEAU_JOB,
    cron: "0 7 * * 1-5",
    timeoutMs: 20 * MIN,
    async run({ signal, trigger }) {
      const { runPlateau } = await import("./plateauStore");
      return runPlateau({ signal, manual: trigger === "manual" });
    },
  });
}
