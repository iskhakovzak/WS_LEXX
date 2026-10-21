/**
 * Wave 0 / 0.3 — Telegram admin routes and the Academy ladder on the permissions matrix, plus audit lines:
 *  - broadcast + unlink: telegram.broadcast (admin by default); broadcast goes to active, not banned members only;
 *  - assignments: read with users.read.team (no raw chat ids), changed with users.manage;
 *  - ladder stage names / criteria / direct stage change / demo seed: settings.manage (admin-only);
 *  - PATCH /users/:id (PIN reset, role, deactivation, rename) and DELETE /users/:id write the audit log.
 * Route × role: trader / curator (default caps) / admin. DB, Telegram and audit are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const TRADER: Who = { id: 5, name: "Trader T.", role: "trader" };
const CURATOR: Who = { id: 3, name: "Curator C.", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin A.", role: "admin" };
let who: Who = TRADER;
const calls: string[] = [];

vi.mock("@workspace/db", () => {
  const answer = async (sql: string) => {
    calls.push(sql);
    if (/SELECT name, telegram_chat_id FROM users/.test(sql)) return { rows: [{ name: "Trader T.", telegram_chat_id: "111" }], rowCount: 1 };
    if (/AS telegram_linked/.test(sql)) return { rows: [{ name: "Trader T.", role: "trader", active: true, telegram_linked: true }], rowCount: 1 };
    if (/SELECT name FROM users WHERE name = ANY/.test(sql)) return { rows: [{ name: "Curator C." }], rowCount: 1 };
    if (/SELECT role, name, active FROM users WHERE id/.test(sql) || /SELECT role, name FROM users WHERE id/.test(sql)) return { rows: [{ role: "trader", name: "Trader T.", active: true }], rowCount: 1 };
    if (/^\s*UPDATE users SET .*RETURNING/s.test(sql)) return { rows: [{ id: 5, name: "Trader T.", role: "trader", active: true }], rowCount: 1 };
    if (/^\s*UPDATE users/.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return {
    db: {},
    pool: {
      query: vi.fn(answer),
      connect: vi.fn(async () => ({ query: vi.fn(answer), release: vi.fn() })),
    },
  };
});
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const matrix = actual.buildEffectiveMatrix([]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    can: vi.fn(can),
    requireCap: vi.fn(async (req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => {
      if (await can(req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../../lib/audit", () => audit);
const tg = vi.hoisted(() => ({ sendMessage: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../lib/telegramBot", async (orig) => ({ ...(await orig<typeof import("../../lib/telegramBot")>()), ...tg }));
vi.mock("../../lib/notifyUtils", () => ({
  notifyTraderTelegram: vi.fn(), notifyPublicComment: vi.fn(), applyIdeaReview: vi.fn(), getSiteUrl: () => "https://x",
  notifyUser: vi.fn(async () => 1), notifyUsers: vi.fn(async () => undefined), assignedStaffOf: vi.fn(async () => []),
}));
vi.mock("../../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../lib/auth")>()),
  viewerRole: vi.fn(async () => who.role),
  bumpTokenVersion: vi.fn(async () => undefined),
}));
vi.mock("../../lib/security/loginGuard", () => ({ lockoutStore: () => ({ clearUser: vi.fn(async () => undefined) }) }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: telegramRouter } = await import("../telegram");
const { default: academyRouter } = await import("../academy-path");
const { default: usersRouter } = await import("../users");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    next();
  });
  app.use("/api", telegramRouter);
  app.use("/api", academyRouter);
  app.use("/api", usersRouter);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = TRADER;
  calls.length = 0;
  vi.clearAllMocks();
});

async function call(as: Who, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  who = as;
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const statuses = async (method: string, path: string, body?: unknown) => [
  (await call(TRADER, method, path, body)).status,
  (await call(CURATOR, method, path, body)).status,
  (await call(ADMIN, method, path, body)).status,
];
const auditActions = () => audit.logAudit.mock.calls.map((c) => (c as unknown as [{ action: string }])[0].action);

describe("Telegram admin routes", () => {
  it("broadcast: trader 403, curator 403, admin 200 — active, not banned members only; audited", async () => {
    expect(await statuses("POST", "/api/telegram/broadcast", { message: "Desk update" })).toEqual([403, 403, 200]);
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    const q = calls.find((s) => /SELECT name, telegram_chat_id FROM users/.test(s))!;
    expect(q).toMatch(/active = true/);
    expect(q).toMatch(/COALESCE\(banned, false\) = false/);
    expect(auditActions()).toEqual(["telegram.broadcast"]);
  });

  it("force unlink: trader 403, curator 403, admin 200 (audited)", async () => {
    expect(await statuses("DELETE", "/api/telegram/admin/disconnect/Trader%20T.")).toEqual([403, 403, 200]);
    expect(auditActions()).toEqual(["telegram.unlink"]);
  });

  it("assignments list: trader 403, curator 200, admin 200 — no raw chat ids", async () => {
    expect(await statuses("GET", "/api/telegram/assignments")).toEqual([403, 200, 200]);
    const q = calls.find((s) => /AS telegram_linked/.test(s))!;
    expect(q).not.toMatch(/SELECT name, role, active, telegram_chat_id/);
    expect((await call(ADMIN, "GET", "/api/telegram/assignments")).json[0]).not.toHaveProperty("telegram_chat_id");
  });

  it("re-assigning curator / risk / mentor: trader 403, curator 403 (users.manage), admin 200 (audited)", async () => {
    const body = { assigned_curator: "Curator C.", assigned_risk_manager: null, assigned_mentor: null };
    expect(await statuses("PATCH", "/api/telegram/assignments/Trader%20T.", body)).toEqual([403, 403, 200]);
    expect(calls.filter((s) => /^\s*UPDATE users SET assigned_curator/.test(s))).toHaveLength(1);
    expect(auditActions()).toEqual(["user.assignments.update"]);
  });
});

describe("Academy ladder is desk configuration (settings.manage)", () => {
  it("stage names, criteria, direct stage change, demo seed: trader 403, curator 403, admin passes the gate", async () => {
    // Empty / invalid bodies: an admin reaches validation (400), the others stop at the gate (403).
    expect(await statuses("PUT", "/api/academy/path/stages", [])).toEqual([403, 403, 400]);
    expect(await statuses("PUT", "/api/academy/path/criteria", { not: "a list" })).toEqual([403, 403, 400]);
    expect(await statuses("POST", "/api/academy/path/assign", {})).toEqual([403, 403, 400]);
    const seed = await call(CURATOR, "POST", "/api/academy/path/seed-demo", {});
    expect([seed.status, seed.json.details]).toEqual([403, { capability: "settings.manage" }]);
  });
});

describe("people changes are audited", () => {
  it("PIN reset / role / deactivation: trader 403, curator 403 (users.manage), admin 200 with an audit row", async () => {
    expect(await statuses("PATCH", "/api/users/5", { password: "Zx9!kq2Lm#7pVw" })).toEqual([403, 403, 200]);
    const [entry] = audit.logAudit.mock.calls.map((c) => (c as unknown as [{ action: string; details: Record<string, unknown> }])[0]);
    expect(entry).toMatchObject({ actor: "Admin A.", action: "user.update", targetId: "5", details: { name: "Trader T.", secretReset: true } });
    expect(JSON.stringify(entry)).not.toContain("Zx9!kq2Lm#7pVw");
  });

  it("deactivation via DELETE is audited", async () => {
    expect(await statuses("DELETE", "/api/users/5")).toEqual([403, 403, 200]);
    expect(auditActions()).toEqual(["user.deactivate"]);
  });
});
