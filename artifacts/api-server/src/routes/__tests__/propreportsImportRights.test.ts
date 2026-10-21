/**
 * Wave 0 / 0.2 — POST /propreports/import (owner decision: manual file import of one's OWN account stays open):
 *  - without propreports.sync a member previews and applies only their own mapped accounts, new trades only — an
 *    existing broker trade is never rewritten by a file (skip "broker_locked"); importing into another trader's account
 *    (a picked trader) or desk-wide needs propreports.sync (admin by default);
 *  - a Trade Performance report is previewed / saved only by the account's mapped trader (a typed-in own name no longer
 *    passes for someone else's account) or by staff; a member never replaces another trader's report.
 * Route × role: trader / curator (propreports.read.team, no sync) / admin. The parsers, planner and store are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const OWNER: Who = { id: 5, name: "Owner O.", role: "trader" };
const OTHER: Who = { id: 6, name: "Other T.", role: "trader" };
const CURATOR: Who = { id: 3, name: "Curator C.", role: "curator" };
const ADMIN: Who = { id: 1, name: "Admin A.", role: "admin" };
let who: Who = OWNER;
let storedReportOwner: string | null = null;

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string) => {
      if (/SELECT trader_name FROM propreports_performance_reports/.test(sql)) return { rows: storedReportOwner ? [{ trader_name: storedReportOwner }] : [], rowCount: 0 };
      if (/SELECT 1 FROM users WHERE name/.test(sql)) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const { sendError } = await import("../../lib/http/errors");
  const matrix = actual.buildEffectiveMatrix([]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  const can = async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target);
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    can: vi.fn(can),
    requireCap: vi.fn(async (req: unknown, res: express.Response, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => {
      if (await can(req, cap, target)) return true;
      sendError(res, actual.forbiddenError(cap));
      return false;
    }),
  };
});
vi.mock("../../lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
const pr = vi.hoisted(() => ({
  planSync: vi.fn(async () => ({
    items: [
      { externalId: "a|SPCX|1|long", action: "update", trader: "Owner O.", account: "31206881", tradeId: 236675, pendingId: null, changes: [{ field: "pnl", from: 25, to: 1000 }], candidates: [], trip: {} },
      { externalId: "a|NEW|2|long", action: "insert", trader: "Owner O.", account: "31206881", tradeId: null, pendingId: null, changes: [], candidates: [], trip: {} },
    ],
    counts: { insert: 1, update: 1, unchanged: 0, adopt: 0, conflict: 0, skip: 0 },
    unmappedAccounts: [], inactiveAccounts: [], dateFrom: null, dateTo: null, feeColumns: [], resolvedAccounts: [],
  })),
  applySync: vi.fn(async (_plan: unknown) => ({ runId: 7, inserted: 1, updated: 0, unchanged: 0, skipped: 1, conflicts: 0, errors: 0 })),
  savePerformanceReport: vi.fn(async () => ({ row: { id: 3, uploadedAt: "2026-10-20T00:00:00.000Z" }, replaced: false })),
}));
vi.mock("../../lib/propreports", async (orig) => ({
  ...(await orig<typeof import("../../lib/propreports")>()),
  parseTradesReportBuffer: vi.fn(() => [{ date: "2026-10-16" }]),
  reportTradesToRoundTrips: vi.fn(() => []),
  planSync: pr.planSync,
  applySync: pr.applySync,
  summarizeTrips: vi.fn(() => ({})),
  performanceSheetRows: vi.fn(() => [["Trade Performance"]]),
  isPerformanceReport: vi.fn(() => true),
  parsePerformanceRows: vi.fn(() => ({ totals: {}, summary: { net: 64.99 }, issues: [], bySide: [], byTime: [], byWeekday: [], perTradeAverages: {}, bySymbol: [] })),
  performanceFileMeta: vi.fn(() => ({ account: "31206881", periodFrom: "2026-10-01", periodTo: "2026-10-15" })),
  traderForAccount: vi.fn(async (account: string) => (account === "31206881" ? { trader: "Owner O.", how: "account" } : { trader: null, how: null })),
  savePerformanceReport: pr.savePerformanceReport,
}));
vi.mock("../../lib/propreports/import-target", () => ({ prepareTradesImport: vi.fn(async () => ({ account: "31206881", virtualMappings: [] })) }));
vi.mock("../../lib/propreports/tick/outbox", () => ({ enqueueOutbox: vi.fn(async () => undefined), kickOutbox: vi.fn(async () => undefined) }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../propreports");
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
  app.use(router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = OWNER;
  storedReportOwner = null;
  vi.clearAllMocks();
});

async function upload(as: Who, opts: { dryRun: boolean; kind: "trades" | "performance"; trader?: string; account?: string }): Promise<{ status: number; json: any }> {
  who = as;
  const fd = new FormData();
  fd.append("kind", opts.kind);
  if (opts.trader) fd.append("trader", opts.trader);
  if (opts.account) fd.append("account", opts.account);
  fd.append("file", new Blob([new Uint8Array([1, 2, 3])]), "31206881-2026-10-01-to-2026-10-15.xls");
  const r = await fetch(`${base}/propreports/import${opts.dryRun ? "?dryRun=1" : ""}`, { method: "POST", body: fd });
  return { status: r.status, json: await r.json().catch(() => null) };
}

type Plan = { items: { action: string; reason?: string }[]; counts: Record<string, number> };
const appliedPlan = () => (pr.applySync.mock.calls.at(-1) as unknown as [Plan])[0];
const planOpts = () => (pr.planSync.mock.calls.at(-1) as unknown as [unknown, { onlyTrader: string | null }])[1];

describe("Fills / Trades import", () => {
  it("owner applies their own account: new trades go in, existing broker trades are not rewritten", async () => {
    const r = await upload(OWNER, { dryRun: false, kind: "trades" });
    expect(r.status).toBe(200);
    expect(planOpts().onlyTrader).toBe(OWNER.name);
    const plan = appliedPlan();
    expect(plan.items.map((i) => [i.action, i.reason ?? null])).toEqual([["skip", "broker_locked"], ["insert", null]]);
    expect(plan.counts).toMatchObject({ update: 0, insert: 1, skip: 1 });
  });

  it("the preview shows the same plan (update → broker_locked)", async () => {
    const r = await upload(OWNER, { dryRun: true, kind: "trades" });
    expect(r.status).toBe(200);
    expect(r.json.counts).toMatchObject({ update: 0, skip: 1, insert: 1 });
    expect(pr.applySync).not.toHaveBeenCalled();
  });

  it("into another trader's account: trader 403, curator without propreports.sync 403, admin 200 (desk-wide, updates kept)", async () => {
    const t = await upload(OWNER, { dryRun: false, kind: "trades", trader: OTHER.name });
    expect([t.status, t.json.details]).toEqual([403, { capability: "propreports.sync" }]);
    expect((await upload(CURATOR, { dryRun: false, kind: "trades", trader: OWNER.name })).status).toBe(403);
    expect(pr.applySync).not.toHaveBeenCalled();
    expect((await upload(ADMIN, { dryRun: false, kind: "trades", trader: OWNER.name })).status).toBe(200);
    expect(planOpts().onlyTrader).toBeNull();
    expect(appliedPlan().items.map((i) => i.action)).toEqual(["update", "insert"]);
  });

  it("a curator's apply without a pick is limited to the curator's own accounts", async () => {
    expect((await upload(CURATOR, { dryRun: false, kind: "trades" })).status).toBe(200);
    expect(planOpts().onlyTrader).toBe(CURATOR.name);
    // the read.team preview may still look desk-wide
    expect((await upload(CURATOR, { dryRun: true, kind: "trades", trader: OWNER.name })).status).toBe(200);
    expect(planOpts().onlyTrader).toBeNull();
  });
});

describe("Trade Performance report", () => {
  it("another trader: refused even with their own name typed in (preview and save)", async () => {
    for (const dryRun of [true, false]) {
      const r = await upload(OTHER, { dryRun, kind: "performance", trader: OTHER.name });
      expect([r.status, r.json.code]).toEqual([403, "ACCOUNT_NOT_YOURS"]);
    }
    expect(pr.savePerformanceReport).not.toHaveBeenCalled();
  });

  it("the account's mapped trader previews and saves their own report", async () => {
    expect((await upload(OWNER, { dryRun: true, kind: "performance" })).status).toBe(200);
    const r = await upload(OWNER, { dryRun: false, kind: "performance" });
    expect(r.status).toBe(200);
    expect(pr.savePerformanceReport).toHaveBeenCalledWith(expect.objectContaining({ account: "31206881", trader: OWNER.name }));
  });

  it("an existing report of another trader is never replaced without propreports.sync", async () => {
    storedReportOwner = "Someone Else";
    const r = await upload(OWNER, { dryRun: false, kind: "performance" });
    expect([r.status, r.json.code]).toEqual([403, "ACCOUNT_NOT_YOURS"]);
    expect(pr.savePerformanceReport).not.toHaveBeenCalled();
  });

  it("staff (curator, admin) preview and save for the mapped trader", async () => {
    expect((await upload(CURATOR, { dryRun: true, kind: "performance" })).status).toBe(200);
    expect((await upload(CURATOR, { dryRun: false, kind: "performance" })).status).toBe(200);
    storedReportOwner = "Someone Else";
    expect((await upload(ADMIN, { dryRun: false, kind: "performance" })).status).toBe(200);
    expect(pr.savePerformanceReport).toHaveBeenCalledTimes(2);
    expect(pr.savePerformanceReport).toHaveBeenLastCalledWith(expect.objectContaining({ trader: OWNER.name }));
  });
});
