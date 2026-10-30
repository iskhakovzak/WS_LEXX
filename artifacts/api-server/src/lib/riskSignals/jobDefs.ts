/**
 * The job «risksignals.scan» for the in-process scheduler. Importing this module loads nothing heavy: the scan
 * (lib/riskSignals/scan.ts) is imported on the first run.
 *
 * Triggers: every PropReports sync that wrote trades («propreports.synced», with the changed traders — the live path:
 * the alert follows the sync that brought the fill in) and every minute 08:00–16:59 New York on weekdays (the positions
 * snapshot moves the stop numbers without a sync event; the late runs settle the day). The scan itself is off outside
 * the session and when the desk setting riskSignals.enabled is off (settling continues).
 *
 * Registered from index.ts right after registerAllJobs() (jobs/definitions.ts is owned by the PropReports sync work;
 * moving this line into its registerModuleJobs() is a one-line follow-up).
 */
import type { JobDef } from "../../jobs/registry";

export const RISK_SIGNALS_JOB = "risksignals.scan";

export function registerRiskSignalJobs(register: (def: JobDef) => void): void {
  register({
    name: RISK_SIGNALS_JOB,
    on: ["propreports.synced"],
    cron: "* 8-16 * * 1-5",
    timeoutMs: 60_000,
    async run({ payload, trigger }) {
      const { runRiskSignals } = await import("./scan");
      return runRiskSignals(new Date(), trigger === "event" ? payload : undefined);
    },
  });
}
