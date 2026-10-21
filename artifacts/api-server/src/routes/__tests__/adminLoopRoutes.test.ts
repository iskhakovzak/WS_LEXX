/**
 * GET /api/admin/loop-yesterday (routes/admin-loop.ts, Волна 2 п. 2.4) over a mocked pool, route × role: admin 200
 * (whole desk), curator 200 with «Моя группа» by default and «Все» on request, trader 403, anonymous 401, guest
 * read-only; `?date` picks the day, a bad / future date → 400 INVALID_DATE.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest"; guest?: boolean };
const TRADER: Who = { id: 5, name: "Trader T.", role: "trader" };
const CURATOR: Who = { id: 3, name: "Curator C.", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin A.", role: "admin" };
const GUEST: Who = { id: 0, name: "guest", role: "guest", guest: true };
let who: Who | null = ADMIN;

const sqls = vi.hoisted(() => [] as { sql: string; params: unknown[] }[]);
vi.mock("@workspace/db", () => {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    sqls.push({ sql, params });
    // lib/people/deskGroups: the curator's group (groupMembersOf) and his assignments
    if (/JOIN users c ON c\.id = g\.curator_id/.test(sql)) return { rows: params[0] === "Curator C." ? [{ name: "Trader T." }] : [] };
    if (/assigned_mentor = \$1/.test(sql)) return { rows: [] };
    // lib/admin/loopYesterday reads
    if (/FROM users u LEFT JOIN desk_groups/.test(sql)) {
      return { rows: [
        { name: "Trader T.", group_name: "Alpha", telegram_chat_id: "123" },
        { name: "Other O.", group_name: null, telegram_chat_id: "" },
      ] };
    }
    if (/FROM trader_plans/.test(sql)) return { rows: [{ trader: "Trader T.", created: new Date("2026-10-19T12:00:00Z") }] };
    if (/FROM trades t/.test(sql)) return { rows: [{ trader: "Trader T.", n: 3 }, { trader: "Other O.", n: 1 }] };
    if (/FROM eod_days/.test(sql)) {
      return { rows: [{ trader: "Trader T.", closed_at: new Date("2026-10-19T20:30:00Z"), reviewed_at: new Date("2026-10-20T13:30:00Z"), reviewed_by: "Curator C." }] };
    }
    return { rows: [], rowCount: 0 };
  });
  return { db: {}, pool: { query, connect: vi.fn(async () => ({ query, release: () => undefined })) } };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { Router } = await import("express");
const { mountLoopYesterdayRoutes } = await import("../admin-loop");
const { errorMiddleware } = await import("../../lib/http");
const { nyDate } = await import("../../lib/tradingDate");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (who) {
      (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
      (req as unknown as { permActor: unknown }).permActor = { id: who.id, name: who.name, role: who.role, guest: !!who.guest, wards: [] };
    }
    next();
  });
  const router = Router();
  mountLoopYesterdayRoutes(router);
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = ADMIN; sqls.length = 0; });

async function get(path: string): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path);
  return { status: r.status, json: await r.json().catch(() => null) };
}

describe("GET /admin/loop-yesterday", () => {
  it("admin: the whole desk for the asked day, rows + totals", async () => {
    const r = await get("/api/admin/loop-yesterday?date=2026-10-19");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ date: "2026-10-19", scope: "all", mine: false, slaHours: 24 });
    expect(r.json.rows.map((x: { name: string }) => x.name)).toEqual(["Other O.", "Trader T."]);
    expect(r.json.rows[1]).toMatchObject({
      group: "Alpha", plan: true, planBeforeOpen: true, trades: 3, closed: true, reviewed: true, reviewedBy: "Curator C.", reviewHours: 17, telegram: true,
    });
    expect(r.json.rows[0]).toMatchObject({ group: null, plan: false, trades: 1, closed: false, reviewHours: null, telegram: false });
    expect(r.json.totals).toEqual({ traders: 2, plan: 1, planBeforeOpen: 1, traded: 2, trades: 4, closed: 1, reviewed: 1, waiting: 0, overdue: 0, telegram: 1 });
    // every store is read for that date
    for (const re of [/FROM trader_plans/, /FROM trades t/, /FROM eod_days/]) {
      expect(sqls.find((q) => re.test(q.sql))?.params).toEqual(["2026-10-19"]);
    }
  });

  it("without ?date: the last finished trading day (before today, a weekday)", async () => {
    const r = await get("/api/admin/loop-yesterday");
    expect(r.status).toBe(200);
    const d: string = r.json.date;
    expect(d < nyDate()).toBe(true);
    expect([0, 6]).not.toContain(new Date(`${d}T12:00:00Z`).getUTCDay());
  });

  it("curator: «Моя группа» by default, «Все» on request", async () => {
    who = CURATOR;
    const mine = await get("/api/admin/loop-yesterday?date=2026-10-19");
    expect(mine.status).toBe(200);
    expect(mine.json).toMatchObject({ scope: "group", mine: true });
    expect(mine.json.rows.map((x: { name: string }) => x.name)).toEqual(["Trader T."]);
    expect(mine.json.totals.traders).toBe(1);
    const all = await get("/api/admin/loop-yesterday?date=2026-10-19&scope=all");
    expect(all.json).toMatchObject({ scope: "all", mine: true });
    expect(all.json.rows).toHaveLength(2);
  });

  it("trader 403, guest read-only, anonymous 401", async () => {
    who = TRADER;
    const t = await get("/api/admin/loop-yesterday");
    expect([t.status, t.json.code]).toEqual([403, "FORBIDDEN"]);
    who = GUEST;
    expect((await get("/api/admin/loop-yesterday")).json.code).toBe("GUEST_READ_ONLY");
    who = null;
    expect((await get("/api/admin/loop-yesterday")).status).toBe(401);
    expect(sqls.some((q) => /FROM eod_days/.test(q.sql))).toBe(false);
  });

  it("a bad or future date → 400 INVALID_DATE", async () => {
    for (const d of ["2026-13-01", "yesterday", "2026-02-30", "2999-01-01"]) {
      const r = await get(`/api/admin/loop-yesterday?date=${d}`);
      expect([r.status, r.json.code]).toEqual([400, "INVALID_DATE"]);
    }
  });
});
