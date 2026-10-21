/**
 * Finviz jobs for the in-process scheduler (jobs/definitions.ts calls registerFinvizJobs once). Cron = New York time.
 * Importing this module loads nothing heavy: the bodies are imported on the first run. All four are off
 * (enabled: false) without FINVIZ_AUTH or with the desk switch finviz.enabled off.
 */
import type { JobDef } from "../../jobs/registry";
import { finvizEnabled } from "./presets";

const MIN = 60_000;

export const FINVIZ_JOBS = {
  screener: "finviz.screener",
  snapshot: "finviz.snapshot",
  snapshotPending: "finviz.snapshot-pending",
  earnings: "finviz.earnings",
} as const;

export function registerFinvizJobs(register: (def: JobDef) => void): void {
  // Every 5 min 07:00–16:55 on weekdays; the body keeps only the premarket (5 min, ≤ 09:30) and RTH (15 min,
  // 09:45–16:00) slots of trading days, so a manual run is never filtered.
  register({
    name: FINVIZ_JOBS.screener,
    cron: "*/5 7-16 * * 1-5",
    timeoutMs: 3 * MIN,
    enabled: finvizEnabled,
    async run({ trigger, signal }) {
      const { runScreener } = await import("./jobs");
      return runScreener({ trigger, signal });
    },
  });

  // Daily before the premarket: every ticker the desk touched (trades 30 d, plans 14 d, watchlist, ideas 30 d).
  register({
    name: FINVIZ_JOBS.snapshot,
    cron: "30 6 * * 1-5",
    timeoutMs: 10 * MIN,
    enabled: finvizEnabled,
    async run({ trigger, signal }) {
      const { runSnapshot } = await import("./jobs");
      return runSnapshot({ trigger, signal });
    },
  });

  // Tickers a page asked for and the store did not have (GET /api/finviz/ticker/:symbol miss).
  register({
    name: FINVIZ_JOBS.snapshotPending,
    cron: "*/15 7-20 * * 1-5",
    timeoutMs: 2 * MIN,
    enabled: finvizEnabled,
    async run({ trigger, signal }) {
      const { runSnapshotPending } = await import("./jobs");
      return runSnapshotPending({ trigger, signal });
    },
  });

  // Earnings calendar, this week + next week, every morning (weekends too: Sunday prepares the new week).
  register({
    name: FINVIZ_JOBS.earnings,
    cron: "0 6 * * *",
    timeoutMs: 3 * MIN,
    enabled: finvizEnabled,
    async run({ trigger, signal }) {
      const { runEarnings } = await import("./jobs");
      return runEarnings({ trigger, signal });
    },
  });
}
