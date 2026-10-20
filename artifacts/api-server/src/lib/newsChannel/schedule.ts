/**
 * WS_NEWS channel briefs — when and whether they go out. Light module (jobs/definitions.ts imports it through
 * ./jobDefs for `cron` / `enabled`): config + desk settings only, no DB, no senders.
 *
 *   configured   NEWS_CHANNEL_BOT_TOKEN and NEWS_CHANNEL_CHAT_ID are both set (config.newsChannel)
 *   on           configured AND the desk switch newsChannel.enabled (default off)
 *   scheduled    on AND the post's switch (newsChannel.<post>Enabled) — also on a local/dev API: the desk runs it
 *                locally, and the two env vars + the desk switch are already an explicit opt-in
 *   time         newsChannel.<post>Time, New York, weekdays (holidays are skipped by the run itself), clamped to the
 *                post's window: premarket 04:00–09:25, «от открытия» 09:35–15:55, «итоги дня» 16:05–19:55
 *
 * Cron getters are read by the registry on every tick, so a saved time takes effect from the next minute.
 */
import { config } from "../../config";
import { SETTINGS, setting } from "../settings/registry";
import { timeToMinutes } from "../settings/validate";
import { weekdayCronAt } from "../daily/telegramSchedule";

export const NEWS_POSTS = ["premarket", "open", "close"] as const;
export type NewsPost = (typeof NEWS_POSTS)[number];

export const NEWS_JOBS: Record<NewsPost, string> = {
  premarket: "news-channel.premarket",
  open: "news-channel.open",
  close: "news-channel.close",
};

const KEYS = {
  premarket: { enabled: "newsChannel.premarketEnabled", time: "newsChannel.premarketTime" },
  open: { enabled: "newsChannel.openEnabled", time: "newsChannel.openTime" },
  close: { enabled: "newsChannel.closeEnabled", time: "newsChannel.closeTime" },
} as const;

/** Allowed send window per post, minutes after NY midnight (inclusive). */
export const POST_WINDOW: Record<NewsPost, readonly [number, number]> = {
  premarket: [4 * 60, 9 * 60 + 25],
  open: [9 * 60 + 35, 15 * 60 + 55],
  close: [16 * 60 + 5, 19 * 60 + 55],
};

type NewsEnv = { isProduction: boolean; newsChannel: { botToken: string; chatId: string } };

export function newsChannelConfigured(c: NewsEnv = config): boolean {
  return !!c.newsChannel.botToken.trim() && !!c.newsChannel.chatId.trim();
}

/** The feature is on: both env vars AND the desk switch. Everything else (preview aside) needs this. */
export function newsChannelOn(c: NewsEnv = config): boolean {
  return newsChannelConfigured(c) && setting("newsChannel.enabled");
}

export function postEnabled(post: NewsPost): boolean {
  return setting(KEYS[post].enabled);
}

/** The scheduled job may run: on and the post switched on. */
export function postScheduled(post: NewsPost, c: NewsEnv = config): boolean {
  return newsChannelOn(c) && postEnabled(post);
}

/** Minutes after NY midnight of the post (the setting, clamped to the post's window). */
export function postSendMinutes(post: NewsPost): number {
  const k = KEYS[post].time;
  const m = timeToMinutes(setting(k)) ?? (timeToMinutes(SETTINGS[k].default) as number);
  const [lo, hi] = POST_WINDOW[post];
  return Math.min(Math.max(m, lo), hi);
}

export const postCron = (post: NewsPost) => (): string => weekdayCronAt(postSendMinutes(post));
