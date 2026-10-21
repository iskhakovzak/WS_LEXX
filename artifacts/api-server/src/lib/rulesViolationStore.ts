import { pool } from "@workspace/db";
import { DESK_TRADER } from "./rulesEngine";
import { violationMessage } from "./rulesI18n";
import type { Lang } from "../i18n";
import type { PersistedViolation } from "./rulesReport";
import { closeDateSql, netPnlSql, resultSql, signedRSql } from "./tradeMath";
import { activeViolationSql, isArchiveReason } from "./violationArchive";

/**
 * rule_violations reads of routes/rules.ts: the persisted / archived maps of the live report and the joined SELECT +
 * row shape of GET /rule-violations. Split out of routes/rules.ts (size ratchet).
 */

export async function persistedMap(trader: string): Promise<Map<string, PersistedViolation>> {
  const { rows } = await pool.query<any>(
    `SELECT id, rule_id, dedup_key, acknowledged_at, resolved_at, resolution FROM rule_violations
      WHERE trader = $1 AND dedup_key IS NOT NULL AND ${activeViolationSql()}`,
    [trader],
  );
  const m = new Map<string, PersistedViolation>();
  for (const r of rows) {
    m.set(`${r.rule_id}:${r.dedup_key}`, {
      id: Number(r.id),
      status: r.resolved_at ? "resolved" : r.acknowledged_at ? "acknowledged" : "open",
      resolution: r.resolution ?? null,
    });
  }
  return m;
}

/** Per rule: this trader's violations archived because the rule is disabled (they come back when it is re-enabled). */
export async function archivedCounts(trader: string): Promise<Map<number, number>> {
  const { rows } = await pool.query<any>(
    `SELECT rule_id, COUNT(*)::int AS n FROM rule_violations WHERE trader = $1 AND archived_reason = 'rule_disabled' GROUP BY rule_id`,
    [trader],
  );
  return new Map(rows.map((r: any) => [Number(r.rule_id), Number(r.n)] as [number, number]));
}

export const VIOLATION_SELECT = `
  SELECT v.id, v.trader, v.rule_id AS "ruleId", v.trade_id AS "tradeId",
         v.occurred_at AS "occurredAt", v.severity, v.message, v.details,
         v.day, v.cost_net::float AS "costNet",
         v.acknowledged_by AS "acknowledgedBy", v.acknowledged_at AS "acknowledgedAt", v.comment,
         v.resolution, v.consequence, v.resolved_by AS "resolvedBy", v.resolved_at AS "resolvedAt",
         v.archived_at AS "archivedAt", v.archived_reason AS "archivedReason",
         r.enabled AS "ruleEnabled", (r.deleted_at IS NOT NULL) AS "ruleDeleted",
         r.name AS "ruleName", r.kind AS "ruleKind", r.origin AS "ruleOrigin", (r.trader = '${DESK_TRADER}') AS "ruleDesk",
         t.ticker, t.date AS "tradeDate", ${closeDateSql()} AS "tradeCloseDate", ${resultSql()} AS "tradeResult",
         ${signedRSql()} AS "tradeR", t.pnl::float AS "tradePnl", ${netPnlSql()}::float AS "tradeNetPnl",
         t.setup AS "tradeSetup", t.playbook_id AS "playbookId", p.name AS "playbookName", t.source AS "tradeSource"
    FROM rule_violations v
    LEFT JOIN trading_rules r ON v.rule_id = r.id
    LEFT JOIN trades t ON v.trade_id = t.id
    LEFT JOIN playbook p ON p.id = t.playbook_id
`;

export function shapeViolation(r: any, lang: Lang) {
  return {
    ...r,
    // Stored reason (Russian) → the reader's language when the row carries it as data (details.msg).
    message: violationMessage(r.message, r.details, lang),
    costNet: r.costNet == null ? null : Number(r.costNet),
    tradeR: r.tradeR == null ? null : Number(r.tradeR),
    tradePnl: r.tradePnl == null ? null : Number(r.tradePnl),
    tradeNetPnl: r.tradeNetPnl == null ? null : Number(r.tradeNetPnl),
    ruleOrigin: r.ruleDesk ? "office" : r.ruleOrigin ?? "personal",
    ruleDesk: !!r.ruleDesk,
    status: r.resolvedAt ? "resolved" : r.acknowledgedAt ? "acknowledged" : "open",
    archived: r.archivedAt != null,
    archivedReason: isArchiveReason(r.archivedReason) ? r.archivedReason : r.archivedAt != null ? "stale" : null,
    ruleEnabled: r.ruleEnabled !== false,
    ruleDeleted: !!r.ruleDeleted,
  };
}
