/**
 * People management by a curator (owner policy: curators run their traders; another curator, assignments and the
 * desk's settings are admin's). A curator who was granted users.manage on the desk still may not reset another
 * curator's password, rename, deactivate, demote, unfreeze, restore or reset the sessions of a curator — the same rule
 * as freeze / ban (users.manage.admins). Assignments (whom an «assigned» curator sees) need settings.manage, in the
 * admin console and in the Telegram admin. A rename bumps token_version (the name is signed into the token).
 * The real default matrix decides (curator + the users.manage override); the DB is faked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const ADMIN: Who = { id: 1, name: "Admin A.", role: "admin" };
const CURATOR: Who = { id: 3, name: "Curator C.", role: "curator" };
const OTHER_CURATOR = { id: 4, name: "Curator D.", role: "curator" };
const TRADER = { id: 5, name: "Trader T.", role: "trader" };
let who: Who = CURATOR;

const st = vi.hoisted(() => ({ sql: [] as { sql: string; params: unknown[] }[], banned: false, active: true }));
const USERS = () => [ADMIN, CURATOR, OTHER_CURATOR, TRADER].map((u) => ({ ...u, active: st.active, banned: st.banned, assigned_curator: null }));

function answer(sql: string, params: unknown[] = []) {
  st.sql.push({ sql, params });
  const byId = (id: unknown) => USERS().find((u) => u.id === Number(id));
  if (/FROM users u WHERE u\.id = \$1/.test(sql) || /SELECT role, name(, active)? FROM users WHERE id = \$1/.test(sql)) {
    const u = byId(params[0]);
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }
  if (/^\s*UPDATE users SET .* RETURNING/s.test(sql)) {
    const u = byId(params[params.length - 1]);
    const named = /name = \$1/.test(sql) ? String(params[0]) : u?.name;
    return { rows: u ? [{ ...u, name: named }] : [], rowCount: u ? 1 : 0 };
  }
  if (/SELECT name FROM users WHERE name = \$1 AND active = true/.test(sql)) return { rows: [{ name: params[0] }], rowCount: 1 };
  if (/SELECT name FROM users WHERE name = ANY/.test(sql)) return { rows: (params[0] as string[]).map((name) => ({ name })), rowCount: 1 };
  if (/^\s*UPDATE users SET assigned_curator = \$1, assigned_risk_manager/.test(sql)) return { rows: [], rowCount: 1 };
  if (/^\s*UPDATE users/.test(sql)) return { rows: [], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)),
    connect: vi.fn(async () => ({ query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)), release: vi.fn() })),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../../lib/telegramBot", () => ({ sendMessage: vi.fn(async () => undefined) }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  // The desk granted its curators user management (a sensitive capability, off by default).
  const matrix = actual.buildEffectiveMatrix([{ role: "curator", capability: "users.manage", allowed: true, scope: null }]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix),
    can: vi.fn(can),
    requireCap: vi.fn(async (req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => {
      if (await can(req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: usersRouter } = await import("../users");
const { default: adminConsoleRouter } = await import("../admin-console");
const { default: telegramAdminRouter } = await import("../telegram-admin");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", usersRouter, adminConsoleRouter, telegramAdminRouter);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = CURATOR; st.sql.length = 0; st.banned = false; st.active = true; });

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, json };
}
const bumps = () => st.sql.filter((q) => /token_version = token_version \+ 1/.test(q.sql)).map((q) => q.params[0]);
const writes = () => st.sql.filter((q) => /^\s*UPDATE users/.test(q.sql));

describe("PATCH /users/:id and DELETE /users/:id on a curator", () => {
  it("a curator may not reset another curator's password, demote, deactivate or rename them; admin may", async () => {
    for (const body of [{ password: "a-long-new-password-1" }, { role: "trader" }, { active: false }, { name: "Renamed" }]) {
      const r = await call("PATCH", `/api/users/${OTHER_CURATOR.id}`, body);
      expect([r.status, r.json?.code]).toEqual([403, "ADMIN_ONLY"]);
    }
    expect(writes()).toEqual([]);
    who = ADMIN;
    expect((await call("PATCH", `/api/users/${OTHER_CURATOR.id}`, { role: "trader" })).status).toBe(200);
  });

  it("a curator still manages a trader", async () => {
    expect((await call("PATCH", `/api/users/${TRADER.id}`, { active: false })).status).toBe(200);
  });

  it("DELETE of a curator: curator 403 ADMIN_ONLY, admin 200", async () => {
    const r = await call("DELETE", `/api/users/${OTHER_CURATOR.id}`);
    expect([r.status, r.json?.code]).toEqual([403, "ADMIN_ONLY"]);
    expect(writes()).toEqual([]);
    expect((await call("DELETE", `/api/users/${TRADER.id}`)).status).toBe(200);
    who = ADMIN;
    expect((await call("DELETE", `/api/users/${OTHER_CURATOR.id}`)).status).toBe(200);
  });

  it("a rename bumps token_version (old tokens carry the old name); a no-op field change does not", async () => {
    who = ADMIN;
    expect((await call("PATCH", `/api/users/${TRADER.id}`, { name: "Trader Renamed" })).status).toBe(200);
    expect(bumps()).toEqual([TRADER.id]);
    st.sql.length = 0;
    expect((await call("PATCH", `/api/users/${TRADER.id}`, { name: TRADER.name })).status).toBe(200);
    expect(bumps()).toEqual([]);
  });
});

describe("admin console actions on a curator", () => {
  it("unfreeze / restore / sessions reset / role: curator 403 ADMIN_ONLY, admin passes", async () => {
    st.banned = true;
    expect((await call("POST", `/api/admin/console/people/${OTHER_CURATOR.id}/unfreeze`, { reason: "back to work" })).json?.code).toBe("ADMIN_ONLY");
    st.banned = false; st.active = false;
    expect((await call("POST", `/api/admin/console/people/${OTHER_CURATOR.id}/restore`, { reason: "back to work" })).json?.code).toBe("ADMIN_ONLY");
    st.active = true;
    expect((await call("POST", `/api/admin/console/people/${OTHER_CURATOR.id}/sessions/reset`, { reason: "lost phone" })).json?.code).toBe("ADMIN_ONLY");
    expect((await call("POST", `/api/admin/console/people/${OTHER_CURATOR.id}/role`, { role: "trader", reason: "demote" })).json?.code).toBe("ADMIN_ONLY");
    expect(writes()).toEqual([]);
    expect(bumps()).toEqual([]);
    who = ADMIN;
    expect((await call("POST", `/api/admin/console/people/${OTHER_CURATOR.id}/role`, { role: "trader", reason: "demote" })).status).toBe(200);
  });

  it("the existing specific codes stay for freeze / archive; own sessions and traders stay open to a curator", async () => {
    expect((await call("POST", `/api/admin/console/people/${OTHER_CURATOR.id}/freeze`, { reason: "pause" })).json?.code).toBe("ADMIN_ONLY_FREEZE_CURATOR");
    expect((await call("POST", `/api/admin/console/people/${CURATOR.id}/sessions/reset`, { reason: "my phone" })).status).toBe(200);
    expect((await call("POST", `/api/admin/console/people/${TRADER.id}/sessions/reset`, { reason: "lost phone" })).status).toBe(200);
  });

  it("assigning a curator (single and bulk) needs settings.manage", async () => {
    const one = await call("POST", `/api/admin/console/people/${TRADER.id}/curator`, { curator: CURATOR.name, reason: "new group" });
    expect([one.status, one.json?.details?.capability]).toEqual([403, "settings.manage"]);
    const bulk = await call("POST", "/api/admin/console/people/bulk", { ids: [TRADER.id], action: "curator", curator: CURATOR.name, reason: "new group" });
    expect([bulk.status, bulk.json?.details?.capability]).toEqual([403, "settings.manage"]);
    expect(writes()).toEqual([]);
    who = ADMIN;
    expect((await call("POST", `/api/admin/console/people/${TRADER.id}/curator`, { curator: CURATOR.name, reason: "new group" })).status).toBe(200);
  });

  it("bulk: other actions keep users.manage; a curator row in the selection is skipped with ADMIN_ONLY", async () => {
    const r = await call("POST", "/api/admin/console/people/bulk", { ids: [TRADER.id, OTHER_CURATOR.id], action: "sessions", reason: "rotate" });
    expect(r.status).toBe(200);
    expect(r.json.done).toEqual([TRADER.name]);
    expect(r.json.skipped.map((s: { code: string }) => s.code)).toEqual(["ADMIN_ONLY"]);
  });
});

describe("PATCH /telegram/assignments/:name", () => {
  it("curator (even with users.manage) 403 naming settings.manage; admin 200", async () => {
    const r = await call("PATCH", `/api/telegram/assignments/${encodeURIComponent(TRADER.name)}`, { assigned_curator: CURATOR.name });
    expect([r.status, r.json?.details?.capability]).toEqual([403, "settings.manage"]);
    expect(writes()).toEqual([]);
    who = ADMIN;
    expect((await call("PATCH", `/api/telegram/assignments/${encodeURIComponent(TRADER.name)}`, { assigned_curator: CURATOR.name })).status).toBe(200);
  });
});
