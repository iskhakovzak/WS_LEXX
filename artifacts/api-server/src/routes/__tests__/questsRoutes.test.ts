/**
 * routes/quests.ts — access and validation. The DB, the actor and lib/quests/service are mocked: a trader reads only
 * their own quests and can't assign; a curator reads / assigns for traders in the journal.review scope (assigned scope
 * respected), only to active traders, with the assignment checks; cancel only by the assigner or an admin; complete
 * only for the manual template.
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

const users: Record<string, { role: string; active: boolean }> = {
  "Кирилл Б.": { role: "trader", active: true }, "Максим Р.": { role: "trader", active: true }, "Ольга Н.": { role: "curator", active: true },
};
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM users WHERE name = \$1/.test(sql)) { const u = users[String(params[0])]; return { rows: u ? [u] : [], rowCount: u ? 1 : 0 }; }
      if (/FROM role_permissions/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([{ role: "curator", capability: "journal.review", allowed: true, scope: "assigned" }])),
  };
});
const quest = (over: Record<string, unknown> = {}) => ({
  id: 7, trader: "Кирилл Б.", scope: "curator", template: "review_days", period: "curator", params: {}, progress: 0, target: 3, status: "active",
  rewardPoints: 10, startsOn: "2026-10-19", endsOn: "2026-10-30", completedOn: null, assignedBy: "Ольга Н.", note: null, ...over,
});
let stored: ReturnType<typeof quest> | null = quest();
vi.mock("../../lib/quests/store", () => ({ questById: vi.fn(async () => stored) }));
const service = vi.hoisted(() => ({
  questsMe: vi.fn(async (trader: string) => ({ today: "2026-10-19", quests: [], achievements: [], summary: {}, trader })),
  activeCuratorCount: vi.fn(async () => 0),
  checkAssign: vi.fn((): unknown => null),
  assignQuest: vi.fn(async (body: { trader: string; template: string }, by: string) => ({ id: 8, template: body.template, assignedBy: by })),
  cancelQuest: vi.fn(async () => ({ id: 7 })),
  completeQuest: vi.fn(async () => ({ id: 7, status: "done" })),
  isManual: vi.fn((q: { template: string }) => q.template === "curator_task"),
  MAX_DEADLINE_DAYS: 92,
}));
vi.mock("../../lib/quests/service", () => service);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../quests");
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
beforeEach(() => { who = TRADER; stored = quest(); vi.clearAllMocks(); service.checkAssign.mockImplementation(() => null); });

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const enc = encodeURIComponent;
const assignBody = { trader: "Кирилл Б.", template: "review_days", target: 5, endsOn: "2026-10-30" };

describe("reads", () => {
  it("a trader reads their own quests, not another trader's, not the templates", async () => {
    expect((await call("GET", "/api/quests/me")).status).toBe(200);
    expect(service.questsMe).toHaveBeenCalledWith("Кирилл Б.");
    expect((await call("GET", `/api/quests/trader/${enc("Максим Р.")}`)).status).toBe(403);
    expect((await call("GET", "/api/quests/templates")).status).toBe(403);
  });
  it("a curator reads a ward, not a trader outside the assigned scope; templates list", async () => {
    who = CURATOR;
    expect((await call("GET", `/api/quests/trader/${enc("Кирилл Б.")}`)).status).toBe(200);
    expect((await call("GET", `/api/quests/trader/${enc("Максим Р.")}`)).status).toBe(403);
    const t = await call("GET", "/api/quests/templates");
    expect(t.status).toBe(200);
    expect(t.json.templates.map((x: { template: string }) => x.template)).toContain("curator_task");
    expect(t.json.templates[0]).toMatchObject({ template: "contract_days", unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60, defaultPoints: 10 });
  });
});

describe("POST /quests/assign", () => {
  it("a trader can't assign", async () => {
    const r = await call("POST", "/api/quests/assign", assignBody);
    expect(r.status).toBe(403);
    expect(service.assignQuest).not.toHaveBeenCalled();
    // Rights before the form (DEV-18): an invalid body from a trader is 403, not a 400 about the fields.
    expect((await call("POST", "/api/quests/assign", { trader: "" })).status).toBe(403);
  });
  it("a curator assigns to a ward; not outside the scope; only to an active trader", async () => {
    who = CURATOR;
    const r = await call("POST", "/api/quests/assign", assignBody);
    expect(r.status).toBe(200);
    expect(service.assignQuest).toHaveBeenCalledWith(expect.objectContaining({ trader: "Кирилл Б.", target: 5 }), "Ольга Н.", expect.any(String));
    expect((await call("POST", "/api/quests/assign", { ...assignBody, trader: "Максим Р." })).status).toBe(403);
    who = ADMIN;
    const staff = await call("POST", "/api/quests/assign", { ...assignBody, trader: "Ольга Н." });
    expect(staff.status).toBe(400);
    expect(staff.json.code).toBe("QUEST_TRADER_ONLY");
    expect((await call("POST", "/api/quests/assign", { ...assignBody, trader: "Никто" })).json.code).toBe("TRADER_NOT_FOUND");
  });
  it("assignment problems map to their codes with params; a bad body is VALIDATION", async () => {
    who = CURATOR;
    service.checkAssign.mockImplementation(() => ({ code: "QUEST_LIMIT", max: 5 }));
    const r = await call("POST", "/api/quests/assign", assignBody);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("QUEST_LIMIT");
    expect(r.json.error).toContain("5");
    expect((await call("POST", "/api/quests/assign", { ...assignBody, endsOn: "2026-02-30" })).json.code).toBe("VALIDATION");
  });
});

describe("cancel and complete", () => {
  it("cancel: the assigner or an admin; another curator gets QUEST_NOT_YOURS; a finished quest is QUEST_NOT_ACTIVE", async () => {
    who = OTHER_CURATOR;
    expect((await call("POST", "/api/quests/7/cancel")).json.code).toBe("QUEST_NOT_YOURS");
    who = CURATOR;
    expect((await call("POST", "/api/quests/7/cancel")).status).toBe(200);
    who = ADMIN;
    expect((await call("POST", "/api/quests/7/cancel")).status).toBe(200);
    stored = quest({ status: "done" });
    expect((await call("POST", "/api/quests/7/cancel")).json.code).toBe("QUEST_NOT_ACTIVE");
    who = TRADER;
    stored = quest();
    expect((await call("POST", "/api/quests/7/cancel")).status).toBe(403);
  });
  it("only curator quests exist for these endpoints", async () => {
    who = ADMIN;
    stored = quest({ scope: "daily", template: "plan_before_open" });
    expect((await call("POST", "/api/quests/7/cancel")).json.code).toBe("QUEST_NOT_FOUND");
    stored = null;
    expect((await call("POST", "/api/quests/7/complete")).status).toBe(404);
  });
  it("complete: only the manual task", async () => {
    who = CURATOR;
    expect((await call("POST", "/api/quests/7/complete")).json.code).toBe("QUEST_NOT_MANUAL");
    stored = quest({ template: "curator_task", target: 1 });
    const r = await call("POST", "/api/quests/7/complete");
    expect(r.status).toBe(200);
    expect(service.completeQuest).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), "Ольга Н.");
  });
});
