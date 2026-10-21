/**
 * Wave 0 / 0.11 — one tier-lock check (lib/playbookLock) on every /playbook/:id/* route and in
 * /playbook-tools/for-trade: a setup above the trader's tier answers 403 PLAYBOOK_SETUP_LOCKED for reading its examples,
 * stats, edge, marks, checklist runs… and for adding an example / a checklist run / a mark; for-trade no longer offers
 * it (its checklist is part of the closed card). Staff are never locked; /children keeps its per-row redaction.
 * The lock level itself (PATCH /playbook/:id { minTier }) is admin-only (settings.manage).
 * Route × role: trader (trainee) / curator / admin. DB is faked; viewerLocks is mocked (203 locked for the trader).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const TRADER: Who = { id: 5, name: "Trader T.", role: "trader" };
const CURATOR: Who = { id: 3, name: "Curator C.", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin A.", role: "admin" };
let who: Who = TRADER;

const LOCKED = { id: 203, name: "1.1 Gap & Go", trader: null, space: "office", visibility: "private", folder: "1", minTier: "junior", deletedAt: null };
const OPEN = { id: 7, name: "0.1 Morning", trader: null, space: "office", visibility: "private", folder: "0", minTier: null, deletedAt: null };
const updates: { sql: string; params: unknown[] }[] = [];
const byId = (id: unknown) => (Number(id) === 203 ? LOCKED : Number(id) === 7 ? OPEN : null);

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/to_regclass/.test(sql)) return { rows: [{ t: null, ok: false }], rowCount: 1 };
      if (/FROM playbook WHERE id = \$1/.test(sql)) { const r = byId(params[0]); return { rows: r ? [r] : [], rowCount: r ? 1 : 0 }; }
      if (/FROM playbook p WHERE p\.deleted_at IS NULL/.test(sql)) {
        return { rows: [LOCKED, OPEN].map((r) => ({ ...r, checklistItems: [{ id: "a", text: "A-grade only" }], checklist: "- A-grade only" })), rowCount: 2 };
      }
      if (/^\s*UPDATE playbook SET/.test(sql)) { updates.push({ sql, params }); return { rows: [{ ...OPEN, minTier: "junior" }], rowCount: 1 }; }
      if (/^\s*INSERT INTO playbook_checklist_runs/.test(sql)) return { rows: [{ id: 1, score: 1, checked_items: [], trade_id: null, playbook_id: params[0], created_at: null }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const matrix = actual.buildEffectiveMatrix([]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix),
    readScope: vi.fn(async () => (who.role === "trader" ? [who.name] : null)),
    can: vi.fn(can),
    requireCap: vi.fn(async (req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => {
      if (await can(req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});
vi.mock("../../lib/playbookAccess", async (orig) => {
  const actual = await orig<typeof import("../../lib/playbookAccess")>();
  return {
    ...actual,
    ensurePlaybookSpaces: vi.fn(async () => undefined),
    loadViewer: vi.fn(async () => ({
      name: who.name, guest: false, teamScope: who.role === "trader" ? [] : null, editOwn: true,
      editAny: who.role !== "trader", review: who.role !== "trader", stage: who.role === "trader" ? "trainee" : null, cohorts: [],
    })),
    loadMoneyViewer: vi.fn(async () => ({ name: who.name, staff: who.role !== "trader" })),
  };
});
vi.mock("../../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../lib/auth")>()),
  canAccessTrade: vi.fn(async () => true),
}));
vi.mock("../../lib/playbookToday/service", async (orig) => ({
  ...(await orig<typeof import("../../lib/playbookToday/service")>()),
  tradeTagged: vi.fn(async () => undefined),
  viewerLocks: vi.fn(async (name: string) => ({
    known: new Map(name === "Trader T." ? [[203, { locked: true, unlock: { key: "unlock.tier", params: { tier: "junior" } } }], [7, { locked: false, unlock: null }]] : []),
    lockOther: () => ({ locked: false, unlock: null }),
  })),
}));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: playbookRouter } = await import("../playbook");
const { default: spacesRouter } = await import("../playbook-spaces");
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
  // Same order as routes/index.ts: playbook (with marks) before playbook-spaces.
  app.use("/api", playbookRouter);
  app.use("/api", spacesRouter);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { who = TRADER; });

async function call(as: Who, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  who = as;
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

describe("a setup above the trader's tier", () => {
  const routes: [string, string, unknown?][] = [
    ["GET", "/api/playbook/203/examples"],
    ["POST", "/api/playbook/203/examples", { tradeId: 236675 }],
    ["GET", "/api/playbook/203/stats"],
    ["GET", "/api/playbook/203/edge"],
    ["GET", "/api/playbook/203/marks"],
    ["PUT", "/api/playbook/203/marks/a", { scope: "personal", done: true }],
    ["POST", "/api/playbook/203/checklist-run", { checkedItems: ["a"], score: 1, total: 1 }],
    ["GET", "/api/playbook/203/checklist-runs"],
    ["GET", "/api/playbook/203/revisions"],
    ["GET", "/api/playbook/203/activity"],
    ["GET", "/api/playbook/203/trades"],
    ["GET", "/api/playbook/203/ideas"],
    ["GET", "/api/playbook/203/reviews"],
  ];
  it.each(routes)("trader: %s %s → 403 PLAYBOOK_SETUP_LOCKED", async (method, path, body) => {
    const r = await call(TRADER, method, path, body);
    expect([r.status, r.json?.code]).toEqual([403, "PLAYBOOK_SETUP_LOCKED"]);
    expect(r.json.error).toContain("1.1 Gap & Go");
  });

  it("curator and admin are never locked (examples list 200)", async () => {
    expect((await call(CURATOR, "GET", "/api/playbook/203/examples")).status).toBe(200);
    expect((await call(ADMIN, "GET", "/api/playbook/203/examples")).status).toBe(200);
  });

  it("an open setup stays readable for the trader; /children keeps its per-row redaction", async () => {
    expect((await call(TRADER, "GET", "/api/playbook/7/examples")).status).toBe(200);
    expect((await call(TRADER, "GET", "/api/playbook/203/children")).status).toBe(200);
  });
});

describe("GET /playbook-tools/for-trade/:tradeId", () => {
  it("trader: locked setups (and their checklists) are not offered; curator / admin see all", async () => {
    const t = await call(TRADER, "GET", "/api/playbook-tools/for-trade/236675");
    expect(t.status).toBe(200);
    expect(t.json.setups.map((s: { id: number }) => s.id)).toEqual([7]);
    for (const staff of [CURATOR, ADMIN]) {
      const r = await call(staff, "GET", "/api/playbook-tools/for-trade/236675");
      expect(r.json.setups.map((s: { id: number }) => s.id)).toEqual([203, 7]);
    }
  });
});

describe("PATCH /playbook/:id { minTier } — the lock level of an existing setup", () => {
  it("trader 403, curator 403 (settings.manage is admin-only), admin 200 and the column is written", async () => {
    updates.length = 0;
    expect((await call(TRADER, "PATCH", "/api/playbook/7", { minTier: "junior" })).status).toBe(403);
    const c = await call(CURATOR, "PATCH", "/api/playbook/7", { minTier: "junior" });
    expect([c.status, c.json.details]).toEqual([403, { capability: "settings.manage" }]);
    expect(updates).toHaveLength(0);
    expect((await call(ADMIN, "PATCH", "/api/playbook/7", { minTier: "junior" })).status).toBe(200);
    expect(updates[0]?.sql).toMatch(/min_tier = \$/);
    expect(updates[0]?.params).toContain("junior");
  });
  it("a curator still edits the rest of an office setup", async () => {
    expect((await call(CURATOR, "PATCH", "/api/playbook/7", { name: "0.1 Morning routine" })).status).toBe(200);
  });
});
