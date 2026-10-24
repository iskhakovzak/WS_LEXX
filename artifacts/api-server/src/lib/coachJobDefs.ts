/**
 * Jobs of the coaching evidence (roadmap Wave 1), registered by jobs/definitions.ts registerModuleJobs. Importing this
 * module loads nothing heavy: each runner is imported on its first run. Cron is New York time; every run takes the
 * registry's advisory lock and writes job_runs; JOBS_ENABLED=false keeps them off with the rest of the scheduler (the
 * admin console «Запустить» still runs them by hand).
 *
 *   edgemap.nightly           18:40 Mon–Fri   R4 edge map with desk shrinkage (lib/edgeMapStore runEdgeMapNightly)
 *   academy.plateau-monthly   07:00 Mon–Fri   R6 plateau detector: the 1st trading day of a month = the monthly run,
 *                                             Mondays = the weekly refresh, other days only catch up missing monthly runs;
 *                                             a manual run refreshes today (lib/plateauStore runPlateau)
 */
import type { JobDef } from "../jobs/registry";

const MIN = 60_000;

export const EDGEMAP_JOB = "edgemap.nightly";
export const PLATEAU_JOB = "academy.plateau-monthly";

export function registerCoachJobs(register: (def: JobDef) => void): void {
  register({
    name: EDGEMAP_JOB,
    cron: "40 18 * * 1-5",
    timeoutMs: 20 * MIN,
    async run({ signal }) {
      const { runEdgeMapNightly } = await import("./edgeMapStore");
      return runEdgeMapNightly({ signal });
    },
  });

  register({
    name: PLATEAU_JOB,
    cron: "0 7 * * 1-5",
    timeoutMs: 20 * MIN,
    async run({ signal, trigger }) {
      const { runPlateau } = await import("./plateauStore");
      return runPlateau({ signal, manual: trigger === "manual" });
    },
  });
}
