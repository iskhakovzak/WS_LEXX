/**
 * Job ai.batch-reviews (nightly AI reviews through the Message Batches API; body: ./job.ts). Registered by
 * jobs/definitions.ts; off with the rest of the scheduler under JOBS_ENABLED=false (the admin «Запустить» still runs
 * it, and a manual run does not wait for the EODs / the cutoff). Every run takes the registry's advisory lock, so two
 * processes on one database never submit or poll the same batch at once.
 *
 * The tick is every 5 minutes, but the job is «enabled» only when there is something to do (so job_runs does not
 * fill with idle rows): an open batch due for a poll, a stored review to announce in the morning window, or — with
 * aiBatch.enabled — tonight's submission not done yet. The getter is sync: it reads a small state the job refreshes
 * after every run (and on its own every 10 minutes); until the first refresh after a start it says «due» once, so a
 * restart resumes polling at once.
 */
import type { JobDef } from "../../../jobs/registry";
import { isAnthropicConfigured } from "@workspace/integrations-anthropic-ai";
import { config } from "../../../config";
import { setting } from "../../settings/registry";
import { logger } from "../../logger";
import type { DueState } from "./store";

export const BATCH_JOB = "ai.batch-reviews";
const MIN = 60_000;

let state: (DueState & { at: number }) | null = null;
let refreshing = false;

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const { dueState } = await import("./store");
    state = { ...(await dueState()), at: Date.now() };
  } catch (err) {
    logger.warn({ err }, "ai batch: due state refresh failed");
  } finally {
    refreshing = false;
  }
}

/** Is there anything for the job to do now? (sync; see the module comment) */
function dueNow(now: Date): boolean {
  if (!isAnthropicConfigured() && !config.ai.assistantMock) return false;
  if (!state) { void refresh(); return true; }
  if (Date.now() - state.at > 10 * MIN) void refresh();
  if (state.nextPollAt && state.nextPollAt.getTime() <= now.getTime()) return true;
  // Late imports keep this module light: plan / job load on the first run.
  const { nyClock, inNotifyWindow, nightTargets } = planMod ?? {};
  if (!nyClock || !inNotifyWindow || !nightTargets || !jobMod) { void loadMods(); return state.unnotified > 0 || setting("aiBatch.enabled"); }
  const c = nyClock(now);
  const s = jobMod.batchSettings();
  if (state.unnotified > 0 && inNotifyWindow(c, s.morningMin)) return true;
  return s.enabled && jobMod.doneNight !== c.today && nightTargets(c, s.scopes).length > 0;
}

let planMod: typeof import("./plan") | null = null;
let jobMod: typeof import("./job") | null = null;
async function loadMods(): Promise<void> {
  planMod ??= await import("./plan");
  jobMod ??= await import("./job");
}

export function registerBatchJobs(register: (def: JobDef) => void): void {
  register({
    name: BATCH_JOB,
    cron: "*/5 * * * *",
    timeoutMs: 20 * MIN,
    enabled: () => dueNow(new Date()),
    async run(ctx) {
      await loadMods();
      try {
        return await jobMod!.runBatchReviews(ctx);
      } finally {
        await refresh();
      }
    },
  });
}
