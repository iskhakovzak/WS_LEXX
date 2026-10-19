/**
 * GET /reconcile (DEV-10): the whole-desk result is cached per scope / range; the trade query reads only the snapshot
 * keys the engine uses (not the full broker snapshot).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const calls: { sql: string; params: unknown[] }[] = [];

vi.mock("@workspace/db", () => ({
  db: {},
  pool: { query: vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: /to_regclass/.test(sql) ? [{ ok: true }] : [], rowCount: 0 }; }) },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../lib/auth")>()),
  scopeTrader: vi.fn(async (_req: unknown, requested?: string | null) => requested || null),
}));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../reconcile");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: 2, name: "Дмитрий К.", role: "admin" }; next(); });
  app.use(router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { calls.length = 0; });

const tradeQueries = () => calls.filter((c) => /FROM trades t\s/.test(c.sql) && !/trade_executions/.test(c.sql));

describe("GET /reconcile cache", () => {
  it("computes once per scope / range and serves the repeat from the cache", async () => {
    expect((await fetch(`${base}/reconcile?from=2026-10-01&to=2026-10-16`)).status).toBe(200);
    expect(tradeQueries()).toHaveLength(1);
    expect((await fetch(`${base}/reconcile?from=2026-10-01&to=2026-10-16`)).status).toBe(200);
    expect(tradeQueries()).toHaveLength(1);
    expect((await fetch(`${base}/reconcile?from=2026-10-02&to=2026-10-16`)).status).toBe(200);
    expect(tradeQueries()).toHaveLength(2);
  });

  it("selects only the snapshot keys the engine reads", async () => {
    await fetch(`${base}/reconcile?trader=X`);
    const sql = tradeQueries()[0]!.sql;
    expect(sql).toContain("jsonb_build_object('source', t.context_snapshot -> 'source'");
    expect(sql).not.toMatch(/THEN t\.context_snapshot END/);
  });
});
