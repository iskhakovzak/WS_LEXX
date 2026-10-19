/**
 * Dashboard fixes of the persona walkthrough (2026-10-19): violation lines in the reader's language (MAKSIM-12), the
 * equity curve summed on raw values (ROMAN-23), research patterns scoped to the trader (MAKSIM-43). DB and auth mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Q = { sql: string; params: unknown[] };
const calls: Q[] = [];
const state = vi.hoisted(() => ({ equity: [] as Record<string, unknown>[] }));

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM research/.test(sql)) return { rows: [{ id: 1, pattern_name: "Gap & Go", repeat_count: 3, confidence_level: 2 }], rowCount: 1 };
      if (/GROUP BY 1 ORDER BY 1 ASC/.test(sql)) return { rows: state.equity, rowCount: state.equity.length };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("../../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../lib/auth")>()),
  viewerRole: vi.fn(async () => "trader"),
  scopeTrader: vi.fn(async () => "Роман Ж."),
}));

const { default: router, violationLine } = await import("../dashboard");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: 136, name: "Роман Ж.", role: "trader" }; next(); });
  app.use(router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { calls.length = 0; state.equity = []; });

describe("violationLine (MAKSIM-12)", () => {
  const details = { msg: { key: "pause", params: { gap: 6, min: 5 } } };
  it("renders details.msg in the reader's language", () => {
    expect(violationLine("Вход через 6 мин после убытка (пауза 5 мин)", details, "min_pause_after_loss", "en")).toBe("Entry 6 min after a loss (pause 5 min)");
  });
  it("without details: the rule kind's label for EN / UZ, the stored text for RU", () => {
    expect(violationLine("Пауза нарушена", null, "min_pause_after_loss", "en")).toBe("Pause after a losing trade");
    expect(violationLine("Пауза нарушена", null, "min_pause_after_loss", "ru")).toBe("Пауза нарушена");
    expect(violationLine("Пауза нарушена", null, null, "en")).toBe("Пауза нарушена");
  });
});

describe("GET /dashboard/equity (ROMAN-23)", () => {
  it("sums raw day values and rounds once — the curve equals the week card", async () => {
    const day = (date: string, net: number) => ({ day: date, trades: 1, wins: 1, losses: 0, be: 0, pnl_gross: net + 1, pnl_net: net, fees: 1, pnl_count: 1, r: 0, r_count: 0, r_pos: 0, r_neg: 0 });
    state.equity = [day("2026-10-12", 100.004), day("2026-10-13", 100.004), day("2026-10-14", 100.004)];
    const r = await fetch(`${base}/dashboard/equity?period=week&date=2026-10-16`);
    const body = await r.json() as { totals: { pnl: number }; days: { cumPnl: number; pnl: number }[] };
    expect(body.totals.pnl).toBe(300.01); // 300.012 rounded once, not 3 × 100.00
    expect(body.days[2]!.cumPnl).toBe(300.01);
    expect(body.days[0]!.pnl).toBe(100);
  });
});

describe("GET /dashboard/toppatterns (MAKSIM-43)", () => {
  it("a trader's own scope reads only patterns linked to his trades", async () => {
    const r = await fetch(`${base}/dashboard/toppatterns`);
    expect(r.status).toBe(200);
    const q = calls.find((c) => /FROM research/.test(c.sql))!;
    expect(q.sql).toContain("WHERE id IN (SELECT t.pattern_id FROM trades t");
    expect(q.params).toEqual(["Роман Ж."]);
  });
});
