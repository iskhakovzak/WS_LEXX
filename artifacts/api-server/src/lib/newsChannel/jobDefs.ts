/**
 * WS_NEWS channel jobs for the in-process scheduler (jobs/definitions.ts calls registerNewsChannelJobs once). Cron =
 * New York time, read from the desk settings on every tick (./schedule.ts). Importing this module loads nothing
 * heavy: the publisher is imported on the first run. Off (enabled: false) without NEWS_CHANNEL_BOT_TOKEN +
 * NEWS_CHANNEL_CHAT_ID or with newsChannel.enabled / the post's switch off.
 *
 *   news-channel.premarket   newsChannel.premarketTime (08:30)   gappers, theme leaders / laggards, earnings, macro
 *   news-channel.open        newsChannel.openTime (10:00)        «От открытия»: themes + biggest theme-member moves
 *   news-channel.close       newsChannel.closeTime (16:15)       «Итоги дня»: themes of the day + after-hours movers
 */
import type { JobDef } from "../../jobs/registry";
import { NEWS_JOBS, NEWS_POSTS, postCron, postScheduled } from "./schedule";

const MIN = 60_000;

export function registerNewsChannelJobs(register: (def: JobDef) => void): void {
  for (const post of NEWS_POSTS) {
    register({
      name: NEWS_JOBS[post],
      cron: postCron(post),
      timeoutMs: 5 * MIN,
      enabled: () => postScheduled(post),
      async run({ trigger, signal }) {
        const { publishNewsPost } = await import("./publish");
        return publishNewsPost(post, { trigger: trigger === "schedule" ? "schedule" : "manual", signal });
      },
    });
  }
}
