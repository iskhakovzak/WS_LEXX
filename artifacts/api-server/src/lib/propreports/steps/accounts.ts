/**
 * Tick step "accounts.daily" (phase 3 ACCURACY): the broker's account list with status fields
 * (client.accounts → optionalFields accountName,groups,status,closeDate,deactivationDate).
 *
 *   closed account    status closed / inactive / disabled / deactivated / terminated / suspended, or a close /
 *                     deactivation date on or before today (NY) → its mapping is deactivated (active = false,
 *                     auto_deactivated_at = now). A mapping deactivated by hand is never touched; one deactivated here
 *                     is re-activated if the broker re-opens the account.
 *   new account       open, matched by no mapping (account / name / id / alias, the sync's resolver) → added to the
 *                     existing «unmatched accounts» list (propreports_settings.unmatched) for the owner to map;
 *                     closed accounts leave that list.
 *   broker metadata   status / close / deactivation dates / last seen are stored on every matched mapping.
 *   adjustments       `trader` of stored adjustments is re-resolved (mappings edited since the last run).
 */
import { pool } from "@workspace/db";
import { logAudit } from "../../audit";
import { nyDate } from "../../tradingDate";
import type { PropReportsAccount } from "../client";
import { everyMinutes } from "../tick/due";
import type { TickStep } from "../tick/types";
import { getSettings, setSetting } from "../settings";
import { loadAccountMappings, resolveAccount, type AccountMapping } from "../sync";
import { relinkAdjustmentTraders } from "../adjustments";

const CLOSED_STATUS = /^(closed|inactive|disabled|deactivated|terminated|suspended|locked|archived)/i;

export function isClosedAccount(a: Pick<PropReportsAccount, "status" | "closeDate" | "deactivationDate">, today: string): boolean {
  if (a.status && CLOSED_STATUS.test(a.status.trim())) return true;
  if (a.closeDate && a.closeDate.slice(0, 10) <= today) return true;
  if (a.deactivationDate && a.deactivationDate.slice(0, 10) <= today) return true;
  return false;
}

export interface MappingMeta { id: number; autoDeactivated: boolean }

export interface AccountsPlan {
  deactivate: Array<{ id: number; account: string; reason: string }>;
  reactivate: Array<{ id: number; account: string }>;
  metadata: Array<{ id: number; status: string | null; closeDate: string | null; deactivationDate: string | null; accountId: string | null }>;
  /** The whole new unmatched list (sorted). */
  unmatched: string[];
  /** Names that were not on the unmatched list before. */
  newUnmatched: string[];
}

function resolveBroker(a: PropReportsAccount, mappings: AccountMapping[]): AccountMapping | null {
  for (const name of [a.account, a.accountName ?? "", a.accountId]) {
    if (!name) continue;
    const r = resolveAccount(name, mappings);
    if (r) return r.mapping;
  }
  return null;
}

/** Pure planner (no I/O). `autoDeactivated` = mapping ids this step deactivated earlier. */
export function planAccounts(broker: PropReportsAccount[], mappings: AccountMapping[], autoDeactivated: Set<number>, unmatchedBefore: string[], today: string): AccountsPlan {
  const plan: AccountsPlan = { deactivate: [], reactivate: [], metadata: [], unmatched: [], newUnmatched: [] };
  const unmatched = new Set(unmatchedBefore);
  const before = new Set(unmatchedBefore);
  const done = new Set<number>();
  for (const a of broker) {
    const closed = isClosedAccount(a, today);
    const m = resolveBroker(a, mappings);
    if (!m) {
      if (closed) { unmatched.delete(a.account); if (a.accountName) unmatched.delete(a.accountName); }
      else unmatched.add(a.account);
      continue;
    }
    if (done.has(m.id)) continue;
    done.add(m.id);
    plan.metadata.push({ id: m.id, status: a.status, closeDate: a.closeDate, deactivationDate: a.deactivationDate, accountId: a.accountId || null });
    if (closed && m.active) {
      plan.deactivate.push({ id: m.id, account: m.account, reason: a.status ?? (a.closeDate ? `closed ${a.closeDate}` : `deactivated ${a.deactivationDate}`) });
    } else if (!closed && !m.active && autoDeactivated.has(m.id)) {
      plan.reactivate.push({ id: m.id, account: m.account });
    }
  }
  // a name that a mapping covers now (mapped since) is not "unmatched" any more
  for (const name of [...unmatched]) if (resolveAccount(name, mappings)?.how === "exact") unmatched.delete(name);
  plan.unmatched = [...unmatched].sort();
  plan.newUnmatched = plan.unmatched.filter((x) => !before.has(x));
  return plan;
}

export async function applyAccountsPlan(plan: AccountsPlan, unmatchedBefore: string[]): Promise<void> {
  for (const m of plan.metadata) {
    await pool.query(
      `UPDATE propreports_accounts SET broker_status = $2, broker_close_date = $3, broker_deactivation_date = $4,
              account_id = COALESCE(account_id, $5), broker_seen_at = NOW()
        WHERE id = $1`,
      [m.id, m.status, m.closeDate, m.deactivationDate, m.accountId],
    );
  }
  for (const d of plan.deactivate) {
    await pool.query(`UPDATE propreports_accounts SET active = FALSE, auto_deactivated_at = NOW(), updated_at = NOW() WHERE id = $1 AND active`, [d.id]);
    await logAudit({ actor: "propreports.tick", action: "propreports.accounts.auto_deactivate", targetType: "propreports_accounts", targetId: String(d.id), details: { account: d.account, reason: d.reason } });
  }
  for (const r of plan.reactivate) {
    await pool.query(`UPDATE propreports_accounts SET active = TRUE, auto_deactivated_at = NULL, updated_at = NOW() WHERE id = $1 AND auto_deactivated_at IS NOT NULL`, [r.id]);
    await logAudit({ actor: "propreports.tick", action: "propreports.accounts.auto_reactivate", targetType: "propreports_accounts", targetId: String(r.id), details: { account: r.account } });
  }
  if (plan.unmatched.join("|") !== [...unmatchedBefore].sort().join("|")) await setSetting("unmatched", plan.unmatched);
}

export const accountsStep: TickStep = {
  name: "accounts.daily",
  due: everyMinutes(24 * 60),
  async run(ctx) {
    const broker = await ctx.client.accounts();
    const [mappings, settings, auto] = await Promise.all([
      loadAccountMappings(),
      getSettings(),
      pool.query(`SELECT id FROM propreports_accounts WHERE auto_deactivated_at IS NOT NULL`),
    ]);
    const plan = planAccounts(broker, mappings, new Set(auto.rows.map((r: any) => Number(r.id))), settings.unmatched, nyDate(ctx.now));
    await applyAccountsPlan(plan, settings.unmatched);
    // mappings edited since the last run (PUT /propreports/accounts): adjustments follow their account's trader
    const relinked = await relinkAdjustmentTraders().catch(() => 0);
    return {
      done: true,
      note: `accounts ${broker.length}: −${plan.deactivate.length} +${plan.reactivate.length} unmatched +${plan.newUnmatched.length}; adjustments relinked ${relinked}`,
    };
  },
};
