/**
 * Achievements v2 — storage beyond the tiers themselves (migration 0275):
 *   trader_achievements.lost_on   a held tier stopped holding (setup edge faded, a closed leak came back)
 *   trader_achievements.seen_at   the trader saw the ceremony of a big win (history recounts are stored seen)
 *   achievement_kudos             a curator's kudos for one day (and optionally one trade of it)
 * Every read degrades to «nothing» on a database without the migration (42P01 / 42703).
 */
import { pool } from "@workspace/db";

const quiet = <T>(err: unknown): { rows: T[]; rowCount: number } => {
  const code = (err as { code?: string })?.code;
  if (code !== "42P01" && code !== "42703") throw err;
  return { rows: [], rowCount: 0 };
};

export type AwardExtra = { line: string; tier: string; lostOn: string | null; seen: boolean; createdAt: string; detail: Record<string, unknown> | null };

export async function awardExtras(trader: string): Promise<AwardExtra[]> {
  const { rows } = await pool
    .query<{ line: string; tier: string; lost_on: string | null; seen: boolean; created_at: string; detail: Record<string, unknown> | null }>(
      `SELECT line, tier, lost_on, seen_at IS NOT NULL AS seen, created_at, detail FROM trader_achievements WHERE trader = $1`,
      [trader],
    )
    .catch((e) => quiet<{ line: string; tier: string; lost_on: string | null; seen: boolean; created_at: string; detail: Record<string, unknown> | null }>(e));
  return rows.map((r) => ({ line: r.line, tier: r.tier, lostOn: r.lost_on ?? null, seen: !!r.seen, createdAt: new Date(r.created_at).toISOString(), detail: r.detail ?? null }));
}

/** Marks the listed tiers of a line lost on `day`, or clears the mark (day null). True when a row changed. */
export async function setLostOn(trader: string, line: string, tiers: readonly string[], day: string | null): Promise<boolean> {
  if (!tiers.length) return false;
  const r = await pool
    .query(
      `UPDATE trader_achievements SET lost_on = $4 WHERE trader = $1 AND line = $2 AND tier = ANY($3::text[]) AND lost_on IS DISTINCT FROM $4`,
      [trader, line, [...tiers], day],
    )
    .catch((e) => quiet<unknown>(e));
  return (r.rowCount ?? 0) > 0;
}

/** The trader saw these ceremonies ("line|tier" keys). */
export async function markSeen(trader: string, keys: readonly string[]): Promise<number> {
  const pairs = keys.map((k) => k.split("|")).filter((p) => p.length === 2 && p[0] && p[1]);
  if (!pairs.length) return 0;
  const r = await pool
    .query(
      `UPDATE trader_achievements a SET seen_at = now() FROM UNNEST($2::text[], $3::text[]) AS k(line, tier)
        WHERE a.trader = $1 AND a.line = k.line AND a.tier = k.tier AND a.seen_at IS NULL`,
      [trader, pairs.map((p) => p[0]), pairs.map((p) => p[1])],
    )
    .catch((e) => quiet<unknown>(e));
  return r.rowCount ?? 0;
}

// ─── kudos ──────────────────────────────────────────────────────────────────

export type Kudos = { id: number; trader: string; author: string; day: string; tradeId: number | null; note: string | null; createdAt: string };

type KudosRow = { id: number; trader: string; author: string; day: string; trade_id: number | null; note: string | null; created_at: string };
const toKudos = (r: KudosRow): Kudos => ({
  id: Number(r.id), trader: r.trader, author: r.author, day: String(r.day), tradeId: r.trade_id == null ? null : Number(r.trade_id), note: r.note ?? null,
  createdAt: new Date(r.created_at).toISOString(),
});

/** Stores a kudos once per author / trader / day / trade; null when it already exists. */
export async function insertKudos(k: { trader: string; author: string; day: string; tradeId: number | null; note: string | null }): Promise<Kudos | null> {
  const { rows } = await pool.query<KudosRow>(
    `INSERT INTO achievement_kudos (trader, author, day, trade_id, note) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (author, trader, day, COALESCE(trade_id, 0)) DO NOTHING
     RETURNING id, trader, author, day, trade_id, note, created_at`,
    [k.trader, k.author, k.day, k.tradeId, k.note],
  );
  return rows[0] ? toKudos(rows[0]) : null;
}

export async function kudosOf(trader: string, limit = 50): Promise<Kudos[]> {
  const { rows } = await pool
    .query<KudosRow>(`SELECT id, trader, author, day, trade_id, note, created_at FROM achievement_kudos WHERE trader = $1 ORDER BY day DESC, id DESC LIMIT $2`, [trader, limit])
    .catch((e) => quiet<KudosRow>(e));
  return rows.map(toKudos);
}

/** A trade of the trader on that NY day (kudos tied to a trade must name one of his). */
export async function tradeOfDay(trader: string, tradeId: number, day: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM trades WHERE id = $1 AND trader = $2 AND deleted_at IS NULL AND substring(date, 1, 10) = $3 LIMIT 1`,
    [tradeId, trader, day],
  );
  return rows.length > 0;
}
