/**
 * GET /api/permissions/me → `tier` + `nav` (the web shell's simple menu for new traders): the tier comes from the same
 * resolution as the playbook locks (own academy stage → enrolment → scaling tier), is cached per name, and is null for
 * staff without touching the stage tables; `nav` carries the desk settings nav.simpleForTrainees / nav.simpleUntilTier.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
let who: Who = { id: 134, name: "Владислав Е.", role: "trader" };

const stages: Record<string, { own?: string; enr?: string; tier?: string; role?: string }> = {
  "Владислав Е.": { own: "trainee", enr: "junior", tier: "junior" },
  "Кирилл Б.": { tier: "junior" },
  "Пётр Н.": {},
};
const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  const p = stages[String(params[0])] ?? {};
  if (/FROM users WHERE name/.test(sql)) return { rows: [{ role: p.role ?? "trader" }] };
  if (/academy_trader_stage/.test(sql)) return { rows: p.own ? [{ stage: p.own }] : [] };
  if (/academy_enrollments/.test(sql)) return { rows: p.enr ? [{ stage: p.enr }] : [] };
  if (/trader_risk_limits/.test(sql)) return { rows: p.tier ? [{ tier: p.tier }] : [] };
  return { rows: [] };
});
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: (sql: string, params?: unknown[]) => query(sql, params) } }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    ensureRolePermissionsTable: vi.fn(async () => undefined),
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] })),
    getMatrixState: vi.fn(async () => ({ matrix: actual.buildEffectiveMatrix([]), overrides: [], updatedAt: null, updatedBy: null })),
  };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../permissions");
const { errorMiddleware } = await import("../../lib/http");
const { __loadSettingsCache } = await import("../../lib/settings/registry");
const { forgetTier } = await import("../../lib/playbookToday/tier");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
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
  who = { id: 134, name: "Владислав Е.", role: "trader" };
  __loadSettingsCache({});
  for (const n of Object.keys(stages)) forgetTier(n);
  query.mockClear();
});

const me = async () => (await fetch(`${base}/api/permissions/me`)).json() as Promise<{ tier: string | null; nav: { simpleForTrainees: boolean; simpleUntilTier: string }; capabilities: string[] }>;
const stageQueries = () => query.mock.calls.filter(([sql]) => /academy_trader_stage|academy_enrollments|trader_risk_limits/.test(String(sql))).length;

describe("GET /permissions/me tier", () => {
  it("own academy stage wins over enrolment and scaling tier (playbook-lock order); cached per name", async () => {
    const a = await me();
    expect(a.tier).toBe("trainee");
    expect(a.capabilities.length).toBeGreaterThan(0);
    expect(stageQueries()).toBe(3);
    await me();
    expect(stageQueries()).toBe(3); // second read served from the cache
  });

  it("falls back to the scaling tier, and to the default stage («Джун», lib/people/stage) when nothing names one", async () => {
    who = { id: 130, name: "Кирилл Б.", role: "trader" };
    expect((await me()).tier).toBe("junior");
    who = { id: 140, name: "Пётр Н.", role: "trader" };
    expect((await me()).tier).toBe("junior");
  });

  it("staff get null without reading the stage tables", async () => {
    who = { id: 123, name: "Ольга Н.", role: "curator" };
    expect((await me()).tier).toBeNull();
    who = { id: 121, name: "Дмитрий К.", role: "admin" };
    expect((await me()).tier).toBeNull();
    expect(stageQueries()).toBe(0);
  });

  it("nav carries the simple-menu settings (defaults, then a saved value)", async () => {
    expect((await me()).nav).toEqual({ simpleForTrainees: true, simpleUntilTier: "trainee" });
    __loadSettingsCache({ "nav.simpleForTrainees": false, "nav.simpleUntilTier": "junior" });
    expect((await me()).nav).toEqual({ simpleForTrainees: false, simpleUntilTier: "junior" });
  });
});
