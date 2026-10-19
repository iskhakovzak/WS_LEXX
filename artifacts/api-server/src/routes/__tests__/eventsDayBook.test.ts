/**
 * routes/events.ts — GET /events/day-book (ROMAN-18: «Катализаторы» reads day × ticker aggregates instead of the full
 * trade list) and GET /events/stats (DEV-10: one grouped query, no OR-join). DB and actor mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const TRADER: Who = { id: 136, name: "Роман Ж.", role: "trader" };
const ADMIN: Who = { id: 121, name: "Дмитрий К.", role: "admin" };
let who: Who = TRADER;

const BOOK_ROWS = [
  { d: "2026-01-12", tk: "NVDA", n: 2, w: 1, l: 1, net: "5.504" },
  { d: "2026-01-12", tk: "MU", n: 1, w: 0, l: 1, net: "-3" },
  { d: "2026-01-13", tk: "NVDA", n: 1, w: 1, l: 0, net: "9" },
  { d: "bad", tk: "X", n: 1, w: 1, l: 0, net: "1" },
];
const query = vi.fn(async (sql: string, _params?: unknown[]) => {
  if (/FROM trades t\s+WHERE t\.deleted_at IS NULL/.test(sql)) return { rows: BOOK_ROWS };
  return { rows: [] };
});
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: (sql: string, params?: unknown[]) => query(sql, params) } }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router, packDayBook } = await import("../events");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = TRADER; query.mockClear(); });

const bookCalls = () => query.mock.calls.filter(([sql]) => /FROM trades t\s+WHERE t\.deleted_at IS NULL/.test(sql));

describe("packDayBook", () => {
  it("dictionary of tickers, cells grouped by day, net rounded to cents, bad dates dropped", () => {
    expect(packDayBook("Роман Ж.", BOOK_ROWS)).toEqual({
      scope: "Роман Ж.",
      tickers: ["NVDA", "MU"],
      days: [
        ["2026-01-12", [[0, 2, 1, 1, 5.5], [1, 1, 0, 1, -3]]],
        ["2026-01-13", [[0, 1, 1, 0, 9]]],
      ],
    });
    expect(packDayBook(null, [])).toEqual({ scope: null, tickers: [], days: [] });
  });
});

describe("GET /events/day-book", () => {
  it("a trader always gets their own book (a ?trader= for someone else is ignored)", async () => {
    const r = await fetch(`${base}/api/events/day-book?trader=${encodeURIComponent("Максим Р.")}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { scope: string | null; tickers: string[] };
    expect(body.scope).toBe("Роман Ж.");
    expect(body.tickers).toEqual(["NVDA", "MU"]);
    const [sql, params] = bookCalls()[0];
    expect(params).toEqual(["Роман Ж."]);
    // closed trades only, net money, grouped per day × ticker
    expect(sql).toMatch(/IS DISTINCT FROM 'open'/);
    expect(sql).toMatch(/GROUP BY 1, 2/);
    expect(sql).toMatch(/pnl - ABS\(COALESCE\(t\.fees, 0\)\)/);
  });

  it("the scope is whatever lib/auth scopeTrader resolves (same rule as GET /trades)", async () => {
    who = ADMIN;
    const r = await fetch(`${base}/api/events/day-book`);
    const body = (await r.json()) as { scope: string | null; tickers: string[] };
    expect(bookCalls()[0][1]).toEqual([body.scope]);
  });
});

describe("GET /events/stats", () => {
  it("one statement with two equi-joins and no correlated sub-queries", async () => {
    who = ADMIN;
    const r = await fetch(`${base}/api/events/stats`);
    expect(r.status).toBe(200);
    const sql = String(query.mock.calls.find(([s]) => /WITH ev AS/.test(s))?.[0] ?? "");
    expect(sql).toMatch(/t\.event_id = ev\.id/);
    expect(sql).toMatch(/UPPER\(t\.ticker\) = ANY\(ev\.tks\)/);
    expect(sql).not.toMatch(/\(SELECT COUNT\(DISTINCT trade_id\)/);
    expect(sql).not.toMatch(/OR \(substring\(t\.date/);
  });
});
