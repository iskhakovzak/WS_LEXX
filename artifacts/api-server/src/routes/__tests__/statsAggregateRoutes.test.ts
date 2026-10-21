/**
 * GET /stats/aggregate (Волна 2 п. 2.5) route × role over a mocked trades table:
 *  - admin: whole desk (no trader filter) and any trader; $ visible;
 *  - curator with the «assigned» team scope: the desk = his wards + self; another trader → 403;
 *  - trader: scope=desk is his own book only, another trader → 403, own $ visible;
 *  - guest 403, anonymous 401; bad dates → 400 VALIDATION; lite=1 has no breakdowns.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest" } | null;
const TRADER = { id: 5, name: "Trader T.", role: "trader" as const };
const CURATOR = { id: 3, name: "Curator C.", role: "curator" as const };
const ADMIN = { id: 1, name: "Admin A.", role: "admin" as const };
const GUEST = { id: 0, name: "guest", role: "guest" as const };
let who: Who = TRADER;
let overrides: { role: "trader" | "curator"; capability: string; allowed: boolean; scope?: "desk" | "assigned" }[] = [];
const WARDS: Record<string, string[]> = { "Curator C.": ["Trader T."] };

const calls = vi.hoisted(() => [] as unknown[][]);
const ROW = (id: number, trader: string, pnl: number) => ({
  id, trader, ticker: "AAPL", date: "2026-10-01T10:00:00", exit_date: null, result: pnl > 0 ? "win" : "loss", side: "long",
  entry: 10, exit: 11, stop: 9, r_multiple: null, pnl, fees: 1, risk_usd: null, horizon: "intraday", setup: "ORB",
  event_type: null, sector: null, session: "regular", conviction: null, broker_account: null, source: "propreports",
  created_at: "2026-10-01T15:00:00.000Z", opened_at: null,
});
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (!/FROM trades t/.test(sql)) return { rows: [], rowCount: 0 };
      calls.push(params);
      const all = [ROW(1, "Trader T.", 100), ROW(2, "Other O.", -50), ROW(3, "Curator C.", 20)];
      const names = params[0] as string[] | null;
      return { rows: names ? all.filter((r) => names.includes(r.trader)) : all, rowCount: 0 };
    }),
  },
}));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const matrix = () => actual.buildEffectiveMatrix(overrides as never);
  const actor = () => (who ? { id: who.id, name: who.name, role: who.role, guest: who.role === "guest", wards: WARDS[who.name] ?? [] } : null);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    readScope: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.can>[1]) => actual.readableTraders(matrix(), actor() as never, cap)),
  };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../stats-aggregate");
const { errorMiddleware } = await import("../../lib/http");
const { bucketIndex: F } = await import("../../lib/stats/aggregate");
const { invalidateTradesPageCache } = await import("../../lib/tradesPageCache");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    if (who) {
      (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
      (req as unknown as { permActor: unknown }).permActor = { id: who.id, name: who.name, role: who.role, guest: who.role === "guest", wards: WARDS[who.name] ?? [] };
    }
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
// The route caches the aggregate 60 s per key (lib/tradesPageCache); each test sets its own rows.
beforeEach(() => { who = TRADER; overrides = []; calls.length = 0; invalidateTradesPageCache(); });

async function get(path: string): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path);
  return { status: r.status, json: await r.json().catch(() => null) };
}

describe("GET /stats/aggregate", () => {
  it("admin: the whole desk with $, and one trader on request", async () => {
    who = ADMIN;
    const desk = await get("/api/stats/aggregate?scope=desk&from=2026-07-01");
    expect(desk.status).toBe(200);
    expect(desk.json.scope).toBe("desk");
    expect(desk.json.money).toBe(true);
    expect(calls[0]![0]).toBeNull(); // no trader filter
    expect(calls[0]![1]).toBe("2026-07-01");
    expect(desk.json.total[F.n]).toBe(3);
    expect(desk.json.total[F.net]).toBe(67);
    expect(desk.json.groups.trader).toHaveLength(3);
    const one = await get("/api/stats/aggregate?scope=trader&trader=Other%20O.");
    expect(one.status).toBe(200);
    expect(one.json.trader).toBe("Other O.");
    expect(one.json.total[F.net]).toBe(-51);
  });

  it("curator with the assigned scope: wards + self; another trader is 403", async () => {
    who = CURATOR;
    overrides = [{ role: "curator", capability: "team.read", allowed: true, scope: "assigned" }];
    const desk = await get("/api/stats/aggregate");
    expect(desk.status).toBe(200);
    expect([...(calls[0]![0] as string[])].sort()).toEqual(["Curator C.", "Trader T."]);
    expect(desk.json.money).toBe(true);
    const ward = await get("/api/stats/aggregate?scope=trader&trader=Trader%20T.");
    expect(ward.status).toBe(200);
    const other = await get("/api/stats/aggregate?scope=trader&trader=Other%20O.");
    expect(other.status).toBe(403);
  });

  it("trader: the desk is his own book; another trader is 403", async () => {
    who = TRADER;
    const desk = await get("/api/stats/aggregate?scope=desk");
    expect(desk.status).toBe(200);
    expect(calls[0]![0]).toEqual(["Trader T."]);
    expect(desk.json.money).toBe(true);
    expect(desk.json.total[F.n]).toBe(1);
    const other = await get("/api/stats/aggregate?scope=trader&trader=Other%20O.");
    expect(other.status).toBe(403);
  });

  it("guest 403, anonymous 401, bad dates 400", async () => {
    who = GUEST;
    expect((await get("/api/stats/aggregate")).status).toBe(403);
    who = null;
    expect((await get("/api/stats/aggregate")).status).toBe(401);
    who = ADMIN;
    const bad = await get("/api/stats/aggregate?from=yesterday");
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("VALIDATION");
  });

  it("lite=1 answers the comparison period without breakdowns", async () => {
    who = ADMIN;
    const r = await get("/api/stats/aggregate?from=2026-07-01&to=2026-09-30&lite=1");
    expect(r.status).toBe(200);
    expect(r.json.groups).toBeUndefined();
    expect(r.json.days).toBeDefined();
    expect(calls[0]![2]).toBe("2026-09-30");
  });
});

describe("GET /stats/aggregate cache", () => {
  it("the same key is computed once until a trade write clears the cache", async () => {
    who = ADMIN;
    expect((await get("/api/stats/aggregate?from=2026-07-01&to=2026-09-30")).status).toBe(200);
    expect((await get("/api/stats/aggregate?from=2026-07-01&to=2026-09-30")).status).toBe(200);
    expect(calls).toHaveLength(1);
    invalidateTradesPageCache();
    expect((await get("/api/stats/aggregate?from=2026-07-01&to=2026-09-30")).status).toBe(200);
    expect(calls).toHaveLength(2);
  });
});
