/**
 * Wave 1, 1.13 — GET /api/propreports/my-freshness: the trader's «Сделки за прошлый торговый день» line. The DB is
 * mocked: the last finished trading day (calendar-aware), own trades only (no `trader` parameter is read), the
 * broker summary decides ok / mismatch, no sync after the close = behind, no linked account = no_account.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

let who = { id: 5, name: "Кирилл Б.", role: "trader" as const };
const state = vi.hoisted(() => ({
  accounts: 1,
  accountSync: "2026-10-19T20:20:00Z" as string | null,
  trades: 48,
  recon: [] as Array<{ status: string; diff: number; acknowledged: boolean; checked_at: string }>,
  calls: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      state.calls.push({ sql, params });
      if (sql.includes("FROM holiday_calendar")) {
        const closed = sql.includes("market closed") && params[0] === "2026-11-26";
        const early = sql.includes("early close") && params[0] === "2026-11-27";
        return { rows: closed || early ? [{ "?column?": 1 }] : [], rowCount: 0 };
      }
      if (sql.includes("FROM propreports_accounts")) return { rows: [{ n: state.accounts, last: state.accountSync }] };
      if (sql.includes("FROM propreports_reconcile_days")) return { rows: state.recon };
      if (sql.includes("FROM trades t")) return { rows: [{ n: state.trades, last_day: "2026-10-19", last_sync: null }] };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../propreports");
const { errorMiddleware } = await import("../../lib/http");
const F = await import("../../lib/propreports/freshness");

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
beforeEach(() => {
  who = { id: 5, name: "Кирилл Б.", role: "trader" };
  Object.assign(state, { accounts: 1, accountSync: "2026-10-19T20:20:00Z", trades: 48, recon: [], calls: [] });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T13:00:00Z")); // Tue 09:00 NY → the last trading day is Mon 19.10
});

async function get(path: string) {
  const r = await fetch(base + path);
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("GET /api/propreports/my-freshness", () => {
  it("own trades of the last trading day; a sync after the close and no broker check yet = ok", async () => {
    const r = await get("/api/propreports/my-freshness?trader=Закир");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ day: "2026-10-19", trades: 48, accounts: 1, broker: null, state: "ok", lastSyncedAt: "2026-10-19T20:20:00.000Z" });
    const tradeSql = state.calls.find((c) => c.sql.includes("FROM trades t"))!;
    expect(tradeSql.params).toEqual(["Кирилл Б.", "2026-10-19"]); // never the ?trader= of the query
  });

  it("the broker summary decides: ok → verified, missing_ours → mismatch (acknowledged rows count as ok)", async () => {
    state.recon = [{ status: "ok", diff: 0, acknowledged: false, checked_at: "2026-10-20T00:10:00Z" }];
    expect((await get("/api/propreports/my-freshness")).json).toMatchObject({ state: "ok", broker: { status: "ok", diff: 0 } });
    state.recon = [
      { status: "ok", diff: 0, acknowledged: false, checked_at: "2026-10-20T00:10:00Z" },
      { status: "missing_ours", diff: -37.5, acknowledged: false, checked_at: "2026-10-20T00:11:00Z" },
    ];
    expect((await get("/api/propreports/my-freshness")).json).toMatchObject({ state: "mismatch", broker: { status: "missing_ours", diff: -37.5 } });
    state.recon = [{ status: "mismatch", diff: 12, acknowledged: true, checked_at: "2026-10-20T00:10:00Z" }];
    expect((await get("/api/propreports/my-freshness")).json.state).toBe("ok");
  });

  it("no sync since the day's close = behind; no linked account = no_account", async () => {
    state.accountSync = "2026-10-19T18:00:00Z"; // 14:00 NY, before the 16:00 close
    expect((await get("/api/propreports/my-freshness")).json.state).toBe("behind");
    state.accounts = 0;
    expect((await get("/api/propreports/my-freshness")).json.state).toBe("no_account");
  });

  it("today counts 30 min after the close; a holiday is skipped; an early close counts from 13:30", async () => {
    expect(await F.lastFinishedDay(new Date("2026-10-20T20:10:00Z"))).toBe("2026-10-19"); // 16:10 NY
    expect(await F.lastFinishedDay(new Date("2026-10-20T20:30:00Z"))).toBe("2026-10-20"); // 16:30 NY
    expect(await F.lastFinishedDay(new Date("2026-11-27T14:00:00Z"))).toBe("2026-11-25"); // Fri 09:00, Thu closed
    expect(await F.lastFinishedDay(new Date("2026-11-27T18:30:00Z"))).toBe("2026-11-27"); // 13:30 on the early close
    expect(F.nyInstant("2026-10-19", 16 * 60).toISOString()).toBe("2026-10-19T20:00:00.000Z");
    expect(F.nyInstant("2026-11-27", 13 * 60).toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });

  it("anonymous → 401", async () => {
    const app = express();
    app.use("/api", router);
    app.use(errorMiddleware);
    const s = await new Promise<http.Server>((resolve) => { const x = app.listen(0, () => resolve(x)); });
    const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/propreports/my-freshness`);
    expect(r.status).toBe(401);
    await new Promise<void>((resolve) => s.close(() => resolve()));
  });
});
