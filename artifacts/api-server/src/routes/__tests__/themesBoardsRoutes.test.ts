/**
 * routes/themes-boards.ts over mocked stores (no DB, no network): boards are owner-only, ≤ 8 per user, a tickers board
 * needs a list (≤ 50) or a screener (only f / o of a pasted URL kept — the auth token never stored or echoed), ← / →
 * reorders, archive with active false (its themes archived with it), «Архив» lists / restores (≤ 8 boards, themes up to
 * the limit of 10), guests are read-only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "guest" };
const OWNER: Who = { id: 5, name: "Owner O.", role: "trader" };
const OTHER: Who = { id: 6, name: "Other O.", role: "trader" };
const GUEST: Who = { id: 0, name: "guest", role: "guest" };
let who: Who = OWNER;

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
const rec = (over: Record<string, unknown> = {}) => ({
  id: 4, userId: 5, name: "Chips", kind: "tickers", position: 0, columns: ["today"], sort: null, pinned: [],
  source: { kind: "tickers", tickers: ["MU"] }, resolvedTickers: [], resolvedAt: null, active: true, ...over,
});
const store = vi.hoisted(() => ({
  boardById: vi.fn(),
  countBoards: vi.fn(async () => 0),
  insertBoard: vi.fn(async (userId: number, i: Record<string, unknown>) => ({ ...i, id: 9, userId, position: 0, sort: null, resolvedTickers: [], resolvedAt: null, active: true, columns: i.columns ?? ["today"], pinned: i.pinned ?? [], source: i.source ?? null })),
  listBoards: vi.fn(async () => [{ id: 3, position: 0 }, { id: 4, position: 1 }]),
  setPositions: vi.fn(async () => undefined),
  updateBoard: vi.fn(async (_u: number, _id: number, p: Record<string, unknown>, cur: Record<string, unknown>) => ({ ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) })),
  archiveBoardThemes: vi.fn(async () => 3),
  listArchive: vi.fn(async (userId: number) => ({ boards: userId === 5 ? [{ id: 4, name: "Chips", kind: "themes", themes: 3 }] : [], themes: [] })),
  restoreBoard: vi.fn(async (_u: number, _id: number, max: number) => ({ board: rec({ active: true, position: 2 }), restored: Math.min(3, max), skipped: 0 })),
}));
vi.mock("../../lib/themes/boardsStore", () => store);
const data = vi.hoisted(() => ({
  getBoardData: vi.fn(async (userId: number, id: number) => (userId === 5 && id === 4 ? { kind: "tickers", rows: [] } : null)),
  refreshBoardScreener: vi.fn(async (b: unknown) => b),
  boardMeta: (b: Record<string, unknown>) => ({ id: b.id, name: b.name, kind: b.kind, position: b.position, columns: b.columns, sort: b.sort, pinned: b.pinned, source: b.source, resolvedAt: null }),
}));
vi.mock("../../lib/themes/board", () => data);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../themes-boards");
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
  who = OWNER;
  vi.clearAllMocks();
  store.countBoards.mockResolvedValue(0);
  store.boardById.mockImplementation(async (userId: number, id: number) => (userId === 5 && id === 4 ? rec() : null));
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

describe("owner only", () => {
  it("another user reads / edits nothing of it (404); guests are read-only", async () => {
    expect((await call("GET", "/api/themes/boards/4")).status).toBe(200);
    who = OTHER;
    expect((await call("GET", "/api/themes/boards/4")).json.code).toBe("BOARD_NOT_FOUND");
    expect((await call("PUT", "/api/themes/boards/4", { name: "Mine now" })).json.code).toBe("BOARD_NOT_FOUND");
    expect(store.updateBoard).not.toHaveBeenCalled();
    who = GUEST;
    expect((await call("POST", "/api/themes/boards", { name: "X", kind: "themes" })).json.code).toBe("GUEST_READ_ONLY");
  });
});

describe("create", () => {
  it("a themes board; a tickers board from a list (≤ 50, upper-cased); ≤ 8 boards", async () => {
    expect((await call("POST", "/api/themes/boards", { name: "Watch", kind: "themes", pinned: [3, 1] })).json).toMatchObject({ id: 9, kind: "themes", pinned: [3, 1] });
    const t = await call("POST", "/api/themes/boards", { name: "Chips", kind: "tickers", tickers: ["nvda", "$amd"], columns: ["rvol", "today"] });
    expect(t.json).toMatchObject({ kind: "tickers", source: { kind: "tickers", tickers: ["NVDA", "AMD"] }, columns: ["today", "rvol"] });
    expect((await call("POST", "/api/themes/boards", { name: "Empty", kind: "tickers" })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => `T${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    expect((await call("POST", "/api/themes/boards", { name: "Big", kind: "tickers", tickers: tooMany })).status).toBe(400);
    store.countBoards.mockResolvedValue(8);
    const over = await call("POST", "/api/themes/boards", { name: "Ninth", kind: "themes" });
    expect([over.status, over.json.code]).toEqual([409, "BOARD_LIMIT"]);
  });

  it("a screener board from a pasted URL keeps only f / o; the token is neither stored nor echoed", async () => {
    const url = "https://elite.finviz.com/screener.ashx?v=111&f=ind_semiconductors,cap_large&o=-volume&auth=SECRET-TOKEN";
    const r = await call("POST", "/api/themes/boards", { name: "Semis", kind: "tickers", screener: url, top: 50 });
    expect(r.json.source).toEqual({ kind: "screener", screener: { filters: ["ind_semiconductors", "cap_large"], order: "-volume" }, top: 50 });
    expect(r.text).not.toContain("SECRET");
    expect(JSON.stringify(store.insertBoard.mock.calls)).not.toContain("SECRET");
    expect(data.refreshBoardScreener).toHaveBeenCalledTimes(1);
    expect((await call("POST", "/api/themes/boards", { name: "Bad", kind: "tickers", screener: "sec_energy,<x>" })).json.details?.[0]?.path).toBe("body.screener");
    expect((await call("POST", "/api/themes/boards", { name: "Bad", kind: "tickers", screener: "sec_energy", top: 30 })).status).toBe(400);
  });
});

describe("edit", () => {
  it("rename, columns, sort; ← / → reorders; archive", async () => {
    expect((await call("PUT", "/api/themes/boards/4", { name: "Semis", columns: ["float", "today"], sort: { col: "float", dir: "asc" } })).json)
      .toMatchObject({ name: "Semis", columns: ["today", "float"], sort: { col: "float", dir: "asc" } });
    await call("PUT", "/api/themes/boards/4", { move: "left" });
    expect(store.setPositions).toHaveBeenCalledWith(5, [{ id: 4, position: 0 }, { id: 3, position: 1 }]);
    expect((await call("PUT", "/api/themes/boards/4", { active: false })).json.name).toBe("Chips");
    expect(store.updateBoard.mock.calls.at(-1)![2]).toMatchObject({ active: false });
  });
});

describe("archive", () => {
  it("archiving a board archives its active themes with it (same request, owner-scoped); other edits do not", async () => {
    await call("PUT", "/api/themes/boards/4", { name: "Semis" });
    expect(store.archiveBoardThemes).not.toHaveBeenCalled();
    expect((await call("PUT", "/api/themes/boards/4", { active: false })).status).toBe(200);
    expect(store.archiveBoardThemes).toHaveBeenCalledWith(5, 4);
    expect(logAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "themes.board.archive", details: expect.objectContaining({ themes: 3 }) }));
    // Already archived: no second cascade.
    store.boardById.mockResolvedValue(rec({ active: false }));
    await call("PUT", "/api/themes/boards/4", { active: false });
    expect(store.archiveBoardThemes).toHaveBeenCalledTimes(1);
  });

  it("GET /themes/archive: the caller's own archive only; guests are read-only", async () => {
    expect((await call("GET", "/api/themes/archive")).json).toEqual({ boards: [{ id: 4, name: "Chips", kind: "themes", themes: 3 }], themes: [] });
    expect(store.listArchive).toHaveBeenCalledWith(5);
    who = OTHER;
    expect((await call("GET", "/api/themes/archive")).json).toEqual({ boards: [], themes: [] });
    expect(store.listArchive).toHaveBeenLastCalledWith(6);
    who = GUEST;
    expect((await call("GET", "/api/themes/archive")).json.code).toBe("GUEST_READ_ONLY");
  });

  it("restore a board: owner only, ≤ 8 boards, its themes back up to the limit of 10", async () => {
    store.boardById.mockImplementation(async (userId: number, id: number) => (userId === 5 && id === 4 ? rec({ active: false }) : null));
    who = OTHER;
    const foreign = await call("POST", "/api/themes/boards/4/restore");
    expect([foreign.status, foreign.json.code]).toEqual([404, "BOARD_NOT_FOUND"]);
    expect((await call("POST", "/api/themes/boards/77/restore")).json.code).toBe("BOARD_NOT_FOUND");
    who = GUEST;
    expect((await call("POST", "/api/themes/boards/4/restore")).json.code).toBe("GUEST_READ_ONLY");
    expect(store.restoreBoard).not.toHaveBeenCalled();
    who = OWNER;
    store.countBoards.mockResolvedValue(8);
    const over = await call("POST", "/api/themes/boards/4/restore");
    expect([over.status, over.json.code]).toEqual([409, "BOARD_LIMIT"]);
    expect(store.restoreBoard).not.toHaveBeenCalled();
    store.countBoards.mockResolvedValue(7);
    const ok = await call("POST", "/api/themes/boards/4/restore");
    expect(ok.json).toMatchObject({ id: 4, name: "Chips", position: 2, restoredThemes: 3, skippedThemes: 0 });
    expect(store.restoreBoard).toHaveBeenCalledWith(5, 4, 10);
    expect(logAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "themes.board.restore", targetId: "4" }));
    // An active board: nothing to do.
    store.boardById.mockResolvedValue(rec());
    expect((await call("POST", "/api/themes/boards/4/restore")).json).toMatchObject({ id: 4, restoredThemes: 0, skippedThemes: 0 });
    expect(store.restoreBoard).toHaveBeenCalledTimes(1);
  });
});
