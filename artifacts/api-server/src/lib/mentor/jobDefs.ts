/**
 * Mentor jobs for the in-process scheduler (jobs/definitions.ts calls registerMentorJobs once). Cron = New York time.
 * Importing this module loads nothing heavy: the bodies are imported on the first run.
 *
 *   mentor.escalations  18:50 Mon–Fri — deterministic escalation check of every active trader (lib/mentor/escalate.ts):
 *                       tilt streak, repeated commitment breaks, drawdown near the limit, silence → one in-app notice
 *                       to the trader's staff. Setting mentor.escalationsEnabled. No model call.
 *   mentor.pushes       every 10 minutes Mon–Fri while mentor.pushesEnabled (off by default) — the scheduled brief /
 *                       debrief through the Message Batches API (lib/mentor/push.ts).
 */
import type { JobDef } from "../../jobs/registry";
import { setting } from "../settings/registry";
import { nyDate } from "../tradingDate";

const MIN = 60_000;

export function registerMentorJobs(register: (def: JobDef) => void): void {
  register({
    name: "mentor.escalations",
    cron: "50 18 * * 1-5",
    timeoutMs: 20 * MIN,
    enabled: () => setting("mentor.enabled") && setting("mentor.escalationsEnabled"),
    async run({ signal }) {
      const { runEscalations } = await import("./escalate");
      return runEscalations({ signal, today: nyDate() });
    },
  });
  register({
    name: "mentor.pushes",
    cron: "*/10 * * * 1-5",
    timeoutMs: 20 * MIN,
    enabled: () => setting("mentor.enabled") && setting("mentor.pushesEnabled"),
    async run(ctx) {
      const { runPushes } = await import("./push");
      return runPushes(ctx);
    },
  });
}
