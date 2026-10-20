/**
 * Desk score without R (routes/leaderboard.ts scoreParts / profitFactorUsd / deskDefaultLimits and GET /leaderboard end
 * to end, DB mocked). Audit 2026-10-20 (team.md P1): R is known for 1 trade of 1 180, so PF fell back to 1.0 («a win
 * was there») and the drawdown to 1.0 (|0 R| / 10) — chert ($106, PF $ 1.688) ranked above Закир ($331, PF $ 1.722).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type TradeRow = { trader: string; day: string; result: string; net: number | null; gross: number | null; r: number | null };
let tradeRows: TradeRow[] = [];
const query = vi.fn(async (sql: string) => {
  if (/FROM users WHERE id/.test(sql)) return { rows: [{ role: "admin", name: "Admin" }] };
  if (/FROM trades t\s+WHERE t.trader IS NOT NULL AND t.deleted_at IS NULL AND/.test(sql) && /AS day/.test(sql)) return { rows: tradeRows };
  return { rows: [] };
});
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: (sql: string) => query(sql) } }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: 1, name: "Admin", role: "admin", guest: false, wards: [] })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});
process.env.JWT_SECRET ??= "vitest-only-secret";

const { default: router, deskScore, scoreParts, profitFactorUsd, deskDefaultLimits } = await import("../leaderboard");
const { errorMiddleware } = await import("../../lib/http");

const base = {
  expectancyR: null, profitFactorR: null, maxDrawdownR: 0, rCount: 0, violations: 0, windowDays: 20,
  dailyLossLimit: null, maxDrawdownLimit: null, accountSize: null,
} as const;

describe("score parts without R", () => {
  it("PF in $: wins / |losses|; wins without a loss yet = the number of winning trades; nothing → null", () => {
    expect(profitFactorUsd(260.61, -154.39, 7)).toBe(1.69);
    expect(profitFactorUsd(50, 0, 1)).toBe(1);
    expect(profitFactorUsd(150, 0, 3)).toBe(3);
    expect(profitFactorUsd(0, 0, 0)).toBeNull();
    expect(profitFactorUsd(0, -20, 0)).toBe(0);
  });

  it("chert-like: one winning trade, no R, no limits → PF and drawdown are not a free 1.0, score is not the maximum", () => {
    const one = { ...base, closed: 1, wins: 1, net: 50, profitFactorUsd: 1, tradingDays: 1, greenDays: 1, maxDrawdownNet: 0 };
    // Before the fix (no PF $, no limits): PF 1.0 and drawdown 1.0 → 100.
    const old = deskScore({ ...one, profitFactorUsd: null, maxDrawdownNet: null });
    expect(old.parts.profitFactor).toBeNull();
    expect(old.parts.drawdown).toBeNull();
    const d = deskDefaultLimits(null);
    expect(d).toEqual({ dailyLossLimit: 300, maxDrawdown: 2000, accountSize: 25000 });
    const s = deskScore({ ...one, dailyLossLimit: d.dailyLossLimit, maxDrawdownLimit: d.maxDrawdown, accountSize: d.accountSize });
    expect(s.parts.profitFactor).toBeCloseTo(0.333, 3);
    expect(s.parts.net).toBeCloseTo(0.542, 3);
    expect(s.score).toBe(77.5);
    expect(s.score!).toBeLessThan(100);
  });

  it("drawdown without limits and without R is not measured as 1.0 (excluded); with R it stays the 10R scale", () => {
    expect(scoreParts({ ...base, closed: 5, wins: 3, net: null, tradingDays: 3, greenDays: 2, maxDrawdownNet: null }).drawdown).toBeNull();
    expect(scoreParts({ ...base, closed: 5, wins: 3, net: null, tradingDays: 3, greenDays: 2, maxDrawdownNet: null, rCount: 5, maxDrawdownR: -2 }).drawdown).toBeCloseTo(0.8, 6);
  });

  it("October fixture: Закир ($330.94, PF $ 1.722, DD −306.59) ranks above chert ($106.22, PF $ 1.688) at the same share of green days", () => {
    const d = deskDefaultLimits(null);
    const lim = { dailyLossLimit: d.dailyLossLimit, maxDrawdownLimit: d.maxDrawdown, accountSize: d.accountSize };
    const zakir = deskScore({ ...base, ...lim, closed: 26, wins: 15, net: 330.94, profitFactorUsd: 1.722, tradingDays: 10, greenDays: 7, maxDrawdownNet: -306.59 });
    const chert = deskScore({ ...base, ...lim, closed: 13, wins: 7, net: 106.22, profitFactorUsd: 1.688, tradingDays: 10, greenDays: 7, maxDrawdownNet: -150 });
    expect(zakir.score!).toBeGreaterThan(chert.score!);
    expect(chert.parts.profitFactor).not.toBe(1);
    expect(chert.parts.drawdown).not.toBe(1);
  });
});

describe("GET /leaderboard (DB mocked)", () => {
  let server: http.Server;
  let url = "";
  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: 1, name: "Admin", role: "admin" }; next(); });
    app.use("/api", router);
    app.use(errorMiddleware);
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("one winning trade without R and without limits does not get the maximum score or a 1.0 PF / drawdown", async () => {
    tradeRows = [{ trader: "chert", day: "2026-10-20", result: "win", net: 50, gross: 52, r: null }];
    const res = await fetch(`${url}/api/leaderboard?format=desk&minTrades=0&from=2026-10-01&to=2026-10-20`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { trader: string; score: number; scoreParts: Record<string, number | null>; profitFactorUsd: number }[] };
    const row = body.rows.find((r) => r.trader === "chert")!;
    expect(row.profitFactorUsd).toBe(1);
    expect(row.scoreParts.profitFactor).not.toBe(1);
    expect(row.score).toBeLessThan(100);
  });
});
