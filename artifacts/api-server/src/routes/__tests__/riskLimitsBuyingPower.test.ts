/**
 * Волна 1 п. 1.21: buying power in the limits editor (PUT /risk/limits/:trader) — curator / admin only (trader 403),
 * a junior 25 000 – 800 000 $ (BUYING_POWER_RANGE), above junior no cap (only ≥ 25 000, BUYING_POWER_MIN); an editor
 * that does not send buyingPower keeps the stored value; GET returns it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const TRADER: Who = { id: 5, name: "Олег Е.", role: "trader" };
const CURATOR: Who = { id: 3, name: "Ольга Н.", role: "curator" };
let who: Who = CURATOR;
let stageOfTrader: string | null = "junior";
const upserts: unknown[][] = [];

vi.mock("@workspace/db", () => {
  const answer = async (sql: string, params: unknown[] = []) => {
    if (/SELECT 1 FROM users WHERE name/.test(sql)) return { rows: [{ "?column?": 1 }], rowCount: 1 };
    if (/INSERT INTO trader_risk_limits AS l/.test(sql)) {
      upserts.push(params);
      return { rows: [{ trader: params[0], daily_loss_limit: params[2], buying_power: params[15] ? params[14] : 100_000, tier: params[11] }], rowCount: 1 };
    }
    if (/SELECT \* FROM trader_risk_limits/.test(sql)) return { rows: [{ trader: "Олег Е.", daily_loss_limit: 300, buying_power: "250000", tier: "junior" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { db: {}, pool: { query: vi.fn(answer), connect: vi.fn(async () => ({ query: vi.fn(answer), release: vi.fn() })) } };
});
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../../lib/notifyUtils", () => ({ notifyUser: vi.fn(async () => 1), notifyUsers: vi.fn(async () => []), assignedStaffOf: vi.fn(async () => []) }));
vi.mock("../../lib/notifyEvents", () => ({ inBackground: vi.fn() }));
vi.mock("../../lib/people/stage", async (orig) => ({ ...(await orig<typeof import("../../lib/people/stage")>()), stageOf: vi.fn(async () => stageOfTrader) }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const matrix = actual.buildEffectiveMatrix([]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target);
  return {
    ...actual,
    can: vi.fn(can),
    requireCap: vi.fn(async (_req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => {
      if (await can(_req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../risk");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((rq, _res, next) => {
    (rq as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = CURATOR; stageOfTrader = "junior"; upserts.length = 0; });

const put = async (body: unknown) => {
  const r = await fetch(`${base}/api/risk/limits/${encodeURIComponent("Олег Е.")}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
};

describe("PUT /risk/limits/:trader — buying power", () => {
  it("a trader may not edit limits (403)", async () => {
    who = TRADER;
    expect((await put({ dailyLossLimit: 300, buyingPower: 250_000 })).status).toBe(403);
    expect(upserts).toHaveLength(0);
  });

  it("junior: 25 000 – 800 000 $; outside → 400 BUYING_POWER_RANGE with the bounds", async () => {
    const ok = await put({ dailyLossLimit: 300, buyingPower: 250_000 });
    expect(ok.status).toBe(200);
    expect(ok.json.buyingPower).toBe(250_000);
    expect(upserts[0]!.slice(14, 16)).toEqual([250_000, true]);
    for (const bp of [900_000, 10_000]) {
      const bad = await put({ dailyLossLimit: 300, buyingPower: bp });
      expect([bad.status, bad.json.code]).toEqual([400, "BUYING_POWER_RANGE"]);
      expect(bad.json.error).toContain("$800,000");
    }
    expect(upserts).toHaveLength(1);
  });

  it("above junior: no cap, still ≥ 25 000 (BUYING_POWER_MIN); the tier in the body decides", async () => {
    stageOfTrader = "senior";
    expect((await put({ buyingPower: 2_000_000 })).status).toBe(200);
    expect((await put({ buyingPower: 1_000 })).json.code).toBe("BUYING_POWER_MIN");
    stageOfTrader = "trader";
    expect((await put({ buyingPower: 900_000, tier: "junior" })).json.code).toBe("BUYING_POWER_RANGE");
  });

  it("an editor without the field keeps the stored BP; null clears it", async () => {
    expect((await put({ dailyLossLimit: 300 })).status).toBe(200);
    expect(upserts.at(-1)!.slice(14, 16)).toEqual([null, false]);
    expect((await put({ buyingPower: null })).status).toBe(200);
    expect(upserts.at(-1)!.slice(14, 16)).toEqual([null, true]);
  });

  it("GET returns buyingPower (number)", async () => {
    const r = await fetch(`${base}/api/risk/limits/${encodeURIComponent("Олег Е.")}`);
    expect((await r.json() as any).buyingPower).toBe(250_000);
  });
});
