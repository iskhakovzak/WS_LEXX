import { pool } from "@workspace/db";
import { syncRiskTier } from "../people/stage";
import { applyStageDefaultLimits } from "../people/stageLimits";
import { loadTiers } from "../academyPathStore";
import { forgetTier } from "../playbookToday/tier";
import { onStageAssigned } from "../rulesTemplates";
import { riskT } from "../../i18n/ns";
import { nyDate } from "../tradingDate";
import type { StageKey } from "../promotionEngine";

/**
 * Stage writes of routes/academy-path.ts (promotion approve / manual assign): the trader's stage row, the history entry,
 * the risk tier and — for a trader without any limits yet — the ladder template limits of that tier (Волна 1 п. 1.1;
 * existing limits are never overwritten), in one transaction. Split out of routes/academy-path.ts (size ratchet).
 * Returns whether template limits were applied.
 */

export async function setStage(user: string, from: StageKey | null, to: StageKey, actor: string, action: string, comment: string | null, requestId: number | null, report: unknown): Promise<{ limitsApplied: boolean }> {
  const [tiers] = await Promise.all([loadTiers()]);
  let limitsApplied = false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO academy_trader_stage (user_name, stage, since, updated_by, updated_at) VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_name) DO UPDATE SET stage = EXCLUDED.stage, since = EXCLUDED.since, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [user, to, nyDate(), actor],
    );
    await client.query(
      `INSERT INTO academy_stage_history (user_name, from_stage, to_stage, action, request_id, actor, comment, report) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user, from, to, action, requestId, actor, comment, report == null ? null : JSON.stringify(report)],
    );
    await syncRiskTier(client, user, to, actor); // the stage is the single source: the risk tier follows it
    limitsApplied = await applyStageDefaultLimits(client, user, to, actor, tiers, riskT.tFor("ru")("stageDefaults.logReason"));
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  forgetTier(user);
  onStageAssigned(user, to); // the stage's desk rules (Волна 2 п. 2.6) are live at once
  return { limitsApplied };
}

