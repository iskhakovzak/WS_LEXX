/**
 * GET /office-stats/recommendations — who sees what (DB and the desk computation mocked; synthetic names):
 *   anonymous 401, guest 403;
 *   trader   — desk kinds only, no $ (money, …Usd params), no names, no staff link;
 *   curator  — every kind, no $, names only within the team.read scope (assigned scope via a desk override);
 *   admin    — $ and every name;
 *   the viewer's own «скрыть на неделю» entries move to `hidden`, expired ones are ignored.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { OfficeRec } from "../../lib/officeRecs/types";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest" } | null;
const TRADER = { id: 5, name: "Synth-Trader", role: "trader" as const };
const CURATOR = { id: 2, name: "Synth-Curator", role: "curator" as const };
const ADMIN = { id: 1, name: "Synth-Admin", role: "admin" as const };
let who: Who = TRADER;
let assignedScope = false;
let settings: Record<string, unknown> = {};

const rec = (over: Partial<OfficeRec>): OfficeRec => ({
  id: "leak:time:15:30-16:00", kind: "leak", audience: "desk", priority: 10, confidence: 2,
  params: { slice: "time:15:30-16:00", medianPerDayUsd: 12 }, money: { mean: -5, lo: -8, hi: -2, per: "trade" },
  rel: { mean: -10, lo: -15, hi: -4, unit: "bps" }, affected: { count: 2, names: ["Synth-A", "Synth-B"] },
  action: { kind: "whatif", href: "/what-if?trader=__all__&r=abc" }, secondary: { kind: "rules", href: "/rules" },
  basis: { trades: 300, days: 60, traders: 6, from: "2026-05-01", to: "2026-10-23", q: 0.02 }, ...over,
});
const RECS = [rec({}), rec({ id: "attention:noReview", kind: "attention", audience: "staff", money: null, secondary: null })];

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string) => {
      if (/SELECT settings FROM users WHERE id = \$1/.test(sql)) return { rows: [{ settings }] };
      return { rows: [] };
    }),
  },
}));
vi.mock("../../lib/officeRecs/store", () => ({
  deskRecs: vi.fn(async () => ({ asOf: "2026-10-23", computedAt: "2026-10-23T20:00:00.000Z", window: { from: "2026-05-01", to: "2026-10-23", days: 120 }, recs: RECS })),
}));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { buildEffectiveMatrix, readableTraders } = await import("../../lib/permissionsMatrix");
  const actor = () => (who ? { id: who.id, name: who.name, role: who.role, guest: who.role === "guest", wards: assignedScope ? ["Synth-B"] : [] } : null);
  const matrix = () => buildEffectiveMatrix(assignedScope ? [{ role: "curator", capability: "team.read", allowed: true, scope: "assigned" }] : []);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    readScope: vi.fn(async (_req: unknown, cap: never) => readableTraders(matrix(), actor() as never, cap)),
  };
});
vi.mock("../../lib/tradingDate", async (orig) => ({ ...(await orig<typeof import("../../lib/tradingDate")>()), nyDate: () => "2026-10-23" }));
process.env.JWT_SECRET ??= "vitest-only-secret";

const { default: router } = await import("../officeRecs");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { if (who) (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = TRADER; assignedScope = false; settings = {}; });

const get = async () => {
  const r = await fetch(`${base}/api/office-stats/recommendations`);
  return { status: r.status, body: (await r.json()) as { role: string; recs: OfficeRec[]; hidden: { id: string }[] } };
};

describe("GET /office-stats/recommendations", () => {
  it("anonymous 401, guest 403", async () => {
    who = null;
    expect((await get()).status).toBe(401);
    who = { id: 0, name: "guest", role: "guest" };
    expect((await get()).status).toBe(403);
  });

  it("trader: anonymised desk aggregates only", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.role).toBe("trader");
    expect(body.recs.map((r) => r.kind)).toEqual(["leak"]);
    const r = body.recs[0];
    expect(r.money).toBeNull();
    expect(r.params.medianPerDayUsd).toBeUndefined();
    expect(r.affected).toEqual({ count: 2, names: [] });
    expect(r.secondary).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/Synth-[AB]/);
  });

  it("curator with an assigned scope: names of wards only, no $", async () => {
    who = CURATOR;
    assignedScope = true;
    const { body } = await get();
    expect(body.recs.map((r) => r.kind)).toEqual(["leak", "attention"]);
    expect(body.recs[0].money).toBeNull();
    expect(body.recs[0].affected.names).toEqual(["Synth-B"]);
    expect(JSON.stringify(body)).not.toContain("Synth-A");
  });

  it("curator with the default desk scope: every name, still no $", async () => {
    who = CURATOR;
    const { body } = await get();
    expect(body.recs[0].affected.names).toEqual(["Synth-A", "Synth-B"]);
    expect(body.recs[0].money).toBeNull();
  });

  it("admin: $ and names; own hidden entries move out, expired ones stay", async () => {
    who = ADMIN;
    settings = { officeRecsHidden: { "attention:noReview": "2026-10-29", "leak:time:15:30-16:00": "2026-10-01" } };
    const { body } = await get();
    expect(body.recs.map((r) => r.id)).toEqual(["leak:time:15:30-16:00"]);
    expect(body.recs[0].money).not.toBeNull();
    expect(body.recs[0].affected.names).toEqual(["Synth-A", "Synth-B"]);
    expect(body.hidden.map((h) => h.id)).toEqual(["attention:noReview"]);
  });
});
