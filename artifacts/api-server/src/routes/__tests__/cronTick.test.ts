/**
 * POST|GET /cron/tick: Bearer CRON_SECRET (constant-time), 401 on a wrong / missing secret, 503 when unset; a valid call
 * runs one tick and answers its summary. The runner is mocked (no DB, no PropReports).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
const runTick = vi.fn(async () => ({ ok: true, startedAt: "2026-10-19T15:00:00.000Z", ms: 5, steps: [], outbox: { processed: 0, failed: 0, remaining: 0 } }));
vi.mock("../../lib/propreports/tick/runner", () => ({ runTick }));

let secret = "s3cret-value";
vi.mock("../../config", async (orig) => {
  const real = await orig<typeof import("../../config")>();
  return { ...real, config: new Proxy(real.config, { get: (t, k) => (k === "propreportsEnv" ? (name: string) => (name === "CRON_SECRET" ? secret : "") : Reflect.get(t, k)) }) };
});

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router, cronAuthorized } = await import("../cron");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(router);
  app.use(errorMiddleware);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("cronAuthorized", () => {
  it("accepts only the exact bearer secret", () => {
    expect(cronAuthorized({ headers: { authorization: "Bearer abc" } }, "abc")).toBe(true);
    expect(cronAuthorized({ headers: { authorization: "bearer abc" } }, "abc")).toBe(true);
    expect(cronAuthorized({ headers: { authorization: "Bearer abcd" } }, "abc")).toBe(false);
    expect(cronAuthorized({ headers: { authorization: "abc" } }, "abc")).toBe(false);
    expect(cronAuthorized({ headers: {} }, "abc")).toBe(false);
    expect(cronAuthorized({ headers: { authorization: "Bearer " } }, "")).toBe(false);
  });
});

describe("/cron/tick", () => {
  it("401 without / with a wrong secret, tick not run", async () => {
    secret = "s3cret-value";
    expect((await fetch(`${base}/cron/tick`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${base}/cron/tick`, { method: "POST", headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });
  it("POST (pg_cron) and GET (Vercel Cron) with the secret run the tick", async () => {
    secret = "s3cret-value";
    const r = await fetch(`${base}/cron/tick`, { method: "POST", headers: { Authorization: "Bearer s3cret-value" } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ok: boolean }).ok).toBe(true);
    const g = await fetch(`${base}/cron/tick`, { headers: { Authorization: "Bearer s3cret-value" } });
    expect(g.status).toBe(200);
    expect(runTick).toHaveBeenCalledTimes(2);
    expect(runTick).toHaveBeenCalledWith({ trigger: "cron" });
  });
  it("503 CRON_NOT_CONFIGURED when CRON_SECRET is unset", async () => {
    secret = "";
    const r = await fetch(`${base}/cron/tick`, { method: "POST", headers: { Authorization: "Bearer " } });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { code: string }).code).toBe("CRON_NOT_CONFIGURED");
  });
});
