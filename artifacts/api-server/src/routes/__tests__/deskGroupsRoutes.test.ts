/**
 * Волна 1 п. 1.19 — routes/desk-groups.ts over a mocked store, route × role: the list needs users.read.team (trader 403,
 * curator reads with canEdit false), every change needs settings.manage (admin only by default); a group name is
 * unique among live groups, a group's curator must be an active curator / admin, moving into an archived / unknown group
 * is 404, every change is audited.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const TRADER: Who = { id: 5, name: "Trader T.", role: "trader" };
const CURATOR: Who = { id: 3, name: "Curator C.", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin A.", role: "admin" };
let who: Who = ADMIN;

const client = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), connect: vi.fn(async () => client) } }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../../lib/audit", () => audit);
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const matrix = actual.buildEffectiveMatrix([]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target);
  return {
    ...actual,
    can: vi.fn(can),
    requireCap: vi.fn(async (_req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1]) => {
      if (await can(_req, cap)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});
const STATE = {
  groups: [{ id: 2, name: "Группа Curator C.", curatorId: 3, curatorName: "Curator C.", sortOrder: 1, members: [{ id: 5, name: "Trader T." }] }],
  ungrouped: [{ id: 6, name: "New N." }],
  curators: [{ id: 1, name: "Admin A." }, { id: 3, name: "Curator C." }],
};
const store = vi.hoisted(() => ({
  loadDeskGroups: vi.fn(),
  curatorById: vi.fn(async (id: number) => (id === 3 ? { id: 3, name: "Curator C." } : id === 1 ? { id: 1, name: "Admin A." } : null)),
  groupNameTaken: vi.fn(async (name: string) => name.toLowerCase() === "группа curator c."),
  liveGroup: vi.fn(async (id: number) => (id === 2 ? { id: 2, name: "Группа Curator C.", curatorId: 3 } : null)),
  insertGroup: vi.fn(async () => 7),
  updateGroup: vi.fn(async () => undefined),
  moveTrader: vi.fn(async (userId: number) => (userId === 6 ? { name: "New N.", from: null } : null)),
}));
vi.mock("../../lib/people/deskGroups", () => store);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../desk-groups");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((rq, _res, next) => {
    (rq as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = ADMIN;
  vi.clearAllMocks();
  store.loadDeskGroups.mockResolvedValue(structuredClone(STATE));
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
}

describe("GET /desk-groups", () => {
  it("trader 403; curator reads (canEdit false); admin reads (canEdit true)", async () => {
    who = TRADER;
    expect((await call("GET", "/api/desk-groups")).status).toBe(403);
    who = CURATOR;
    const c = await call("GET", "/api/desk-groups");
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ canEdit: false, ungrouped: [{ name: "New N." }] });
    expect(c.json.groups[0]).toMatchObject({ name: "Группа Curator C.", curatorName: "Curator C.", members: [{ name: "Trader T." }] });
    who = ADMIN;
    expect((await call("GET", "/api/desk-groups")).json.canEdit).toBe(true);
  });
});

describe("changes (settings.manage)", () => {
  it("trader and curator may not create, rename, archive or move (403)", async () => {
    for (const w of [TRADER, CURATOR]) {
      who = w;
      expect((await call("POST", "/api/desk-groups", { name: "Утро" })).status).toBe(403);
      expect((await call("PUT", "/api/desk-groups/2", { name: "Утро" })).status).toBe(403);
      expect((await call("PUT", "/api/desk-groups/members", { userId: 6, groupId: 2 })).status).toBe(403);
    }
    expect(store.insertGroup).not.toHaveBeenCalled();
    expect(store.updateGroup).not.toHaveBeenCalled();
    expect(store.moveTrader).not.toHaveBeenCalled();
  });

  it("create: 201 + audit; a taken name → 409; a non-curator → 400", async () => {
    store.loadDeskGroups.mockResolvedValueOnce({ ...structuredClone(STATE), groups: [...STATE.groups, { id: 7, name: "Утро", curatorId: 1, curatorName: "Admin A.", sortOrder: 2, members: [] }] });
    const r = await call("POST", "/api/desk-groups", { name: "Утро", curatorId: 1 });
    expect(r.status).toBe(201);
    expect(r.json.group).toMatchObject({ id: 7, name: "Утро" });
    expect(store.insertGroup).toHaveBeenCalledWith("Утро", 1);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "desk_groups.create", targetId: "7" }));
    const taken = await call("POST", "/api/desk-groups", { name: "группа Curator C." });
    expect([taken.status, taken.json.code]).toEqual([409, "DESK_GROUP_NAME_TAKEN"]);
    const bad = await call("POST", "/api/desk-groups", { name: "Вечер", curatorId: 5 });
    expect([bad.status, bad.json.code]).toEqual([400, "DESK_GROUP_CURATOR_INVALID"]);
    expect((await call("POST", "/api/desk-groups", { name: "" })).status).toBe(400);
  });

  it("rename / new curator / archive in one transaction; unknown group → 404", async () => {
    const r = await call("PUT", "/api/desk-groups/2", { name: "Утро", curatorId: 1 });
    expect(r.status).toBe(200);
    expect(store.updateGroup).toHaveBeenCalledWith(2, { name: "Утро", curator: { id: 1, name: "Admin A." }, sortOrder: undefined, archived: undefined }, client);
    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    await call("PUT", "/api/desk-groups/2", { archived: true });
    expect(store.updateGroup).toHaveBeenLastCalledWith(2, expect.objectContaining({ archived: true }), client);
    expect(audit.logAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "desk_groups.archive" }));
    expect((await call("PUT", "/api/desk-groups/9", { name: "X" })).json.code).toBe("DESK_GROUP_NOT_FOUND");
    expect((await call("PUT", "/api/desk-groups/2", { curatorId: null })).status).toBe(200);
    expect(store.updateGroup).toHaveBeenLastCalledWith(2, expect.objectContaining({ curator: null }), client);
  });

  it("move a trader: into a live group (state back), out of groups (null); unknown group / trader → 404", async () => {
    const r = await call("PUT", "/api/desk-groups/members", { userId: 6, groupId: 2 });
    expect(r.status).toBe(200);
    expect(r.json.groups).toHaveLength(1);
    expect(store.moveTrader).toHaveBeenCalledWith(6, 2);
    await call("PUT", "/api/desk-groups/members", { userId: 6, groupId: null });
    expect(store.moveTrader).toHaveBeenLastCalledWith(6, null);
    expect((await call("PUT", "/api/desk-groups/members", { userId: 6, groupId: 9 })).json.code).toBe("DESK_GROUP_NOT_FOUND");
    expect((await call("PUT", "/api/desk-groups/members", { userId: 77, groupId: 2 })).json.code).toBe("USER_NOT_FOUND");
  });
});
