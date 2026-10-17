import { Router, type IRouter, type Request, type Response } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { generateReview, getLatestReview, RateLimitedError } from "../lib/aiReview";
import { handleAiNotConfigured } from "../lib/aiErrors";
import { canAccessTrade } from "../lib/auth";
import { db, aiReviewRateLimitTable, aiTradeReviewsTable } from "@workspace/db";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

/**
 * AI reviews are personal feedback (like curator reviews): the trade's owner and whoever may read it through the
 * permission matrix (trades.read.team). A playbook example opened by another trader is NOT enough — the review
 * quotes the trade's $. Sends 404/403 and returns false when denied.
 */
async function requireReviewAccess(req: Request, res: Response, id: number): Promise<boolean> {
  const ok = await canAccessTrade(req, id, "read");
  if (ok === null) { res.status(404).json({ error: "Trade not found" }); return false; }
  if (!ok) { res.status(403).json({ error: "Нет доступа к AI-разбору этой сделки" }); return false; }
  return true;
}

const router: IRouter = Router();

const RATE_LIMIT_PER_USER = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function userKeyFor(req: any): string {
  // Authenticated users are always rate-limited under their own name.
  const actor = req.authUser?.name;
  if (typeof actor === "string" && actor.trim()) return actor.trim();
  const fromHeader = req.headers["x-user"];
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();
  const fromBody = req.body?.userKey;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
  const fromQuery = req.query?.user;
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();
  return "anonymous";
}

router.get("/ai-review/usage", asyncHandler(async (req, res): Promise<void> => {
  const fromHeader = req.headers["x-user"];
  const fromQuery = req.query.userKey;
  const actor = req.authUser?.name;
  const userKey =
    (typeof actor === "string" && actor.trim() ? actor.trim() : null) ??
    (typeof fromHeader === "string" && fromHeader.trim() ? fromHeader.trim() : null) ??
    (typeof fromQuery === "string" && fromQuery.trim() ? fromQuery.trim() : null) ??
    "anonymous";

  const now = Date.now();
  const hourlyCutoff = new Date(now - RATE_LIMIT_WINDOW_MS);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [hourlyRows, dailyRateLimitRows] = await Promise.all([
    db.select({ id: aiReviewRateLimitTable.id })
      .from(aiReviewRateLimitTable)
      .where(and(eq(aiReviewRateLimitTable.userKey, userKey), gte(aiReviewRateLimitTable.createdAt, hourlyCutoff))),
    db.select({ tradeId: aiReviewRateLimitTable.tradeId })
      .from(aiReviewRateLimitTable)
      .where(and(eq(aiReviewRateLimitTable.userKey, userKey), gte(aiReviewRateLimitTable.createdAt, todayStart))),
  ]);

  const hourlyCount = hourlyRows.length;
  const dailyCount = dailyRateLimitRows.length;

  let dailyCostUsd = 0;
  const dailyTradeIds = dailyRateLimitRows.map(r => r.tradeId).filter((id): id is number => id != null);
  if (dailyTradeIds.length > 0) {
    const costRows = await db
      .select({ costUsd: sql<string>`COALESCE(SUM(${aiTradeReviewsTable.costUsd}), 0)` })
      .from(aiTradeReviewsTable)
      .where(and(
        inArray(aiTradeReviewsTable.tradeId, dailyTradeIds),
        gte(aiTradeReviewsTable.generatedAt, todayStart),
      ));
    dailyCostUsd = parseFloat(costRows[0]?.costUsd ?? "0");
  }

  res.json({
    userKey,
    hourlyCount,
    hourlyLimit: RATE_LIMIT_PER_USER,
    dailyCount,
    dailyCostUsd,
  });
}));

router.post("/trades/:id/ai-review", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid trade id" }); return; }
  if (!(await requireReviewAccess(req, res, id))) return;
  const userKey = userKeyFor(req);
  const force = req.query.force === "true" || req.body?.force === true;
  try {
    const result = await generateReview({ tradeId: id, userKey, force });
    res.status(201).json(result);
  } catch (e: any) {
    if (e instanceof RateLimitedError) {
      res.setHeader("Retry-After", String(e.retryAfterSec));
      res.status(429).json({ error: e.message, retryAfterSec: e.retryAfterSec, code: "RATE_LIMITED" });
      return;
    }
    if (e.message?.includes("not found")) {
      res.status(404).json({ error: e.message });
      return;
    }
    if (handleAiNotConfigured(e, res)) return; // 503 ai_not_configured (audit P2-3)
    req.log?.error({ error: e.message, tradeId: id }, "ai review failed");
    res.status(500).json({ error: e.message || "AI review failed" });
  }
}));

router.get("/trades/:id/ai-review", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid trade id" }); return; }
  if (!(await requireReviewAccess(req, res, id))) return;
  const review = await getLatestReview(id);
  if (!review) { res.status(404).json({ error: "No review yet" }); return; }
  res.json(review);
}));

export default router;
