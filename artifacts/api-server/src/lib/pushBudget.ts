/**
 * Telegram push budget, DB side (roadmap R3). The rule is pure (lib/notificationCore pushVerdict); this applies it to
 * one person's pushes of the New York day (table telegram_push_log, migration 0247) under a per-person advisory lock, so
 * two producers at the same moment cannot both take the last slot. Every Telegram push to a person goes through
 * claimPush first: lib/notifyUtils notifyTraderTelegram (in-app notifications mirrored to Telegram) and the daily loop
 * sends (lib/daily/telegramJobs). A push Telegram rejected gives its slot back (releasePush).
 * Fail-open: when the log cannot be read (database older than the migration) the push goes out as before.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { setting } from "./settings/registry";
import { nyDate } from "./tradingDate";
import { pushCategory, pushVerdict, type PushBudget, type PushLogRow, type PushVerdict } from "./notificationCore";

export function pushBudget(): PushBudget {
  return {
    dailyPush: setting("alerts.budget.dailyPush"),
    coachingPush: setting("alerts.budget.coachingPush"),
    riskQuietMinutes: setting("alerts.budget.riskQuietMinutes"),
  };
}

export type PushClaim = { ok: true; id: number | null } | { ok: false; reason: Extract<PushVerdict, { send: false }>["reason"] };

/** May `userName` get a Telegram push of `kind` now? On yes the push is logged (the caller sends it). */
export async function claimPush(userName: string, kind: string, dedupKey: string | null = null, now: Date = new Date()): Promise<PushClaim> {
  const category = pushCategory(kind);
  if (category === "exempt") return { ok: true, id: null };
  const day = nyDate(now);
  const client = await Promise.resolve().then(() => pool.connect()).catch(() => null);
  if (!client) return { ok: true, id: null };
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`telegram-push:${userName}`]);
    const { rows } = await client.query<{ kind: string; category: PushLogRow["category"]; dedup_key: string | null; sent_at: Date }>(
      `SELECT kind, category, dedup_key, sent_at FROM telegram_push_log WHERE user_name = $1 AND ny_date = $2`,
      [userName, day],
    );
    const verdict = pushVerdict(kind, dedupKey, rows.map((r) => ({ kind: r.kind, category: r.category, dedupKey: r.dedup_key, sentAt: r.sent_at })), pushBudget(), now);
    if (!verdict.send) {
      await client.query("ROLLBACK");
      logger.debug({ userName, kind, reason: verdict.reason }, "telegram push held back by the budget");
      return { ok: false, reason: verdict.reason };
    }
    const ins = await client.query<{ id: string }>(
      `INSERT INTO telegram_push_log (user_name, ny_date, kind, category, dedup_key, sent_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userName, day, kind.slice(0, 60), category, dedupKey ? dedupKey.slice(0, 200) : null, now],
    );
    await client.query("COMMIT");
    return { ok: true, id: Number(ins.rows[0].id) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.warn({ err: (err as Error).message, userName, kind }, "telegram push budget unavailable — sending");
    return { ok: true, id: null };
  } finally {
    client.release();
  }
}

/** Gives a slot back (Telegram did not accept the message). */
export async function releasePush(claim: PushClaim): Promise<void> {
  if (!claim.ok || claim.id == null) return;
  await pool.query(`DELETE FROM telegram_push_log WHERE id = $1`, [claim.id]).catch(() => undefined);
}
