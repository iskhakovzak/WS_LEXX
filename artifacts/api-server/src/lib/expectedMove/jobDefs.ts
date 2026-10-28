/**
 * Job «em.snapshot» (lib/expectedMove/store.ts snapshotUpcoming): the options-implied move of tomorrow's reports, taken
 * before the reaction — at 09:15 (the morning's after-close and next-day reports) and 15:15 New York on weekdays (the
 * chain is quoted live then; a report after today's close moves tomorrow). Importing this module loads nothing heavy.
 */
import type { JobDef } from "../../jobs/registry";

const MIN = 60_000;

export function registerExpectedMoveJobs(register: (def: JobDef) => void): void {
  register({
    name: "em.snapshot",
    cron: "15 9,15 * * 1-5",
    timeoutMs: 10 * MIN,
    async run() {
      const { snapshotUpcoming } = await import("./store");
      return snapshotUpcoming();
    },
  });
}
