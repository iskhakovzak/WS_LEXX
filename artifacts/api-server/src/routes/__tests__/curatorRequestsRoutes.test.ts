/**
 * Волна 1 п. 1.1 «Попросить куратора» — routes/curator-requests.ts over a mocked store, route × role:
 *  - a member asks (201), one open request per kind (409 CURATOR_REQUEST_OPEN), guests are read-only, the group curator
 *    / assigned staff are notified in their language;
 *  - GET /mine is the caller's own; the staff list needs journal.review (trader 403) and defaults to «Моя группа»;
 *  - PATCH: staff only, 404 outside the matrix scope (`assigned`), 409 when closed; the trader gets the note.
 *  - Волна 2 п. 2.13: kind «review» needs a thread link (discussion / idea), one open per thread, the curator's
 *    notification leads to the thread.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest" };
const TRADER: Who = { id: 5, name: "Trader T.", role: "trader" };
const OTHER: Who = { id: 6, name: "Other O.", role: "trader" };
const CURATOR: Who = { id: 3, name: "Curator C.", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin A.", role: "admin" };
const GUEST: Who = { id: 0, name: "guest", role: "guest" };
let who: Who = TRADER;
/** Overrides of the matrix for a test (e.g. curator journal.review scoped «assigned»). */
let overrides: { role: "trader" | "curator"; capability: string; allowed: boolean; scope?: "desk" | "assigned" }[] = [];
const WARDS: Record<string, string[]> = { "Curator C.": ["Trader T."] };

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../../i18n", async (orig) => ({ ...(await orig<typeof import("../../i18n")>()), localeOfUser: vi.fn(async (n: string) => (n === "Trader T." ? "en" : "ru")) }));
const notify = vi.hoisted(() => ({ notifyUser: vi.fn(async (_opts: Record<string, unknown>) => 1) }));
vi.mock("../../lib/notifyUtils", () => notify);
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const { AppError } = await import("../../lib/http/errors");
  const matrix = () => actual.buildEffectiveMatrix(overrides as never);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: who.role === "guest", wards: WARDS[who.name] ?? [] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix(), actor() as never, cap, target);
  return {
    ...actual,
    can: vi.fn(can),
    readScope: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.can>[1]) => actual.readableTraders(matrix(), actor() as never, cap)),
    requireCap: vi.fn(async (_req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => {
      if (who.role === "guest") { sendError(res, new AppError("GUEST_READ_ONLY")); return false; }
      if (await can(_req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});
const req = (over: Record<string, unknown> = {}) => ({
  id: 11, trader: "Trader T.", traderId: 5, kind: "limits", message: "", status: "open", note: null,
  createdAt: "2026-10-20T14:00:00.000Z", resolvedAt: null, resolvedBy: null, link: null, ...over,
});
const store = vi.hoisted(() => ({
  REQUEST_KINDS: ["limits", "group", "stage", "plan", "other", "review"] as const,
  REVIEW_LINK_RE: /^\/(discussions\?thread=|trade-ideas\?idea=)[1-9]\d{0,9}$/,
  REQUEST_STATUSES: ["open", "done", "dismissed"] as const,
  memberId: vi.fn(async (name: string) => ({ "Trader T.": 5, "Other O.": 6, "Curator C.": 3, "Admin A.": 1 } as Record<string, number>)[name] ?? null),
  openRequestOf: vi.fn(async () => null),
  insertRequest: vi.fn(),
  listMine: vi.fn(async () => []),
  listForStaff: vi.fn(async () => []),
  requestById: vi.fn(),
  resolveRequest: vi.fn(),
  requestRecipients: vi.fn(async () => ["Curator C."]),
}));
vi.mock("../../lib/people/curatorRequests", () => store);
const groups = vi.hoisted(() => ({
  myPeople: vi.fn(async (name: string) => (name === "Curator C." ? ["Trader T."] : [])),
  pickScope: (raw: unknown, mine: readonly string[]) => {
    const want = raw === "group" ? "group" : raw === "all" ? "all" : null;
    const scope = want ?? (mine.length ? "group" : "all");
    return { scope, names: scope === "group" ? new Set(mine) : null };
  },
}));
vi.mock("../../lib/people/deskGroups", () => groups);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../curator-requests");
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
  who = TRADER;
  overrides = [];
  vi.clearAllMocks();
  store.openRequestOf.mockResolvedValue(null);
  store.insertRequest.mockImplementation(async (traderId: number, kind: string, message: string, link: string | null = null) => req({ traderId, kind, message, link }));
  store.requestById.mockResolvedValue(req());
  store.resolveRequest.mockImplementation(async (id: number, status: string, note: string | null) => req({ id, status, note, resolvedAt: "2026-10-20T15:00:00.000Z", resolvedBy: who.name }));
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
}

describe("POST /curator-requests (member)", () => {
  it("a trader asks for limits: 201, the group curator is notified in his language", async () => {
    const r = await call("POST", "/api/curator-requests", { kind: "limits", message: "Нужен дневной стоп" });
    expect(r.status).toBe(201);
    expect(r.json.request).toMatchObject({ kind: "limits", message: "Нужен дневной стоп", status: "open" });
    expect(store.insertRequest).toHaveBeenCalledWith(5, "limits", "Нужен дневной стоп", null);
    expect(notify.notifyUser).toHaveBeenCalledTimes(1);
    expect(notify.notifyUser.mock.calls[0]![0]).toMatchObject({ userName: "Curator C.", type: "curator_request", title: "Trader T. просит: лимиты риска", link: expect.stringContaining("/curator") });
  });

  it("one open request per kind → 409 CURATOR_REQUEST_OPEN with its id; unknown kind → 400; guest → read-only", async () => {
    store.openRequestOf.mockResolvedValue(req({ id: 4 }) as never);
    const dup = await call("POST", "/api/curator-requests", { kind: "limits" });
    expect([dup.status, dup.json.code, dup.json.details]).toEqual([409, "CURATOR_REQUEST_OPEN", { id: 4 }]);
    expect(store.insertRequest).not.toHaveBeenCalled();
    expect((await call("POST", "/api/curator-requests", { kind: "money" })).status).toBe(400);
    who = GUEST;
    expect((await call("POST", "/api/curator-requests", { kind: "plan" })).json.code).toBe("GUEST_READ_ONLY");
  });

  it("curators and admins may ask too (they are members); the request is saved even if a notification fails", async () => {
    who = CURATOR;
    notify.notifyUser.mockRejectedValueOnce(new Error("telegram down"));
    expect((await call("POST", "/api/curator-requests", { kind: "other" })).status).toBe(201);
  });
});

describe("POST /curator-requests kind «review» (2.13)", () => {
  it("from a discussion thread: 201 with the link; the curator's notification leads to the thread", async () => {
    const r = await call("POST", "/api/curator-requests", { kind: "review", message: "Посмотрите вход", link: "/discussions?thread=7" });
    expect(r.status).toBe(201);
    expect(r.json.request).toMatchObject({ kind: "review", link: "/discussions?thread=7" });
    expect(store.openRequestOf).toHaveBeenCalledWith(5, "review", "/discussions?thread=7");
    expect(store.insertRequest).toHaveBeenCalledWith(5, "review", "Посмотрите вход", "/discussions?thread=7");
    expect(notify.notifyUser.mock.calls[0]![0]).toMatchObject({ userName: "Curator C.", title: "Trader T. просит: разбор темы", link: "/discussions?thread=7" });
  });

  it("from a trade idea: accepted; one open per thread → 409", async () => {
    expect((await call("POST", "/api/curator-requests", { kind: "review", link: "/trade-ideas?idea=3" })).status).toBe(201);
    store.openRequestOf.mockResolvedValue(req({ id: 8, kind: "review", link: "/trade-ideas?idea=3" }) as never);
    const dup = await call("POST", "/api/curator-requests", { kind: "review", link: "/trade-ideas?idea=3" });
    expect([dup.status, dup.json.code, dup.json.details]).toEqual([409, "CURATOR_REQUEST_OPEN", { id: 8 }]);
  });

  it("a review without a link, a foreign link, or a link on another kind → 400", async () => {
    for (const body of [
      { kind: "review" },
      { kind: "review", link: "https://evil.example/discussions?thread=1" },
      { kind: "review", link: "/admin?thread=1" },
      { kind: "review", link: "/discussions?thread=0" },
      { kind: "limits", link: "/discussions?thread=7" },
    ]) expect((await call("POST", "/api/curator-requests", body)).status).toBe(400);
    expect(store.insertRequest).not.toHaveBeenCalled();
  });

  it("closing a review request tells the trader with a link back to the thread", async () => {
    who = CURATOR;
    store.requestById.mockResolvedValueOnce(req({ kind: "review", link: "/discussions?thread=7" }) as never);
    store.resolveRequest.mockResolvedValueOnce(req({ kind: "review", link: "/discussions?thread=7", status: "done", resolvedAt: "2026-10-20T15:00:00.000Z" }) as never);
    await call("PATCH", "/api/curator-requests/11", { status: "done" });
    expect(notify.notifyUser.mock.calls[0]![0]).toMatchObject({ userName: "Trader T.", title: "Your curator handled the request: a review of a thread", link: "/discussions?thread=7" });
  });
});

describe("GET lists", () => {
  it("/mine: own requests only, any member", async () => {
    store.listMine.mockResolvedValue([req()] as never);
    const r = await call("GET", "/api/curator-requests/mine");
    expect(r.json.requests).toHaveLength(1);
    expect(store.listMine).toHaveBeenCalledWith(5);
  });

  it("staff list: trader 403; a curator gets «Моя группа» by default and everyone with scope=all; admin without people → all", async () => {
    expect((await call("GET", "/api/curator-requests")).status).toBe(403);
    who = CURATOR;
    const mine = await call("GET", "/api/curator-requests?status=open");
    expect(mine.json.scope).toBe("group");
    expect(store.listForStaff).toHaveBeenLastCalledWith(["Trader T."], "open");
    const all = await call("GET", "/api/curator-requests?scope=all");
    expect(all.json.scope).toBe("all");
    expect(store.listForStaff).toHaveBeenLastCalledWith(null, null);
    who = ADMIN;
    expect((await call("GET", "/api/curator-requests")).json.scope).toBe("all");
  });

  it("matrix scope «assigned»: even scope=all stays within the curator's wards", async () => {
    overrides = [{ role: "curator", capability: "journal.review", allowed: true, scope: "assigned" }];
    who = CURATOR;
    await call("GET", "/api/curator-requests?scope=all");
    expect(store.listForStaff).toHaveBeenLastCalledWith(["Curator C.", "Trader T."], null);
  });
});

describe("PATCH /curator-requests/:id (staff)", () => {
  it("done with a note → the trader is notified (his language, Telegram) with the note; audit written", async () => {
    who = CURATOR;
    const r = await call("PATCH", "/api/curator-requests/11", { status: "done", note: "Лимиты заданы: стоп $300" });
    expect(r.status).toBe(200);
    expect(r.json.request).toMatchObject({ status: "done", note: "Лимиты заданы: стоп $300" });
    expect(store.resolveRequest).toHaveBeenCalledWith(11, "done", "Лимиты заданы: стоп $300", 3);
    expect(notify.notifyUser.mock.calls[0]![0]).toMatchObject({
      userName: "Trader T.", type: "curator_request_done", telegram: true, message: "Лимиты заданы: стоп $300",
      title: "Your curator handled the request: risk limits", link: "/risk",
    });
  });

  it("trader 403; closed → 409; unknown id → 404; outside the «assigned» scope → 404", async () => {
    expect((await call("PATCH", "/api/curator-requests/11", { status: "done" })).status).toBe(403);
    who = ADMIN;
    store.requestById.mockResolvedValueOnce(req({ status: "done" }) as never);
    expect((await call("PATCH", "/api/curator-requests/11", { status: "dismissed" })).json.code).toBe("CURATOR_REQUEST_CLOSED");
    store.requestById.mockResolvedValueOnce(null as never);
    expect((await call("PATCH", "/api/curator-requests/99", { status: "done" })).json.code).toBe("CURATOR_REQUEST_NOT_FOUND");
    overrides = [{ role: "curator", capability: "journal.review", allowed: true, scope: "assigned" }];
    who = CURATOR;
    store.requestById.mockResolvedValueOnce(req({ trader: "Other O.", traderId: 6 }) as never);
    const r = await call("PATCH", "/api/curator-requests/12", { status: "done" });
    expect([r.status, r.json.code]).toEqual([404, "CURATOR_REQUEST_NOT_FOUND"]);
    expect(store.resolveRequest).not.toHaveBeenCalled();
  });

  it("dismissed without a note → default text", async () => {
    who = CURATOR;
    await call("PATCH", "/api/curator-requests/11", { status: "dismissed" });
    expect(notify.notifyUser.mock.calls[0]![0]).toMatchObject({ title: "Your curator closed the request: risk limits", message: "Closed without changes" });
  });
});
