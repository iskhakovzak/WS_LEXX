/**
 * routes/usage.ts — POST /usage/batch (any member, ≤ 50 events, unknown keys dropped, the switch usage.enabled) and
 * GET /admin/usage (usage.read: admins only).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest"; guest?: boolean };
const TRADER: Who = { id: 130, name: "Кирилл Б.", role: "trader" };
const CURATOR: Who = { id: 123, name: "Ольга Н.", role: "curator" };
const ADMIN: Who = { id: 121, name: "Дмитрий К.", role: "admin" };
const GUEST: Who = { id: 0, name: "guest", role: "guest", guest: true };
let who: Who = TRADER;

const inserts = vi.hoisted(() => [] as { sql: string; params: unknown[] }[]);
vi.mock("@workspace/db", () => {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO usage_events/.test(sql)) {
      inserts.push({ sql, params });
      return { rows: [], rowCount: (params[3] as unknown[]).length };
    }
    return { rows: [], rowCount: 0 };
  });
  return { db: {}, pool: { query, connect: vi.fn(async () => ({ query, release: () => undefined })) } };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../usage");
const { errorMiddleware } = await import("../../lib/http");
const { __loadSettingsCache } = await import("../../lib/settings/registry");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    (req as unknown as { permActor: unknown }).permActor = { id: who.id, name: who.name, role: who.role, guest: !!who.guest, wards: [] };
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = TRADER; inserts.length = 0; __loadSettingsCache({}); });

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

describe("POST /usage/batch", () => {
  it("stores normalised views and allow-listed actions, drops the rest", async () => {
    const r = await call("POST", "/api/usage/batch", { events: [
      { kind: "view", key: "/trades/42?trader=X" },
      { kind: "action", key: "playbook.today" },
      { kind: "action", key: "rm.rf" },
      { kind: "view", key: "javascript:alert(1)" },
    ] });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ accepted: 2, dropped: 2, enabled: true });
    expect(inserts).toHaveLength(1);
    const p = inserts[0]!.params;
    expect(p.slice(0, 3)).toEqual([130, "Кирилл Б.", "trader"]);
    expect(p[3]).toEqual(["view", "action"]);
    expect(p[4]).toEqual(["/trades/:id", "playbook.today"]);
  });
  it("rejects more than 50 events", async () => {
    const events = Array.from({ length: 51 }, () => ({ kind: "view", key: "/" }));
    const r = await call("POST", "/api/usage/batch", { events });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("VALIDATION");
    expect(inserts).toHaveLength(0);
  });
  it("an empty or fully dropped batch writes nothing", async () => {
    expect((await call("POST", "/api/usage/batch", { events: [] })).json).toEqual({ accepted: 0, dropped: 0, enabled: true });
    expect((await call("POST", "/api/usage/batch", { events: [{ kind: "action", key: "nope" }] })).json).toEqual({ accepted: 0, dropped: 1, enabled: true });
    expect(inserts).toHaveLength(0);
  });
  it("stores nothing while usage.enabled is off", async () => {
    __loadSettingsCache({ "usage.enabled": false });
    const r = await call("POST", "/api/usage/batch", { events: [{ kind: "view", key: "/" }] });
    expect(r.json).toEqual({ accepted: 0, dropped: 1, enabled: false });
    expect(inserts).toHaveLength(0);
  });
  it("guests are never tracked", async () => {
    who = GUEST;
    const r = await call("POST", "/api/usage/batch", { events: [{ kind: "view", key: "/" }] });
    expect(r.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });
});

describe("GET /admin/usage", () => {
  it("is admin-only (usage.read)", async () => {
    who = CURATOR;
    expect((await call("GET", "/api/admin/usage")).status).toBe(403);
    who = TRADER;
    expect((await call("GET", "/api/admin/usage")).status).toBe(403);
  });
  it("answers the overview to an admin (empty DB here)", async () => {
    who = ADMIN;
    const r = await call("GET", "/api/admin/usage");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ enabled: true, retentionDays: 120, trackedSince: null, inactive: [], pilot: { names: [], unknown: [] } });
    expect(r.json.activity).toHaveLength(30);
    expect(r.json.funnel.days).toHaveLength(10);
  });
});
