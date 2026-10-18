/**
 * routes/gamification.ts — access and validation over mocked services: a trader reads own numbers (not another
 * trader's), staff read a ward; the catalog editor is admin-only (settings.manage) with item checks; a trader requests
 * only active, eligible rewards; the queue is scoped (admin: all, curator: own traders); grant / decline only by the
 * trader's curator or an admin; titles must be earned; public titles leave out users who hide achievements.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin"; wards: string[] };
const TRADER: Who = { id: 5, name: "Кирилл Б.", role: "trader", wards: [] };
const CURATOR: Who = { id: 3, name: "Ольга Н.", role: "curator", wards: ["Кирилл Б."] };
const OTHER_CURATOR: Who = { id: 4, name: "Сергей В.", role: "curator", wards: ["Кирилл Б."] };
const ADMIN: Who = { id: 1, name: "Дмитрий К.", role: "admin", wards: [] };
let who: Who = TRADER;

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([{ role: "curator", capability: "journal.review", allowed: true, scope: "assigned" }])),
  };
});
const service = vi.hoisted(() => ({
  gamificationMe: vi.fn(async (v: unknown, o: unknown) => ({ v, o })),
  seasonState: vi.fn(async () => ({ key: "2026-10" })),
  leagueState: vi.fn(async () => null),
}));
vi.mock("../../lib/gamification/service", () => service);
const people = vi.hoisted(() => ({
  userInfo: vi.fn(async (name: string) => (name === "Кирилл Б." ? { role: "trader", active: true, curator: "Ольга Н." } : name === "Ольга Н." ? { role: "curator", active: true, curator: null } : null)),
  participants: vi.fn(async () => [{ name: "Кирилл Б.", curator: "Ольга Н.", share: true }, { name: "Максим Р.", curator: null, share: true }]),
  hiddenUsers: vi.fn(async () => new Set(["Максим Р."])),
  setChosenTitle: vi.fn(async () => undefined),
}));
vi.mock("../../lib/gamification/people", () => people);
const titles = vi.hoisted(() => ({
  earnedTitles: vi.fn(async (t: string[]) => new Map(t.map((n) => [n, [{ key: "iron", earnedAt: "2026-10-01" }]]))),
  activeTitles: vi.fn(async () => new Map([["Кирилл Б.", "iron"], ["Максим Р.", "analyst"]])),
}));
vi.mock("../../lib/gamification/titlesStore", () => titles);
const item = (over: Record<string, unknown> = {}) => ({ id: 3, title: "Книга", description: null, active: true, stock: null, condition: { kind: "level", ref: "1", tier: null, rank: null }, ...over });
const grant = { id: 9, itemId: 3, trader: "Кирилл Б.", status: "requested", at: "2026-10-18T00:00:00Z", by: null, title: "Книга" };
const store = vi.hoisted(() => ({
  itemById: vi.fn(),
  listItems: vi.fn(async () => []),
  pendingCount: vi.fn(async () => 2),
  insertItem: vi.fn(async (i: object) => ({ id: 10, ...i })),
  updateItem: vi.fn(async (id: number, i: object): Promise<object | null> => ({ id, ...i })),
  grantById: vi.fn(),
  requestedGrants: vi.fn(async () => []),
}));
vi.mock("../../lib/gamification/rewardsStore", () => store);
const rs = vi.hoisted(() => ({ requestReward: vi.fn(), decideReward: vi.fn() }));
vi.mock("../../lib/gamification/rewardsService", () => rs);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../gamification");
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
beforeEach(() => {
  who = TRADER;
  vi.clearAllMocks();
  store.itemById.mockResolvedValue(item());
  store.grantById.mockResolvedValue(grant);
  rs.requestReward.mockResolvedValue({ ...grant, status: "requested" });
  rs.decideReward.mockResolvedValue({ ok: true, grant: { ...grant, status: "granted" } });
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const enc = encodeURIComponent;

describe("reads", () => {
  it("a trader reads own numbers, not another trader's", async () => {
    expect((await call("GET", "/api/gamification/me")).status).toBe(200);
    expect(service.gamificationMe).toHaveBeenCalledWith({ subject: "Кирилл Б.", staff: false }, { isTrader: true });
    expect((await call("GET", `/api/gamification/me?trader=${enc("Максим Р.")}`)).status).toBe(403);
    expect((await call("GET", "/api/gamification/season?key=2026-13")).status).toBe(400);
    expect((await call("GET", "/api/gamification/season?key=2026-09")).status).toBe(200);
    expect(service.seasonState).toHaveBeenCalledWith({ subject: "Кирилл Б.", staff: false }, "2026-09");
  });
  it("a curator reads a ward (staff view); league without teams answers an empty list", async () => {
    who = CURATOR;
    expect((await call("GET", `/api/gamification/me?trader=${enc("Кирилл Б.")}`)).status).toBe(200);
    expect(service.gamificationMe).toHaveBeenCalledWith({ subject: "Кирилл Б.", staff: true }, { isTrader: true });
    expect((await call("GET", "/api/gamification/league")).json).toEqual({ season: null, teams: [] });
  });
  it("public titles leave out users who hide achievements", async () => {
    expect((await call("GET", "/api/gamification/titles")).json).toEqual({ titles: { "Кирилл Б.": "iron" } });
  });
});

describe("titles", () => {
  it("only an earned title; null clears", async () => {
    expect((await call("PUT", "/api/gamification/title", { key: "unbreakable" })).json.code).toBe("TITLE_NOT_EARNED");
    expect((await call("PUT", "/api/gamification/title", { key: "iron" })).status).toBe(200);
    expect(people.setChosenTitle).toHaveBeenCalledWith("Кирилл Б.", "iron");
    expect((await call("PUT", "/api/gamification/title", { key: null })).status).toBe(200);
    expect(people.setChosenTitle).toHaveBeenLastCalledWith("Кирилл Б.", null);
  });
});

describe("catalog editor", () => {
  const body = { title: "Худи", description: "Мерч", condition: { kind: "achievement", ref: "contract_streak", tier: "gold" }, active: false, stock: 20 };
  it("admin only (settings.manage)", async () => {
    expect((await call("GET", "/api/gamification/rewards/items")).status).toBe(403);
    who = CURATOR;
    expect((await call("POST", "/api/gamification/rewards/items", body)).status).toBe(403);
    who = ADMIN;
    const r = await call("GET", "/api/gamification/rewards/items");
    expect(r.status).toBe(200);
    expect(r.json.pending).toBe(2);
    expect(r.json.options.levels).toBe(4);
    expect(r.json.options.achievements.find((a: { id: string }) => a.id === "contract_streak").tiers).toEqual(["bronze", "silver", "gold", "platinum"]);
    expect(r.json.options.achievements.find((a: { id: string }) => a.id === "tier_up").tiers).toEqual(["bronze", "silver", "gold"]);
    expect(r.json.options.achievements.find((a: { id: string }) => a.id === "comeback").tiers).toEqual(["gold"]);
  });
  it("checks the condition; creates and replaces", async () => {
    who = ADMIN;
    const bad = await call("POST", "/api/gamification/rewards/items", { ...body, condition: { kind: "achievement", ref: "nope" } });
    expect([bad.status, bad.json.code, bad.json.details ?? null]).toEqual([400, "REWARD_ITEM_INVALID", null]);
    expect((await call("POST", "/api/gamification/rewards/items", body)).status).toBe(200);
    expect(store.insertItem).toHaveBeenCalledWith(expect.objectContaining({ title: "Худи", stock: 20, condition: { kind: "achievement", ref: "contract_streak", tier: "gold", rank: null } }), "Дмитрий К.");
    store.updateItem.mockResolvedValueOnce(null);
    expect((await call("PUT", "/api/gamification/rewards/items/77", body)).json.code).toBe("REWARD_ITEM_NOT_FOUND");
  });
});

describe("rewards flow", () => {
  it("a trader requests an active eligible reward", async () => {
    expect((await call("POST", "/api/gamification/rewards/items/3/request")).status).toBe(200);
    expect(rs.requestReward).toHaveBeenCalledWith("Кирилл Б.", expect.objectContaining({ id: 3 }));
    store.itemById.mockResolvedValueOnce(item({ active: false }));
    expect((await call("POST", "/api/gamification/rewards/items/3/request")).json.code).toBe("REWARD_ITEM_NOT_FOUND");
    rs.requestReward.mockResolvedValueOnce(null);
    expect((await call("POST", "/api/gamification/rewards/items/3/request")).json.code).toBe("REWARD_NOT_ELIGIBLE");
  });
  it("queue: traders can't; curator sees own traders; admin everyone", async () => {
    expect((await call("GET", "/api/gamification/rewards/queue")).status).toBe(403);
    who = CURATOR;
    expect((await call("GET", "/api/gamification/rewards/queue")).json).toEqual({ grants: [] });
    expect(store.requestedGrants).toHaveBeenCalledWith(["Кирилл Б."]);
    who = ADMIN;
    await call("GET", "/api/gamification/rewards/queue");
    expect(store.requestedGrants).toHaveBeenLastCalledWith(null);
  });
  it("grant / decline: the trader's curator or an admin; out of stock surfaces", async () => {
    expect((await call("POST", "/api/gamification/rewards/grants/9/grant", {})).status).toBe(403);
    who = OTHER_CURATOR;
    expect((await call("POST", "/api/gamification/rewards/grants/9/grant", {})).json.code).toBe("REWARD_NOT_YOUR_TRADER");
    who = CURATOR;
    expect((await call("POST", "/api/gamification/rewards/grants/9/decline", { note: "позже" })).status).toBe(200);
    expect(rs.decideReward).toHaveBeenCalledWith(grant, "declined", "Ольга Н.", "позже");
    rs.decideReward.mockResolvedValueOnce({ ok: false, code: "REWARD_OUT_OF_STOCK" });
    expect((await call("POST", "/api/gamification/rewards/grants/9/grant", {})).json.code).toBe("REWARD_OUT_OF_STOCK");
    who = ADMIN;
    expect((await call("POST", "/api/gamification/rewards/grants/9/grant", {})).status).toBe(200);
    store.grantById.mockResolvedValueOnce(null);
    expect((await call("POST", "/api/gamification/rewards/grants/99/grant", {})).json.code).toBe("REWARD_GRANT_NOT_FOUND");
  });
});
