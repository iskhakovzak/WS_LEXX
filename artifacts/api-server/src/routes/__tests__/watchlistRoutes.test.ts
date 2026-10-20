/**
 * routes/watchlist.ts over a mocked store (no DB, no network) — route × role for the two lists (Волна 1, item 1.18):
 * a personal list is its owner's only (another trader / staff → 404), the desk list is read by all and written by
 * seniors and staff (a trader → 403 NOT_OWNER), writes default to the personal list, «Торговал» from own trades.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { WatchActor } from "../../lib/watchlist/scope";

const OWNER: WatchActor = { id: 5, name: "Owner O.", role: "trader", guest: false, senior: false };
const OTHER: WatchActor = { id: 6, name: "Other O.", role: "trader", guest: false, senior: false };
const SENIOR: WatchActor = { id: 7, name: "Senior S.", role: "trader", guest: false, senior: true };
const CURATOR: WatchActor = { id: 8, name: "Curator C.", role: "curator", guest: false, senior: false };
const GUEST: WatchActor = { id: 0, name: "guest", role: "guest", guest: true, senior: false };
let who: WatchActor = OWNER;

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../lib/scoreEngine", () => ({ calcWatchlistScore: vi.fn(async () => ({ total: 50 })) }));
vi.mock("../../lib/watchlist/quotes", () => ({ LAYER_MAX_TICKERS: 200, layerQuotes: vi.fn(async (t: string[]) => ({ session: "rth", asOf: "x", quotes: Object.fromEntries(t.map((x) => [x, { price: 1 }])) })) }));
const access = vi.hoisted(() => ({
  watchActor: vi.fn(),
  readWatchView: vi.fn(async () => ({ scope: "mine" })),
  writeWatchView: vi.fn(async (_id: number, v: unknown) => v),
}));
vi.mock("../../lib/watchlist/access", () => access);

/** Rows: 1 = OWNER's personal, 2 = desk, 3 = OTHER's personal. */
const OWNERS: Record<number, number | null> = { 1: 5, 2: null, 3: 6 };
const row = (id: number, over: Record<string, unknown> = {}) => ({
  id, ticker: id === 2 ? "DESK" : "MINE", owner: OWNERS[id] ?? null, status: "watching", catalyst: null, sector: null, inPlay: false, inPlayAt: null, list: "watch", ...over,
});
const store = vi.hoisted(() => ({
  listRows: vi.fn(async (_owner: number | null) => [] as unknown[]),
  getRow: vi.fn(),
  ownersOf: vi.fn(async (ids: number[]) => new Map(ids.filter((id) => id in OWNERS).map((id) => [id, OWNERS[id]]))),
  activeByTickers: vi.fn(async () => [] as unknown[]),
  insertRows: vi.fn(async (values: Array<Record<string, unknown>>, owner: number | null, list: string) => values.map((v, i) => ({ ...row(100 + i), ...v, owner, list }))),
  updateContent: vi.fn(async (id: number) => row(id)),
  setScore: vi.fn(async (id: number) => row(id)),
  setStatus: vi.fn(async (ids: number[]) => ids.length),
  setDeleted: vi.fn(async (ids: number[]) => ids),
  setInPlay: vi.fn(async (ids: number[]) => ids.length),
  setList: vi.fn(async (ids: number[]) => ids.length),
  rowsToScore: vi.fn(async () => []),
  tickerStats: vi.fn(async () => ({ ideas: new Map(), trades: new Map(), open: new Map() })),
}));
vi.mock("../../lib/watchlist/store", () => store);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../watchlist");
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
  access.watchActor.mockImplementation(async () => who);
  store.getRow.mockImplementation(async (id: number) => (id in OWNERS ? row(id) : null));
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
}

describe("GET /watchlist — which list", () => {
  it("default = the remembered list; ?scope=desk = owner null; a guest only reads the desk", async () => {
    store.listRows.mockResolvedValueOnce([row(1)]);
    const mine = await call("GET", "/api/watchlist");
    expect(mine.status).toBe(200);
    expect(store.listRows).toHaveBeenLastCalledWith(5);
    expect(mine.json[0]).toMatchObject({ scope: "mine", canEdit: true });

    store.listRows.mockResolvedValueOnce([row(2)]);
    const desk = await call("GET", "/api/watchlist?scope=desk");
    expect(store.listRows).toHaveBeenLastCalledWith(null);
    expect(desk.json[0]).toMatchObject({ scope: "desk", canEdit: false });

    access.readWatchView.mockResolvedValueOnce({ scope: "desk" });
    await call("GET", "/api/watchlist");
    expect(store.listRows).toHaveBeenLastCalledWith(null);

    who = GUEST;
    await call("GET", "/api/watchlist?scope=mine");
    expect(store.listRows).toHaveBeenLastCalledWith(null);
    expect((await call("GET", "/api/watchlist?scope=all")).status).toBe(400);
  });

  it("«Торговал» from the caller's own trades; GET writes nothing", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    store.listRows.mockResolvedValueOnce([row(1)]);
    store.tickerStats.mockResolvedValueOnce({ ideas: new Map(), trades: new Map([["MINE", { count: 2, last: today }]]), open: new Map() });
    const r = await call("GET", "/api/watchlist");
    expect(store.tickerStats).toHaveBeenCalledWith(["MINE"], "Owner O.");
    expect(r.json[0]).toMatchObject({ tradedToday: true, tradeCount: 2 });
    expect(store.setStatus).not.toHaveBeenCalled();
  });

  it("desk rows are editable for a senior and staff", async () => {
    for (const a of [SENIOR, CURATOR]) {
      who = a;
      store.listRows.mockResolvedValueOnce([row(2)]);
      expect((await call("GET", "/api/watchlist?scope=desk")).json[0].canEdit).toBe(true);
    }
  });
});

describe("POST /watchlist and /quick — personal by default, desk for seniors and staff", () => {
  it("default scope → the caller's list", async () => {
    const r = await call("POST", "/api/watchlist", { ticker: "nvda" });
    expect(r.status).toBe(200);
    expect(store.insertRows.mock.calls[0]![1]).toBe(5);
    expect(store.activeByTickers).toHaveBeenCalledWith(["NVDA"], 5);
    await call("POST", "/api/watchlist/quick", { tickers: ["amd"], list: "today" });
    expect(store.insertRows.mock.calls[1]!.slice(1)).toEqual([5, "today"]);
  });

  it("scope desk: trader 403 NOT_OWNER, senior / curator write it, guest read-only", async () => {
    const t = await call("POST", "/api/watchlist", { ticker: "NVDA", scope: "desk" });
    expect([t.status, t.json.code]).toEqual([403, "NOT_OWNER"]);
    expect((await call("POST", "/api/watchlist/quick", { tickers: ["NVDA"], scope: "desk" })).json.code).toBe("NOT_OWNER");
    expect(store.insertRows).not.toHaveBeenCalled();
    for (const a of [SENIOR, CURATOR]) {
      who = a;
      expect((await call("POST", "/api/watchlist", { ticker: "NVDA", scope: "desk" })).status).toBe(200);
      expect(store.insertRows.mock.calls.at(-1)![1]).toBeNull();
    }
    who = GUEST;
    expect((await call("POST", "/api/watchlist", { ticker: "NVDA" })).json.code).toBe("GUEST_READ_ONLY");
  });

  it("a duplicate is per list (409 with the existing id)", async () => {
    store.activeByTickers.mockResolvedValueOnce([{ id: 1, ticker: "NVDA", status: "watching" }]);
    const r = await call("POST", "/api/watchlist", { ticker: "NVDA" });
    expect([r.status, r.json.code, r.json.details]).toEqual([409, "ALREADY_IN_WATCHLIST", { id: 1 }]);
  });
});

describe("row writes — route × role", () => {
  const writes: Array<[string, (id: number) => string, unknown?]> = [
    ["PATCH", (id) => `/api/watchlist/${id}`, { notes: "x" }],
    ["PATCH", (id) => `/api/watchlist/${id}`, { list: "today" }],
    ["DELETE", (id) => `/api/watchlist/${id}`],
    ["POST", (id) => `/api/watchlist/${id}/restore`],
    ["POST", (id) => `/api/watchlist/${id}/score`],
  ];

  it("own personal row: the owner writes; another trader / senior / curator get 404 (not even visible)", async () => {
    for (const [m, p, b] of writes) expect((await call(m, p(1), b)).status).toBe(200);
    for (const a of [OTHER, SENIOR, CURATOR]) {
      who = a;
      for (const [m, p, b] of writes) expect((await call(m, p(1), b)).status).toBe(404);
    }
  });

  it("desk row: trader 403 NOT_OWNER (flags too); senior and curator write; unknown id 404", async () => {
    for (const [m, p, b] of writes) {
      const r = await call(m, p(2), b);
      expect([r.status, r.json.code]).toEqual([403, "NOT_OWNER"]);
    }
    expect(store.updateContent).not.toHaveBeenCalled();
    expect(store.setList).not.toHaveBeenCalled();
    expect(store.setDeleted).not.toHaveBeenCalled();
    for (const a of [SENIOR, CURATOR]) {
      who = a;
      for (const [m, p, b] of writes) expect((await call(m, p(2), b)).status).toBe(200);
    }
    expect((await call("PATCH", "/api/watchlist/999", { notes: "x" })).status).toBe(404);
  });

  it("bulk: rows the caller may not write are skipped and listed in `denied`; none left → 403", async () => {
    const r = await call("POST", "/api/watchlist/bulk", { ids: [1, 2, 3], action: "list", list: "swing" });
    expect(r.status).toBe(200);
    expect(store.setList).toHaveBeenCalledWith([1], "swing");
    expect(r.json.denied).toEqual([2, 3]);
    who = OTHER;
    const d = await call("POST", "/api/watchlist/bulk", { ids: [1, 2], action: "delete" });
    expect([d.status, d.json.code]).toEqual([403, "NOT_OWNER"]);
    who = CURATOR;
    const c = await call("POST", "/api/watchlist/bulk", { ids: [1, 2, 3], action: "status", status: "passed" });
    expect(store.setStatus).toHaveBeenLastCalledWith([2], "passed");
    expect(c.json.denied).toEqual([1, 3]);
  });

  it("score-all: own list by default; the desk list only for seniors / staff", async () => {
    expect((await call("POST", "/api/watchlist/score-all")).status).toBe(200);
    expect(store.rowsToScore).toHaveBeenLastCalledWith(5, 300);
    expect((await call("POST", "/api/watchlist/score-all?scope=desk")).json.code).toBe("NOT_OWNER");
    who = SENIOR;
    expect((await call("POST", "/api/watchlist/score-all?scope=desk")).status).toBe(200);
    expect(store.rowsToScore).toHaveBeenLastCalledWith(null, 300);
  });
});

describe("view and quotes", () => {
  it("GET view says whether the desk is editable; PUT remembers the list; guests read the desk only", async () => {
    expect((await call("GET", "/api/watchlist/view")).json).toEqual({ scope: "mine", canEditDesk: false });
    expect((await call("PUT", "/api/watchlist/view", { scope: "desk" })).json).toEqual({ scope: "desk", canEditDesk: false });
    expect(access.writeWatchView).toHaveBeenCalledWith(5, { scope: "desk" });
    expect((await call("PUT", "/api/watchlist/view", { scope: "x" })).status).toBe(400);
    who = SENIOR;
    expect((await call("GET", "/api/watchlist/view")).json.canEditDesk).toBe(true);
    who = GUEST;
    expect((await call("GET", "/api/watchlist/view")).json).toEqual({ scope: "desk", canEditDesk: false });
    expect((await call("PUT", "/api/watchlist/view", { scope: "mine" })).json.code).toBe("GUEST_READ_ONLY");
  });

  it("quotes come from the common quote layer (tickers checked)", async () => {
    const r = await call("GET", "/api/watchlist/quotes?tickers=nvda,$amd,bad!");
    expect(r.json.quotes).toEqual({ NVDA: { price: 1 }, AMD: { price: 1 } });
    expect((await call("GET", "/api/watchlist/quotes?tickers=")).status).toBe(400);
  });
});
