/**
 * routes/leads.ts: POST /leads (public landing lead form): validation, storage, owner notice, honeypot, rate limit.
 * The DB and the Telegram notice are mocked; nothing leaves the process.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const inserts = vi.hoisted(() => [] as unknown[][]);
vi.mock("@workspace/db", () => {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO leads/.test(sql)) {
      inserts.push(params);
      return { rows: [{ id: String(inserts.length) }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { db: {}, pool: { query } };
});
const notify = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../lib/leads/notify", () => ({ notifyLeadOwner: notify }));

const { createLeadsRouter, leadsLimiter } = await import("../leads");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", createLeadsRouter((_req, _res, next) => next()));
  app.use("/limited", createLeadsRouter(leadsLimiter(2)));
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { inserts.length = 0; notify.mockClear(); });

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const VALID = {
  segment: "prop_desk", name: "Alex Doe", company: "Example Desk", tradersCount: "11-25", platform: "PropReports",
  email: "  Alex@Example.com ", locale: "es", message: "", page: "/es/",
};

describe("POST /leads", () => {
  it("stores a valid lead and notifies the owner", async () => {
    const r = await post("/api/leads", VALID);
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.slice(0, 8)).toEqual(["prop_desk", "Alex Doe", "Example Desk", "11-25", "PropReports", "alex@example.com", "es", null]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(1, expect.objectContaining({ segment: "prop_desk", email: "alex@example.com", locale: "es" }));
  });

  it("rejects a bad email, an unknown segment, a missing name and unknown keys", async () => {
    for (const body of [
      { ...VALID, email: "not-an-email" },
      { ...VALID, segment: "retail" },
      { ...VALID, name: "  " },
      { ...VALID, tradersCount: "7" },
      { ...VALID, admin: true },
    ]) {
      const r = await post("/api/leads", body);
      expect(r.status).toBe(400);
      expect(r.json.code).toBe("VALIDATION");
    }
    expect(inserts).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("drops a filled honeypot silently", async () => {
    const r = await post("/api/leads", { ...VALID, website: "http://spam.example" });
    expect(r.status).toBe(201);
    expect(inserts).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("rate-limits per IP", async () => {
    expect((await post("/limited/leads", VALID)).status).toBe(201);
    expect((await post("/limited/leads", VALID)).status).toBe(201);
    const third = await post("/limited/leads", VALID);
    expect(third.status).toBe(429);
    expect(third.json.code).toBe("RATE_LIMITED");
    expect(inserts).toHaveLength(2);
  });
});
