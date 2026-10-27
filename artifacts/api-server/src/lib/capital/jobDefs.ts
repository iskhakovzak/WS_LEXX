/**
 * capital.weekly — Friday 19:30 NY (off-hours: after the close, the post-close sync and the nightly gamification run):
 * the capital allocation engine over the desk → proposals in the scaling queue (lib/capital/service recomputeCapital).
 * Idempotent: a re-run refreshes / leaves the same pending proposals and never re-proposes a trader decided this ISO
 * week. The registry takes the advisory lock and writes job_runs. With settings capital.autoApply on, the run's
 * proposals are applied by «system» (audited, reversible); off (the default) they wait for a curator / admin.
 */
import type { JobDef } from "../../jobs/registry";

const MIN = 60_000;
export const CAPITAL_JOB = "capital.weekly";

export function registerCapitalJobs(register: (def: JobDef) => void): void {
  register({
    name: CAPITAL_JOB,
    cron: "30 19 * * 5",
    timeoutMs: 15 * MIN,
    async run() {
      const { recomputeCapital, SYSTEM_ACTOR } = await import("./service");
      const { autoApplyOn } = await import("./settings");
      return recomputeCapital(SYSTEM_ACTOR, "ru", { apply: autoApplyOn() });
    },
  });
}
