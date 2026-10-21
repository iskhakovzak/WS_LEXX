/**
 * WS_NEWS channel jobs for the in-process scheduler (jobs/definitions.ts calls registerNewsChannelJobs once). Cron =
 * New York time, read from the desk settings on every tick (./schedule.ts). Importing this module loads nothing
 * heavy: the publisher is imported on the first run. Off (enabled: false) without NEWS_CHANNEL_BOT_TOKEN +
 * NEWS_CHANNEL_CHAT_ID or with newsChannel.enabled / the post's switch off.
 *
 *   news-channel.premarket   newsChannel.premarketTime (08:30)   gappers, theme leaders / laggards, earnings, macro
 *   news-channel.open        newsChannel.openTime (10:00)        «От открытия»: themes + biggest theme-member moves
 *   news-channel.close       newsChannel.closeTime (16:15)       «Итоги дня»: themes of the day + after-hours movers
 *
 * A scheduled run of «open» / «close» that ends `retryable` plans the next try 5 min later (./schedule.ts planRetry,
 * the cron getter then answers that minute) until 11:00 / 19:00 NY; the result carries `retryAt`. A run that throws
 * is retried the same way. Manual runs never plan retries.
 */
import type { JobDef } from "../../jobs/registry";
import { NEWS_JOBS, NEWS_POSTS, planRetry, postCron, postScheduled } from "./schedule";

const MIN = 60_000;

export function registerNewsChannelJobs(register: (def: JobDef) => void): void {
  for (const post of NEWS_POSTS) {
    register({
      name: NEWS_JOBS[post],
      cron: postCron(post),
      timeoutMs: 5 * MIN,
      enabled: () => postScheduled(post),
      async run({ trigger, signal, logger }) {
        const { publishNewsPost } = await import("./publish");
        const scheduled = trigger === "schedule";
        const start = new Date();
        let res;
        try {
          res = await publishNewsPost(post, { trigger: scheduled ? "schedule" : "manual", signal });
        } catch (err) {
          if (scheduled) planRetry(post, true, start, new Date());
          throw err;
        }
        if (!scheduled) return res;
        const retryAt = planRetry(post, !!res.retryable, start, new Date());
        if (retryAt) logger.info({ post, reason: res.reason ?? res.status, retryAt }, "news-channel: retry planned");
        return retryAt ? { ...res, retryAt } : res;
      },
    });
  }
}
