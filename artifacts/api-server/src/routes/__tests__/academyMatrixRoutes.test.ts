/**
 * Wave 1, item 1.6 — Academy on the permission matrix (lib/academyAccess), route × role, DB mocked:
 *   GET /academy/my?user=            trader → always own; curator (desk) → the requested person; curator with the
 *                                    «assigned» scope → a ward yes, anyone else → own; admin → anyone.
 *   GET /academy/idp?student=        same rule.
 *   GET /academy/content/review-queue  curator «assigned» → the SQL is limited to the mentor's people; trader → 403.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin"; wards?: string[] };
const KIRILL: Who = { id: 5, name: "Kirill", role: "trader" };
const ANTON: Who = { id: 2, name: "Anton", role: "curator", wards: ["Umid"] };
const ADMIN: Who = { id: 1, name: "Admin", role: "admin" };
let who: Who = KIRILL;
let assigned = false;
const sqlLog: { sql: string; params: unknown[] }[] = [];

const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  sqlLog.push({ sql, params });
  if (/SELECT role FROM users WHERE id = \$1/.test(sql)) return { rows: [{ role: who.role }] };
  if (/to_regclass/.test(sql)) return { rows: [{ t: "x" }] };
  return { rows: [], rowCount: 0 };
});
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: (sql: string, params?: unknown[]) => query(sql, params),
    connect: async () => ({ query: (sql: string, params?: unknown[]) => query(sql, params), release: () => undefined }),
  },
}));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { buildEffectiveMatrix, evaluate, readableTraders } = await import("../../lib/permissionsMatrix");
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards ?? [] });
  const matrix = () => buildEffectiveMatrix(assigned ? [
    { role: "curator", capability: "team.read", allowed: true, scope: "assigned" },
    { role: "curator", capability: "journal.review", allowed: true, scope: "assigned" },
  ] : []);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix()),
    can: vi.fn(async (_req: unknown, cap: never, target?: never) => evaluate(matrix(), actor(), cap, target)),
    readScope: vi.fn(async (_req: unknown, cap: never) => readableTraders(matrix(), actor(), cap)),
    requireCap: vi.fn(async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, cap: never, target?: never) => {
      if (evaluate(matrix(), actor(), cap, target)) return true;
      res.status(403).json({ code: "STAFF_ONLY" });
      return false;
    }),
  };
});
process.env.JWT_SECRET ??= "vitest-only-secret";

const { default: cohorts } = await import("../academy-cohorts");
const { default: content } = await import("../academy-content");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", cohorts, content);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = KIRILL; assigned = false; sqlLog.length = 0; });

const get = async (path: string) => {
  const r = await fetch(base + path);
  return { status: r.status, json: (await r.json()) as any };
};

describe("GET /academy/my?user= × role", () => {
  it("trader asking for someone else gets their own dashboard", async () => {
    const r = await get("/api/academy/my?user=Umid");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ user: "Kirill", viewingOther: false });
  });
  it("curator (desk scope) opens anyone", async () => {
    who = ANTON;
    expect((await get("/api/academy/my?user=Kirill")).json).toMatchObject({ user: "Kirill", viewingOther: true });
  });
  it("curator with the «assigned» scope: a ward yes, someone else → own", async () => {
    who = ANTON; assigned = true;
    expect((await get("/api/academy/my?user=Umid")).json.user).toBe("Umid");
    expect((await get("/api/academy/my?user=Kirill")).json).toMatchObject({ user: "Anton", viewingOther: false });
  });
  it("admin opens anyone", async () => {
    who = ADMIN; assigned = true;
    expect((await get("/api/academy/my?user=Kirill")).json.user).toBe("Kirill");
  });
});

describe("GET /academy/idp?student= × role", () => {
  it("assigned curator: non-ward → own; ward → the ward", async () => {
    who = ANTON; assigned = true;
    expect((await get("/api/academy/idp?student=Kirill")).json.student).toBe("Anton");
    expect((await get("/api/academy/idp?student=Umid")).json.student).toBe("Umid");
  });
  it("trader → own", async () => {
    expect((await get("/api/academy/idp?student=Umid")).json.student).toBe("Kirill");
  });
});

describe("GET /academy/content/review-queue × role", () => {
  it("trader → 403", async () => {
    expect((await get("/api/academy/content/review-queue")).status).toBe(403);
  });
  it("desk curator: no person filter; assigned curator: limited to own people", async () => {
    who = ANTON;
    expect((await get("/api/academy/content/review-queue")).status).toBe(200);
    const desk = sqlLog.find((q) => /FROM academy_submissions s/.test(q.sql))!;
    expect(desk.params.some((p) => Array.isArray(p))).toBe(false);
    sqlLog.length = 0;
    assigned = true;
    expect((await get("/api/academy/content/review-queue")).status).toBe(200);
    const scoped = sqlLog.find((q) => /FROM academy_submissions s/.test(q.sql))!;
    expect(scoped.params).toContainEqual(["Anton", "Umid"]);
  });
});
