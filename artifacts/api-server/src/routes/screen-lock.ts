/**
 * Screen lock «Заблокировать» (lib/security/screenLock.ts, migration 0245). A privacy screen, not a sign-out.
 *
 *   GET    /auth/lock          → { locked, hasCode, kind, attemptsLeft }            (allowed while locked)
 *   POST   /auth/lock          → locks this session; same body                       (allowed while locked: idempotent)
 *   POST   /auth/unlock {code} → { ok, token? } | 403 UNLOCK_CODE_INVALID {attemptsLeft} | 401 UNLOCK_SIGNED_OUT
 *   GET    /auth/quick-code    → { set, kind, setAt }
 *   PUT    /auth/quick-code {code} → { ok, kind }   set or change («4–8 digits or a 6–32 character phrase»)
 *   DELETE /auth/quick-code    → { ok }             remove (the lock then takes the account password)
 *
 * Unlock checks the quick code; with none set, the account password (so an auto-lock never strands anyone). The 5th wrong
 * answer since the lock signs this session out (auth_revoked_sessions) — the client then shows the sign-in page.
 * Members only (a guest has no session row to lock). Limiters: unlock and code changes per member, failures only.
 * Every lock, unlock, failed unlock, forced sign-out and code change is audited (never the code itself).
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { hashPassword, isGuest, requireMember, shouldRefreshToken, signToken, verifyPassword } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { AppError, unauthorized } from "../lib/http";
import { langOf } from "../i18n";
import { securityT } from "../lib/security/i18n";
import { revokeSession } from "../lib/security/sessions";
import {
  MAX_UNLOCK_ATTEMPTS, isSessionLocked, lockSession, quickCodeKind, recordUnlockFailure, unlockFailureOutcome,
  unlockFailures, unlockSession, type QuickCodeKind,
} from "../lib/security/screenLock";

const router: IRouter = Router();

const WINDOW_MS = 15 * 60 * 1000;

/** Per member (all their sessions together), failed requests only. */
function memberLimiter(prefix: string, limit: number) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `${prefix}:${req.authUser?.id ?? 0}`,
    message: (req: Request) => ({ error: securityT.tFor(langOf(req))("password.tooManyAttempts"), code: "RATE_LIMITED" }),
  });
}

/** 10 wrong unlocks per member per 15 min across sessions (each session also ends at its 5th). */
export const UNLOCK_LIMIT = 10;
const unlockLimiter = memberLimiter("unlock", UNLOCK_LIMIT);
const codeLimiter = memberLimiter("quick-code", 20);
const lockLimiter = rateLimit({
  windowMs: WINDOW_MS, limit: 120, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: (req) => `lock:${req.authUser?.id ?? 0}`,
  message: (req: Request) => ({ error: securityT.tFor(langOf(req))("body.tooManyRequests"), code: "RATE_LIMITED" }),
});

type CodeRow = { quick_code_hash: string | null; quick_code_kind: QuickCodeKind | null; quick_code_set_at: Date | null; password_hash: string | null };

async function codeRow(userId: number): Promise<CodeRow | null> {
  const { rows } = await pool.query<CodeRow>(
    `SELECT quick_code_hash, quick_code_kind, quick_code_set_at, password_hash FROM users WHERE id = $1 AND active = true LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * The session a member request belongs to (401 for anonymous / guest). A bearer token always carries one
 * (authMiddleware sets authMeta.sid); a request built in-process without it locks per member.
 */
function sessionOf(req: Request): { sid: string; userId: number; exp?: number } {
  if (!req.authUser || isGuest(req)) throw unauthorized();
  return { sid: req.authMeta?.sid ?? `u:${req.authUser.id}`, userId: req.authUser.id, exp: req.authMeta?.exp };
}

async function lockStatus(sid: string, userId: number) {
  const [row, failures, locked] = await Promise.all([codeRow(userId), unlockFailures(sid), isSessionLocked(sid)]);
  const kind = row?.quick_code_hash ? row.quick_code_kind ?? "digits" : null;
  return { locked, hasCode: !!kind, kind, attemptsLeft: Math.max(0, MAX_UNLOCK_ATTEMPTS - failures) };
}

router.get("/auth/lock", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const { sid, userId } = sessionOf(req);
  res.json(await lockStatus(sid, userId));
}));

router.post("/auth/lock", lockLimiter, asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const { sid, userId, exp } = sessionOf(req);
  const wasLocked = await isSessionLocked(sid);
  await lockSession(sid, userId, exp);
  if (!wasLocked) await logAudit({ actor: req.authUser!.name, action: "auth.screen_lock", targetType: "user", targetId: String(userId), details: {} });
  res.json(await lockStatus(sid, userId));
}));

const unlockSchema = z.object({ code: z.string().min(1).max(200) });

router.post("/auth/unlock", unlockLimiter, asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const { sid, userId, exp } = sessionOf(req);
  const parsed = unlockSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const actor = req.authUser!.name;
  const audit = (action: string, details: Record<string, unknown> = {}) =>
    logAudit({ actor, action, targetType: "user", targetId: String(userId), details: { ...details, ip: req.ip ?? null } });

  const signOut = async () => {
    await revokeSession(sid, userId, exp);
    await unlockSession(sid);
    await audit("auth.screen_unlock_signed_out", { attempts: MAX_UNLOCK_ATTEMPTS });
    res.setHeader("Cache-Control", "no-store");
    throw new AppError("UNLOCK_SIGNED_OUT");
  };
  // Parallel guesses past the limit never get a verdict.
  if ((await unlockFailures(sid)) >= MAX_UNLOCK_ATTEMPTS) await signOut();

  const row = await codeRow(userId);
  if (!row) throw unauthorized();
  // The quick code; with none set, the account password (auto-lock without a code must not strand anyone).
  const hash = row.quick_code_hash ?? row.password_hash;
  const typed = row.quick_code_hash ? parsed.data.code.normalize("NFC") : parsed.data.code;
  const ok = !!hash && (await verifyPassword(typed, { passwordHash: hash }));
  if (!ok) {
    const outcome = unlockFailureOutcome(await recordUnlockFailure(sid, userId, exp));
    if (outcome.signOut) await signOut();
    await audit("auth.screen_unlock_failed", { attemptsLeft: outcome.attemptsLeft });
    throw new AppError("UNLOCK_CODE_INVALID", undefined, undefined, { attemptsLeft: outcome.attemptsLeft });
  }
  await unlockSession(sid);
  await audit("auth.screen_unlock", { with: row.quick_code_hash ? "quick_code" : "password" });
  // Sliding session: a long lock may have aged the token past the refresh point.
  const token = shouldRefreshToken(req.authMeta?.iat) ? await signToken(req.authUser!, { sid }) : undefined;
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...(token ? { token } : {}) });
}));

router.get("/auth/quick-code", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const row = await codeRow(req.authUser!.id);
  const set = !!row?.quick_code_hash;
  res.json({ set, kind: set ? row?.quick_code_kind ?? "digits" : null, setAt: set ? row?.quick_code_set_at ?? null : null });
}));

const codeSchema = z.object({ code: z.string().max(200) });

router.put("/auth/quick-code", codeLimiter, asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const parsed = codeSchema.safeParse(req.body ?? {});
  const kind = parsed.success ? quickCodeKind(parsed.data.code) : null;
  if (!parsed.success || !kind) throw new AppError("QUICK_CODE_INVALID");
  const me = req.authUser!;
  const before = await codeRow(me.id);
  if (!before) throw unauthorized();
  await pool.query(
    `UPDATE users SET quick_code_hash = $1, quick_code_kind = $2, quick_code_set_at = now() WHERE id = $3`,
    [await hashPassword(parsed.data.code.normalize("NFC")), kind, me.id],
  );
  await logAudit({ actor: me.name, action: before.quick_code_hash ? "auth.quick_code_change" : "auth.quick_code_set", targetType: "user", targetId: String(me.id), details: { kind } });
  res.json({ ok: true, kind });
}));

router.delete("/auth/quick-code", codeLimiter, asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const me = req.authUser!;
  const { rowCount } = await pool.query(
    `UPDATE users SET quick_code_hash = NULL, quick_code_kind = NULL, quick_code_set_at = NULL WHERE id = $1 AND quick_code_hash IS NOT NULL`,
    [me.id],
  );
  if (rowCount) await logAudit({ actor: me.name, action: "auth.quick_code_remove", targetType: "user", targetId: String(me.id), details: {} });
  res.json({ ok: true });
}));

export default router;
