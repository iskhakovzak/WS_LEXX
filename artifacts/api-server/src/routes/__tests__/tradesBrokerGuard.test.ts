/**
 * Wave 0 / 0.1 — broker-sourced trades (PropReports) keep their numbers on the server (lib/brokerTradeGuard):
 * only an admin (settings.manage, admin-only) changes pnl / fees / qty / entry / exit / dates / result / owner of a broker trade,
 * deletes it (single or bulk), sets its result in bulk, adds or removes its fills, or creates a trade marked as
 * broker-sourced. The owner keeps the review layer (setup, tags, notes, grade). Manual trades are unchanged.
 * Route × role: trader (owner) / curator (trades.write.any — still 403) / admin.
 * The drizzle db and pool are faked; the permission matrix is the real default one (only the actor is mocked).
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

const st = vi.hoisted(() => ({
  trade: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  sql: [] as string[],
  limits: [] as number[],
  selects: [] as (Record<string, unknown> | undefined)[],
}));

vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const rows = () => (st.trade ? [{ ...st.trade }] : []);
  const select = (fields?: Record<string, unknown>) => {
    st.selects.push(fields);
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy"]) c[k] = () => c;
    c.limit = (n: number) => { st.limits.push(n); return c; };
    c.as = () => new Proxy({}, { get: (_t, k) => String(k) }); // a subquery (lib/tradesListQuery lite)
    c.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(rows()).then(ok, ko);
    return c;
  };
  const update = () => ({
    set: (data: Record<string, unknown>) => {
      st.updates.push(data);
      const w: Record<string, unknown> = {};
      w.where = () => w;
      w.returning = async () => (st.trade ? [{ ...st.trade, ...data }] : []);
      w.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(undefined).then(ok, ko);
      return w;
    },
  });
  const insert = () => ({
    values: (v: Record<string, unknown>) => {
      st.inserts.push(v);
      return { returning: async () => [{ id: 99, createdAt: new Date("2026-10-20T14:00:00Z"), ...v }] };
    },
  });
  return {
    ...schema,
    db: { select, update, insert },
    pool: {
      query: vi.fn(async (sql: string) => {
        st.sql.push(sql);
        if (/SELECT trader, source, context_snapshot FROM trades/.test(sql)) {
          return { rows: st.trade ? [{ trader: st.trade.trader, source: st.trade.source ?? null, context_snapshot: st.trade.contextSnapshot ?? null }] : [], rowCount: st.trade ? 1 : 0 };
        }
        if (/INSERT INTO trade_executions/.test(sql)) return { rows: [{ id: 501 }], rowCount: 1 };
        if (/DELETE FROM trade_executions/.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    },
  };
});
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
// The real default matrix decides; only the actor is fixed (can() inside lib/permissions resolves it from the DB).
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const matrix = actual.buildEffectiveMatrix([]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix),
    can: vi.fn(can),
    readScope: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.can>[1]) => actual.readableTraders(matrix, actor(), cap)),
    requireCap: vi.fn(async (req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => {
      if (await can(req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});
vi.mock("../../lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("../../lib/marketContext", () => ({ captureAndAttach: vi.fn(async () => undefined) }));
vi.mock("../../lib/rulesEngine", () => ({ scanRulesForTrader: vi.fn(async () => undefined) }));
vi.mock("../../lib/hotCache", () => ({ invalidateDashboardCache: vi.fn() }));
vi.mock("../../lib/tradesPageCache", () => ({ invalidateTradesPageCache: vi.fn() }));
vi.mock("../../lib/tradeStructureStore", () => ({ refreshTradeStructures: vi.fn(async () => undefined), structureForTrade: vi.fn(async () => null) }));
vi.mock("../../lib/playbookAccess", () => ({ isReadableExampleTrade: vi.fn(async () => false), loadMoneyViewer: vi.fn(async () => ({ name: who.name, staff: who.role !== "trader" })) }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: tradesRouter } = await import("../trades");
const { default: executionsRouter } = await import("../executions");
const { errorMiddleware } = await import("../../lib/http");

const brokerTrade = (over: Record<string, unknown> = {}) => ({
  id: 236675, ticker: "SPCX", date: "2026-10-16", side: "long", entry: "147.10", exit: "147.39", qty: "100", fees: "1.2",
  pnl: "25", result: "win", trader: TRADER.name, source: "propreports", externalId: "acc|SPCX|t|long", brokerAccount: "31206881",
  contextSnapshot: { source: "propreports" }, setup: null, tags: null, notes: null, deletedAt: null,
  createdAt: new Date("2026-10-16T14:00:00Z"), playbookId: null, ...over,
});
const manualTrade = () => brokerTrade({ source: null, externalId: null, brokerAccount: null, contextSnapshot: null });

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    next();
  });
  app.use("/api", tradesRouter);
  app.use("/api", executionsRouter);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = TRADER;
  st.trade = brokerTrade();
  st.updates.length = 0;
  st.inserts.length = 0;
  st.sql.length = 0;
  st.limits.length = 0;
  st.selects.length = 0;
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: r.status, json };
}
const asRole = async (w: Who, method: string, path: string, body?: unknown) => { who = w; return call(method, path, body); };

describe("PATCH /trades/:id on a broker trade", () => {
  it("money / broker fields: trader 403, curator 403, admin 200", async () => {
    const body = { pnl: 1000, exit: 166.89 };
    const t = await asRole(TRADER, "PATCH", "/api/trades/236675", body);
    expect([t.status, t.json.code]).toEqual([403, "BROKER_TRADE_READ_ONLY"]);
    expect(t.json.details).toMatchObject({ capability: "settings.manage", fields: ["exit", "pnl"] });
    const c = await asRole(CURATOR, "PATCH", "/api/trades/236675", body);
    expect([c.status, c.json.code]).toEqual([403, "BROKER_TRADE_READ_ONLY"]);
    expect(st.updates).toHaveLength(0);
    const a = await asRole(ADMIN, "PATCH", "/api/trades/236675", body);
    expect(a.status).toBe(200);
    expect(st.updates[0]).toMatchObject({ pnl: 1000, exit: 166.89 });
  });

  it("every broker-owned field is guarded (fees, qty, result, dates, account owner)", async () => {
    for (const body of [{ fees: 0 }, { qty: 1 }, { result: "loss" }, { date: "2026-10-15" }, { exitDate: "2026-10-17" }, { entry: 1 }, { trader: CURATOR.name }]) {
      const r = await asRole(CURATOR, "PATCH", "/api/trades/236675", body);
      expect([r.status, r.json.code]).toEqual([403, "BROKER_TRADE_READ_ONLY"]);
    }
  });

  it("review fields stay editable by the owner; re-sending unchanged numbers is not a change", async () => {
    const r = await asRole(TRADER, "PATCH", "/api/trades/236675", { setup: "Gap & Go", tags: "a, b", notes: "late entry", confidenceGrade: "B" });
    expect(r.status).toBe(200);
    expect(st.updates[0]).toMatchObject({ setup: "Gap & Go", tags: "a, b", notes: "late entry" });
    const same = await asRole(TRADER, "PATCH", "/api/trades/236675", { pnl: 25, fees: 1.2, result: "win", notes: "x" });
    expect(same.status).toBe(200);
  });

  it("a manual trade keeps the old rule (owner may fix its numbers)", async () => {
    st.trade = manualTrade();
    expect((await asRole(TRADER, "PATCH", "/api/trades/236675", { pnl: 40 })).status).toBe(200);
  });

  it("a legacy admin-XLS row (context_snapshot.source only) counts as broker", async () => {
    st.trade = brokerTrade({ source: null, contextSnapshot: { source: "propreports" } });
    expect((await asRole(TRADER, "PATCH", "/api/trades/236675", { pnl: 1 })).status).toBe(403);
  });
});

describe("DELETE /trades/:id and POST /trades/bulk", () => {
  it("single delete of a broker trade: trader 403, curator 403, admin 204", async () => {
    expect((await asRole(TRADER, "DELETE", "/api/trades/236675")).json.code).toBe("BROKER_TRADE_READ_ONLY");
    expect((await asRole(CURATOR, "DELETE", "/api/trades/236675")).status).toBe(403);
    expect(st.updates).toHaveLength(0);
    expect((await asRole(ADMIN, "DELETE", "/api/trades/236675")).status).toBe(204);
  });

  it("manual trade: the owner may still delete it", async () => {
    st.trade = manualTrade();
    expect((await asRole(TRADER, "DELETE", "/api/trades/236675")).status).toBe(204);
  });

  it("bulk delete / setResult with a broker trade: trader 403, curator 403, admin 200", async () => {
    for (const body of [{ action: "delete", ids: [236675] }, { action: "setResult", ids: [236675], result: "loss" }]) {
      const t = await asRole(TRADER, "POST", "/api/trades/bulk", body);
      expect([t.status, t.json.code]).toEqual([403, "BROKER_TRADE_READ_ONLY"]);
      expect((await asRole(CURATOR, "POST", "/api/trades/bulk", body)).status).toBe(403);
      expect(st.updates).toHaveLength(0);
      const a = await asRole(ADMIN, "POST", "/api/trades/bulk", body);
      expect([a.status, a.json.updated]).toEqual([200, [236675]]);
      st.updates.length = 0;
    }
  });

  it("bulk review actions (setup, tags) stay open to the owner", async () => {
    expect((await asRole(TRADER, "POST", "/api/trades/bulk", { action: "setSetup", ids: [236675], setup: "VWAP" })).json.updated).toEqual([236675]);
    expect((await asRole(TRADER, "POST", "/api/trades/bulk", { action: "addTags", ids: [236675], tags: ["fomo"] })).json.updated).toEqual([236675]);
  });
});

describe("restore of a broker trade (same rule as delete)", () => {
  it("POST /trades/:id/restore: trader 403, curator 403, admin 200", async () => {
    st.trade = brokerTrade({ deletedAt: new Date("2026-10-17T12:00:00Z") });
    expect((await asRole(TRADER, "POST", "/api/trades/236675/restore")).json.code).toBe("BROKER_TRADE_READ_ONLY");
    expect((await asRole(CURATOR, "POST", "/api/trades/236675/restore")).status).toBe(403);
    expect(st.updates).toHaveLength(0);
    expect((await asRole(ADMIN, "POST", "/api/trades/236675/restore")).status).toBe(200);
    expect(st.updates[0]).toMatchObject({ deletedAt: null });
  });

  it("bulk restore with a broker trade: trader 403, curator 403, admin 200", async () => {
    st.trade = brokerTrade({ deletedAt: new Date("2026-10-17T12:00:00Z") });
    const body = { action: "restore", ids: [236675] };
    expect((await asRole(TRADER, "POST", "/api/trades/bulk", body)).json.code).toBe("BROKER_TRADE_READ_ONLY");
    expect((await asRole(CURATOR, "POST", "/api/trades/bulk", body)).status).toBe(403);
    expect(st.updates).toHaveLength(0);
    expect((await asRole(ADMIN, "POST", "/api/trades/bulk", body)).json.updated).toEqual([236675]);
  });

  it("a manual trade: the owner may still restore it", async () => {
    st.trade = { ...manualTrade(), deletedAt: new Date("2026-10-17T12:00:00Z") };
    expect((await asRole(TRADER, "POST", "/api/trades/236675/restore")).status).toBe(200);
    expect((await asRole(TRADER, "POST", "/api/trades/bulk", { action: "restore", ids: [236675] })).json.updated).toEqual([236675]);
  });
});

describe("rMultiple of a broker trade is broker-owned", () => {
  it("changing the stored R: trader 403 naming the field, admin 200; an unchanged R is not a change", async () => {
    st.trade = brokerTrade({ rMultiple: "1.5" });
    const t = await asRole(TRADER, "PATCH", "/api/trades/236675", { rMultiple: 9 });
    expect([t.status, t.json.code, t.json.details?.fields]).toEqual([403, "BROKER_TRADE_READ_ONLY", ["rMultiple"]]);
    expect((await asRole(TRADER, "PATCH", "/api/trades/236675", { rMultiple: 1.5, notes: "x" })).status).toBe(200);
    expect((await asRole(ADMIN, "PATCH", "/api/trades/236675", { rMultiple: 9 })).status).toBe(200);
  });
});

describe("POST /trades marked as broker-sourced", () => {
  const body = { ticker: "AAPL", date: "2026-10-16", result: "win", pnl: 4998, conviction: 3, confidenceGrade: "A", source: "propreports", externalId: "x" };
  it("trader 403, curator 403, admin passes (the marker is stripped: booked as a manual trade)", async () => {
    expect((await asRole(TRADER, "POST", "/api/trades", body)).json.code).toBe("BROKER_TRADE_READ_ONLY");
    expect((await asRole(CURATOR, "POST", "/api/trades", body)).status).toBe(403);
    expect(st.inserts).toHaveLength(0);
    const a = await asRole(ADMIN, "POST", "/api/trades", body);
    expect(a.status).toBe(201);
    expect(st.inserts[0]).not.toHaveProperty("source");
  });
  it("a plain manual trade is still accepted", async () => {
    const { source: _s, externalId: _e, ...plain } = body;
    expect((await asRole(TRADER, "POST", "/api/trades", plain)).status).toBe(201);
  });
});

describe("fills of a broker trade (routes/executions.ts)", () => {
  const fill = { kind: "entry", price: 147.1, qty: 100 };
  it("POST: trader 403, curator 403, admin 201", async () => {
    expect((await asRole(TRADER, "POST", "/api/trades/236675/executions", fill)).json.code).toBe("BROKER_TRADE_READ_ONLY");
    expect((await asRole(CURATOR, "POST", "/api/trades/236675/executions", fill)).status).toBe(403);
    expect(st.sql.some((s) => /INSERT INTO trade_executions/.test(s))).toBe(false);
    expect((await asRole(ADMIN, "POST", "/api/trades/236675/executions", fill)).status).toBe(201);
  });
  it("DELETE: trader 403, curator 403, admin 204", async () => {
    expect((await asRole(TRADER, "DELETE", "/api/trades/236675/executions/9")).status).toBe(403);
    expect((await asRole(CURATOR, "DELETE", "/api/trades/236675/executions/9")).status).toBe(403);
    expect(st.sql.some((s) => /DELETE FROM trade_executions/.test(s))).toBe(false);
    expect((await asRole(ADMIN, "DELETE", "/api/trades/236675/executions/9")).status).toBe(204);
  });
  it("a manual trade's fills stay editable by the owner", async () => {
    st.trade = manualTrade();
    expect((await asRole(TRADER, "POST", "/api/trades/236675/executions", fill)).status).toBe(201);
    expect((await asRole(TRADER, "DELETE", "/api/trades/236675/executions/9")).status).toBe(204);
  });
});

describe("GET /trades never returns the whole book (Волна 2 п. 2.15)", () => {
  it("no window and no limit → the newest 500", async () => {
    const r = await asRole(TRADER, "GET", "/api/trades");
    expect(r.status).toBe(200);
    expect(st.limits).toEqual([500]);
  });

  it("a date window of up to 400 days is still capped at 5000 rows; a wider one → 400 RANGE_TOO_LONG", async () => {
    expect((await asRole(TRADER, "GET", "/api/trades?from=2026-01-01&to=2026-10-20")).status).toBe(200);
    expect(st.limits).toEqual([5000]);
    expect((await asRole(TRADER, "GET", "/api/trades?from=2026-01-01&limit=50")).status).toBe(200);
    expect(st.limits).toEqual([5000, 50]);
    const wide = await asRole(ADMIN, "GET", "/api/trades?from=2024-01-01&to=2026-10-20");
    expect([wide.status, wide.json.code, wide.json.details]).toEqual([400, "RANGE_TOO_LONG", undefined]);
  });

  it("desk-wide lists default to the slim snapshot; one trader's book (or lite=0) reads the full one", async () => {
    const { tradesTable } = await import("@workspace/db/schema");
    const list = () => st.selects.filter((f) => f && "contextSnapshot" in f).at(-1);
    const full = () => list()?.contextSnapshot === tradesTable.contextSnapshot;
    await asRole(ADMIN, "GET", "/api/trades?from=2026-10-01");
    expect(full()).toBe(false);
    expect(list()).toHaveProperty("ticker");
    await asRole(ADMIN, "GET", "/api/trades?from=2026-10-01&lite=0");
    expect(full()).toBe(true);
    await asRole(ADMIN, "GET", "/api/trades?from=2026-10-01&trader=Trader%20T.");
    expect(full()).toBe(true);
    await asRole(TRADER, "GET", "/api/trades?from=2026-10-01");
    expect(full()).toBe(true);
    await asRole(TRADER, "GET", "/api/trades?from=2026-10-01&lite=1");
    expect(full()).toBe(false);
  });

  it("an explicit limit wins (clamped to 5000)", async () => {
    await asRole(TRADER, "GET", "/api/trades?limit=20");
    await asRole(TRADER, "GET", "/api/trades?limit=99999");
    expect(st.limits).toEqual([20, 5000]);
  });
});
