/**
 * Wave 1, item 1.17 — content reports: a trade idea can be reported (was always 400), the target must exist, and the
 * same reporter + target answers the open report (200) instead of a new row. The moderation list resolves idea targets.
 * routes/admin.ts + lib/contentReports.ts, DB mocked (an in-memory content_reports).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const TRADER: Who = { id: 5, name: "Kirill", role: "trader" };
const CURATOR: Who = { id: 2, name: "Anton", role: "curator" };
let who: Who = TRADER;

type Report = { id: number; reporter: string; target_type: string; target_id: string; reason: string; status: string; resolved_by: null; resolved_at: null; resolution: null; created_at: Date };
let reports: Report[] = [];
const ideas = new Map<number, { trader: string; ticker: string; setup: string; thesis: string; deleted_at: Date | null }>([
  [42, { trader: "Roman", ticker: "SPCX", setup: "ORB", thesis: "Spam link here", deleted_at: null }],
  [43, { trader: "Roman", ticker: "AMD", setup: "VWAP", thesis: "gone", deleted_at: new Date() }],
]);

const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  if (/SELECT COALESCE\(banned, false\) AS banned FROM users WHERE name = \$1/.test(sql)) return { rows: [{ banned: false }] };
  if (/SELECT 1 FROM trade_ideas WHERE id = \$1 AND deleted_at IS NULL/.test(sql)) {
    const i = ideas.get(Number(params[0]));
    return { rows: i && !i.deleted_at ? [{ "?column?": 1 }] : [] };
  }
  if (/SELECT 1 FROM discussions WHERE id = \$1/.test(sql)) return { rows: Number(params[0]) === 7 ? [{}] : [] };
  if (/WITH existing AS/.test(sql)) {
    const [reporter, type, id, reason] = params as string[];
    const hit = reports.find((r) => r.reporter === reporter && r.target_type === type && r.target_id === id && r.status === "open");
    if (hit) return { rows: [{ ...hit, created: false }] };
    const row: Report = { id: reports.length + 1, reporter, target_type: type, target_id: id, reason, status: "open", resolved_by: null, resolved_at: null, resolution: null, created_at: new Date() };
    reports.push(row);
    return { rows: [{ ...row, created: true }] };
  }
  if (/FROM trade_ideas WHERE id = ANY/.test(sql)) {
    return { rows: (params[0] as number[]).filter((id) => ideas.has(id)).map((id) => ({ id, ...ideas.get(id)!, created_at: new Date("2026-10-19T10:00:00Z") })) };
  }
  if (/SELECT id, name, role, COALESCE\(banned, false\) AS banned FROM users/.test(sql)) return { rows: [{ id: 9, name: "Roman", role: "trader", banned: false }] };
  if (/SELECT target_type, target_id, COUNT/.test(sql)) {
    const m = new Map<string, number>();
    for (const r of reports.filter((x) => x.status === "open")) m.set(`${r.target_type}|${r.target_id}`, (m.get(`${r.target_type}|${r.target_id}`) ?? 0) + 1);
    return { rows: [...m].map(([k, c]) => ({ target_type: k.split("|")[0], target_id: k.split("|")[1], c })) };
  }
  return { rows: [], rowCount: 0 };
});
const camel = (r: Report) => ({ id: r.id, reporter: r.reporter, targetType: r.target_type, targetId: r.target_id, reason: r.reason, status: r.status, resolvedBy: null, resolvedAt: null, resolution: null, createdAt: r.created_at });
vi.mock("@workspace/db", () => ({
  pool: { query: (sql: string, params?: unknown[]) => query(sql, params) },
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => reports.map(camel) }) }) }) }) },
  auditLogTable: {}, contentReportsTable: { status: "status", createdAt: "created_at", id: "id" }, discussionsTable: {}, commentsTable: {},
}));
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { buildEffectiveMatrix, evaluate } = await import("../../lib/permissionsMatrix");
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    can: vi.fn(async (_req: unknown, cap: never, target?: never) => evaluate(buildEffectiveMatrix([]), actor(), cap, target)),
  };
});
process.env.JWT_SECRET ??= "vitest-only-secret";

const { default: admin } = await import("../admin");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", admin);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = TRADER; reports = []; });

const post = async (body: unknown) => {
  const r = await fetch(`${base}/api/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as any };
};

describe("POST /reports", () => {
  it("trader reports a trade idea → 201 with the report", async () => {
    const r = await post({ targetType: "trade_idea", targetId: "42", reason: "spam" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ reporter: "Kirill", targetType: "trade_idea", targetId: "42", status: "open", alreadyReported: false });
  });

  it("the same reporter + target again → 200 with the same report, no new row", async () => {
    const a = await post({ targetType: "trade_idea", targetId: 42, reason: "spam" });
    const b = await post({ targetType: "trade_idea", targetId: "42", reason: "still spam" });
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ id: a.json.id, reason: "spam", alreadyReported: true });
    expect(reports).toHaveLength(1);
  });

  it("another reporter on the same idea gets their own report", async () => {
    await post({ targetType: "trade_idea", targetId: "42", reason: "spam" });
    who = CURATOR;
    expect((await post({ targetType: "trade_idea", targetId: "42", reason: "spam" })).status).toBe(201);
    expect(reports).toHaveLength(2);
  });

  it("a missing or deleted idea → 404; unknown target type → 400", async () => {
    expect((await post({ targetType: "trade_idea", targetId: "999", reason: "x" })).status).toBe(404);
    expect((await post({ targetType: "trade_idea", targetId: "43", reason: "x" })).status).toBe(404);
    expect((await post({ targetType: "playbook", targetId: "1", reason: "x" })).status).toBe(400);
  });

  it("discussions still work", async () => {
    expect((await post({ targetType: "discussion", targetId: "7", reason: "x" })).status).toBe(201);
  });
});

describe("GET /admin/reports — idea targets", () => {
  it("curator sees the reported idea with its author, title and preview", async () => {
    await post({ targetType: "trade_idea", targetId: "42", reason: "spam" });
    who = CURATOR;
    const r = await fetch(`${base}/api/admin/reports`);
    expect(r.status).toBe(200);
    const [item] = (await r.json()) as any[];
    expect(item.target).toMatchObject({ author: "Roman", authorId: 9, title: "SPCX · ORB", preview: "Spam link here", deleted: false });
    expect(item.openReportsOnTarget).toBe(1);
  });
  it("trader → 403", async () => {
    expect((await fetch(`${base}/api/admin/reports`)).status).toBe(403);
  });
});
