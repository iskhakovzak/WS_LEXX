/**
 * WS_NEWS channel briefs (lib/newsChannel) — admin only (settings.manage, an adminOnly capability).
 *
 *   GET  /api/news-channel/preview?post=premarket|open|close   PreviewResult: the text the post would have now (or
 *                                                              null), the gates and whether today's is already out —
 *                                                              never sends, never marks
 *   POST /api/news-channel/send-now { post, force? }           PublishResult (sent | dup | skipped | failed | busy);
 *                                                              once a day like the schedule unless force: true (which
 *                                                              also posts on a closed market day). 503
 *                                                              NEWS_CHANNEL_NOT_CONFIGURED without the env vars or with
 *                                                              newsChannel.enabled off
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { AppError, route } from "../lib/http";
import { NEWS_POSTS, newsChannelOn } from "../lib/newsChannel/schedule";
import { previewNewsPost, publishNewsPost } from "../lib/newsChannel/publish";

const router: IRouter = Router();

router.get("/news-channel/preview", route({
  cap: "settings.manage",
  query: z.object({ post: z.enum(NEWS_POSTS) }),
}, async ({ query }) => previewNewsPost(query.post)));

router.post("/news-channel/send-now", route({
  cap: "settings.manage",
  body: z.object({ post: z.enum(NEWS_POSTS), force: z.boolean().optional().default(false) }),
}, async ({ body }) => {
  if (!newsChannelOn()) throw new AppError("NEWS_CHANNEL_NOT_CONFIGURED");
  return publishNewsPost(body.post, { trigger: "manual", force: body.force });
}));

export default router;
