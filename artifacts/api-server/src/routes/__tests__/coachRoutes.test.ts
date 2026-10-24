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

async function get(path: string): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path);
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
