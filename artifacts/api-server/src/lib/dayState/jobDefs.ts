/**
 * Day-state jobs for the in-process scheduler (jobs/definitions.ts registerModuleJobs). Cron = New York time.
 *
 *   traders.silence   18:45 Mon–Fri — the silence signal (lib/dayState/silence.ts): traders without trades for
 *                     dayState.pausedDays trading days and unclosed day reviews → one in-app notice to their staff.
 *                     Setting dayState.silenceEnabled; Telegram stays off unless dayState.silenceTelegram (and production).
 */
import type { JobDef } from "../../jobs/registry";
import { setting } from "../settings/registry";

const MIN = 60_000;

export function registerDayStateJobs(register: (def: JobDef) => void): void {
  register({
    name: "traders.silence",
    cron: "45 18 * * 1-5",
    timeoutMs: 20 * MIN,
    enabled: () => setting("dayState.silenceEnabled"),
    async run({ signal }) {
      const { runSilenceSignal } = await import("./silence");
      return runSilenceSignal({ signal });
    },
  });
}
