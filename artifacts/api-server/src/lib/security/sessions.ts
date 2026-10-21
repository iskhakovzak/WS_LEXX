/**
 * Per-session sign-out (wave 1, item 1.10; migration 0232 `auth_revoked_sessions`).
 *
 * Every member token carries a session id (`sid` claim). The sliding refresh in GET /auth/me keeps the sid, so one
 * device = one session for its whole life. «Выйти» in the menu revokes only that sid (a row here); «Выйти на других
 * устройствах» in the settings bumps users.token_version (every token dies) and hands the calling device a fresh token.
 *
 * Tokens issued before 0232 have no sid: their session key is a hash of the token itself, and the next refresh carries
 * that key forward as the sid — so they can be signed out individually too.
 *
 * authMiddleware asks `isSessionRevoked` on every authenticated request; answers are cached in memory (revoked: until
 * the token expires; live: 30 s), so a sign-out on another API process takes effect within 30 s. Rows are kept (tiny:
 * one per sign-out); a row past `expires_at` no longer matters because the token itself is expired by then.
 */
import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";

/** A fresh, unguessable session id for a new sign-in. */
export function newSessionId(): string {
  return randomBytes(12).toString("base64url");
}

/** The revocation key of a token: its `sid`, or (legacy token without one) `h:` + a hash of the token. */
export function sessionKey(sid: string | null | undefined, token: string): string {
  if (sid) return sid;
  return `h:${createHash("sha256").update(token).digest("base64url").slice(0, 32)}`;
}

const LIVE_TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { revoked: boolean; exp: number }>();

function remember(key: string, revoked: boolean, exp: number): void {
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { revoked, exp });
}

/** Postgres «relation does not exist» — the migration has not run yet: nothing is revoked. */
const isMissingTable = (err: unknown): boolean => (err as { code?: string } | null)?.code === "42P01";

/** Was this session signed out («Выйти» on that device)? */
export async function isSessionRevoked(key: string, nowMs = Date.now()): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && hit.exp > nowMs) return hit.revoked;
  try {
    const { rows } = await pool.query(`SELECT 1 FROM auth_revoked_sessions WHERE sid = $1 LIMIT 1`, [key]);
    const revoked = rows.length > 0;
    remember(key, revoked, nowMs + LIVE_TTL_MS);
    return revoked;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

/**
 * Sign one session out. `expiresAtSec` = the token's `exp` (the row is irrelevant afterwards). Idempotent.
 */
export async function revokeSession(key: string, userId: number, expiresAtSec: number | undefined, nowMs = Date.now()): Promise<void> {
  const expMs = typeof expiresAtSec === "number" ? expiresAtSec * 1000 : nowMs + 8 * 24 * 3600_000;
  await pool.query(
    `INSERT INTO auth_revoked_sessions (sid, user_id, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
     ON CONFLICT (sid) DO NOTHING`,
    [key, userId, expMs],
  );
  remember(key, true, Math.max(expMs, nowMs + LIVE_TTL_MS));
}

/** Tests only. */
export function clearSessionCache(): void {
  cache.clear();
}
