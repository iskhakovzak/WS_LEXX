/**
 * POST /api/analyst-actions/refresh is a ~500-ticker external scrape (DEV-03): at most once per 10 minutes for the
 * whole desk. The window starts when a refresh starts; a call inside it gets 429 RATE_LIMITED with Retry-After.
 */
import type { Request, Response } from "express";
import { AppError } from "./http";
import { requireCap } from "./permissions";

export const ANALYST_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
let lastAnalystRefreshAt = 0;

/** Milliseconds left in the cooldown at `now` (0 = may run). */
export function analystRefreshWait(now = Date.now(), last = lastAnalystRefreshAt): number {
  return Math.max(0, last + ANALYST_REFRESH_COOLDOWN_MS - now);
}

/** Throws 429 inside the window (sets Retry-After), else starts a new window. */
export function startAnalystRefresh(res: Response, now = Date.now()): void {
  const wait = analystRefreshWait(now);
  if (wait > 0) {
    res.setHeader("Retry-After", String(Math.ceil(wait / 1000)));
    throw new AppError("RATE_LIMITED", 429, undefined, { retryAfterMs: wait });
  }
  lastAnalystRefreshAt = now;
}

/** The route guard: staff only (dailyfeed.manage), then the desk-wide cooldown. false = already answered (401/403). */
export async function guardAnalystRefresh(req: Request, res: Response): Promise<boolean> {
  if (!(await requireCap(req, res, "dailyfeed.manage", null, "STAFF_ONLY"))) return false;
  startAnalystRefresh(res);
  return true;
}
