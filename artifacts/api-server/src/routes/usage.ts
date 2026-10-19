/**
 * Internal usage tracking (owner 2026-10-19, pilot: «надо видеть, чем стажёры реально пользуются»). No third-party
 * analytics: events stay in our DB (usage_events, migration 0214), only admins read them, and they never feed
 * rewards, rankings or pay. Logic: lib/usage/* (keys = the allow-list, stats = the admin view).
 *
 *   POST /api/usage/batch   any signed-in member (guests are read-only and never tracked):
 *                           { events: [{ kind: "view" | "action", key, t?: epoch ms, meta? }] } (≤ 50 per call,
 *                           rate-limited per user). Views are re-normalised to route patterns, actions must be
 *                           allow-listed; everything else is dropped silently. → { accepted, dropped, enabled }
 *                           (enabled = false: the setting usage.enabled is off, nothing was stored).
 *   GET  /api/admin/usage   usage.read (admins): UsageOverview (lib/usage/stats.ts)
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { AppError, route, unauthorized } from "../lib/http";
import { resolveActor } from "../lib/permissions";
import { usageLimiter } from "../lib/rateLimits";
import { setting } from "../lib/settings/registry";
import { cleanBatch } from "../lib/usage/keys";
import { usageOverview } from "../lib/usage/stats";
import { insertUsageEvents } from "../lib/usage/store";

const router: IRouter = Router();

export const MAX_BATCH = 50;
const Batch = z.object({ events: z.array(z.unknown()).max(MAX_BATCH) });

router.post("/usage/batch", usageLimiter, route({ body: Batch }, async ({ req, body }) => {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  if (!setting("usage.enabled")) return { accepted: 0, dropped: body.events.length, enabled: false };
  const { events, dropped } = cleanBatch(body.events);
  const accepted = await insertUsageEvents({ id: actor.id, name: actor.name, role: actor.role }, events);
  return { accepted, dropped, enabled: true };
}));

router.get("/admin/usage", route({ cap: "usage.read" }, async () => usageOverview()));

export default router;
