/**
 * The dashboard layout in the account (users.settings.dashboardLayout): the stored block's schema (mirrors the web's
 * components/dashboard/layout-model StoredLayoutSchema) and PUT / GET /users/me/settings — stored on the caller's own
 * row, `null` removes it (= back to the default layout), junk is a 400, a guest cannot write.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DashboardLayoutSchema, MAX_LAYOUT_TILES } from "../../lib/people/dashboardLayoutSchema";

type Who = { id: number; name: string; role: "trader" | "admin" | "guest" };
const TRADER: Who = { id: 130, name: "Trader K.", role: "trader" };
const GUEST: Who = { id: 0, name: "guest", role: "guest" };
let who: Who = TRADER;

const db = vi.hoisted(() => ({ settings: new Map<number, Record<string, unknown>>(), updates: [] as unknown[][] }));

vi.mock("@workspace/db", () => {
  const rows = <T>(r: T[]) => ({ rows: r, rowCount: r.length });
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT settings FROM users WHERE id = \$1/.test(sql)) {
      const s = db.settings.get(params[0] as number);
      return rows(s ? [{ settings: s }] : []);
    }
    if (/UPDATE users SET settings/.test(sql)) {
      db.updates.push(params);
      const id = params[2] as number;
      const cur = db.settings.get(id);
      if (!cur) return rows([]);
      const next: Record<string, unknown> = { ...cur };
      for (const k of params[1] as string[]) delete next[k];
      Object.assign(next, JSON.parse(String(params[0])));
      db.settings.set(id, next);
      return rows([{ settings: next }]);
    }
    return rows([]);
  });
  return { db: {}, pool: { query, connect: vi.fn(async () => ({ query, release: () => undefined })) } };
});
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../users");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role, guest: who.role === "guest" };
    (req as unknown as { permActor: unknown }).permActor = { id: who.id, name: who.name, role: who.role, guest: who.role === "guest", wards: [] };
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  who = TRADER;
  db.settings.clear();
  db.settings.set(130, { appearance: { v: 1 } });
  db.updates = [];
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const layout = {
  v: 1,
  items: [
    { id: "attention", size: "s" },
    { id: "equity", size: "m" },
    { id: "leaks", size: "l", rows: 2 },
    { id: "streaks", size: "s" },
  ],
  updatedAt: "2026-10-25T10:00:00.000Z",
};

describe("users.settings.dashboardLayout schema", () => {
  it("accepts the web's shape and an unknown (newer) tile id", () => {
    expect(DashboardLayoutSchema.safeParse(layout).success).toBe(true);
    expect(DashboardLayoutSchema.safeParse({ v: 1, items: [{ id: "futureTile", size: "xl" }] }).success).toBe(true);
    expect(DashboardLayoutSchema.safeParse({ v: 1, items: [] }).success).toBe(true);
  });

  it("refuses junk: another version, unknown sizes, 3 rows, bad ids, duplicates, too many tiles", () => {
    expect(DashboardLayoutSchema.safeParse({ ...layout, v: 2 }).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse({ v: 1, items: [{ id: "leaks", size: "huge" }] }).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse({ v: 1, items: [{ id: "leaks", size: "l", rows: 3 }] }).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse({ v: 1, items: [{ id: "<script>", size: "s" }] }).success).toBe(false);
    expect(DashboardLayoutSchema.safeParse({ v: 1, items: [{ id: "leaks", size: "s" }, { id: "leaks", size: "m" }] }).success).toBe(false);
    const many = Array.from({ length: MAX_LAYOUT_TILES + 1 }, (_, i) => ({ id: `t${i}`, size: "s" }));
    expect(DashboardLayoutSchema.safeParse({ v: 1, items: many }).success).toBe(false);
  });

  it("drops unknown keys instead of storing them", () => {
    const r = DashboardLayoutSchema.parse({ ...layout, extra: 1, items: [{ id: "leaks", size: "s", color: "red" }] });
    expect(r).not.toHaveProperty("extra");
    expect(r.items[0]).not.toHaveProperty("color");
  });
});

describe("PUT / GET /users/me/settings { dashboardLayout }", () => {
  it("stores the layout next to the other settings and reads it back", async () => {
    const put = await call("PUT", "/api/users/me/settings", { dashboardLayout: layout });
    expect(put.status).toBe(200);
    expect(put.json.settings.dashboardLayout).toEqual(layout);
    expect(put.json.settings.appearance).toEqual({ v: 1 });
    const get = await call("GET", "/api/users/me/settings");
    expect(get.json.settings.dashboardLayout).toEqual(layout);
  });

  it("null removes it (back to the default layout)", async () => {
    db.settings.set(130, { dashboardLayout: layout, appearance: { v: 1 } });
    const r = await call("PUT", "/api/users/me/settings", { dashboardLayout: null });
    expect(r.status).toBe(200);
    expect(r.json.settings).toEqual({ appearance: { v: 1 } });
  });

  it("junk is a 400 and nothing is written", async () => {
    const r = await call("PUT", "/api/users/me/settings", { dashboardLayout: { v: 1, items: [{ id: "leaks", size: "giant" }] } });
    expect(r.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });

  it("a guest cannot write a layout", async () => {
    who = GUEST;
    const r = await call("PUT", "/api/users/me/settings", { dashboardLayout: layout });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(db.updates).toHaveLength(0);
  });
});
