/**
 * Screen lock «Заблокировать» end to end through the real app (src/app.ts) with the DB mocked: users (quick code,
 * password), auth_session_locks, auth_revoked_sessions. Tokens are signed directly (lib/auth signToken), never via
 * /auth/login. Covers the server gate (423 while locked, allowlist), unlock (correct / wrong / 5-strike sign-out /
 * password fallback), the per-member rate limit, and the quick-code endpoints.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";

process.env.JWT_SECRET = "vitest-only-secret-for-screen-lock";

type U = { id: number; name: string; role: string; token_version: number; password_hash: string | null; quick_code_hash: string | null; quick_code_kind: string | null };
const users: U[] = [];
const revoked = new Set<string>();
const locks = new Map<string, { user_id: number; failures: number }>();
const audits: { action: string; details?: unknown }[] = [];

vi.mock("@workspace/db", () => ({
  db: { insert: () => ({ values: async () => undefined }) },
  setPoolErrorHandler: () => undefined,
  pool: {
    connect: async () => { throw new Error("no pg in tests"); },
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const none = { rows: [], rowCount: 0 };
      const user = () => users.find((x) => x.id === params[params.length - 1] || x.id === params[0]);
      if (/SELECT token_version FROM users WHERE id = \$1/.test(sql)) {
        const u = users.find((x) => x.id === params[0]);
        return u ? { rows: [{ token_version: u.token_version }], rowCount: 1 } : none;
      }
      if (/SELECT 1 FROM auth_revoked_sessions/.test(sql)) return revoked.has(String(params[0])) ? { rows: [{}], rowCount: 1 } : none;
      if (/INSERT INTO auth_revoked_sessions/.test(sql)) { revoked.add(String(params[0])); return { rows: [], rowCount: 1 }; }
      if (/SELECT 1 FROM auth_session_locks/.test(sql)) return locks.has(String(params[0])) ? { rows: [{}], rowCount: 1 } : none;
      if (/INSERT INTO auth_session_locks[\s\S]*failures \+ 1/.test(sql)) {
        const r = locks.get(String(params[0])) ?? { user_id: Number(params[1]), failures: 0 };
        r.failures += 1;
        locks.set(String(params[0]), r);
        return { rows: [{ failures: r.failures }], rowCount: 1 };
      }
      if (/INSERT INTO auth_session_locks/.test(sql)) {
        if (!locks.has(String(params[0]))) locks.set(String(params[0]), { user_id: Number(params[1]), failures: 0 });
        return { rows: [], rowCount: 1 };
      }
      if (/DELETE FROM auth_session_locks/.test(sql)) { locks.delete(String(params[0])); return { rows: [], rowCount: 1 }; }
      if (/SELECT failures FROM auth_session_locks/.test(sql)) {
        const r = locks.get(String(params[0]));
        return r ? { rows: [{ failures: r.failures }], rowCount: 1 } : none;
      }
      if (/SELECT quick_code_hash, quick_code_kind, quick_code_set_at, password_hash FROM users/.test(sql)) {
        const u = users.find((x) => x.id === params[0]);
        return u ? { rows: [{ ...u, quick_code_set_at: u.quick_code_hash ? new Date() : null }], rowCount: 1 } : none;
      }
      if (/UPDATE users SET quick_code_hash = NULL/.test(sql)) {
        const u = users.find((x) => x.id === params[0]);
        if (!u?.quick_code_hash) return none;
        u.quick_code_hash = null; u.quick_code_kind = null;
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE users SET quick_code_hash = \$1/.test(sql)) {
        const u = user();
        if (u) { u.quick_code_hash = String(params[0]); u.quick_code_kind = String(params[1]); }
        return { rows: [], rowCount: u ? 1 : 0 };
      }
      return none;
    }),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async (e: { action: string; details?: unknown }) => { audits.push(e); }) }));

const { signToken, signGuestToken } = await import("../../lib/auth");
const { clearSessionCache } = await import("../../lib/security/sessions");
const { clearScreenLockCache, allowedWhileLocked, quickCodeKind, unlockFailureOutcome, MAX_UNLOCK_ATTEMPTS } = await import("../../lib/security/screenLock");
const { UNLOCK_LIMIT } = await import("../screen-lock");
const { default: app } = await import("../../app");

let server: http.Server;
let base = "";
let ip = 0;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = { "X-Forwarded-For": `203.0.113.${++ip % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, json };
}

const zakir = { id: 1, name: "Закир", role: "admin" };
const anton = { id: 2, name: "Антон", role: "trader" };
const lena = { id: 3, name: "Лена", role: "trader" };

beforeAll(async () => {
  const pin = await bcrypt.hash("pin-2468", 4);
  users.push(
    { ...zakir, token_version: 0, password_hash: pin, quick_code_hash: await bcrypt.hash("1357", 4), quick_code_kind: "digits" },
    { ...anton, token_version: 0, password_hash: pin, quick_code_hash: null, quick_code_kind: null },
    { ...lena, token_version: 0, password_hash: pin, quick_code_hash: await bcrypt.hash("0000", 4), quick_code_kind: "digits" },
  );
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { locks.clear(); revoked.clear(); audits.length = 0; clearSessionCache(); clearScreenLockCache(); });

describe("screen lock policy (pure)", () => {
  it("quick code: 4–8 digits or a 6–32 character phrase", () => {
    expect(quickCodeKind("1234")).toBe("digits");
    expect(quickCodeKind("12345678")).toBe("digits");
    expect(quickCodeKind("123")).toBeNull();
    expect(quickCodeKind("123456789")).toBeNull();
    expect(quickCodeKind("tiger lily")).toBe("phrase");
    expect(quickCodeKind("abc")).toBeNull();
    expect(quickCodeKind(" padded ")).toBeNull();
    expect(quickCodeKind("x".repeat(33))).toBeNull();
    expect(quickCodeKind(1234)).toBeNull();
  });

  it("only unlock / lock / logout / permissions-me / healthz pass the gate while locked", () => {
    for (const [m, p] of [["POST", "/auth/unlock"], ["POST", "/auth/lock"], ["GET", "/auth/lock"], ["POST", "/auth/logout"], ["GET", "/permissions/me"], ["HEAD", "/healthz"], ["OPTIONS", "/trades"]]) {
      expect(allowedWhileLocked(m, p), `${m} ${p}`).toBe(true);
    }
    for (const [m, p] of [["GET", "/trades"], ["GET", "/auth/me"], ["GET", "/auth/quick-code"], ["PUT", "/auth/quick-code"], ["POST", "/auth/logout-all"], ["GET", "/notifications/count"]]) {
      expect(allowedWhileLocked(m, p), `${m} ${p}`).toBe(false);
    }
  });

  it("five wrong answers end the session", () => {
    expect(unlockFailureOutcome(1)).toEqual({ attemptsLeft: 4, signOut: false });
    expect(unlockFailureOutcome(MAX_UNLOCK_ATTEMPTS)).toEqual({ attemptsLeft: 0, signOut: true });
  });
});

describe("server lock gate", () => {
  it("a locked token gets 423 on data routes and passes the allowlist; another session is untouched", async () => {
    const pc = await signToken(zakir);
    const phone = await signToken(zakir);
    const lock = await call("POST", "/auth/lock", pc);
    expect(lock.status).toBe(200);
    expect(lock.json).toMatchObject({ locked: true, hasCode: true, kind: "digits", attemptsLeft: 5 });
    const me = await call("GET", "/auth/me", pc);
    expect(me.status).toBe(423);
    expect(me.json.code).toBe("SESSION_LOCKED");
    expect((await call("GET", "/trades", pc)).status).toBe(423);
    expect((await call("GET", "/auth/quick-code", pc)).status).toBe(423);
    expect((await call("GET", "/auth/lock", pc)).json.locked).toBe(true);
    expect((await call("GET", "/permissions/me", pc)).status).not.toBe(423);
    expect((await call("GET", "/healthz", pc)).status).not.toBe(423);
    expect((await call("GET", "/auth/me", phone)).status).toBe(200);
    expect(audits.map((a) => a.action)).toContain("auth.screen_lock");
  });

  it("logout still works while locked", async () => {
    const t = await signToken(zakir);
    await call("POST", "/auth/lock", t);
    expect((await call("POST", "/auth/logout", t)).status).toBe(200);
    expect((await call("GET", "/auth/me", t)).status).toBe(401);
  });

  it("guests cannot lock (no session row)", async () => {
    expect((await call("POST", "/auth/lock", signGuestToken())).status).toBe(403);
  });
});

describe("POST /auth/unlock", () => {
  it("the right quick code unlocks and data routes answer again", async () => {
    const t = await signToken(zakir);
    await call("POST", "/auth/lock", t);
    const r = await call("POST", "/auth/unlock", t, { code: "1357" });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect((await call("GET", "/auth/me", t)).status).toBe(200);
    expect(locks.size).toBe(0);
    expect(audits.find((a) => a.action === "auth.screen_unlock")?.details).toMatchObject({ with: "quick_code" });
  });

  it("a wrong code answers 403 with the attempts left and keeps the lock", async () => {
    const t = await signToken(zakir);
    await call("POST", "/auth/lock", t);
    const r = await call("POST", "/auth/unlock", t, { code: "9999" });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ code: "UNLOCK_CODE_INVALID", details: { attemptsLeft: 4 } });
    expect((await call("GET", "/auth/me", t)).status).toBe(423);
    expect((await call("GET", "/auth/lock", t)).json.attemptsLeft).toBe(4);
    // The account password is not accepted once a quick code is set.
    expect((await call("POST", "/auth/unlock", t, { code: "pin-2468" })).status).toBe(403);
  });

  it("the 5th wrong answer signs this session out (revoked), the next request is 401", async () => {
    const t = await signToken(zakir);
    await call("POST", "/auth/lock", t);
    for (let i = 1; i < MAX_UNLOCK_ATTEMPTS; i++) expect((await call("POST", "/auth/unlock", t, { code: "0001" })).json.details.attemptsLeft).toBe(5 - i);
    const last = await call("POST", "/auth/unlock", t, { code: "0001" });
    expect(last.status).toBe(401);
    expect(last.json.code).toBe("UNLOCK_SIGNED_OUT");
    expect(revoked.size).toBe(1);
    expect(locks.size).toBe(0);
    expect((await call("GET", "/auth/me", t)).status).toBe(401);
    expect((await call("POST", "/auth/unlock", t, { code: "1357" })).status).toBe(401);
    expect(audits.map((a) => a.action)).toContain("auth.screen_unlock_signed_out");
  });

  it("without a quick code the account password unlocks", async () => {
    const t = await signToken(anton);
    const lock = await call("POST", "/auth/lock", t);
    expect(lock.json).toMatchObject({ hasCode: false, kind: null });
    expect((await call("POST", "/auth/unlock", t, { code: "1357" })).status).toBe(403);
    const ok = await call("POST", "/auth/unlock", t, { code: "pin-2468" });
    expect(ok.status).toBe(200);
    expect(audits.find((a) => a.action === "auth.screen_unlock")?.details).toMatchObject({ with: "password" });
  });

  it("a session that was never locked on the server still needs the code (offline lock)", async () => {
    const t = await signToken(zakir);
    expect((await call("POST", "/auth/unlock", t, { code: "nope" })).status).toBe(403);
    expect((await call("GET", "/auth/me", t)).status).toBe(423); // a failed attempt locks it
    expect((await call("POST", "/auth/unlock", t, { code: "1357" })).status).toBe(200);
  });

  it("an empty body is a validation error, not an attempt", async () => {
    const t = await signToken(zakir);
    await call("POST", "/auth/lock", t);
    expect((await call("POST", "/auth/unlock", t, {})).status).toBe(400);
    expect((await call("GET", "/auth/lock", t)).json.attemptsLeft).toBe(5);
  });

  it(`rate limit: ${UNLOCK_LIMIT} wrong answers per member per 15 min across sessions → 429`, async () => {
    let wrong = 0;
    let limited: { status: number; json: any } | null = null;
    while (!limited && wrong < UNLOCK_LIMIT + 5) {
      const t = await signToken(lena); // a fresh session every 4 tries, so no session reaches its 5th
      for (let i = 0; i < 4 && !limited; i++) {
        const r = await call("POST", "/auth/unlock", t, { code: "9999" });
        if (r.status === 429) limited = r;
        else { expect(r.status).toBe(403); wrong++; }
      }
    }
    expect(wrong).toBe(UNLOCK_LIMIT);
    expect(limited?.json.code).toBe("RATE_LIMITED");
  });
});

describe("quick code endpoints", () => {
  it("set, read, change and remove — the code itself never comes back", async () => {
    const t = await signToken(anton);
    expect((await call("GET", "/auth/quick-code", t)).json).toMatchObject({ set: false, kind: null });
    expect((await call("PUT", "/auth/quick-code", t, { code: "12" })).json.code).toBe("QUICK_CODE_INVALID");
    expect((await call("PUT", "/auth/quick-code", t, { code: "2580" })).json).toEqual({ ok: true, kind: "digits" });
    const got = await call("GET", "/auth/quick-code", t);
    expect(got.json).toMatchObject({ set: true, kind: "digits" });
    expect(JSON.stringify(got.json)).not.toContain("2580");
    expect(users[1].quick_code_hash).not.toBe("2580");
    expect((await call("PUT", "/auth/quick-code", t, { code: "morning coffee" })).json.kind).toBe("phrase");
    await call("POST", "/auth/lock", t);
    expect((await call("POST", "/auth/unlock", t, { code: "morning coffee" })).status).toBe(200);
    expect((await call("DELETE", "/auth/quick-code", t)).status).toBe(200);
    expect((await call("GET", "/auth/quick-code", t)).json.set).toBe(false);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["auth.quick_code_set", "auth.quick_code_change", "auth.quick_code_remove"]));
  });
});
