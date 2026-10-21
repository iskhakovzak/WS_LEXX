/**
 * WS_NEWS channel briefs — when and whether they go out. Light module (jobs/definitions.ts imports it through
 * ./jobDefs for `cron` / `enabled`): config + desk settings only, no DB, no senders.
 *
 *   configured   NEWS_CHANNEL_BOT_TOKEN and NEWS_CHANNEL_CHAT_ID are both set (config.newsChannel)
 *   on           configured AND the desk switch newsChannel.enabled (default off)
 *   scheduled    on AND the post's switch (newsChannel.<post>Enabled) — also on a local/dev API: the desk runs it
 *                locally, and the two env vars + the desk switch are already an explicit opt-in
 *   time         newsChannel.<post>Time, New York, weekdays (holidays are skipped by the run itself), clamped to the
 *                post's window: premarket 04:00–09:25, «от открытия» 09:35–15:55, «итоги дня» 16:05–19:55; on an
 *                early-close day (lib/marketDays, 13:00) «от открытия» ends 12:55 and «итоги дня» runs 13:05–16:55
 *
 *   retry        a scheduled «open» / «close» run that ends `retryable` (stale / another session's themes, nothing to
 *                say yet, Telegram failed) is run again 5 min later, then every 5 min, until the cutoff («open» 11:00 NY;
 *                «close» 3 h after its clamped send time, within its window — 19:15 by default, 16:55 on an early
 *                close): planRetry keeps the next retry minute per post (in memory, today only) and the cron
 *                getter answers it instead of the post's time while it is pending. The dedup key is still written
 *                only by a delivered post (./publish.ts), so a retry after a success ends as "dup".
 *
 * Cron getters are read by the registry on every tick, so a saved time takes effect from the next minute.
 */
import { config } from "../../config";
import { SETTINGS, setting } from "../settings/registry";
import { timeToMinutes } from "../settings/validate";
import { weekdayCronAt } from "../daily/telegramSchedule";
import { nyDate, nyMinutes, POST_HOURS_MIN, REGULAR_CLOSE_MIN } from "../tradingDate";
import { knownSession, sessionFor } from "../marketDays";

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

/** The post's window on a day closing at `closeMin` (POST_WINDOW on a regular day; shifted with an early close). */
export function postWindow(post: NewsPost, closeMin: number = REGULAR_CLOSE_MIN): readonly [number, number] {
  const [lo, hi] = POST_WINDOW[post];
  if (post === "open") return [lo, Math.min(hi, closeMin - 5)];
  if (post === "close") return [closeMin + 5, closeMin + POST_HOURS_MIN - 5];
  return [lo, hi];
}

/** Minutes after NY midnight of the post (the setting, clamped to the post's window on a day closing at `closeMin`). */
export function postSendMinutes(post: NewsPost, closeMin: number = REGULAR_CLOSE_MIN): number {
  const k = KEYS[post].time;
  const m = timeToMinutes(setting(k)) ?? (timeToMinutes(SETTINGS[k].default) as number);
  const [lo, hi] = postWindow(post, closeMin);
  return Math.min(Math.max(m, lo), hi);
}

/** Retry spacing and the last NY minute an «open» retry may run (inclusive); premarket is not retried. */
export const RETRY_EVERY_MIN = 5;
export const RETRY_CUTOFF: Partial<Record<NewsPost, number>> = { open: 11 * 60 };
/** The close post is retried for this long after its own (clamped) send time. */
export const CLOSE_RETRY_SPAN_MIN = 3 * 60;

/**
 * The retry cutoff on a day closing at `closeMin`: the open post 11:00 (never after the close); the close post 3 h after
 * its clamped send time, within its post-market window — so an early close (13:00, the post at 16:15) still retries.
 */
export function retryCutoff(post: NewsPost, closeMin: number = REGULAR_CLOSE_MIN): number | null {
  if (post === "close") return Math.min(postSendMinutes("close", closeMin) + CLOSE_RETRY_SPAN_MIN, postWindow("close", closeMin)[1]);
  const base = RETRY_CUTOFF[post];
  if (base == null) return null;
  return Math.min(base, closeMin - 5);
}

/**
 * Today's close in NY minutes for the cron getters (sync): the cached lib/marketDays session; before the first read
 * the regular 16:00, and a read is started so the next registry tick (1 min) already knows an early close.
 */
export function closeMinutesToday(now: Date = new Date()): number {
  const today = nyDate(now);
  const s = knownSession(today);
  if (s) return s.closeMin;
  void sessionFor(today).catch(() => undefined);
  return REGULAR_CLOSE_MIN;
}

const pendingRetry = new Map<NewsPost, { date: string; minutes: number }>();

/** The pending retry minute of `post` for the NY day of `now` (null: none). */
export function retryMinutes(post: NewsPost, now: Date = new Date()): number | null {
  const r = pendingRetry.get(post);
  return r && r.date === nyDate(now) ? r.minutes : null;
}

/**
 * After a scheduled run that started at `start` and ended at `end`: with `retryable`, the next retry RETRY_EVERY_MIN
 * after the start (never a minute already gone) if that is not past the post's cutoff — kept and returned as NY
 * "HH:MM"; otherwise any pending retry is dropped and null is returned.
 */
export function planRetry(post: NewsPost, retryable: boolean, start: Date, end: Date = start, closeMin?: number): string | null {
  pendingRetry.delete(post);
  const cutoff = retryCutoff(post, closeMin ?? closeMinutesToday(start));
  if (!retryable || cutoff == null || nyDate(start) !== nyDate(end)) return null;
  const at = Math.max(nyMinutes(start) + RETRY_EVERY_MIN, nyMinutes(end) + 1);
  if (at > cutoff) return null;
  pendingRetry.set(post, { date: nyDate(end), minutes: at });
  return `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
}

/** Tests only. */
export function resetRetries(): void {
  pendingRetry.clear();
}

/** The post's time, or its pending retry minute today (the registry reads this on every tick). */
export const postCron = (post: NewsPost, now: () => Date = () => new Date()) => (): string => {
  const at = now();
  return weekdayCronAt(retryMinutes(post, at) ?? postSendMinutes(post, closeMinutesToday(at)));
};
