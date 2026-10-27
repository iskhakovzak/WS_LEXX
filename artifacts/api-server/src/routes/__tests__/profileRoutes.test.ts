/**
 * routes/profile.ts — who may open whose profile (over a mocked service, the real permission matrix):
 * own profile always; staff any desk member (curator under «assigned» scope only wards); a trader never another trader;
 * a missing id is 404 only for a viewer who may read the desk; curator steps and the style peer are staff-only extras.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin"; wards: string[] };
const TRADER: Who = { id: 5, name: "Trader A", role: "trader", wards: [] };
const OTHER: Who = { id: 6, name: "Trader B", role: "trader", wards: [] };
const CURATOR: Who = { id: 3, name: "Curator C", role: "curator", wards: ["Trader A"] };
const ADMIN: Who = { id: 1, name: "Admin D", role: "admin", wards: [] };
let who: Who = TRADER;
let assignedScope = false;

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards });
  const matrix = () => actual.buildEffectiveMatrix(assignedScope ? [
    { role: "curator", capability: "team.read", allowed: true, scope: "assigned" },
    { role: "curator", capability: "journal.review", allowed: true, scope: "assigned" },
  ] : []);
  // The real helpers call resolveActor inside their own module, so the request-level checks are rebuilt on the pure core.
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix()),
    can: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.evaluate>[2], target?: { trader?: string | null }) => actual.evaluate(matrix(), actor(), cap, target)),
    readScope: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.evaluate>[2]) => actual.readableTraders(matrix(), actor(), cap)),
  };
});
const people = [TRADER, OTHER, CURATOR, ADMIN];
const load = vi.hoisted(() => ({
  personById: vi.fn(),
  personByName: vi.fn(),
}));
vi.mock("../../lib/profile/load", () => load);
const service = vi.hoisted(() => ({ buildProfile: vi.fn(async (p: { name: string }, v: unknown) => ({ person: { name: p.name }, viewer: v })) }));
vi.mock("../../lib/profile/service", () => service);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../profile");
const { errorMiddleware } = await import("../../lib/http");

const row = (w: Who) => ({ id: w.id, name: w.name, nameLatin: null, role: w.role, joinedAt: null, curator: null, mentor: null, quoteFavs: [] });

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
beforeEach(() => {
  who = TRADER;
  assignedScope = false;
  vi.clearAllMocks();
  load.personById.mockImplementation(async (id: number) => { const w = people.find((p) => p.id === id); return w ? row(w) : null; });
  load.personByName.mockImplementation(async (name: string) => { const w = people.find((p) => p.name === name); return w ? row(w) : null; });
});

async function get(path: string): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path);
  return { status: r.status, json: await r.json().catch(() => null) };
}
const lastViewer = () => (service.buildProfile.mock.calls.at(-1) as unknown[] | undefined)?.[1] as { self: boolean; curatorSteps: boolean; peerScope: unknown };

describe("own profile", () => {
  it("a trader opens their own profile at /me and by id, without staff extras", async () => {
    const me = await get("/api/profile/me");
    expect(me.status).toBe(200);
    expect(me.json.person.name).toBe("Trader A");
    expect(lastViewer()).toEqual({ self: true, curatorSteps: false, peerScope: false });
    expect((await get("/api/profile/5")).status).toBe(200);
    expect(lastViewer().self).toBe(true);
  });
  it("staff see their own profile with the peer tool but never their own curator steps", async () => {
    who = ADMIN;
    expect((await get("/api/profile/me")).status).toBe(200);
    expect(lastViewer()).toEqual({ self: true, curatorSteps: false, peerScope: null });
  });
});

describe("other people", () => {
  it("a trader is denied another trader's profile (and learns nothing about unknown ids)", async () => {
    const r = await get("/api/profile/6");
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("PERSONAL_DATA_FORBIDDEN");
    expect(service.buildProfile).not.toHaveBeenCalled();
    const missing = await get("/api/profile/999");
    expect(missing.status).toBe(403);
    expect(missing.json.code).toBe("PERSONAL_DATA_FORBIDDEN");
  });
  it("a trader cannot open a staff member's profile either", async () => {
    expect((await get("/api/profile/1")).status).toBe(403);
  });
  it("a curator (desk scope by default) opens any member with curator steps and the peer", async () => {
    who = CURATOR;
    expect((await get("/api/profile/6")).status).toBe(200);
    expect(lastViewer()).toEqual({ self: false, curatorSteps: true, peerScope: null });
    expect((await get("/api/profile/999")).status).toBe(404);
  });
  it("a curator under «assigned» scope: wards yes, others no; the peer stays inside the scope", async () => {
    who = CURATOR;
    assignedScope = true;
    expect((await get("/api/profile/5")).status).toBe(200);
    expect(lastViewer().curatorSteps).toBe(true);
    expect(lastViewer().peerScope).toEqual(["Curator C", "Trader A"]);
    const denied = await get("/api/profile/6");
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe("PERSONAL_DATA_FORBIDDEN");
  });
  it("an admin opens anyone", async () => {
    who = ADMIN;
    expect((await get("/api/profile/5")).status).toBe(200);
    expect((await get("/api/profile/3")).status).toBe(200);
    expect(lastViewer()).toEqual({ self: false, curatorSteps: true, peerScope: null });
  });
  it("rejects a malformed id", async () => {
    who = ADMIN;
    expect((await get("/api/profile/abc")).status).toBe(400);
  });
});
