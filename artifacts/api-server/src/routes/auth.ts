import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { timingSafeEqual } from "node:crypto";
import { signToken, signGuestToken, verifyPassword, bumpTokenVersion, hashPassword, isGuest, GUEST_NAME, GUEST_ROLE, GUEST_USER_ID } from "../lib/auth";

/**
 * Admin secret for /auth/init-passwords. No hard-coded fallback: if ADMIN_PASSWORD
 * is not configured, the endpoint is disabled (503). Existing users keep their
 * bcrypt hashes and log in exactly as before.
 */
function adminPasswordMatches(input: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof input !== "string" || input.length === 0) return false;
  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const router: IRouter = Router();

const loginSchema = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

router.post("/auth/login", asyncHandler(async (req, res): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректный запрос", code: "VALIDATION", details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    return;
  }
  const { name, password } = parsed.data;
  const { rows } = await pool.query<{ id: number; name: string; password_hash: string | null; role: string; active: boolean; banned: boolean | null }>(
    `SELECT id, name, password_hash, role, active, COALESCE(banned, false) AS banned
     FROM users WHERE name = $1 LIMIT 1`,
    [name],
  );
  const user = rows[0];
  if (!user || !user.active) { res.status(401).json({ error: "Неверное имя или пароль", code: "INVALID_CREDENTIALS" }); return; }
  if (user.banned) { res.status(403).json({ error: "Доступ заблокирован. Обратитесь к куратору", code: "BANNED" }); return; }
  const ok = await verifyPassword(password, { passwordHash: user.password_hash });
  if (!ok) { res.status(401).json({ error: "Неверное имя или пароль", code: "INVALID_CREDENTIALS" }); return; }
  const token = await signToken({ id: user.id, name: user.name, role: user.role });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
}));

/**
 * Guest mode: a short-lived (12h) read-only token for a synthetic user without a users row.
 * The global gate rejects every mutation from it with 403; scopeTrader() gives it an empty
 * personal scope. Public (no token needed) — this is how an anonymous visitor gets in.
 */
router.post("/auth/guest", asyncHandler(async (_req, res): Promise<void> => {
  const token = signGuestToken();
  res.json({ token, user: { id: GUEST_USER_ID, name: GUEST_NAME, role: GUEST_ROLE }, expiresInSec: 12 * 3600 });
}));

router.get("/auth/me", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) { res.status(401).json({ error: "Требуется вход", code: "AUTH_REQUIRED" }); return; }
  res.json({ user: req.authUser, guest: isGuest(req) });
}));

router.post("/auth/logout", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) { res.status(401).json({ error: "Требуется вход", code: "AUTH_REQUIRED" }); return; }
  // Guest tokens have no users row / token_version — the client simply drops the token.
  if (!isGuest(req)) await bumpTokenVersion(req.authUser.id);
  res.json({ ok: true });
}));

/**
 * Initial passwords are never stored in source. They come either from the request body
 * (`passwords: { [name]: password }`) or from the INIT_PASSWORDS env var (JSON object).
 * Only users whose password_hash IS NULL are touched; existing hashes are never changed.
 */
const initPasswordsSchema = z.object({
  adminPassword: z.string().min(1).max(200),
  passwords: z.record(z.string().trim().min(1).max(100), z.string().min(4).max(200)).optional(),
});

function readEnvInitPasswords(): Record<string, string> {
  const raw = process.env.INIT_PASSWORDS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length >= 4 && k.trim()) out[k.trim()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

router.post("/auth/init-passwords", asyncHandler(async (req, res): Promise<void> => {
  if (!process.env.ADMIN_PASSWORD) {
    res.status(503).json({ error: "Инициализация паролей отключена (ADMIN_PASSWORD не настроен)" });
    return;
  }
  const parsed = initPasswordsSchema.safeParse(req.body ?? {});
  if (!parsed.success || !adminPasswordMatches(parsed.data.adminPassword)) {
    res.status(403).json({ error: "Нужен пароль администратора", code: "FORBIDDEN" });
    return;
  }
  const source = parsed.data.passwords ?? readEnvInitPasswords();
  const entries = Object.entries(source);
  if (entries.length === 0) {
    res.status(400).json({ error: "Пароли не переданы (body.passwords или переменная INIT_PASSWORDS)" });
    return;
  }
  const results: { name: string; updated: boolean }[] = [];
  for (const [name, password] of entries) {
    const hash = await hashPassword(password);
    const { rowCount } = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE name = $2 AND password_hash IS NULL`,
      [hash, name]
    );
    results.push({ name, updated: (rowCount ?? 0) > 0 });
  }
  res.json({ ok: true, results });
}));

export default router;
