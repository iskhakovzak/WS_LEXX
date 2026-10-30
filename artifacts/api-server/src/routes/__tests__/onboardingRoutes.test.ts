/**
 * First-visit onboarding: the «new user» rule (lib/people/onboarding), the stored block's schema, GET /users/me/onboarding
 * (stage + checklist signals from real data) and POST /users/:id/onboarding/reset (users.manage; admins for admins).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  NEW_MAX_ACCOUNT_DAYS, NEW_MAX_ACTIVE_DAYS, OnboardingStateSchema, SETTLING_MAX_ACTIVE_DAYS, SETTLING_MAX_CLOSED, onboardingStage, resetState,
} from "../../lib/people/onboarding";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" | "guest"; guest?: boolean };
const TRADER: Who = { id: 130, name: "Кирилл Б.", role: "trader" };
const CURATOR: Who = { id: 123, name: "Ольга Н.", role: "curator" };
const ADMIN: Who = { id: 121, name: "Дмитрий К.", role: "admin" };
const GUEST: Who = { id: 0, name: "guest", role: "guest", guest: true };
let who: Who = TRADER;

const db = vi.hoisted(() => ({
  users: new Map<number, { name: string; role: string; created_at: Date; must_change: boolean; tg: boolean; settings: Record<string, unknown>; quick: boolean | "missing" }>(),
  closed: [] as string[],
  reviewed: [] as string[],
  traded: [] as string[],
  used: [] as string[],
  plan: false,
  updates: [] as unknown[][],
}));

vi.mock("@workspace/db", () => {
  const rows = <T>(r: T[]) => ({ rows: r, rowCount: r.length });
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT name, created_at, must_change_secret AS must_change/.test(sql)) {
      const u = db.users.get(params[0] as number);
      return rows(u ? [{ name: u.name, created_at: u.created_at, must_change: u.must_change, tg: u.tg, settings: u.settings }] : []);
    }
    if (/quick_code_hash IS NOT NULL/.test(sql)) {
      const u = db.users.get(params[0] as number);
      if (u?.quick === "missing") throw Object.assign(new Error("column does not exist"), { code: "42703" });
      return rows(u ? [{ set: u.quick }] : []);
    }
    if (/FROM eod_days/.test(sql)) return rows(db.closed.map((d) => ({ d })));
    if (/FROM daily_reviews/.test(sql)) return rows(db.reviewed.map((d) => ({ d })));
    if (/FROM trades/.test(sql)) return rows(db.traded.map((d) => ({ d })));
    if (/FROM usage_events/.test(sql)) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    if (/FROM trader_plans/.test(sql)) return rows(db.plan ? [{ one: 1 }] : []);
    if (/SELECT role, name, settings FROM users WHERE id = \$1/.test(sql)) {
      const u = db.users.get(params[0] as number);
      return rows(u ? [{ role: u.role, name: u.name, settings: u.settings }] : []);
    }
    if (/UPDATE users SET settings/.test(sql)) {
      db.updates.push(params);
      const u = db.users.get(params[1] as number);
      if (u) u.settings = { ...u.settings, onboarding: JSON.parse(String(params[0])) };
      return rows(u ? [{ settings: u.settings }] : []);
    }
    return rows([]);
  });
  return { db: { insert: () => ({ values: async () => undefined }) }, pool: { query, connect: vi.fn(async () => ({ query, release: () => undefined })) } };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../onboarding");
const { errorMiddleware } = await import("../../lib/http");
const { __loadSettingsCache } = await import("../../lib/settings/registry");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    (req as unknown as { permActor: unknown }).permActor = { id: who.id, name: who.name, role: who.role, guest: !!who.guest, wards: [] };
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
beforeEach(() => {
  who = TRADER;
  __loadSettingsCache({});
  db.users.clear();
  db.users.set(130, { name: TRADER.name, role: "trader", created_at: daysAgo(2), must_change: false, tg: false, settings: {}, quick: "missing" });
  db.users.set(123, { name: CURATOR.name, role: "curator", created_at: daysAgo(400), must_change: false, tg: true, settings: {}, quick: true });
  db.users.set(121, { name: ADMIN.name, role: "admin", created_at: daysAgo(400), must_change: false, tg: true, settings: { onboarding: { v: 1, tour: "done", seen: ["trade"] } }, quick: false });
  db.closed = []; db.reviewed = []; db.traded = []; db.used = []; db.plan = false; db.updates = [];
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

describe("the «new user» rule", () => {
  const base0 = { guest: false, closedDays: 0, activeDays: 0, accountDays: 0 };
  it("new = no closed day, fewer than N active days, a young account", () => {
    expect(onboardingStage(base0)).toBe("new");
    expect(onboardingStage({ ...base0, activeDays: NEW_MAX_ACTIVE_DAYS - 1, accountDays: NEW_MAX_ACCOUNT_DAYS - 1 })).toBe("new");
  });
  it("one closed day, N active days or an old account → no tour", () => {
    expect(onboardingStage({ ...base0, closedDays: 1 })).toBe("settling");
    expect(onboardingStage({ ...base0, activeDays: NEW_MAX_ACTIVE_DAYS })).toBe("settling");
    expect(onboardingStage({ ...base0, accountDays: NEW_MAX_ACCOUNT_DAYS })).toBe("settling");
  });
  it("heavy users are settled: page hints never pop up for them", () => {
    expect(onboardingStage({ ...base0, closedDays: SETTLING_MAX_CLOSED, activeDays: 3, accountDays: 300 })).toBe("settled");
    expect(onboardingStage({ ...base0, closedDays: 0, activeDays: SETTLING_MAX_ACTIVE_DAYS, accountDays: 300 })).toBe("settled");
  });
  it("a guest never gets onboarding", () => {
    expect(onboardingStage({ ...base0, guest: true })).toBe("settled");
  });
});

describe("stored block", () => {
  it("accepts the web's shape, refuses junk", () => {
    expect(OnboardingStateSchema.safeParse({ v: 1, tour: "done", tourAt: "2026-10-24T10:00:00Z", checklist: "dismissed", hints: ["analytics", "whatIf"], seen: ["trade"] }).success).toBe(true);
    expect(OnboardingStateSchema.safeParse({ v: 2 }).success).toBe(false);
    expect(OnboardingStateSchema.safeParse({ v: 1, tour: "maybe" }).success).toBe(false);
    expect(OnboardingStateSchema.safeParse({ v: 1, hints: ["<script>"] }).success).toBe(false);
    expect(OnboardingStateSchema.safeParse({ v: 1, hints: Array.from({ length: 33 }, (_, i) => `h${i}`) }).success).toBe(false);
  });
  it("keeps the daily-loop tour's progress (stages seen, the step it was left on) — never strips it", () => {
    const loop = { v: 1, loops: ["junior", "trader"], loopStep: { r: "senior", i: 3 } };
    expect(OnboardingStateSchema.parse(loop)).toEqual(loop);
    expect(OnboardingStateSchema.safeParse({ v: 1, loopStep: { r: "senior", i: 40 } }).success).toBe(false);
    expect(OnboardingStateSchema.safeParse({ v: 1, loops: ["<x>"] }).success).toBe(false);
    expect(resetState(loop)).toEqual({ v: 1, again: true });
  });
  it("an admin reset brings the tour back and keeps what was already done", () => {
    expect(resetState({ v: 1, tour: "done", checklist: "dismissed", hints: ["risk"], seen: ["trade", "playbook"] })).toEqual({ v: 1, again: true, seen: ["trade", "playbook"] });
    expect(resetState(null)).toEqual({ v: 1, again: true });
  });
});

describe("GET /users/me/onboarding", () => {
  it("a two-day-old trader with nothing closed is new; signals come from real data", async () => {
    db.traded = ["2026-10-22", "2026-10-23"];
    db.plan = true;
    const r = await call("GET", "/api/users/me/onboarding");
    expect(r.status).toBe(200);
    expect(r.json.stage).toBe("new");
    expect(r.json.activeDays).toBe(2);
    // No screen-lock column yet → the secret step reads «no issued secret left»; usage_events missing → trades only.
    expect(r.json.signals).toEqual({ secret: true, quickCode: false, look: false, telegram: false, plan: true, closedDay: false });
  });

  it("a closed day (journal or evening card, counted once) ends «new»", async () => {
    db.closed = ["2026-10-22"];
    db.reviewed = ["2026-10-22"];
    const r = await call("GET", "/api/users/me/onboarding");
    expect(r.json.closedDays).toBe(1);
    expect(r.json.stage).toBe("settling");
    expect(r.json.signals.closedDay).toBe(true);
  });

  it("an old account is never new; the quick code drives the secret step once the column exists", async () => {
    who = CURATOR;
    const r = await call("GET", "/api/users/me/onboarding");
    expect(r.json.stage).toBe("settling");
    expect(r.json.signals.secret).toBe(true);
    expect(r.json.signals.quickCode).toBe(true);
    who = ADMIN;
    const a = await call("GET", "/api/users/me/onboarding");
    expect(a.json.signals.secret).toBe(false);
  });

  it("a guest gets settled and no signals", async () => {
    who = GUEST;
    const r = await call("GET", "/api/users/me/onboarding");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ stage: "settled", signals: null });
  });
});

describe("POST /users/:id/onboarding/reset", () => {
  it("admin resets anyone; the stored block becomes { again } with «seen» kept", async () => {
    who = ADMIN;
    const r = await call("POST", "/api/users/121/onboarding/reset");
    expect(r.status).toBe(200);
    expect(r.json.onboarding).toEqual({ v: 1, again: true, seen: ["trade"] });
  });

  it("users.manage only: a trader and (by default, the cap is sensitive) a curator are refused", async () => {
    expect((await call("POST", "/api/users/130/onboarding/reset")).status).toBe(403);
    who = CURATOR;
    expect((await call("POST", "/api/users/130/onboarding/reset")).status).toBe(403);
    expect(db.updates).toEqual([]);
  });

  it("bad id → 400, unknown user → 404", async () => {
    who = ADMIN;
    expect((await call("POST", "/api/users/abc/onboarding/reset")).status).toBe(400);
    expect((await call("POST", "/api/users/999/onboarding/reset")).status).toBe(404);
  });
});
