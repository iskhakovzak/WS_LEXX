/**
 * Coaching jobs of roadmap R3 for the in-process scheduler (jobs/definitions.ts calls registerCoachJobs once). Cron =
 * New York time. Importing this module loads nothing heavy: the bodies are imported on the first run.
 *
 *   notifications.rewards-batch  19:25 daily — one in-app notice per person for the day's quest_done /
 *                                achievement_earned (lib/notificationBatch), after the quests and gamification runs.
 *                                Never Telegram. Idempotent (items are claimed).
 *   curator.digest               curator.digestTime (default 17:30), weekdays — one Telegram + one in-app notice per
 *                                curator with wards (lib/curatorDigest). The in-app notice everywhere; Telegram only in
 *                                production with a bot token. Once per curator and day (notification_dedup).
 */
import type { JobDef } from "../jobs/registry";
import { setting } from "./settings/registry";
import { curatorDigestCron } from "./daily/telegramSchedule";

const MIN = 60_000;

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
      return runCuratorDigest({ signal });
    },
  });
}
