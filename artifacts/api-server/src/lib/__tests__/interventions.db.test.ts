/**
 * R9a intervention log against a real Postgres: a scratch database built from every repository migration (0246
 * included), the real route handlers mounted on express with a mocked actor. Synthetic people only.
 *
 *   - each writer creates exactly one row per action (risk limits, office rules on / off / delete, curator focus, 1:1,
 *     curator quest, tier assignment, concern note); a self-action and a desk-wide rule are not interventions;
 *   - the trigger is derived (breach / after_bad_period / scheduled) when the writer does not know it;
 *   - the one-time backfill (the INSERT … SELECT part of 0246) rebuilds the rows from the source tables and is
 *     idempotent: a second run, or a run over rows the writers already logged, adds nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../db/runner";

const holder: { pool: pg.Pool | null } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  const pool = new Proxy({}, { get: (_t, k) => { const p = holder.pool as unknown as Record<string | symbol, unknown>; const v = p[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v; } });
  return { ...real, pool };
});
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) } }));

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const ADMIN: Who = { id: 1, name: "Admin Synthetic", role: "admin" };
const TRADER = "Trader Synthetic";
const OTHER = "Trader Other";
let who: Who = ADMIN;
vi.mock("../permissions", async (orig) => {
  const actual = await orig<typeof import("../permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});

const MIGRATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations/0246_curator_interventions.sql");
/** The backfill part of 0246: every statement after the function definition. */
const BACKFILL = readFileSync(MIGRATION, "utf8").split("-- ─── one-time backfill")[1]!.replace(/^[^\n]*\n/, "");

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("curator_interventions (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let server: http.Server;
  let base = "";

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "vitest-only-secret";
    db = await createScratchDb("interventions");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
    await db.pool.query(
      `INSERT INTO users (name, role, active, pin) VALUES ($1, 'admin', true, '0000'), ($2, 'trader', true, '0000'), ($3, 'trader', true, '0000')`,
      [ADMIN.name, TRADER, OTHER],
    ).catch(async () => {
      await db.pool.query(`INSERT INTO users (name, role, active) VALUES ($1, 'admin', true), ($2, 'trader', true), ($3, 'trader', true)`, [ADMIN.name, TRADER, OTHER]);
    });
    const { rows } = await db.pool.query(`SELECT id FROM users WHERE name = $1`, [ADMIN.name]);
    ADMIN.id = Number(rows[0].id);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
      (req as unknown as { log: unknown }).log = { warn: () => undefined, info: () => undefined, error: () => undefined };
      next();
    });
    for (const m of ["../../routes/risk", "../../routes/rules", "../../routes/daily", "../../routes/curator", "../../routes/scaling", "../../routes/academy-cohorts", "../../routes/quests"]) {
      app.use("/api", (await import(m)).default);
    }
    app.use((await import("../http")).errorMiddleware);
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180_000);
  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    await db?.drop();
  });

  async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  const rows = async (kind?: string) =>
    (await db.pool.query(`SELECT * FROM curator_interventions ${kind ? "WHERE kind = $1" : ""} ORDER BY id`, kind ? [kind] : [])).rows;
  const enc = encodeURIComponent;

  it("logIntervention: one row per source row, self-actions skipped, trigger derived from breaches and the last 28 days", async () => {
    const { logIntervention } = await import("../interventions/log");
    const base1 = { trader: OTHER, kind: "pause" as const, author: ADMIN.name, sourceTable: "test", startedOn: "2026-10-20" };
    expect(await logIntervention({ ...base1, sourceId: "a" })).toEqual(expect.any(Number));
    expect(await logIntervention({ ...base1, sourceId: "a" })).toBeNull(); // same source row: nothing new
    expect(await logIntervention({ ...base1, author: OTHER, sourceId: "self" })).toBeNull(); // on himself
    expect((await rows("pause")).map((r) => r.trigger)).toEqual(["scheduled"]);

    await db.pool.query(`INSERT INTO trades (ticker, date, result, pnl, fees, trader) VALUES ('SYN', '2026-10-10', 'loss', -120, 2, $1)`, [OTHER]);
    await logIntervention({ ...base1, sourceId: "b" });
    await db.pool.query(`INSERT INTO risk_alert_log (trader, date, kind, level, message) VALUES ($1, '2026-10-19', 'daily', 'breach', 'synthetic')`, [OTHER]);
    await logIntervention({ ...base1, sourceId: "c" });
    await logIntervention({ ...base1, sourceId: "d", trigger: "random" });
    expect((await rows("pause")).map((r) => r.trigger)).toEqual(["scheduled", "after_bad_period", "breach", "random"]);
    await db.pool.query(`DELETE FROM curator_interventions WHERE source_table = 'test'`);
  });

  it("each writer creates exactly one row per action", async () => {
    who = ADMIN;
    // risk limits (manual): one row per save
    expect((await call("PUT", `/api/risk/limits/${enc(TRADER)}`, { dailyLossLimit: 300, reason: "synthetic" })).status).toBe(200);
    expect(await rows("limit_change")).toHaveLength(1);
    expect((await call("PUT", `/api/risk/limits/${enc(TRADER)}`, { dailyLossLimit: 250 })).status).toBe(200);
    expect(await rows("limit_change")).toHaveLength(2);

    // office rule: create → rule_added; switch off → rule_removed; PATCH without a change of `enabled` → nothing
    const created = await call("POST", "/api/rules", { trader: TRADER, name: "Max trades", kind: "max_trades_per_day", threshold: { n: 5 } });
    expect(created.status).toBe(201);
    expect(await rows("rule_added")).toHaveLength(1);
    expect((await call("PATCH", `/api/rules/${created.json.id}`, { note: "x" })).status).toBe(200);
    expect((await call("PATCH", `/api/rules/${created.json.id}`, { enabled: false })).status).toBe(200);
    expect(await rows("rule_removed")).toHaveLength(1);
    expect((await call("DELETE", `/api/rules/${created.json.id}`)).status).toBe(200);
    expect(await rows("rule_removed")).toHaveLength(2);
    // a desk-wide rule is not an intervention on a trader
    expect((await call("POST", "/api/rules", { trader: "*", name: "Desk", kind: "max_trades_per_day", threshold: { n: 9 } })).status).toBe(201);
    expect(await rows("rule_added")).toHaveLength(1);

    // curator focus: a mistake → focus_set; reset to auto → nothing
    const focus = `/api/daily/focus/${enc(TRADER)}/2026-10-21`;
    expect((await call("PUT", focus, { mistake: "behavior:revenge" })).status).toBe(200);
    expect((await call("PUT", focus, { mistake: null })).status).toBe(200);
    expect(await rows("focus_set")).toHaveLength(1);

    // 1:1
    expect((await call("POST", "/api/academy/one-on-ones", { student: TRADER, metAt: "2026-10-21T14:00:00Z", agenda: "plan" })).status).toBe(201);
    expect(await rows("one_on_one")).toHaveLength(1);

    // curator quest
    const quest = await call("POST", "/api/quests/assign", { trader: TRADER, template: "curator_task", target: 1, endsOn: "2026-10-30", note: "x" });
    if (quest.status === 200 || quest.status === 201) expect(await rows("quest")).toHaveLength(1);
    else {
      const { assignQuest } = await import("../quests/service");
      await assignQuest({ trader: TRADER, template: "curator_task", target: 1, endsOn: "2099-12-31", note: "x" } as never, ADMIN.name);
      expect(await rows("quest")).toHaveLength(1);
    }

    // tier assignment
    expect((await call("POST", "/api/scaling/assign", { trader: TRADER, tierKey: "trader" })).status).toBe(200);
    expect(await rows("scaling_decision")).toHaveLength(1);

    // concern note: one row; a plain note none; PATCH a plain note to concern → one more
    expect((await call("POST", "/api/curator/notes", { trader: TRADER, body: "worried", kind: "concern" })).status).toBe(201);
    const plain = await call("POST", "/api/curator/notes", { trader: TRADER, body: "fyi" });
    expect(await rows("concern_note")).toHaveLength(1);
    expect((await call("PATCH", `/api/curator/notes/${plain.json.id}`, { kind: "concern" })).status).toBe(200);
    expect((await call("PATCH", `/api/curator/notes/${plain.json.id}`, { pinned: true })).status).toBe(200);
    expect(await rows("concern_note")).toHaveLength(2);

    const all = await rows();
    expect(all.every((r) => r.trader === TRADER && r.author === ADMIN.name)).toBe(true);
    expect(new Set(all.map((r) => `${r.source_table}:${r.source_id}`)).size).toBe(all.length);
  });

  it("backfill rebuilds the rows from the source tables and is idempotent", async () => {
    const before = await rows();
    // over rows the writers already logged: nothing new
    await db.pool.query(BACKFILL);
    expect(await rows()).toHaveLength(before.length);

    // from scratch: the source tables give the actions back, except what they do not keep — rule switches / deletes
    // (no history) and a curator focus that was later reset to auto (daily_focus keeps the last focus of a day)
    await db.pool.query(`DELETE FROM curator_interventions`);
    await db.pool.query(BACKFILL);
    const rebuilt = await rows();
    const kinds = (rs: any[]) => rs.map((r) => r.kind).sort();
    expect(kinds(rebuilt)).toEqual(kinds(before.filter((r) => r.kind !== "rule_removed" && r.kind !== "focus_set")));
    expect(rebuilt.every((r) => r.params.backfill === true)).toBe(true);

    await db.pool.query(BACKFILL);
    expect(await rows()).toHaveLength(rebuilt.length);
  });
});
