/**
 * routes/themes.ts over mocked stores (no DB, no network): shared themes are admin-only (settings.manage), the view
 * is per member, personal themes are owner-only with a limit of 10, a pasted screener URL keeps only f / o (the auth
 * token is never stored or echoed), an archived theme comes back only onto an active board of its owner, guests are
 * read-only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest" };
const TRADER: Who = { id: 5, name: "Trader T.", role: "trader" };
const CURATOR: Who = { id: 3, name: "Curator C.", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin A.", role: "admin" };
const GUEST: Who = { id: 0, name: "guest", role: "guest" };
let who: Who = TRADER;

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: who.role === "guest", wards: [] })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
const board = vi.hoisted(() => ({
  getBoard: vi.fn(async (id: number | null) => ({ viewer: id })),
  refreshScreener: vi.fn(async (r: unknown) => r),
}));
vi.mock("../../lib/themes/board", () => board);
const rec = (over: Record<string, unknown> = {}) => ({
  id: 9, userId: 5, name: "Mine", kind: "tickers", tickers: ["MU"], screener: null, resolvedTickers: [], resolvedAt: null, active: true, ...over,
});
const mine = vi.hoisted(() => ({
  countPersonal: vi.fn(async () => 0),
  insertPersonal: vi.fn(async (userId: number, i: Record<string, unknown>) => ({ ...i, id: 9, userId, resolvedTickers: [], resolvedAt: null, active: true })),
  personalById: vi.fn(),
  updatePersonal: vi.fn(async (_u: number, id: number, p: Record<string, unknown>, cur: Record<string, unknown>) => ({ ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)), id })),
  writeView: vi.fn(async (_id: number, v: unknown) => v),
  readView: vi.fn(async () => ({ columns: ["premarket", "fromOpen", "today", "afterHours"], hidden: [9], sort: null, tab: "shared" })),
}));
vi.mock("../../lib/themes/personalStore", () => mine);
const boards = vi.hoisted(() => ({
  boardById: vi.fn(async (userId: number, id: number) => (userId === 5 && id === 4 ? { id: 4, userId: 5, kind: "themes", active: true } : null)),
}));
vi.mock("../../lib/themes/boardsStore", () => boards);
const shared = vi.hoisted(() => ({
  listThemes: vi.fn(async () => []),
  themeById: vi.fn(async () => ({ id: 2, name: "AI", tickers: ["NVDA"], sortOrder: 10, active: true })),
  insertTheme: vi.fn(async (i: object) => ({ id: 40, ...i })),
  updateTheme: vi.fn(async (id: number, p: object) => ({ id, ...p })),
}));
vi.mock("../../lib/themes/store", () => shared);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../themes");
const { logAudit } = await import("../../lib/audit");
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
  mine.countPersonal.mockResolvedValue(0);
  mine.personalById.mockResolvedValue(rec());
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

describe("board", () => {
  it("members get their own board; a guest gets the base board", async () => {
    expect((await call("GET", "/api/themes")).json).toEqual({ viewer: 5 });
    who = GUEST;
    expect((await call("GET", "/api/themes")).json).toEqual({ viewer: null });
  });
});

describe("shared themes are admin-only (settings.manage)", () => {
  it("trader and curator 403; admin may list, create and archive", async () => {
    expect((await call("GET", "/api/themes/config")).status).toBe(403);
    who = CURATOR;
    expect((await call("POST", "/api/themes", { name: "X", tickers: ["MU"] })).status).toBe(403);
    expect((await call("PUT", "/api/themes/2", { active: false })).status).toBe(403);
    who = ADMIN;
    expect((await call("GET", "/api/themes/config")).status).toBe(200);
    expect((await call("POST", "/api/themes", { name: "X", tickers: ["mu", "$wdc"] })).json).toMatchObject({ id: 40, tickers: ["MU", "WDC"] });
    expect((await call("PUT", "/api/themes/2", { active: false })).status).toBe(200);
  });
});

describe("view", () => {
  it("saves visible columns (≥ 1, table order) and hidden ids; refuses junk and guests", async () => {
    const r = await call("PUT", "/api/themes/view", { columns: ["today", "premarket"], hidden: [3] });
    expect(r.json).toEqual({ columns: ["premarket", "today"], hidden: [3], sort: null, tab: "shared" });
    expect(mine.writeView).toHaveBeenCalledWith(5, { columns: ["premarket", "today"], hidden: [3], sort: null, tab: "shared" });
    // A partial save merges with the stored view (here: the sort and the last tab only).
    const p = await call("PUT", "/api/themes/view", { sort: { col: "today", dir: "asc" }, tab: 4 });
    expect(p.json).toEqual({ columns: ["premarket", "fromOpen", "today", "afterHours"], hidden: [9], sort: { col: "today", dir: "asc" }, tab: 4 });
    expect((await call("PUT", "/api/themes/view", { columns: [] })).status).toBe(400);
    expect((await call("PUT", "/api/themes/view", { tab: "mine" })).status).toBe(400);
    expect((await call("PUT", "/api/themes/view", { columns: ["week"] })).status).toBe(400);
    who = GUEST;
    expect((await call("PUT", "/api/themes/view", { columns: ["today"] })).json.code).toBe("GUEST_READ_ONLY");
  });
});

describe("«Мои темы»", () => {
  it("tickers theme: created for the caller; ≤ 10 per user", async () => {
    const r = await call("POST", "/api/themes/mine", { boardId: 4, name: "Mine", kind: "tickers", tickers: ["mu", "ionq"] });
    expect(r.status).toBe(200);
    expect(mine.insertPersonal).toHaveBeenCalledWith(5, { name: "Mine", kind: "tickers", tickers: ["MU", "IONQ"], screener: null, boardId: 4 });
    expect((await call("POST", "/api/themes/mine", { boardId: 4, name: "Mine", kind: "tickers" })).status).toBe(400);
    // Only onto one of the caller's own themes boards.
    expect((await call("POST", "/api/themes/mine", { boardId: 77, name: "X", kind: "tickers", tickers: ["MU"] })).json.code).toBe("BOARD_NOT_FOUND");
    expect((await call("POST", "/api/themes/mine", { name: "X", kind: "tickers", tickers: ["MU"] })).status).toBe(400);
    mine.countPersonal.mockResolvedValue(10);
    const over = await call("POST", "/api/themes/mine", { boardId: 4, name: "Eleventh", kind: "tickers", tickers: ["MU"] });
    expect([over.status, over.json.code]).toEqual([409, "THEME_LIMIT"]);
  });

  it("screener from a pasted URL: only f / o kept, the auth token is neither stored nor echoed", async () => {
    const url = "https://elite.finviz.com/screener.ashx?v=111&f=sec_technology,cap_large&o=-volume&auth=SECRET-TOKEN";
    const r = await call("POST", "/api/themes/mine", { boardId: 4, name: "Tech", kind: "screener", screener: url });
    expect(r.status).toBe(200);
    expect(mine.insertPersonal).toHaveBeenCalledWith(5, { name: "Tech", kind: "screener", tickers: [], screener: { filters: ["sec_technology", "cap_large"], order: "-volume" }, boardId: 4 });
    expect(r.text).not.toContain("SECRET");
    expect(JSON.stringify(mine.insertPersonal.mock.calls)).not.toContain("SECRET");
    expect(board.refreshScreener).toHaveBeenCalledTimes(1);
    const bad = await call("POST", "/api/themes/mine", { boardId: 4, name: "Bad", kind: "screener", screener: "sec_technology,<x>" });
    expect([bad.status, bad.json.details?.[0]?.path]).toEqual([400, "body.screener"]);
  });

  it("owner only: another user's theme is 404; archive with active false", async () => {
    mine.personalById.mockResolvedValue(null);
    expect((await call("PUT", "/api/themes/mine/9", { active: false })).json.code).toBe("THEME_NOT_FOUND");
    mine.personalById.mockResolvedValue(rec());
    const r = await call("PUT", "/api/themes/mine/9", { active: false });
    expect([r.status, r.json.active]).toEqual([200, false]);
    expect(mine.personalById).toHaveBeenCalledWith(5, 9);
  });

  it("edit keeps the definition unless a field of it changes", async () => {
    await call("PUT", "/api/themes/mine/9", { name: "Renamed" });
    expect(mine.updatePersonal.mock.calls[0]![2]).toEqual({ name: "Renamed", kind: "tickers", active: undefined });
    await call("PUT", "/api/themes/mine/9", { tickers: ["amd"] });
    expect(mine.updatePersonal.mock.calls[1]![2]).toMatchObject({ kind: "tickers", tickers: ["AMD"], screener: null });
  });
});

describe("restore a personal theme", () => {
  const archived = (over: Record<string, unknown> = {}) => rec({ boardId: 4, active: false, ...over });

  it("POST /themes/mine/:id/restore: owner only, ≤ 10, its board must be active", async () => {
    mine.personalById.mockResolvedValue(null);
    expect((await call("POST", "/api/themes/mine/9/restore")).json.code).toBe("THEME_NOT_FOUND");
    who = GUEST;
    expect((await call("POST", "/api/themes/mine/9/restore")).json.code).toBe("GUEST_READ_ONLY");
    who = TRADER;
    mine.personalById.mockResolvedValue(archived());
    mine.countPersonal.mockResolvedValue(10);
    const over = await call("POST", "/api/themes/mine/9/restore");
    expect([over.status, over.json.code]).toEqual([409, "THEME_LIMIT"]);
    mine.personalById.mockResolvedValue(archived({ boardId: 77 })); // a board that is archived / not the caller's
    mine.countPersonal.mockResolvedValue(3);
    const gone = await call("POST", "/api/themes/mine/9/restore");
    expect([gone.status, gone.json.code]).toEqual([404, "BOARD_NOT_FOUND"]);
    boards.boardById.mockResolvedValueOnce({ id: 4, userId: 5, kind: "themes", active: false });
    mine.personalById.mockResolvedValue(archived());
    expect((await call("POST", "/api/themes/mine/9/restore")).json.code).toBe("BOARD_NOT_FOUND");
    expect(mine.updatePersonal).not.toHaveBeenCalled();
    const ok = await call("POST", "/api/themes/mine/9/restore");
    expect([ok.status, ok.json.active, ok.json.boardId]).toEqual([200, true, 4]);
    expect(mine.updatePersonal).toHaveBeenCalledWith(5, 9, { active: true }, expect.objectContaining({ id: 9 }));
    expect(boards.boardById).toHaveBeenLastCalledWith(5, 4);
    expect(logAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "themes.mine.restore", targetId: "9" }));
  });

  it("PUT { active: true } obeys the same rules (no theme revived onto an archived board)", async () => {
    mine.personalById.mockResolvedValue(archived());
    boards.boardById.mockResolvedValueOnce({ id: 4, userId: 5, kind: "themes", active: false });
    const r = await call("PUT", "/api/themes/mine/9", { active: true });
    expect([r.status, r.json.code]).toEqual([404, "BOARD_NOT_FOUND"]);
    expect(mine.updatePersonal).not.toHaveBeenCalled();
    mine.countPersonal.mockResolvedValue(10);
    expect((await call("PUT", "/api/themes/mine/9", { active: true })).json.code).toBe("THEME_LIMIT");
    mine.countPersonal.mockResolvedValue(9);
    expect((await call("PUT", "/api/themes/mine/9", { active: true })).json.active).toBe(true);
    expect(logAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "themes.mine.restore" }));
  });
});
