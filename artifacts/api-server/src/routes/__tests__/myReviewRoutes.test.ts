/**
 * Волна 2 п. 2.9 «Мой разбор» — GET /api/my-review (routes/my-review.ts, lib/myReview.ts), route × role over a mocked
 * pool and daily engine:
 *  - own trades only: every matrix query is scoped to the viewer, also when ?trader= names someone else, for a trader
 *    and for staff (staff read others on /analytics);
 *  - where I earn / where I lose / one rule for tomorrow (tomorrow's plan rule first, else the period's costliest);
 *  - the answer stays small (≤ 50 KB) even with hundreds of buckets; days clamped to [7, 90]; a guest gets an empty one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest" };
const KIRILL: Who = { id: 5, name: "Kirill", role: "trader" };
const CURATOR: Who = { id: 3, name: "Olga", role: "curator" };
const GUEST: Who = { id: 0, name: "guest", role: "guest" };
let who: Who = KIRILL;
let many = false;

const row = (row_key: string, n: number, net: number, wins: number, losses: number, sum_r = 0, r_n = 0) => ({ row_key, col_key: "—", n, wins, losses, sum_r, r_n, net, pnl_n: n });
const matrixCalls: { dim: string; params: unknown[] }[] = [];
// i18n-ignore-next (the edge matrix's placeholder bucket key, as the SQL returns it)
const NO_SETUP = "Без сетапа";

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/WITH base AS MATERIALIZED/.test(sql)) {
        const dim = /'m' \|\|/.test(sql) ? "tod" : /upper\(COALESCE\(NULLIF\(trim\(t\.ticker\)/.test(sql) ? "ticker" : "setup";
        matrixCalls.push({ dim, params });
        if (many) return { rows: Array.from({ length: 400 }, (_, i) => row(`${dim === "tod" ? "m" + (540 + (i % 7) * 60) : "K" + i}`, 3, i % 2 ? 50 + i : -40 - i, 2, 1, 1.5, 3)) };
        if (dim === "setup") return { rows: [row("ORB", 6, 420, 4, 2, 3.5, 6), row("VWAP reclaim", 4, -180, 1, 3), row(NO_SETUP, 30, 90, 15, 14), row("Gap fade", 1, 500, 1, 0)] };
        if (dim === "ticker") return { rows: [row("NVDA", 5, 300, 3, 2), row("TSLA", 7, -260, 2, 5), row("AMD", 3, 120, 2, 1), row("?", 4, 10, 2, 2)] };
        return { rows: [row("m540", 20, 400, 12, 8), row("m900", 8, -150, 3, 5), row("s:pre", 3, 99, 2, 1), row("без времени", 3, 99, 2, 1)] };
      }
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: who.role === "guest", wards: [] })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});
const daily = vi.hoisted(() => ({
  mistakeCosts: vi.fn(async (_t: string, _from: string, _to: string) => [
    { id: "behavior:fatigue", count: 6, days: 4, costNet: -241.5, examples: [] },
    { id: "behavior:revenge", count: 2, days: 2, costNet: -80, examples: [] },
    { id: "day:fees", count: 9, days: 9, costNet: -30, examples: [] },
    { id: "behavior:chase", count: 1, days: 1, costNet: -5, examples: [] },
    { id: "behavior:euphoria", count: 3, days: 2, costNet: 40, examples: [] },
  ]),
}));
vi.mock("../../lib/daily/service", () => daily);
const prefill = vi.hoisted(() => ({ rule: null as null | Record<string, unknown> }));
vi.mock("../../lib/planPrefill", async (orig) => ({
  ...(await orig<typeof import("../../lib/planPrefill")>()),
  planPrefill: vi.fn(async (_t: string, date: string) => ({ date, focus: null, rule: prefill.rule })),
}));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../my-review");
const { errorMiddleware } = await import("../../lib/http");
const { clampDays, hourKey, nextTradingDay } = await import("../../lib/myReview");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = KIRILL; many = false; prefill.rule = null; matrixCalls.length = 0; vi.clearAllMocks(); });

const get = async (path: string) => {
  const r = await fetch(base + path);
  const text = await r.text();
  return { status: r.status, bytes: Buffer.byteLength(text), json: JSON.parse(text) as any };
};

describe("GET /my-review × role", () => {
  it("trader: own trades only, also with ?trader= of someone else", async () => {
    const r = await get("/api/my-review?trader=Roman");
    expect(r.status).toBe(200);
    expect(r.json.trader).toBe("Kirill");
    expect(matrixCalls.map((c) => c.dim).sort()).toEqual(["setup", "ticker", "tod"]);
    for (const c of matrixCalls) {
      expect(c.params).toContain("Kirill");
      expect(c.params).not.toContain("Roman");
    }
    expect(daily.mistakeCosts.mock.calls[0]![0]).toBe("Kirill");
  });

  it("staff get their own review too (the desk lives on /analytics)", async () => {
    who = CURATOR;
    const r = await get("/api/my-review?trader=Kirill");
    expect(r.json.trader).toBe("Olga");
    for (const c of matrixCalls) expect(c.params).toEqual(expect.arrayContaining(["Olga"]));
    for (const c of matrixCalls) expect(c.params).not.toContain("Kirill");
  });

  it("guest: an empty review, no trades read", async () => {
    who = GUEST;
    const r = await get("/api/my-review");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ totals: { trades: 0 }, earn: { setup: [] }, rule: null });
    expect(matrixCalls).toHaveLength(0);
  });
});

describe("GET /my-review — the three answers", () => {
  it("where I earn: top by net, placeholders and one-trade buckets left out; hours as «09»", async () => {
    const r = (await get("/api/my-review")).json;
    expect(r.days).toBe(30);
    expect(r.earn.setup.map((b: any) => b.key)).toEqual(["ORB"]); // «Gap fade» has 1 trade, «Без сетапа» is a placeholder
    expect(r.earn.setup[0]).toMatchObject({ trades: 6, net: 420, r: 3.5, winRate: 0.667 });
    expect(r.earn.ticker.map((b: any) => b.key)).toEqual(["NVDA", "AMD"]);
    expect(r.earn.hour).toEqual([{ key: "09", trades: 20, net: 400, r: null, winRate: 0.6 }]);
    expect(r.totals).toMatchObject({ trades: 41, net: 830, r: 3.5 });
  });

  it("where I lose: the costliest patterns (top 3, priced losses only) + the worst buckets", async () => {
    const r = (await get("/api/my-review")).json;
    expect(r.lose.patterns.map((p: any) => p.mistake)).toEqual(["behavior:fatigue", "behavior:revenge", "day:fees"]);
    expect(r.lose.patterns[0]).toEqual({ mistake: "behavior:fatigue", costNet: -241.5, count: 6, days: 4 });
    expect(r.lose.setup.map((b: any) => b.key)).toEqual(["VWAP reclaim"]);
    expect(r.lose.ticker.map((b: any) => b.key)).toEqual(["TSLA"]);
    expect(r.lose.hour.map((b: any) => b.key)).toEqual(["15"]);
  });

  it("one rule for tomorrow: tomorrow's plan rule first, else the period's costliest pattern", async () => {
    let r = (await get("/api/my-review")).json;
    expect(r.rule).toMatchObject({ mistake: "behavior:fatigue", costNet: -241.5, source: "period" });
    prefill.rule = { mistake: "behavior:revenge", costNet: -80, count: 2, days: 2, window: { from: "2026-10-06", to: "2026-10-19" } };
    r = (await get("/api/my-review")).json;
    expect(r.rule).toMatchObject({ mistake: "behavior:revenge", source: "plan" });
  });

  it("stays under 50 KB with hundreds of buckets per dimension; days clamped", async () => {
    many = true;
    const r = await get("/api/my-review?days=365");
    expect(r.status).toBe(200);
    expect(r.json.days).toBe(90);
    expect(r.bytes).toBeLessThan(50 * 1024);
    for (const k of ["setup", "ticker", "hour"]) {
      expect(r.json.earn[k].length).toBeLessThanOrEqual(3);
      expect(r.json.lose[k].length).toBeLessThanOrEqual(3);
    }
  });
});

describe("lib/myReview helpers", () => {
  it("clampDays / hourKey / nextTradingDay", () => {
    expect([clampDays(undefined), clampDays("3"), clampDays("45"), clampDays("abc"), clampDays("1000")]).toEqual([30, 7, 45, 30, 90]);
    expect([hourKey("m540"), hourKey("m570"), hourKey("s:pre"), hourKey("m1500")]).toEqual(["09", "09", null, null]);
    expect(nextTradingDay("2026-10-16")).toBe("2026-10-19"); // Fri → Mon
    expect(nextTradingDay("2026-10-20")).toBe("2026-10-21");
  });
});
