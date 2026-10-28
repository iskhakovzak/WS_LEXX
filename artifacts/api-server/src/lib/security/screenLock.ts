/**
 * Screen lock («Заблокировать», migration 0245): a privacy screen for a desk monitor, not a sign-out.
 *
 *  - The lock is per session (JWT `sid`, lib/security/sessions sessionKey): locking the office monitor does not lock the
 *    phone. A row in auth_session_locks = locked.
 *  - While locked, apiAuthGate (lib/auth.ts) answers 423 SESSION_LOCKED to that token on every route except
 *    SCREEN_LOCK_ROUTES (unlock, lock and its status, logout, permissions-me, the lock-screen quote); public routes
 *    stay public.
 *  - Unlock takes the quick-unlock code (users.quick_code_hash, bcrypt) or, when none is set, the account password.
 *    MAX_UNLOCK_ATTEMPTS wrong answers in a row sign the session out (auth_revoked_sessions), so a guesser at the desk
 *    gets 5 tries, then the sign-in page.
 *
 * isSessionLocked is asked on every authenticated request: answers are cached in memory for CACHE_MS, and lock / unlock
 * on this process update the cache at once (another API process sees the change within CACHE_MS).
 */
import { pool } from "@workspace/db";

export const MAX_UNLOCK_ATTEMPTS = 5;
const CACHE_MS = 3_000;
const MAX_ENTRIES = 5_000;

// ─── Quick-unlock code policy (pure) ──────────────────────────────────────────────────────────────────────

export type QuickCodeKind = "digits" | "phrase";
export const QUICK_CODE_DIGITS = { min: 4, max: 8 } as const;
export const QUICK_CODE_PHRASE = { min: 6, max: 32 } as const;

/** «4–8 digits, or a short passphrase (6–32 characters, not all digits)». Null = not acceptable. */
export function quickCodeKind(raw: unknown): QuickCodeKind | null {
  if (typeof raw !== "string") return null;
  const code = raw.normalize("NFC");
  if (/^\d+$/.test(code)) return code.length >= QUICK_CODE_DIGITS.min && code.length <= QUICK_CODE_DIGITS.max ? "digits" : null;
  const chars = [...code];
  if (code.trim() !== code || chars.some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return null;
  return chars.length >= QUICK_CODE_PHRASE.min && chars.length <= QUICK_CODE_PHRASE.max ? "phrase" : null;
}

// ─── Gate allowlist (pure) ────────────────────────────────────────────────────────────────────────────────

export type LockRoute = { method: string; path: string };

/** What a locked token may still call (paths relative to /api). Everything public stays public on top of this. */
export const SCREEN_LOCK_ROUTES: readonly LockRoute[] = [
  { method: "POST", path: "/auth/unlock" },
  { method: "POST", path: "/auth/lock" },
  { method: "GET", path: "/auth/lock" },
  { method: "POST", path: "/auth/logout" },
  { method: "GET", path: "/permissions/me" },
  { method: "GET", path: "/healthz" },
  // The quote under the lock clock (routes/quotes.ts: library texts only, nothing of the reader's data).
  { method: "POST", path: "/quotes/pick" },
  { method: "GET", path: "/quotes/items" },
];

export function allowedWhileLocked(method: string, path: string): boolean {
  const m = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return m === "OPTIONS" || SCREEN_LOCK_ROUTES.some((r) => r.method === m && r.path === p);
}

/** After the n-th wrong answer since the lock (1-based): how many are left, and whether the session ends now. */
export function unlockFailureOutcome(failures: number): { attemptsLeft: number; signOut: boolean } {
  const left = Math.max(0, MAX_UNLOCK_ATTEMPTS - failures);
  return { attemptsLeft: left, signOut: left === 0 };
}

// ─── Store ────────────────────────────────────────────────────────────────────────────────────────────────

export interface ScreenLockStore {
  isLocked(sid: string): Promise<boolean>;
  /** Lock (idempotent: an existing lock keeps its failure count). */
  lock(sid: string, userId: number, expiresAtMs: number): Promise<void>;
  unlock(sid: string): Promise<void>;
  /** Wrong answers since the lock (0 when not locked). */
  failures(sid: string): Promise<number>;
  /** Count one wrong answer (locks the session if it was not locked) → the new count. */
  fail(sid: string, userId: number, expiresAtMs: number): Promise<number>;
}

/** Postgres «relation does not exist»: the migration has not run yet, nothing is locked. */
const isMissingTable = (err: unknown): boolean => (err as { code?: string } | null)?.code === "42P01";

function pgStore(): ScreenLockStore {
  return {
    async isLocked(sid) {
      try {
        const { rows } = await pool.query(`SELECT 1 FROM auth_session_locks WHERE sid = $1 AND expires_at > now() LIMIT 1`, [sid]);
        return rows.length > 0;
      } catch (err) {
        if (isMissingTable(err)) return false;
        throw err;
      }
    },
    async lock(sid, userId, expiresAtMs) {
      await pool.query(
        `INSERT INTO auth_session_locks (sid, user_id, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
         ON CONFLICT (sid) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [sid, userId, expiresAtMs],
      );
    },
    async unlock(sid) {
      await pool.query(`DELETE FROM auth_session_locks WHERE sid = $1`, [sid]);
    },
    async failures(sid) {
      const { rows } = await pool.query<{ failures: number }>(`SELECT failures FROM auth_session_locks WHERE sid = $1`, [sid]);
      return Number(rows[0]?.failures ?? 0);
    },
    async fail(sid, userId, expiresAtMs) {
      const { rows } = await pool.query<{ failures: number }>(
        `INSERT INTO auth_session_locks (sid, user_id, failures, expires_at) VALUES ($1, $2, 1, to_timestamp($3 / 1000.0))
         ON CONFLICT (sid) DO UPDATE SET failures = auth_session_locks.failures + 1
         RETURNING failures`,
        [sid, userId, expiresAtMs],
      );
      return Number(rows[0]?.failures ?? 1);
    },
  };
}

/** In-process store (tests). */
export function memoryScreenLockStore(): ScreenLockStore & { rows: Map<string, { userId: number; failures: number }> } {
  const rows = new Map<string, { userId: number; failures: number }>();
  return {
    rows,
    async isLocked(sid) { return rows.has(sid); },
    async lock(sid, userId) { if (!rows.has(sid)) rows.set(sid, { userId, failures: 0 }); },
    async unlock(sid) { rows.delete(sid); },
    async failures(sid) { return rows.get(sid)?.failures ?? 0; },
    async fail(sid, userId) {
      const r = rows.get(sid) ?? { userId, failures: 0 };
      r.failures += 1;
      rows.set(sid, r);
      return r.failures;
    },
  };
}

let store: ScreenLockStore = pgStore();
const cache = new Map<string, { locked: boolean; exp: number }>();

function remember(sid: string, locked: boolean, nowMs = Date.now()): void {
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(sid, { locked, exp: nowMs + CACHE_MS });
}

export function screenLockStore(): ScreenLockStore { return store; }
/** Tests swap in memoryScreenLockStore(). */
export function setScreenLockStore(s: ScreenLockStore): void { store = s; cache.clear(); }
/** Tests only. */
export function clearScreenLockCache(): void { cache.clear(); }

/** Is this session locked? (authMiddleware, every authenticated request; cached CACHE_MS.) */
export async function isSessionLocked(sid: string, nowMs = Date.now()): Promise<boolean> {
  const hit = cache.get(sid);
  if (hit && hit.exp > nowMs) return hit.locked;
  const locked = await store.isLocked(sid);
  remember(sid, locked, nowMs);
  return locked;
}

/** Token `exp` (seconds) → the lock row's expiry; a token without one keeps the row 8 days (longer than any session). */
export function lockExpiryMs(expSec: number | undefined, nowMs = Date.now()): number {
  return typeof expSec === "number" ? expSec * 1000 : nowMs + 8 * 24 * 3600_000;
}

export async function lockSession(sid: string, userId: number, expSec: number | undefined): Promise<void> {
  await store.lock(sid, userId, lockExpiryMs(expSec));
  remember(sid, true);
}

export async function unlockSession(sid: string): Promise<void> {
  await store.unlock(sid);
  remember(sid, false);
}

export async function unlockFailures(sid: string): Promise<number> {
  return store.failures(sid);
}

export async function recordUnlockFailure(sid: string, userId: number, expSec: number | undefined): Promise<number> {
  const n = await store.fail(sid, userId, lockExpiryMs(expSec));
  remember(sid, true);
  return n;
}
