/**
 * Wave 1, item 1.10 — «Выйти» signs out this device only; «Выйти на других устройствах» (settings) signs out the rest.
 * End to end through the real app (src/app.ts) with the DB mocked: users.token_version + auth_revoked_sessions.
 * Tokens are signed directly (lib/auth signToken) — no /auth/login call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "vitest-only-secret-for-auth-sessions";

type U = { id: number; name: string; role: string; token_version: number };
const users: U[] = [];
const revoked = new Map<string, number>();

vi.mock("@workspace/db", () => ({
  db: { insert: () => ({ values: async () => undefined }) },
  setPoolErrorHandler: () => undefined,
  pool: {
    connect: async () => { throw new Error("no pg in tests"); },
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/SELECT token_version FROM users WHERE id = \$1/.test(sql)) {
        const u = users.find((x) => x.id === params[0]);
        return { rows: u ? [{ token_version: u.token_version }] : [], rowCount: u ? 1 : 0 };
      }
      if (/UPDATE users SET token_version = token_version \+ 1/.test(sql)) {
        const u = users.find((x) => x.id === params[0]);
        if (u) u.token_version++;
        return { rows: [], rowCount: u ? 1 : 0 };
      }
      if (/SELECT 1 FROM auth_revoked_sessions WHERE sid = \$1/.test(sql)) {
        return revoked.has(String(params[0])) ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (/INSERT INTO auth_revoked_sessions/.test(sql)) {
        if (!revoked.has(String(params[0]))) revoked.set(String(params[0]), Number(params[1]));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));

const { signToken, signGuestToken } = await import("../../lib/auth");
const { clearSessionCache, sessionKey } = await import("../../lib/security/sessions");
const { default: app } = await import("../../app");

let server: http.Server;
let base = "";
let ipCounter = 0;

async function call(method: string, path: string, token?: string) {
  const headers: Record<string, string> = { "X-Forwarded-For": `198.51.100.${++ipCounter % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}/api${path}`, { method, headers });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, json };
}

const zakir = { id: 1, name: "Закир", role: "trader" };

beforeAll(async () => {
  users.push({ ...zakir, token_version: 0 }, { id: 2, name: "Антон", role: "curator", token_version: 0 });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { revoked.clear(); clearSessionCache(); });

describe("per-session sign-out (menu «Выйти»)", () => {
  it("every sign-in gets its own session id", async () => {
    const a = jwt.decode(await signToken(zakir)) as { sid?: string };
    const b = jwt.decode(await signToken(zakir)) as { sid?: string };
    expect(a.sid).toBeTruthy();
    expect(a.sid).not.toBe(b.sid);
  });

  it("logout kills only the current token: 401 for it, the phone's session keeps working", async () => {
    const pc = await signToken(zakir);
    const phone = await signToken(zakir);
    expect((await call("GET", "/auth/me", pc)).status).toBe(200);
    expect((await call("POST", "/auth/logout", pc)).status).toBe(200);
    expect((await call("GET", "/auth/me", pc)).status).toBe(401);
    expect((await call("GET", "/auth/me", phone)).status).toBe(200);
    expect(users[0].token_version).toBe(0); // no global bump
  });

  it("the sliding refresh keeps the session id, so «Выйти» also covers the refreshed token", async () => {
    const t = await signToken(zakir);
    const sid = (jwt.decode(t) as { sid: string }).sid;
    const fresh = await signToken(zakir, { sid });
    expect((jwt.decode(fresh) as { sid: string }).sid).toBe(sid);
    await call("POST", "/auth/logout", fresh);
    expect((await call("GET", "/auth/me", t)).status).toBe(401);
  });

  it("a token issued before sessions (no sid) can be signed out on its own", async () => {
    const legacy = jwt.sign({ sub: 1, name: "Закир", role: "trader", tv: 0 }, process.env.JWT_SECRET!, { expiresIn: 3600, algorithm: "HS256" });
    const other = await signToken(zakir);
    expect((await call("POST", "/auth/logout", legacy)).status).toBe(200);
    expect(revoked.has(sessionKey(undefined, legacy))).toBe(true);
    expect((await call("GET", "/auth/me", legacy)).status).toBe(401);
    expect((await call("GET", "/auth/me", other)).status).toBe(200);
  });

  it("guest logout stays a no-op on the server (guest mode intact)", async () => {
    const g = signGuestToken();
    const r = await call("POST", "/auth/logout", g);
    expect(r.status).toBe(200);
    expect(revoked.size).toBe(0);
  });
});

describe("«Выйти на других устройствах» (settings)", () => {
  it("bumps token_version: every old token 401, the caller gets a fresh working token", async () => {
    const pc = await signToken(zakir);
    const phone = await signToken(zakir);
    const r = await call("POST", "/auth/logout-all", pc);
    expect(r.status).toBe(200);
    expect(typeof r.json.token).toBe("string");
    expect((await call("GET", "/auth/me", pc)).status).toBe(401);
    expect((await call("GET", "/auth/me", phone)).status).toBe(401);
    expect((await call("GET", "/auth/me", r.json.token)).status).toBe(200);
  });

  it("guests and anonymous callers cannot use it", async () => {
    expect((await call("POST", "/auth/logout-all", signGuestToken())).status).toBe(403);
    expect((await call("POST", "/auth/logout-all")).status).toBe(401);
  });
});
