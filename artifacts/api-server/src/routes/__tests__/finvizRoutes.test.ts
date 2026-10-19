/**
 * routes/finviz.ts — validation, who may refresh (staff), the cooldown (429), «not connected» (503), a ticker miss
 * queues the ticker, earnings windows, and the token never reaching a response. Store reads are mocked here; the SQL
 * is covered by lib/__tests__/finviz/finvizDb.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest"; guest?: boolean };
const TRADER: Who = { id: 130, name: "Кирилл Б.", role: "trader" };
const CURATOR: Who = { id: 123, name: "Ольга Н.", role: "curator" };
let who: Who = TRADER;

vi.mock("@workspace/db", () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { db: {}, pool: { query, connect: vi.fn(async () => ({ query, release: () => undefined })) } };
});
const m = vi.hoisted(() => ({
  readStatus: vi.fn(async (enabled: boolean) => ({ enabled, lastScreenAt: null, lastSnapshotAt: null, lastEarningsAt: null })),
  readScreener: vi.fn(async (preset: string) => ({ asOf: null, preset, rows: [] })),
  readSnapshot: vi.fn(async (_t: string): Promise<unknown> => null),
  readEarnings: vi.fn(async (_f: string, _t: string) => []),
  readEarningsSoon: vi.fn(async (_t: string[], _a: string, _b: string) => []),
  requestTicker: vi.fn(async (_t: string) => undefined),
  runScreener: vi.fn(async () => ({ results: [] })),
}));
vi.mock("../../lib/finviz/read", () => m);
vi.mock("../../lib/finviz/store", async (orig) => ({ ...(await orig<object>()), requestTicker: m.requestTicker }));
vi.mock("../../lib/finviz/jobs", () => ({
  nextTradingDay: async () => "2026-10-20",
  runScreener: m.runScreener, runSnapshot: m.runScreener, runEarnings: m.runScreener,
}));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../finviz");
const { errorMiddleware } = await import("../../lib/http");
const { __loadSettingsCache } = await import("../../lib/settings/registry");
const { setFinvizClientDeps } = await import("../../lib/finviz/client");
const { resetRefreshCooldowns } = await import("../../lib/finviz/refresh");

const TOKEN = "SUPER-SECRET-FINVIZ";
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
beforeEach(() => {
  who = TRADER;
  __loadSettingsCache({});
  resetRefreshCooldowns();
  setFinvizClientDeps({ token: () => TOKEN });
  for (const f of Object.values(m)) f.mockClear();
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
}

describe("reads", () => {
  it("status: enabled follows the token and the desk switch; the token never leaks", async () => {
    const a = await call("GET", "/api/finviz/status");
    expect(a.json).toEqual({ enabled: true, lastScreenAt: null, lastSnapshotAt: null, lastEarningsAt: null });
    expect(a.text).not.toContain(TOKEN);
    __loadSettingsCache({ "finviz.enabled": false });
    expect((await call("GET", "/api/finviz/status")).json.enabled).toBe(false);
    setFinvizClientDeps({ token: () => null });
    __loadSettingsCache({});
    expect((await call("GET", "/api/finviz/status")).json.enabled).toBe(false);
  });

  it("screener: preset must be known", async () => {
    expect((await call("GET", "/api/finviz/screener?preset=gappers")).json).toEqual({ asOf: null, preset: "gappers", rows: [] });
    const bad = await call("GET", "/api/finviz/screener?preset=all");
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("VALIDATION");
    expect((await call("GET", "/api/finviz/screener")).status).toBe(400);
  });

  it("ticker: normalised; a miss answers null and queues it (only while enabled)", async () => {
    const r = await call("GET", "/api/finviz/ticker/%24smci");
    expect(r.status).toBe(200);
    expect(r.json).toBeNull();
    expect(m.readSnapshot).toHaveBeenCalledWith("SMCI");
    expect(m.requestTicker).toHaveBeenCalledWith("SMCI");
    m.readSnapshot.mockResolvedValueOnce({ ticker: "AMD" });
    expect((await call("GET", "/api/finviz/ticker/amd")).json).toEqual({ ticker: "AMD" });
    expect(m.requestTicker).toHaveBeenCalledTimes(1);
    setFinvizClientDeps({ token: () => null });
    await call("GET", "/api/finviz/ticker/NVDA");
    expect(m.requestTicker).toHaveBeenCalledTimes(1);
    expect((await call("GET", "/api/finviz/ticker/not a ticker")).status).toBe(400);
  });

  it("earnings: default two weeks, explicit window, span ≤ 31 days", async () => {
    await call("GET", "/api/finviz/earnings?from=2026-10-19");
    expect(m.readEarnings).toHaveBeenLastCalledWith("2026-10-19", "2026-11-02");
    await call("GET", "/api/finviz/earnings?from=2026-10-01&to=2026-10-31");
    expect(m.readEarnings).toHaveBeenLastCalledWith("2026-10-01", "2026-10-31");
    expect((await call("GET", "/api/finviz/earnings?from=2026-10-01&to=2026-11-15")).status).toBe(400);
    expect((await call("GET", "/api/finviz/earnings?from=2026-10-20&to=2026-10-19")).status).toBe(400);
    expect((await call("GET", "/api/finviz/earnings?from=19.10.2026")).status).toBe(400);
  });

  it("earnings/today: cleans the list, ≤ 100 tickers, empty → []", async () => {
    expect((await call("GET", "/api/finviz/earnings/today")).json).toEqual([]);
    expect(m.readEarningsSoon).not.toHaveBeenCalled();
    await call("GET", "/api/finviz/earnings/today?tickers=aapl,%24msft,,bad%20one,AAPL");
    expect(m.readEarningsSoon.mock.calls[0]?.[0]).toEqual(["AAPL", "MSFT"]);
    expect(m.readEarningsSoon.mock.calls[0]?.[2]).toBe("2026-10-20");
    const many = Array.from({ length: 101 }, (_, i) => `T${i}`).join(",");
    expect((await call("GET", `/api/finviz/earnings/today?tickers=${many}`)).status).toBe(400);
  });
});

describe("POST /finviz/refresh", () => {
  it("traders cannot refresh", async () => {
    const r = await call("POST", "/api/finviz/refresh", {});
    expect(r.status).toBe(403);
    expect(m.runScreener).not.toHaveBeenCalled();
  });

  it("staff refresh runs the job, then the cooldown answers 429 with Retry-After", async () => {
    who = CURATOR;
    const a = await call("POST", "/api/finviz/refresh", {});
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ kind: "screener", status: "ok" });
    expect(Date.parse(a.json.nextAllowedAt) - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(m.runScreener).toHaveBeenCalledWith({ trigger: "manual" });
    const b = await call("POST", "/api/finviz/refresh", { kind: "screener" });
    expect(b.status).toBe(429);
    expect(b.json.code).toBe("RATE_LIMITED");
    expect(Number(b.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await call("POST", "/api/finviz/refresh", { kind: "earnings" })).status).toBe(200);
    expect((await call("POST", "/api/finviz/refresh", { kind: "everything" })).status).toBe(400);
  });

  it("not connected → 503 FINVIZ_NOT_CONFIGURED, the cooldown is not consumed", async () => {
    who = CURATOR;
    setFinvizClientDeps({ token: () => null });
    const r = await call("POST", "/api/finviz/refresh", {});
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("FINVIZ_NOT_CONFIGURED");
    expect(r.text).not.toContain(TOKEN);
    setFinvizClientDeps({ token: () => TOKEN });
    expect((await call("POST", "/api/finviz/refresh", {})).status).toBe(200);
  });
});
