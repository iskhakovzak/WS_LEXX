/**
 * routes/coach.ts — access: the edge map is personal data (own map for anyone, another trader only with a team
 * capability inside the reader's scope), the intervention log is staff-only (journal.review, assigned scope honoured).
 * The DB, the actor and the stores are mocked; synthetic names only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin"; wards: string[] };
const TRADER: Who = { id: 5, name: "Trader One", role: "trader", wards: [] };
const CURATOR: Who = { id: 3, name: "Curator One", role: "curator", wards: ["Trader One"] };
let who: Who = TRADER;

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  // assigned scope for curators: they act only on their wards
  const matrix = actual.buildEffectiveMatrix([
    { role: "curator", capability: "journal.review", allowed: true, scope: "assigned" },
    { role: "curator", capability: "journal.read.team", allowed: true, scope: "assigned" },
  ]);
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards })),
    getEffectiveMatrix: vi.fn(async () => matrix),
    // lib/auth personalTrader asks can() (an in-module call would bypass the mocked resolveActor)
    can: vi.fn(async (_req: unknown, cap: never, target?: never) => actual.evaluate(matrix, { id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards } as never, cap, target)),
  };
});
const store = vi.hoisted(() => ({
  edgeMapView: vi.fn(async (trader: string) => ({ trader, asOf: "2026-10-20", earn: [], lose: [] })),
}));
vi.mock("../../lib/edgeMapStore", () => store);
const log = vi.hoisted(() => ({ listInterventions: vi.fn(async () => []) }));
vi.mock("../../lib/interventions/log", () => log);
const plateau = vi.hoisted(() => ({
  stuckList: vi.fn(async (traders: string[]) => traders.map((trader) => ({ trader }))),
  scheduleReview: vi.fn(async (trader: string) => (trader === "Trader One" ? { meetingId: 7, metAt: "2026-10-26T16:00:00.000Z", interventionId: 9 } : null)),
}));
vi.mock("../../lib/plateauStore", () => plateau);
vi.mock("../../lib/curatorRoster", () => ({
  loadRoster: vi.fn(async (_req: unknown, scope: unknown) => ({ traders: who.wards, scope: scope === "desk" ? "desk" : "mine", wards: who.wards })),
}));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../coach");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
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
beforeEach(() => { who = TRADER; vi.clearAllMocks(); });

async function get(path: string, method = "GET"): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" } });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const enc = encodeURIComponent;

describe("GET /edge/map", () => {
  it("a trader reads his own map (no name or his own name)", async () => {
    expect((await get("/api/edge/map")).status).toBe(200);
    expect(store.edgeMapView).toHaveBeenLastCalledWith("Trader One");
    expect((await get(`/api/edge/map?trader=${enc("Trader One")}`)).status).toBe(200);
  });
  it("a trader cannot read another trader's map", async () => {
    const r = await get(`/api/edge/map?trader=${enc("Trader Two")}`);
    expect(r.status).toBe(403);
    expect(store.edgeMapView).not.toHaveBeenCalled();
  });
  it("a curator reads a ward, not someone outside his scope", async () => {
    who = CURATOR;
    expect((await get(`/api/edge/map?trader=${enc("Trader One")}`)).status).toBe(200);
    expect((await get(`/api/edge/map?trader=${enc("Trader Two")}`)).status).toBe(403);
  });
});

describe("GET /interventions", () => {
  it("staff only: a trader gets 403 even for himself", async () => {
    expect((await get(`/api/interventions?trader=${enc("Trader One")}`)).status).toBe(403);
    expect(log.listInterventions).not.toHaveBeenCalled();
  });
  it("a curator reads his ward's log; outside his scope → 403; the trader is required", async () => {
    who = CURATOR;
    const ok = await get(`/api/interventions?trader=${enc("Trader One")}`);
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ trader: "Trader One", interventions: [] });
    expect((await get(`/api/interventions?trader=${enc("Trader Two")}`)).status).toBe(403);
    expect((await get("/api/interventions")).status).toBe(400);
  });
});

describe("«Застряли» (R6)", () => {
  it("staff only: a trader never gets the list or the action", async () => {
    expect((await get("/api/curator/stuck")).status).toBe(403);
    expect((await get(`/api/curator/stuck/${enc("Trader One")}/one-on-one`, "POST")).status).toBe(403);
    expect(plateau.stuckList).not.toHaveBeenCalled();
    expect(plateau.scheduleReview).not.toHaveBeenCalled();
  });
  it("a curator gets his roster's list; schedules a 1:1 for a ward (201), not for someone outside his scope", async () => {
    who = CURATOR;
    const list = await get("/api/curator/stuck?scope=mine");
    expect(list.status).toBe(200);
    expect(list.json).toEqual({ scope: "mine", items: [{ trader: "Trader One" }] });
    const ok = await get(`/api/curator/stuck/${enc("Trader One")}/one-on-one`, "POST");
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ meetingId: 7, interventionId: 9 });
    expect(plateau.scheduleReview).toHaveBeenCalledWith("Trader One", "Curator One", "ru");
    expect((await get(`/api/curator/stuck/${enc("Trader Two")}/one-on-one`, "POST")).status).toBe(403);
  });
  it("no current plateau → 404 TRADER_NOT_FOUND", async () => {
    who = { ...CURATOR, wards: ["Trader One", "Trader Three"] };
    const r = await get(`/api/curator/stuck/${enc("Trader Three")}/one-on-one`, "POST");
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("TRADER_NOT_FOUND");
  });
});
