/**
 * Staff «Обновить» (POST /api/finviz/refresh): one desk-wide cooldown per kind (setting finviz.refreshCooldownMinutes,
 * default 5). The window starts when a refresh starts; inside it → 429 RATE_LIMITED with Retry-After. Runs the
 * registered job (advisory lock + job_runs history) or, where the scheduler is not registered (serverless), the body.
 */
import type { Response } from "express";
import { AppError } from "../http";
import { listJobs, runJobNow } from "../../jobs/registry";
import { setting } from "../settings/registry";
import { FINVIZ_JOBS } from "./jobDefs";
import type { RefreshKind, RefreshResponse } from "./types";

const last = new Map<RefreshKind, number>();

function cooldownMs(): number {
  return setting("finviz.refreshCooldownMinutes") * 60_000;
}

/** Milliseconds left for `kind` at `now` (0 = may run). */
export function refreshWait(kind: RefreshKind, now = Date.now()): number {
  return Math.max(0, (last.get(kind) ?? -Infinity) + cooldownMs() - now);
}

/** Throws 429 inside the window (sets Retry-After), else starts a new window. */
export function startRefresh(kind: RefreshKind, res: Response | null, now = Date.now()): void {
  const wait = refreshWait(kind, now);
  if (wait > 0) {
    res?.setHeader("Retry-After", String(Math.ceil(wait / 1000)));
    throw new AppError("RATE_LIMITED", 429, undefined, { retryAfterMs: wait });
  }
  last.set(kind, now);
}

/** Tests only. */
export function resetRefreshCooldowns(): void {
  last.clear();
}

const JOB_OF: Record<RefreshKind, string> = {
  screener: FINVIZ_JOBS.screener,
  snapshot: FINVIZ_JOBS.snapshot,
  earnings: FINVIZ_JOBS.earnings,
};

export async function runRefresh(kind: RefreshKind, now = Date.now()): Promise<RefreshResponse> {
  const name = JOB_OF[kind];
  let status: RefreshResponse["status"];
  if (listJobs().some((j) => j.name === name)) {
    status = await runJobNow(name, { trigger: "manual" });
  } else {
    const jobs = await import("./jobs");
    const fn = kind === "screener" ? jobs.runScreener : kind === "snapshot" ? jobs.runSnapshot : jobs.runEarnings;
    try {
      await fn({ trigger: "manual" });
      status = "ok";
    } catch {
      status = "error";
    }
  }
  return { kind, status, nextAllowedAt: new Date(now + cooldownMs()).toISOString() };
}
