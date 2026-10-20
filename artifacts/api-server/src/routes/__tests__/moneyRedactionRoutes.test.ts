/**
 * Wave 1, item 1.22 — other traders' money is staff-only on shared screens (lib/moneyVisibility), route × role:
 *   GET /leaderboard                       trader own row keeps $; a trader whose desk override opens team.read sees
 *                                          other rows without $ (R, %, score stay); curator / admin see every $.
 *   GET /discussions/ticker-context/:t     desk $ on the ticker: staff; a trader only over ≥ 3 traders.
 *   GET /discussions/:id/entity            the attached trade of another trader: $ null for a trader, kept for staff.
 * «Топ дня» and «Деск на тикере» are covered in topRoutes.test.ts / deskDayViews.test.ts. DB mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const KIRILL: Who = { id: 5, name: "Kirill", role: "trader" };
const CURATOR: Who = { id: 2, name: "Anton", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin", role: "admin" };
let who: Who = KIRILL;
let traderTeamRead = false;
let tickerTraders = 2;

const baseRows = [
  { trader: "Kirill", day: "2026-10-15", result: "win", net: 120, gross: 125, r: 1.2 },
  { trader: "Roman", day: "2026-10-15", result: "loss", net: -300, gross: -295, r: -1 },
];
/** Three more qualified traders (2.14: a trader sees a ranked list only with ≥ 5 qualified). */
const moreRows = ["Ilya", "Olga", "Denis"].map((trader) => ({ trader, day: "2026-10-15", result: "win", net: 10, gross: 11, r: 0.1 }));
let tradeRows = baseRows;
const query = vi.fn(async (sql: string, _params?: unknown[]) => {
  if (/FROM users WHERE id = \$1 AND active = true/.test(sql)) return { rows: [{ role: who.role, name: who.name }] };
  if (/FROM trades t\s+WHERE t.trader IS NOT NULL AND t.deleted_at IS NULL AND/.test(sql) && /AS day/.test(sql)) return { rows: tradeRows };
  if (/COUNT\(DISTINCT t.trader\)::int AS traders/.test(sql)) {
    return { rows: [{ count: 9, lastDate: "2026-10-15", traders: tickerTraders, wins: 5, losses: 4, be: 0, sumR: 2.5, netPnl: 404.94 }] };
  }
  if (/FROM discussions d\s+LEFT JOIN discussion_reads/.test(sql)) {
    return { rows: [{ id: 7, trade_id: 900, event_id: null, idea_id: null, playbook_id: null, journal_date: null, ticker: "SPCX", trader: "Roman", audience: "all", deleted_at: null }] };
  }
  if (/SELECT trader FROM trades WHERE id = \$1/.test(sql)) return { rows: [{ trader: "Roman" }] };
  if (/FROM trades t WHERE t.id = \$1 AND t.deleted_at IS NULL/.test(sql)) {
    return { rows: [{ id: 900, ticker: "SPCX", date: "2026-10-15", side: "Long", result: "loss", res: "loss", entry: 10, exit: 9, stop: 8, qty: 300, pnl: -295, fees: 5, net_pnl: -300, signed_r: -1, trader: "Roman", close_date: "2026-10-15" }] };
  }
  return { rows: [], rowCount: 0 };
});
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: (sql: string, params?: unknown[]) => query(sql, params) } }));
// The desk matrix: defaults, plus (traderTeamRead) an owner override that opens team reads to traders.
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { buildEffectiveMatrix, evaluate, readableTraders } = await import("../../lib/permissionsMatrix");
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  const matrix = () => buildEffectiveMatrix(
    traderTeamRead ? [{ role: "trader", capability: "team.read", allowed: true }, { role: "trader", capability: "trades.read.team", allowed: true }] : [],
  );
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix()),
    can: vi.fn(async (_req: unknown, cap: never, target?: never) => evaluate(matrix(), actor(), cap, target)),
    readScope: vi.fn(async (_req: unknown, cap: never) => readableTraders(matrix(), actor(), cap)),
  };
});
process.env.JWT_SECRET ??= "vitest-only-secret";

const { default: leaderboard } = await import("../leaderboard");
const { default: discussions } = await import("../discussions");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", leaderboard, discussions);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = KIRILL; traderTeamRead = false; tickerTraders = 2; tradeRows = baseRows; });

const get = async (path: string) => {
  const r = await fetch(base + path);
  return { status: r.status, json: (await r.json()) as any };
};
const board = () => get("/api/leaderboard?format=desk&minTrades=0&from=2026-10-01&to=2026-10-20");

describe("GET /leaderboard × role", () => {
  it("trader: own row only, with own $", async () => {
    const r = await board();
    expect(r.status).toBe(200);
    expect(r.json.rows.map((x: any) => x.trader)).toEqual(["Kirill"]);
    expect(r.json.rows[0]).toMatchObject({ net: 120, totalPnl: 120 });
  });
  it("trader with a team.read desk override, < 5 qualified (2.14): own row only, no place («Ваша строка»)", async () => {
    traderTeamRead = true;
    const r = await board();
    expect(r.json.qualifiedCount).toBe(2);
    expect(r.json.rows.map((x: any) => [x.trader, x.rank])).toEqual([["Kirill", null]]);
  });
  it("trader with a team.read desk override, ≥ 5 qualified: other rows come without $ (R, % and score stay)", async () => {
    traderTeamRead = true;
    tradeRows = [...baseRows, ...moreRows];
    const r = await board();
    const roman = r.json.rows.find((x: any) => x.trader === "Roman");
    const own = r.json.rows.find((x: any) => x.trader === "Kirill");
    expect(roman).toMatchObject({ net: null, gross: null, totalPnl: null, bestTrade: null, maxDrawdownNet: null, totalR: -1, winrate: 0 });
    expect(roman.score).not.toBeUndefined();
    expect(own).toMatchObject({ net: 120 });
  });
  it.each([CURATOR, ADMIN])("$s sees every trader's $", async (w) => {
    who = w;
    const r = await board();
    expect(r.json.rows.find((x: any) => x.trader === "Roman")).toMatchObject({ net: -300, totalPnl: -300 });
  });
});

describe("GET /discussions/ticker-context/:ticker × role", () => {
  it("trader, 2 traders on the ticker: desk $ hidden, R and win rate stay", async () => {
    const r = await get("/api/discussions/ticker-context/SPCX");
    expect(r.status).toBe(200);
    expect(r.json.trades).toMatchObject({ netPnl: null, sumR: 2.5, winRate: 56 });
  });
  it("trader, ≥ 3 traders: the desk sum is shown", async () => {
    tickerTraders = 3;
    expect((await get("/api/discussions/ticker-context/SPCX")).json.trades.netPnl).toBe(404.94);
  });
  it("curator: desk $ shown", async () => {
    who = CURATOR;
    expect((await get("/api/discussions/ticker-context/SPCX")).json.trades.netPnl).toBe(404.94);
  });
});

describe("GET /discussions/:id/entity × role (another trader's trade)", () => {
  it("trader allowed to read team trades still gets the $ fields null", async () => {
    traderTeamRead = true;
    const r = await get("/api/discussions/7/entity");
    expect(r.status).toBe(200);
    expect(r.json.trade).toMatchObject({ trader: "Roman", pnl: null, fees: null, netPnl: null, qty: null, signedR: -1 });
  });
  it("curator sees the $", async () => {
    who = CURATOR;
    const r = await get("/api/discussions/7/entity");
    expect(r.json.trade).toMatchObject({ trader: "Roman", netPnl: -300, qty: 300 });
  });
});
