/**
 * Leak guard storage (migration 0267: leak_guard_events, leak_guard_levels). Writers: the scan job (insert, ladder
 * marks, settlement), the trader's acknowledgement, staff release and per-trader levels (both audited). GET routes
 * only read.
 */
import { pool } from "@workspace/db";
import { logAudit } from "../audit";
import { GUARD_LEVELS, LEVEL_CHOICES, type GuardDraft, type GuardLevel, type GuardOutcome, type GuardPattern, type GuardSettlement, type LevelChoice, type SilentReason } from "./types";

export type GuardEventRow = {
  id: number;
  trader: string;
  day: string;
  pattern: GuardPattern;
  sourceKey: string;
  level: GuardLevel;
  triggerTradeId: number | null;
  triggeredAt: string;
  detectedAt: string;
  pauseUntil: string | null;
  late: boolean;
  silentReason: SilentReason | null;
  costPerTrade: number | null;
  costPerTrigger: number | null;
  stats: Record<string, number | string | null>;
  ackedAt: string | null;
  escalatedAt: string | null;
  riskNotifiedAt: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  outcome: GuardOutcome | null;
  outcomeNet: number | null;
  saved: number | null;
  lost: number | null;
  atRiskTradeIds: number[];
  settledAt: string | null;
};

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const numOrNull = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

const COLUMNS = `id, trader, to_char(day, 'YYYY-MM-DD') AS day, pattern, source_key, level, trigger_trade_id, triggered_at, detected_at,
  pause_until, late, silent_reason, cost_per_trade, cost_per_trigger, stats, acked_at, escalated_at, risk_notified_at, released_at,
  released_by, outcome, outcome_net, saved_usd, lost_usd, at_risk_trade_ids, settled_at`;

function rowOf(r: any): GuardEventRow {
  return {
    id: Number(r.id), trader: String(r.trader), day: String(r.day), pattern: r.pattern, sourceKey: String(r.source_key), level: r.level,
    triggerTradeId: r.trigger_trade_id == null ? null : Number(r.trigger_trade_id),
    triggeredAt: iso(r.triggered_at)!, detectedAt: iso(r.detected_at)!, pauseUntil: iso(r.pause_until), late: r.late === true,
    silentReason: r.silent_reason ?? null, costPerTrade: numOrNull(r.cost_per_trade), costPerTrigger: numOrNull(r.cost_per_trigger),
    stats: r.stats ?? {}, ackedAt: iso(r.acked_at), escalatedAt: iso(r.escalated_at), riskNotifiedAt: iso(r.risk_notified_at),
    releasedAt: iso(r.released_at), releasedBy: r.released_by ?? null, outcome: r.outcome ?? null, outcomeNet: numOrNull(r.outcome_net),
    saved: numOrNull(r.saved_usd), lost: numOrNull(r.lost_usd), atRiskTradeIds: (r.at_risk_trade_ids ?? []).map(Number), settledAt: iso(r.settled_at),
  };
}

/** Stores a new event; null when this trader / day / pattern / source already has one. */
/** `detectedAt` = the scan's clock (epoch ms), so the ladder timing reads one clock. */
export async function insertEvent(d: GuardDraft, level: GuardLevel, silent: SilentReason | null, detectedAt: number): Promise<GuardEventRow | null> {
  const { rows } = await pool.query(
    `INSERT INTO leak_guard_events (trader, day, pattern, source_key, level, trigger_trade_id, triggered_at, pause_until, late, silent_reason,
                                    cost_per_trade, cost_per_trigger, stats, detected_at)
     VALUES ($1, $2::date, $3, $4, $5, $6, to_timestamp($7 / 1000.0), CASE WHEN $8::float8 IS NULL THEN NULL ELSE to_timestamp($8::float8 / 1000.0) END,
             $9, $10, $11, $12, $13::jsonb, to_timestamp($14 / 1000.0))
     ON CONFLICT (trader, day, pattern, source_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [d.trader, d.day, d.pattern, d.sourceKey, level, d.triggerTradeId, d.triggeredAt, d.pauseUntil, d.late, silent, d.costPerTrade, d.costPerTrigger, JSON.stringify(d.stats), detectedAt],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

/** Keys already stored for the day (the scan skips them before deciding anything). */
export async function existingKeys(day: string): Promise<Set<string>> {
  const { rows } = await pool.query(`SELECT trader, pattern, source_key FROM leak_guard_events WHERE day = $1::date`, [day]);
  return new Set(rows.map((r: any) => `${r.trader}|${r.pattern}|${r.source_key}`));
}

/** Events told to the trader today (the daily cap). */
export async function toldCounts(day: string): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `SELECT trader, COUNT(*)::int AS n FROM leak_guard_events WHERE day = $1::date AND silent_reason IS NULL GROUP BY trader`,
    [day],
  );
  return new Map(rows.map((r: any) => [String(r.trader), Number(r.n)]));
}

/** Unsettled events (any day — a missed evening is settled the next time the scan runs). */
export async function openEvents(): Promise<GuardEventRow[]> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM leak_guard_events WHERE settled_at IS NULL ORDER BY day, id LIMIT 2000`);
  return rows.map(rowOf);
}

export async function markStep(id: number, step: "escalated_at" | "risk_notified_at"): Promise<boolean> {
  const col = step === "escalated_at" ? "escalated_at" : "risk_notified_at";
  const { rowCount } = await pool.query(`UPDATE leak_guard_events SET ${col} = now() WHERE id = $1 AND ${col} IS NULL`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function saveSettlement(id: number, s: GuardSettlement): Promise<void> {
  await pool.query(
    `UPDATE leak_guard_events SET outcome = $2, outcome_net = $3, saved_usd = $4, lost_usd = $5, at_risk_trade_ids = $6::int[], settled_at = now()
      WHERE id = $1 AND settled_at IS NULL`,
    [id, s.outcome, s.actualNet, s.saved, s.lost, s.atRiskIds],
  );
}

/** The trader acknowledges their own event (firm / hard). False when not theirs or already acknowledged. */
export async function ackEvent(id: number, trader: string): Promise<GuardEventRow | null> {
  const { rows } = await pool.query(
    `UPDATE leak_guard_events SET acked_at = COALESCE(acked_at, now()) WHERE id = $1 AND trader = $2 RETURNING ${COLUMNS}`,
    [id, trader],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

/** Staff end a pause early (audited «leakGuard.release»). */
export async function releaseEvent(id: number, actor: string): Promise<GuardEventRow | null> {
  const { rows } = await pool.query(
    `UPDATE leak_guard_events SET released_at = now(), released_by = $2 WHERE id = $1 AND released_at IS NULL RETURNING ${COLUMNS}`,
    [id, actor],
  );
  const row = rows[0] ? rowOf(rows[0]) : null;
  if (row) await logAudit({ actor, action: "leakGuard.release", targetType: "trader", targetId: row.trader, details: { event: row.id, pattern: row.pattern, day: row.day } });
  return row;
}

export async function eventById(id: number): Promise<GuardEventRow | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM leak_guard_events WHERE id = $1`, [id]);
  return rows[0] ? rowOf(rows[0]) : null;
}

/** Events the trader should see now: told, today, not released, unsettled, and either the pause still runs or — first
 * trade of the day — no trade of the day exists yet. */
export async function activeEvents(trader: string, day: string): Promise<GuardEventRow[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM leak_guard_events e
      WHERE e.trader = $1 AND e.day = $2::date AND e.silent_reason IS NULL AND e.released_at IS NULL AND e.settled_at IS NULL
        AND CASE WHEN e.pattern = 'first_trade'
                 THEN NOT EXISTS (SELECT 1 FROM trades t WHERE t.trader = e.trader AND t.deleted_at IS NULL AND substring(t.date, 1, 10) = $3)
                 ELSE e.pause_until > now() END
      ORDER BY e.detected_at DESC LIMIT 10`,
    [trader, day, day],
  );
  return rows.map(rowOf);
}

export async function listEvents(trader: string | null, from: string, to: string, limit = 2000): Promise<GuardEventRow[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM leak_guard_events WHERE ($1::text IS NULL OR trader = $1) AND day BETWEEN $2::date AND $3::date
      ORDER BY day DESC, id DESC LIMIT $4`,
    [trader, from, to, Math.max(1, Math.min(5000, limit))],
  );
  return rows.map(rowOf);
}

// ─── per-trader levels ──────────────────────────────────────────────────────

export async function loadLevels(): Promise<Map<string, LevelChoice>> {
  const { rows } = await pool.query(`SELECT trader, level FROM leak_guard_levels`);
  return new Map(rows.filter((r: any) => (LEVEL_CHOICES as readonly string[]).includes(r.level)).map((r: any) => [String(r.trader), r.level as LevelChoice]));
}

/** Sets (or with null clears) a trader's override; audited «leakGuard.level» {from, to}. Returns the stored value. */
export async function setLevel(trader: string, level: LevelChoice | null, actor: string): Promise<LevelChoice | null> {
  const before = (await loadLevels()).get(trader) ?? null;
  if (before === level) return level;
  if (level == null) await pool.query(`DELETE FROM leak_guard_levels WHERE trader = $1`, [trader]);
  else {
    await pool.query(
      `INSERT INTO leak_guard_levels (trader, level, set_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (trader) DO UPDATE SET level = EXCLUDED.level, set_by = EXCLUDED.set_by, updated_at = now()`,
      [trader, level, actor],
    );
  }
  await logAudit({ actor, action: "leakGuard.level", targetType: "trader", targetId: trader, details: { from: before, to: level } });
  return level;
}

export const isGuardLevel = (v: unknown): v is GuardLevel => (GUARD_LEVELS as readonly string[]).includes(v as string);
