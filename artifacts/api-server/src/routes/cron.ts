/**
 * Heartbeat endpoint (public route — lib/auth.ts PUBLIC_API_ROUTES; authenticated here by a shared secret):
 *
 *   POST /api/cron/tick   Authorization: Bearer <CRON_SECRET>
 *   GET  /api/cron/tick   same header
 *
 * Optional external heartbeat. On the self-hosted server (docs/DEPLOY.md) the API's own job scheduler runs the tick
 * (jobs "propreports.sync" / "propreports.tick-hourly"), so CRON_SECRET is normally unset and this answers 503.
 *
 * 401 AUTH_REQUIRED on a missing / wrong secret, 503 CRON_NOT_CONFIGURED when CRON_SECRET is unset. Runs one tick
 * (lib/propreports/tick/runner.ts: lease → due steps ≤ 45 s → outbox) and answers its JSON summary. A tick that finds
 * the lease taken answers 200 with `skipped: "lease"`. The secret is never logged or echoed.
 */
import { Router, type IRouter, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { asyncHandler } from "../lib/asyncHandler";
import { AppError, unauthorized } from "../lib/http";
import { config } from "../config";
import { ENV_VARS } from "../lib/propreports/client";

const router: IRouter = Router();

/** Constant-time check of `Authorization: Bearer <secret>`. */
export function cronAuthorized(req: Pick<Request, "headers">, secret: string): boolean {
  const h = req.headers.authorization;
  if (!secret || typeof h !== "string") return false;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const tick = asyncHandler(async (req, res) => {
  const secret = config.propreportsEnv(ENV_VARS.cronSecret);
  if (!secret) throw new AppError("CRON_NOT_CONFIGURED");
  if (!cronAuthorized(req, secret)) throw unauthorized();
  const { runTick } = await import("../lib/propreports/tick/runner");
  const summary = await runTick({ trigger: "cron" });
  res.json(summary);
});

router.post("/cron/tick", tick);
router.get("/cron/tick", tick);

export default router;
