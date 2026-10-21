/**
 * Rights on things attached to another member's trade / idea / event:
 *   GET / POST /trades/:id/reactions   only on a trade the caller may read (canAccessTrade read) — else 404
 *   POST /trades/:id/reviews           trades.review on the trade's owner (an «assigned» curator: own people only)
 *   PATCH /trade-ideas/:id             the trade link (convertedTradeId, also null) only by the author or a reviewer,
 *                                      and only to the caller's own trade (a reviewer: also the author's trade)
 *   POST /events/:id/outcome           the event's author or staff (canModifyEvent), like every other event edit
 * The real matrix decides (curator «assigned» on trades.review when `assigned`); the DB is faked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin"; wards?: string[] };
const KIRILL: Who = { id: 5, name: "Kirill", role: "trader" };
const ANTON: Who = { id: 2, name: "Anton", role: "curator", wards: ["Umid"] };
let who: Who = KIRILL;
let assigned = false;

const st = vi.hoisted(() => ({
  sql: [] as { sql: string; params: unknown[] }[],
  trades: {} as Record<number, string>,
  selects: [] as unknown[][],
  inserts: [] as unknown[],
  updates: [] as Record<string, unknown>[],
  event: null as Record<string, unknown> | null,
}));

vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const thenable = (value: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin"]) c[k] = () => c;
    c.returning = async () => value();
    c.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(value()).then(ok, ko);
    return c;
  };
  const db = {
    select: () => thenable(() => st.selects.shift() ?? []),
    insert: () => ({ values: (v: Record<string, unknown>) => { st.inserts.push(v); return thenable(() => [{ id: 9, createdAt: new Date("2026-10-20T14:00:00Z"), ...v }]); } }),
    update: () => ({ set: (v: Record<string, unknown>) => { st.updates.push(v); return thenable(() => [{ id: 70, trader: "Kirill", ...v }]); } }),
    delete: () => thenable(() => []),
  };
  return {
    ...schema,
    db,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        st.sql.push({ sql, params });
        if (/SELECT trader FROM trades WHERE id = \$1 AND deleted_at IS NULL/.test(sql)) {
          const t = st.trades[Number(params[0])];
          return { rows: t ? [{ trader: t }] : [], rowCount: t ? 1 : 0 };
        }
        if (/SELECT role FROM users WHERE id = \$1/.test(sql)) return { rows: [{ role: who.role }], rowCount: 1 };
        if (/FROM market_events WHERE id = \$1/.test(sql)) return { rows: st.event ? [st.event] : [], rowCount: st.event ? 1 : 0 };
        return { rows: [], rowCount: 0 };
      }),
    },
  };
});
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("../../lib/playbookAccess", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadMoneyViewer: vi.fn(async () => ({ name: who.name, staff: who.role !== "trader" })),
}));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const matrix = () => actual.buildEffectiveMatrix(assigned ? [
    { role: "curator", capability: "trades.review", allowed: true, scope: "assigned" },
    { role: "curator", capability: "trades.read.team", allowed: true, scope: "assigned" },
  ] : []);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards ?? [] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix(), actor(), cap, target);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix()),
    can: vi.fn(can),
    requireCap: vi.fn(async (req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => {
      if (await can(req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: activityRouter } = await import("../activity");
const { default: ideasRouter } = await import("../tradeideas");
const { default: eventsRouter } = await import("../events");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", activityRouter, ideasRouter, eventsRouter);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = KIRILL; assigned = false;
  st.sql.length = 0; st.selects.length = 0; st.inserts.length = 0; st.updates.length = 0;
  st.trades = { 100: "Kirill", 200: "Umid", 300: "Bob" };
  st.event = null;
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, json };
}

describe("trade reactions follow trade visibility", () => {
  it("a trader: own trade yes; someone else's trade → 404 for GET and POST, nothing stored", async () => {
    expect((await call("GET", "/api/trades/200/reactions")).status).toBe(404);
    const p = await call("POST", "/api/trades/200/reactions", { reactionType: "like" });
    expect([p.status, p.json?.code]).toEqual([404, "TRADE_NOT_FOUND"]);
    expect(st.inserts).toEqual([]);
    expect((await call("GET", "/api/trades/100/reactions")).status).toBe(200);
    expect((await call("POST", "/api/trades/100/reactions", { reactionType: "like" })).status).toBe(201);
  });

  it("a missing trade → 404; a curator (trades.read.team) reacts to anyone's trade", async () => {
    expect((await call("GET", "/api/trades/999/reactions")).status).toBe(404);
    who = ANTON;
    expect((await call("POST", "/api/trades/200/reactions", { reactionType: "like" })).status).toBe(201);
  });
});

describe("POST /trades/:id/reviews is scoped to the trade's owner", () => {
  it("«assigned» curator: a ward's trade yes, another trader's trade 403 naming trades.review", async () => {
    who = ANTON; assigned = true;
    expect((await call("POST", "/api/trades/200/reviews", { comment: "good stop" })).status).toBe(201);
    const r = await call("POST", "/api/trades/300/reviews", { comment: "good stop" });
    expect([r.status, r.json?.details?.capability]).toEqual([403, "trades.review"]);
    expect(st.inserts).toHaveLength(1);
  });

  it("desk curator: anyone; trader 403; missing trade 404", async () => {
    who = ANTON;
    expect((await call("POST", "/api/trades/300/reviews", { comment: "ok" })).status).toBe(201);
    expect((await call("POST", "/api/trades/999/reviews", { comment: "ok" })).status).toBe(404);
    who = KIRILL;
    expect((await call("POST", "/api/trades/100/reviews", { comment: "ok" })).status).toBe(403);
  });
});

describe("PATCH /trade-ideas/:id — the trade link", () => {
  const idea = (trader: string) => [{ trader, deletedAt: null, status: "published" }];

  it("a non-author may not unlink or link someone else's idea (403, nothing written)", async () => {
    for (const body of [{ convertedTradeId: null }, { convertedTradeId: 100 }, { status: "converted", convertedTradeId: 100 }]) {
      st.selects.push(idea("Umid"));
      const r = await call("PATCH", "/api/trade-ideas/70", body);
      expect([r.status, r.json?.code]).toEqual([403, "AUTHOR_OR_STAFF_ONLY"]);
    }
    expect(st.updates).toEqual([]);
  });

  it("the author links only their own trade", async () => {
    st.selects.push(idea("Kirill"));
    const r = await call("PATCH", "/api/trade-ideas/70", { convertedTradeId: 200 });
    expect([r.status, r.json?.code]).toEqual([403, "OWN_TRADES_ONLY"]);
    st.selects.push(idea("Kirill"));
    expect((await call("PATCH", "/api/trade-ideas/70", { convertedTradeId: 100 })).status).toBe(200);
    expect(st.updates[0]).toMatchObject({ convertedTradeId: 100 });
  });

  it("a reviewer may link the author's trade, not a third trader's", async () => {
    who = ANTON;
    st.selects.push(idea("Umid"));
    expect((await call("PATCH", "/api/trade-ideas/70", { convertedTradeId: 200 })).status).toBe(200);
    st.selects.push(idea("Umid"));
    expect((await call("PATCH", "/api/trade-ideas/70", { convertedTradeId: 300 })).json?.code).toBe("OWN_TRADES_ONLY");
  });
});

describe("POST /events/:id/outcome", () => {
  const updates = () => st.sql.filter((q) => /^\s*UPDATE market_events/.test(q.sql));
  it("another member's event: trader 403 AUTHOR_OR_STAFF_ONLY, nothing written", async () => {
    st.event = { id: 7, created_by: "Umid", ticker: "NVDA", headline: "CPI", date: "2026-10-20" };
    const r = await call("POST", "/api/events/7/outcome", { reaction: "gap up", percentMove: 3 });
    expect([r.status, r.json?.code]).toEqual([403, "AUTHOR_OR_STAFF_ONLY"]);
    expect(updates()).toEqual([]);
  });

  it("the author and staff reach the write", async () => {
    st.event = { id: 7, created_by: "Kirill", ticker: "NVDA", headline: "CPI", date: "2026-10-20" };
    expect((await call("POST", "/api/events/7/outcome", { reaction: "gap up" })).status).not.toBe(403);
    expect(updates()).toHaveLength(1);
    st.event = { ...st.event, created_by: "Umid" };
    who = ANTON;
    expect((await call("POST", "/api/events/7/outcome", { reaction: "gap up" })).status).not.toBe(403);
    expect(updates()).toHaveLength(2);
  });
});
