/**
 * Nightly AI reviews (lib/assistant/batch, job ai.batch-reviews):
 *
 *   GET /ai/batches?limit=          admin (settings.manage): the recent batches — status, request counts, tokens, units,
 *                                   cost at the batch price — and tonight's use of the desk cap (aiBatch.nightlyUnits)
 *   GET /ai/period-review?kind=&date=&trader=   the stored weekly / monthly review that covers `date` (or null) — read
 *                                   like a day review: whoever may read the trader's personal data (personalTrader).
 *                                   Period reviews are written by the nightly batch only (no live generation).
 * A technical admin view: model names appear in /ai/batches only (never in a member-facing DTO).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { route } from "../lib/http";
import { personalTrader } from "../lib/auth";
import { langOf } from "../i18n";
import { nyDate } from "../lib/tradingDate";
import { batchClient } from "../lib/assistant/batchClient";
import { nightUnits, recentBatches } from "../lib/assistant/batch/store";
import { batchSettings } from "../lib/assistant/batch/job";
import { periodStart } from "../lib/assistant/batch/plan";
import { latestReview } from "../lib/assistant/review/store";
import { reviewDto } from "../lib/assistant/review/service";

const router: IRouter = Router();

router.get("/ai/batches", route({
  cap: "settings.manage",
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).passthrough(),
}, async ({ query }) => {
  const s = batchSettings();
  const night = nyDate();
  const [batches, used] = await Promise.all([recentBatches(query.limit ?? 20), nightUnits(night)]);
  return {
    configured: !!batchClient(),
    enabled: s.enabled,
    model: s.model,
    tonight: { night, usedUnits: used, capUnits: s.nightlyUnits },
    batches,
  };
}));

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.get("/ai/period-review", route({
  query: z.object({ kind: z.enum(["week", "month"]), date: YMD, trader: z.string().trim().max(120).optional() }).passthrough(),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader);
  const r = await latestReview({ kind: query.kind, day: periodStart(query.kind, query.date), trader }, langOf(req));
  return r ? reviewDto(r, true) : null;
}));

export default router;
