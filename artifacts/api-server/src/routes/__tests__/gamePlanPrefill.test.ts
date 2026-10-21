/**
 * GET /api/game-plan/my/prefill (Волна 1, items 1.5 / 1.9) — route × role: a member gets their OWN prefill (no other
 * trader through the query), a guest has no personal plan (403), no session is 401, a bad date is 400.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest"; wards: string[] } | null;
const TRADER = { id: 5, name: "Кирилл Б.", role: "trader" as const, wards: [] };
const CURATOR = { id: 3, name: "Ольга Н.", role: "curator" as const, wards: ["Кирилл Б."] };
const GUEST = { id: 9, name: "guest", role: "guest" as const, wards: [] };
let who: Who = TRADER;

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
const prefill = vi.hoisted(() => ({
  planPrefill: vi.fn(async (trader: string, date: string) => ({ date, focus: null, rule: { mistake: "behavior:fatigue", costNet: -240.9, count: 40, days: 6, window: { from: "a", to: "b" } }, trader })),
  forgetPlanPrefill: vi.fn(),
}));
vi.mock("../../lib/planPrefill", () => prefill);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../gameplan");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // The matrix reads the actor from req.permActor (lib/permissions resolveActor) — set it as the session would.
    if (who) Object.assign(req, {
      authUser: { id: who.id, name: who.name, role: who.role },
      permActor: { id: who.id, name: who.name, role: who.role, guest: who.role === "guest", wards: who.wards },
    });
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = TRADER; vi.clearAllMocks(); });

async function get(path: string): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path);
  return { status: r.status, json: await r.json().catch(() => null) };
}

describe("GET /api/game-plan/my/prefill", () => {
  it("trader: own prefill for the date (a ?trader= is ignored)", async () => {
    const r = await get(`/api/game-plan/my/prefill?date=2026-10-21&trader=${encodeURIComponent("Ольга Н.")}`);
    expect(r.status).toBe(200);
    expect(prefill.planPrefill).toHaveBeenCalledWith("Кирилл Б.", "2026-10-21");
    expect(r.json.rule.mistake).toBe("behavior:fatigue");
  });

  it("curator / admin: their own personal plan too", async () => {
    who = CURATOR;
    expect((await get("/api/game-plan/my/prefill?date=2026-10-21")).status).toBe(200);
    expect(prefill.planPrefill).toHaveBeenCalledWith("Ольга Н.", "2026-10-21");
    who = { id: 1, name: "Закир", role: "admin", wards: [] };
    expect((await get("/api/game-plan/my/prefill?date=2026-10-21")).status).toBe(200);
  });

  it("guest 403, no session 401, a bad date 400 — never reaching the prefill", async () => {
    who = GUEST;
    expect((await get("/api/game-plan/my/prefill?date=2026-10-21")).status).toBe(403);
    who = null;
    expect((await get("/api/game-plan/my/prefill?date=2026-10-21")).status).toBe(401);
    who = TRADER;
    expect((await get("/api/game-plan/my/prefill?date=2026-13-45x")).status).toBe(400);
    expect(prefill.planPrefill).not.toHaveBeenCalled();
  });
});
