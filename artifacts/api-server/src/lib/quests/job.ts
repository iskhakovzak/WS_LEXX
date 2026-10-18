/**
 * Nightly quests rollover (job «quests.nightly», src/jobs/definitions.ts, every day after the evening rewards run):
 * re-evaluates every active trader and everyone with an active quest — finished periods are closed (done / failed /
 * expired, notifications once), the new day's / week's / month's quests are created, achievements awarded. The same
 * work happens lazily on read; the job only makes sure nothing waits for a visit. Idempotent: a re-run changes nothing.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { forgetQuests } from "./cache";
import { evaluationFor } from "./service";
import { tradersWithActiveQuests } from "./store";

export async function runQuestsNightly(o: { now?: Date; signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
  const now = o.now ?? new Date();
  const { rows } = await pool.query<{ name: string }>(`SELECT name FROM users WHERE active = true AND role = 'trader'`);
  const traders = [...new Set([...rows.map((r) => r.name), ...(await tradersWithActiveQuests())])];
  let done = 0, failed = 0, active = 0;
  for (const trader of traders) {
    if (o.signal?.aborted) break;
    try {
      forgetQuests(trader);
      const e = await evaluationFor(trader, now);
      active += e.quests.filter((q) => q.status === "active").length;
      done += e.quests.filter((q) => q.status === "done" && q.completedOn === e.today).length;
    } catch (err) {
      failed++;
      logger.warn({ err: (err as Error)?.message, trader }, "quests.nightly: trader failed");
    }
  }
  return { traders: traders.length, active, doneToday: done, failed };
}
