/**
 * The job whatif.honesty for the in-process scheduler (jobs/definitions.ts registerModuleJobs calls
 * registerWhatIfHonestyJobs once). Importing this module loads nothing heavy: the runner (lib/whatIfHonestyJob) is
 * imported on the first run.
 *
 * Triggers: GET /whatif/suggestions queues a trader's key and emits WHATIF_HONESTY_REQUESTED; every PropReports sync
 * (evening precompute for the traders who use the page); a 2-minute fallback drain (an emit lost to «already running»
 * or a restart); 60 s after boot (rows left queued or running). The admin jobs page runs it by hand.
 */
import type { JobDef } from "../jobs/registry";

const MIN = 60_000;

export const WHATIF_HONESTY_JOB = "whatif.honesty";
export const WHATIF_HONESTY_REQUESTED = "whatif.honesty.requested";

export function registerWhatIfHonestyJobs(register: (def: JobDef) => void): void {
  register({
    name: WHATIF_HONESTY_JOB,
    on: [WHATIF_HONESTY_REQUESTED, "propreports.synced"],
    cron: "*/2 * * * *",
    runOnStartMs: 60_000,
    timeoutMs: 15 * MIN,
    async run(ctx) {
      const { runHonestyQueue } = await import("./whatIfHonestyJob");
      return runHonestyQueue(ctx);
    },
  });
}
