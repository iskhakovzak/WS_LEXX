/**
 * The stage-access middleware (lib/access/sections.ts, mounted in routes/index.ts): with nothing closed (default) every
 * request passes without resolving anybody; a closed section answers 403 SECTION_BLOCKED (typed, translated) for the
 * stages it is closed for, 200 for the other stages and always for staff; paths outside the table and the explicitly
 * open /dailyfeed/stream are never touched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
let who: Who = { id: 1, name: "Джун А.", role: "trader" };
const tiers: Record<string, string> = { "Джун А.": "junior", "Трейдер Б.": "trader", "Сеньор В.": "senior" };

const resolveActor = vi.hoisted(() => vi.fn());
vi.mock("../../lib/permissions", async (orig) => ({ ...(await orig<typeof import("../../lib/permissions")>()), resolveActor }));
vi.mock("../../lib/playbookToday/tier", () => ({ viewerTier: vi.fn(async (n: string) => tiers[n] ?? null), forgetTier: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [] })) } }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { sectionAccessMiddleware } = await import("../../lib/access/sections");
const { errorMiddleware } = await import("../../lib/http");
const { __loadSettingsCache } = await import("../../lib/settings/registry");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    next();
  });
  const api = express.Router();
  api.use(sectionAccessMiddleware);
  api.get(/.*/, (_req, res) => { res.json({ ok: true }); });
  app.use("/api", api);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = { id: 1, name: "Джун А.", role: "trader" };
  __loadSettingsCache({});
  resolveActor.mockReset();
  resolveActor.mockImplementation(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] }));
});

const get = async (path: string, lang = "ru") => {
  const r = await fetch(base + path, { headers: { "X-Lang": lang } });
  return { status: r.status, json: (await r.json()) as { code?: string; error?: string; details?: unknown } };
};

describe("section access middleware", () => {
  it("default (nothing closed): every path passes and no actor is resolved", async () => {
    expect((await get("/api/top/day/2026-10-20")).status).toBe(200);
    expect((await get("/api/leaderboard")).status).toBe(200);
    expect(resolveActor).not.toHaveBeenCalled();
  });

  it("a closed section: 403 SECTION_BLOCKED for the closed stages, 200 for the others", async () => {
    __loadSettingsCache({ "access.sections": { "/top-results": ["junior", "trader"], "/ratings": ["junior"] } });
    const r = await get("/api/top/day/2026-10-20");
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("SECTION_BLOCKED");
    expect(r.json.details).toEqual({ section: "/top-results", stage: "junior" });
    expect(r.json.error).toBeTruthy();
    expect((await get("/api/top/calendar?month=2026-10", "en")).json.error).toMatch(/closed for your stage/);
    expect((await get("/api/leaderboard")).status).toBe(403);
    who = { id: 2, name: "Трейдер Б.", role: "trader" };
    expect((await get("/api/top/calendar")).status).toBe(403);
    expect((await get("/api/leaderboard")).status).toBe(200);
    who = { id: 3, name: "Сеньор В.", role: "trader" };
    expect((await get("/api/top/calendar")).status).toBe(200);
  });

  it("staff are never blocked, even with every stage closed", async () => {
    __loadSettingsCache({ "access.sections": { "/top-results": ["junior", "trader", "senior"] } });
    who = { id: 9, name: "Ольга Н.", role: "curator" };
    expect((await get("/api/top/calendar")).status).toBe(200);
    who = { id: 10, name: "Дмитрий К.", role: "admin" };
    expect((await get("/api/top/calendar")).status).toBe(200);
  });

  it("paths outside the section and the open /dailyfeed/stream pass; a guest counts as junior", async () => {
    __loadSettingsCache({ "access.sections": { "/dailyfeed": ["junior"], "/top-results": ["junior"] } });
    expect((await get("/api/dailyfeed")).status).toBe(403);
    expect((await get("/api/dailyfeed/stream")).status).toBe(200);
    expect((await get("/api/trades")).status).toBe(200);
    expect((await get("/api/topics")).status).toBe(200);
    resolveActor.mockImplementation(async () => ({ id: 0, name: "guest", role: "guest", guest: true, wards: [] }));
    expect((await get("/api/top/calendar")).status).toBe(403);
  });
});
