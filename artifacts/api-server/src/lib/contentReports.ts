/**
 * Content reports («Пожаловаться») — the parts of POST /reports and the moderation queue that live outside
 * routes/admin.ts (wave 1, item 1.17; audit team.md: an idea report always answered 400, duplicates inflated «3 жалобы»).
 *
 *   - targets: a discussion, a comment, or a trade idea (components/ideas/IdeaDetailSheet sends "trade_idea");
 *   - the target must exist (not deleted) — otherwise 404;
 *   - one open report per reporter + target: a repeat answers the existing report (200) instead of a new row.
 */
import { pool } from "@workspace/db";

export const REPORT_TARGET_TYPES = ["discussion", "comment", "trade_idea"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

const EXISTS_SQL: Record<ReportTargetType, string> = {
  discussion: `SELECT 1 FROM discussions WHERE id = $1 AND deleted_at IS NULL`,
  comment: `SELECT 1 FROM comments WHERE id = $1`,
  trade_idea: `SELECT 1 FROM trade_ideas WHERE id = $1 AND deleted_at IS NULL`,
};

/** Does the reported object exist (and is not deleted)? Ids are integers for every target type. */
export async function reportTargetExists(type: ReportTargetType, targetId: string): Promise<boolean> {
  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const { rows } = await pool.query(EXISTS_SQL[type], [id]);
  return rows.length > 0;
}

export interface ReportJson {
  id: number;
  reporter: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
}

type ReportRow = {
  id: number; reporter: string; target_type: string; target_id: string; reason: string; status: string;
  resolved_by: string | null; resolved_at: Date | string | null; resolution: string | null; created_at: Date | string; created: boolean;
};

const iso = (v: Date | string | null): string | null => (v == null ? null : new Date(v).toISOString());

/**
 * Insert a report unless the same reporter already has an OPEN report on the same target; in that case return the
 * existing one (`created: false`). One statement, so a double click does not create two rows.
 */
export async function createOrReuseReport(r: { reporter: string; targetType: ReportTargetType; targetId: string; reason: string }): Promise<{ report: ReportJson; created: boolean }> {
  const { rows } = await pool.query<ReportRow>(
    `WITH existing AS (
       SELECT * FROM content_reports
        WHERE reporter = $1 AND target_type = $2 AND target_id = $3 AND status = 'open'
        ORDER BY id LIMIT 1
     ), ins AS (
       INSERT INTO content_reports (reporter, target_type, target_id, reason)
       SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM existing)
       RETURNING *
     )
     SELECT ins.*, true AS created FROM ins
     UNION ALL
     SELECT existing.*, false AS created FROM existing`,
    [r.reporter, r.targetType, r.targetId, r.reason],
  );
  const row = rows[0];
  return {
    created: !!row.created,
    report: {
      id: Number(row.id), reporter: row.reporter, targetType: row.target_type, targetId: row.target_id, reason: row.reason,
      status: row.status, resolvedBy: row.resolved_by, resolvedAt: iso(row.resolved_at), resolution: row.resolution,
      createdAt: iso(row.created_at)!,
    },
  };
}

export type IdeaTargetRow = { id: number; trader: string | null; title: string; preview: string | null; deleted: boolean; createdAt: string | null };

/** Reported trade ideas for the moderation queue: author, «TICKER · setup» as the title, the thesis as the preview. */
export async function loadIdeaReportTargets(ids: readonly number[]): Promise<IdeaTargetRow[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query<{ id: number; trader: string | null; ticker: string; setup: string | null; thesis: string | null; deleted_at: Date | null; created_at: Date | null }>(
    `SELECT id, trader, ticker, setup, thesis, deleted_at, created_at FROM trade_ideas WHERE id = ANY($1::int[])`, [ids]);
  const clip = (v: string | null) => (v && v.trim() ? v.trim().slice(0, 280) : null);
  return rows.map((r) => ({
    id: Number(r.id), trader: r.trader ?? null, title: [r.ticker, r.setup].filter(Boolean).join(" · "), preview: clip(r.thesis),
    deleted: !!r.deleted_at, createdAt: iso(r.created_at),
  }));
}
