/**
 * The job «leakguard.scan» for the in-process scheduler (jobs/definitions.ts registerModuleJobs). Importing this module
 * loads nothing heavy: the scan (lib/leakGuard/scan.ts) is imported on the first run.
 *
 * Triggers: every PropReports sync that wrote trades («propreports.synced», emitted while the tick drains its outbox —
 * right after the fills step, so the guard sees a new loss at the same sync that brought it in), and every 2 minutes
 * 08:00–16:58 New York on weekdays (the live warn rows of the positions step arrive without a sync event; the late
 * runs settle the day). Switched off by the desk setting leakGuard.enabled (checked in the run: settling continues).
 */
import type { JobDef } from "../../jobs/registry";

const MIN = 60_000;

export const LEAK_GUARD_JOB = "leakguard.scan";

export function registerLeakGuardJobs(register: (def: JobDef) => void): void {
  register({
    name: LEAK_GUARD_JOB,
    on: ["propreports.synced"],
    cron: "*/2 8-16 * * 1-5",
    timeoutMs: 2 * MIN,
    async run() {
      const { runLeakGuardScan } = await import("./scan");
      return runLeakGuardScan();
    },
  });
}
