/**
 * WS_NEWS channel briefs — publish one post (the scheduled jobs and POST /api/news-channel/send-now) and preview it
 * (GET /api/news-channel/preview). Order of a publish:
 *
 *   1. gate        env (NEWS_CHANNEL_BOT_TOKEN + NEWS_CHANNEL_CHAT_ID) AND newsChannel.enabled; a scheduled run also
 *                  needs the post's own switch (the registry's `enabled` adds production)
 *   2. calendar    weekend / NYSE full-day holiday (lib/marketDays isMarketClosed) ⇒ skipped (force: sent anyway)
 *   3. lock        pg_try_advisory_lock('news-channel:<post>') — a manual push and the scheduled run never overlap
 *   4. once a day  notification_dedup key news-channel:<post>:<NY date>: already there ⇒ "dup" (force: sent again)
 *   5. fresh       «open» / «close»: the themes board of the post's session, polled up to 60 s (./data.ts
 *                  awaitThemes); stale or another session's numbers ⇒ skipped with the reason, `retryable`
 *   6. render      nothing to say (every section empty) ⇒ skipped, nothing marked (a later run may have data), `retryable`
 *   7. send        Telegram with retries (./send.ts); only a delivered post is marked (INSERT … ON CONFLICT DO
 *                  NOTHING, never a delete), so a failed one (`retryable`) is retried by the next run / push
 * A `retryable` result of a scheduled run is retried every 5 min until the post's cutoff (./schedule.ts planRetry).
 */
import { pool } from "@workspace/db";
import { config } from "../../config";
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { isMarketClosed } from "../marketDays";
import { claimOnce } from "../notifyEvents";
import { nyDate } from "../tradingDate";
import { awaitThemes, gatherPost, isThemesPost, LIVE_NEWS_DEPS, type NewsDataDeps } from "./data";
import { renderPost, type RenderCaps } from "./render";
import { newsChannelConfigured, newsChannelOn, postEnabled, type NewsPost } from "./schedule";
import { sendChannelMessage, type SendResult } from "./send";

export const newsKey = (post: NewsPost, date: string) => `news-channel:${post}:${date}`;

export type PublishStatus = "sent" | "dup" | "skipped" | "failed" | "busy";
export type PublishResult = {
  post: NewsPost;
  date: string;
  status: PublishStatus;
  reason?: string;
  chars?: number;
  attempts?: number;
  /** A later run may succeed (no fresh data yet, nothing to say yet, Telegram failed): the scheduled job retries. */
  retryable?: boolean;
  /** NY "HH:MM" of the next scheduled retry (set by the job). */
  retryAt?: string;
};

export type PublishDeps = {
  now: () => Date;
  isClosed: (date: string) => Promise<boolean>;
  data?: NewsDataDeps;
  send: (text: string, signal?: AbortSignal) => Promise<SendResult>;
  wasSent: (key: string) => Promise<boolean>;
  markSent: (key: string) => Promise<boolean>;
  withLock: <T>(name: string, fn: () => Promise<T>) => Promise<T | "busy">;
};

async function wasSent(key: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(`SELECT 1 FROM notification_dedup WHERE key = $1`, [key]);
    return rows.length > 0;
  } catch {
    return false; // table not created yet (claimOnce creates it) ⇒ nothing sent
  }
}

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | "busy"> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [name]);
    if (!rows[0]?.ok) return "busy";
    try {
      return await fn();
    } finally {
      await c.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]).catch(() => undefined);
    }
  } finally {
    c.release();
  }
}

const LIVE: PublishDeps = {
  now: () => new Date(),
  isClosed: isMarketClosed,
  send: (text, signal) => sendChannelMessage({ token: config.newsChannel.botToken, chatId: config.newsChannel.chatId, text, signal }),
  wasSent,
  markSent: claimOnce,
  withLock,
};

export function renderCaps(): RenderCaps {
  return { gappers: setting("newsChannel.gappersCount"), earnings: setting("newsChannel.earningsCount"), movers: setting("newsChannel.moversCount") };
}

/** Rendered text of `post` for `date` from the current data (null: nothing to say). `board`: an already checked one. */
export async function buildPostText(post: NewsPost, date: string, data?: NewsDataDeps, board?: Parameters<typeof gatherPost>[3]): Promise<string | null> {
  const d = await gatherPost(post, date, data, board);
  return renderPost(d, { caps: renderCaps(), siteUrl: config.siteUrlSet ? config.siteUrl : null });
}

export type PublishOpts = { trigger: "schedule" | "manual"; force?: boolean; now?: Date; signal?: AbortSignal };

export async function publishNewsPost(post: NewsPost, o: PublishOpts, deps: Partial<PublishDeps> = {}): Promise<PublishResult> {
  const d: PublishDeps = { ...LIVE, ...deps };
  const date = nyDate(o.now ?? d.now());
  const skip = (reason: string): PublishResult => ({ post, date, status: "skipped", reason });
  if (!newsChannelConfigured()) return skip("not configured");
  if (!newsChannelOn()) return skip("off in desk settings");
  if (o.trigger === "schedule" && !postEnabled(post)) return skip("post off in desk settings");
  if (!o.force && (await d.isClosed(date))) return skip("market closed");
  const key = newsKey(post, date);
  const res = await d.withLock(`news-channel:${post}`, async (): Promise<PublishResult> => {
    if (!o.force && (await d.wasSent(key))) return { post, date, status: "dup" };
    const data = d.data ?? LIVE_NEWS_DEPS;
    let board: Parameters<typeof gatherPost>[3];
    if (isThemesPost(post)) {
      // Never post another session's or stale numbers, force or not: wait for a fresh board, else skip (retried).
      const fresh = await awaitThemes(post, data, { signal: o.signal });
      if (fresh.problem) {
        logger.info({ post, date, reason: fresh.problem, waitedMs: fresh.waitedMs, asOf: fresh.board.asOf }, "news-channel: themes not fresh, skipped");
        return { ...skip(fresh.problem), retryable: true };
      }
      board = fresh.board;
    }
    const text = await buildPostText(post, date, data, board);
    if (!text) return { ...skip("no data"), retryable: true };
    if (o.signal?.aborted) return skip("aborted");
    const sent = await d.send(text, o.signal);
    if (!sent.ok) return { post, date, status: "failed", reason: sent.description ?? `status ${sent.status ?? "network"}`, chars: text.length, attempts: sent.attempts, retryable: true };
    if (!(await d.markSent(key))) logger.info({ post, date, force: !!o.force }, "news-channel: posted again (already marked)");
    logger.info({ post, date, trigger: o.trigger, chars: text.length }, "news-channel: posted");
    return { post, date, status: "sent", chars: text.length, attempts: sent.attempts };
  });
  return res === "busy" ? { post, date, status: "busy", reason: "another send of this post is running" } : res;
}

export type PreviewResult = {
  post: NewsPost;
  date: string;
  text: string | null;
  chars: number;
  configured: boolean;
  enabled: boolean;
  postEnabled: boolean;
  marketClosed: boolean;
  alreadySent: boolean;
};

/** What the post would say now — never sends, never marks. */
export async function previewNewsPost(post: NewsPost, o: { now?: Date } = {}, deps: Partial<PublishDeps> = {}): Promise<PreviewResult> {
  const d: PublishDeps = { ...LIVE, ...deps };
  const date = nyDate(o.now ?? d.now());
  const [text, marketClosed, alreadySent] = await Promise.all([buildPostText(post, date, d.data), d.isClosed(date), d.wasSent(newsKey(post, date))]);
  return {
    post, date, text, chars: text?.length ?? 0,
    configured: newsChannelConfigured(), enabled: newsChannelOn(), postEnabled: postEnabled(post), marketClosed, alreadySent,
  };
}
