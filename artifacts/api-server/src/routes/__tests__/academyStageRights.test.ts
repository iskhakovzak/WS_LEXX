/**
 * The ladder stage is admin-only (owner policy) and curator work is scoped to the curator's people:
 *   POST /academy/enrollments          a curator may not set a stage (lib/people/stage falls back to the enrolment's);
 *                                      without one the enrolment records the person's current stage; admin sets any
 *   PATCH /academy/enrollments/:id     a curator may not change the stage (status / note stay open); admin may
 *   staff academy writes about a person  an «assigned» curator: own people only (enrolments, 1:1s)
 *   POST /academy/path/requests/:id/approve  four eyes: a curator does not approve a request they filed; admin may
 * DB, notifications and the actor are faked; the real permission matrix decides.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin"; wards?: string[] };
const ANTON: Who = { id: 2, name: "Anton", role: "curator", wards: ["Umid"] };
const OLGA: Who = { id: 3, name: "Olga", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin", role: "admin" };
let who: Who = ANTON;
let assigned = false;

const st = vi.hoisted(() => ({
  sql: [] as { sql: string; params: unknown[] }[],
  pathStage: null as string | null,
  enrollment: { user_name: "Umid", stage: "junior" },
  meetingStudent: "Umid",
  request: null as Record<string, unknown> | null,
}));
const enrollmentRow = (stage: string, user = "Umid") => ({
  id: 11, cohort_id: 4, user_name: user, stage, status: "active", joined_on: "2026-10-20", note: "",
  created_at: new Date("2026-10-20T12:00:00Z"), updated_at: new Date("2026-10-20T12:00:00Z"), archived_at: null,
});

function answer(sql: string, params: unknown[] = []) {
  st.sql.push({ sql, params });
  if (/SELECT role FROM users WHERE id = \$1/.test(sql)) return { rows: [{ role: who.role }] };
  if (/SELECT 1 FROM users WHERE name = \$1/.test(sql)) return { rows: [{ "?column?": 1 }] };
  if (/FROM academy_trader_stage/.test(sql)) return { rows: st.pathStage ? [{ user_name: "Umid", stage: st.pathStage, since: "2026-09-01" }] : [] };
  if (/SELECT name FROM academy_cohorts WHERE id = \$1/.test(sql)) return { rows: [{ name: "Autumn" }] };
  if (/^\s*INSERT INTO academy_enrollments \(/.test(sql)) return { rows: [enrollmentRow(String(params[2]), String(params[1]))] };
  if (/SELECT user_name, stage FROM academy_enrollments WHERE id = \$1/.test(sql)) return { rows: [st.enrollment] };
  if (/FROM academy_enrollments e WHERE e\.id = \$1 AND e\.archived_at IS NULL FOR UPDATE/.test(sql)) return { rows: [enrollmentRow(st.enrollment.stage, st.enrollment.user_name)] };
  if (/^\s*UPDATE academy_enrollments e SET stage = \$2/.test(sql)) return { rows: [enrollmentRow(String(params[1]), st.enrollment.user_name)] };
  if (/SELECT user_name AS p FROM academy_enrollments/.test(sql)) return { rows: [{ p: st.enrollment.user_name }] };
  if (/SELECT student AS p FROM academy_one_on_ones/.test(sql)) return { rows: [{ p: st.meetingStudent }] };
  if (/FROM academy_promotion_requests WHERE id = \$1/.test(sql)) return { rows: st.request ? [st.request] : [] };
  if (/to_regclass/.test(sql)) return { rows: [{ t: "x" }] };
  return { rows: [], rowCount: 0 };
}
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)),
    connect: vi.fn(async () => ({ query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)), release: vi.fn() })),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/notifyUtils", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  notifyUser: vi.fn(async () => 1), notifyUsers: vi.fn(async () => undefined), assignedStaffOf: vi.fn(async () => []),
}));
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const matrix = () => actual.buildEffectiveMatrix(assigned ? [
    { role: "curator", capability: "team.read", allowed: true, scope: "assigned" },
    { role: "curator", capability: "journal.review", allowed: true, scope: "assigned" },
  ] : []);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards ?? [] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix(), actor(), cap, target);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix()),
    can: vi.fn(can),
    readScope: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.can>[1]) => actual.readableTraders(matrix(), actor(), cap)),
    requireCap: vi.fn(async (req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null, code?: string) => {
      if (await can(req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap, code as never));
      return false;
    }),
  };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: cohorts } = await import("../academy-cohorts");
const { default: path } = await import("../academy-path");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", cohorts, path);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = ANTON; assigned = false;
  st.sql.length = 0; st.pathStage = null; st.enrollment = { user_name: "Umid", stage: "junior" }; st.meetingStudent = "Umid"; st.request = null;
});

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, json };
}
const enrollInserts = () => st.sql.filter((q) => /^\s*INSERT INTO academy_enrollments \(/.test(q.sql));
const stageUpdates = () => st.sql.filter((q) => /^\s*UPDATE academy_enrollments e SET stage/.test(q.sql));

describe("POST /academy/enrollments — the stage", () => {
  it("curator: a stage other than the current one → 403 ADMIN_ONLY, nothing inserted", async () => {
    const r = await call("POST", "/api/academy/enrollments", { cohortId: 4, userName: "Umid", stage: "senior" });
    expect([r.status, r.json?.code]).toEqual([403, "ADMIN_ONLY"]);
    expect(enrollInserts()).toEqual([]);
  });

  it("curator without a stage: the enrolment records the person's current stage (not the default)", async () => {
    st.pathStage = "trader";
    expect((await call("POST", "/api/academy/enrollments", { cohortId: 4, userName: "Umid" })).status).toBe(201);
    expect(enrollInserts()[0]!.params[2]).toBe("trader");
  });

  it("curator re-sending the current stage passes; admin sets any stage", async () => {
    expect((await call("POST", "/api/academy/enrollments", { cohortId: 4, userName: "Umid", stage: "junior" })).status).toBe(201);
    who = ADMIN;
    expect((await call("POST", "/api/academy/enrollments", { cohortId: 4, userName: "Umid", stage: "senior" })).status).toBe(201);
    expect(enrollInserts().map((q) => q.params[2])).toEqual(["junior", "senior"]);
  });
});

describe("PATCH /academy/enrollments/:id — the stage", () => {
  it("curator: changing the stage → 403 ADMIN_ONLY; status-only edits and an unchanged stage pass", async () => {
    const r = await call("PATCH", "/api/academy/enrollments/11", { stage: "senior" });
    expect([r.status, r.json?.code]).toEqual([403, "ADMIN_ONLY"]);
    expect(stageUpdates()).toEqual([]);
    expect((await call("PATCH", "/api/academy/enrollments/11", { status: "paused" })).status).toBe(200);
    expect((await call("PATCH", "/api/academy/enrollments/11", { stage: "junior", note: "same" })).status).toBe(200);
  });

  it("admin changes the stage", async () => {
    who = ADMIN;
    expect((await call("PATCH", "/api/academy/enrollments/11", { stage: "senior" })).status).toBe(200);
    expect(stageUpdates()[0]!.params[1]).toBe("senior");
  });
});

describe("staff academy writes are scoped to the curator's people («assigned»)", () => {
  it("enrol / edit / archive an enrolment: ward yes, someone else 403", async () => {
    assigned = true;
    expect((await call("POST", "/api/academy/enrollments", { cohortId: 4, userName: "Umid" })).status).toBe(201);
    expect((await call("POST", "/api/academy/enrollments", { cohortId: 4, userName: "Kirill" })).status).toBe(403);
    st.enrollment = { user_name: "Kirill", stage: "junior" };
    expect((await call("PATCH", "/api/academy/enrollments/11", { status: "paused" })).status).toBe(403);
    expect((await call("POST", "/api/academy/enrollments/11/archive")).status).toBe(403);
    expect(stageUpdates()).toEqual([]);
  });

  it("1:1s: another curator's trader 403; desk scope opens everyone", async () => {
    assigned = true;
    st.meetingStudent = "Kirill";
    expect((await call("PATCH", "/api/academy/one-on-ones/9", { agenda: "x" })).status).toBe(403);
    expect((await call("POST", "/api/academy/one-on-ones/9/archive")).status).toBe(403);
    expect((await call("POST", "/api/academy/one-on-ones", { student: "Kirill", metAt: "2026-10-20T15:00:00Z" })).status).toBe(403);
    assigned = false;
    expect((await call("PATCH", "/api/academy/one-on-ones/9", { agenda: "x" })).status).not.toBe(403);
  });
});

describe("POST /academy/path/requests/:id/approve — four eyes", () => {
  const request = (requestedBy: string) => ({
    id: 1, user_name: "Umid", from_stage: "junior", to_stage: "trader", status: "pending", requested_by: requestedBy, archived_at: null,
  });

  it("the curator who filed the request may not approve it", async () => {
    st.request = request("Anton");
    const r = await call("POST", "/api/academy/path/requests/1/approve", { comment: "ok" });
    expect([r.status, r.json?.code]).toEqual([403, "PROMOTION_OWN_REQUEST"]);
    expect(st.sql.some((q) => /UPDATE academy_promotion_requests SET status = 'approved'/.test(q.sql))).toBe(false);
  });

  it("another curator and an admin are not stopped by the four-eyes rule", async () => {
    st.request = request("Anton");
    who = OLGA;
    expect((await call("POST", "/api/academy/path/requests/1/approve", { comment: "ok" })).json?.code).not.toBe("PROMOTION_OWN_REQUEST");
    who = { ...ADMIN, name: "Anton" };
    expect((await call("POST", "/api/academy/path/requests/1/approve", { comment: "ok" })).json?.code).not.toBe("PROMOTION_OWN_REQUEST");
  });
});
