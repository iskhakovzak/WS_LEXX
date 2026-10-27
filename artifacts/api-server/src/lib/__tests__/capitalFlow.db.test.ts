/**
 * Capital allocation against a real Postgres (scratch database from every migration, 0270 included), the real
 * /scaling and /capital handlers with a mocked actor. Synthetic people only.
 *
 *   «Пересчитать» → limits proposals in the scaling queue → approve one (limits + history + limit event + audit in one
 *   transaction) / reject one → a re-run the same week adds nothing → revert restores the limits, twice is a 409 →
 *   a tier proposal withdraws a pending capital one (the ladder goes first).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../db/runner";
import { addDays, isWeekend, nyDate } from "../tradingDate";

const holder: { pool: pg.Pool | null } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  const pool = new Proxy({}, { get: (_t, k) => { const p = holder.pool as unknown as Record<string | symbol, unknown>; const v = p[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v; } });
  return { ...real, pool };
});
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) } }));

const ADMIN = { id: 1, name: "Admin Synthetic", role: "admin" as const };
const GOOD = "Trader Edge";
const WEAK = "Trader Leak";
const THIRD = "Trader Third";
vi.mock("../permissions", async (orig) => {
  const actual = await orig<typeof import("../permissions")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => ({ id: ADMIN.id, name: ADMIN.name, role: ADMIN.role, guest: false, wards: [] })),
    getEffectiveMatrix: vi.fn(async () => actual.buildEffectiveMatrix([])),
  };
});

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** The last `n` weekdays before today (oldest first). */
function weekdays(n: number): string[] {
  const out: string[] = [];
  for (let d = addDays(nyDate(), -1); out.length < n; d = addDays(d, -1)) if (!isWeekend(d)) out.unshift(d);
  return out;
}

describe.skipIf(!available)("capital allocation flow (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let server: http.Server;
  let base = "";

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "vitest-only-secret";
    db = await createScratchDb("capital");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
    await db.pool.query(`INSERT INTO users (name, role, active) VALUES ($1, 'admin', true), ($2, 'trader', true), ($3, 'trader', true), ($4, 'trader', true)`, [ADMIN.name, GOOD, WEAK, THIRD]);
    await db.pool.query(
      `INSERT INTO trader_risk_limits (trader, tier, account_size, daily_loss_limit, weekly_loss_limit, max_drawdown, buying_power)
       VALUES ($1, 'trader', 50000, 800, 2400, 6000, 400000), ($2, 'trader', 50000, 600, 1800, 6000, 300000), ($3, 'trader', 50000, 600, 1800, 6000, NULL)`,
      [GOOD, WEAK, THIRD],
    );
    const days = weekdays(50);
    const values: unknown[] = [];
    const tuples: string[] = [];
    days.forEach((d, i) => {
      const swing = i % 2 === 0 ? 1 : -1;
      for (const [who, mean, spread] of [[GOOD, 40, 60], [WEAK, -10, 25]] as const) {
        for (let k = 0; k < 4; k++) {
          const pnl = mean + swing * spread * (k % 2 === 0 ? 1 : 0.5);
          values.push("SYN", d, pnl >= 0 ? "win" : "loss", pnl, who, pnl / 100);
          const o = values.length - 6;
          tuples.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, 0, $${o + 5}, $${o + 6})`);
        }
      }
    });
    await db.pool.query(`INSERT INTO trades (ticker, date, result, pnl, fees, trader, r_multiple) VALUES ${tuples.join(", ")}`, values);
    await db.pool.query(`INSERT INTO eod_days (trader, date, closed_at) SELECT $1, d, now() FROM unnest($2::text[]) AS d`, [GOOD, days]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { authUser: unknown }).authUser = { id: ADMIN.id, name: ADMIN.name, role: ADMIN.role };
      (req as unknown as { log: unknown }).log = { warn: () => undefined, info: () => undefined, error: () => undefined };
      next();
    });
    for (const m of ["../../routes/scaling", "../../routes/capital"]) app.use("/api", (await import(m)).default);
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
  const limitsOf = async (t: string) => (await db.pool.query(`SELECT daily_loss_limit::float8 AS d, buying_power::float8 AS bp FROM trader_risk_limits WHERE trader = $1`, [t])).rows[0];

  it("recompute → queue → approve / reject → idempotent re-run → revert", async () => {
    const plan = await call("GET", "/api/capital/plan");
    expect(plan.status).toBe(200);
    const byName = new Map(plan.json.rows.map((r: any) => [r.trader, r]));
    expect((byName.get(GOOD) as any).direction).toBe("raise");
    expect((byName.get(WEAK) as any).direction).toBe("cut");
    expect((byName.get(THIRD) as any).direction).toBe("keep"); // no trades
    expect((byName.get(GOOD) as any).why[0]).toMatch(/\$800 → \$900/); // capped at 150 % of the tier template
    expect(plan.json.desk.riskBefore).toBe(2000);

    const run = await call("POST", "/api/capital/recompute", {});
    expect(run.status).toBe(200);
    expect(run.json).toMatchObject({ created: 2, updated: 0 });

    const queue = await call("GET", "/api/scaling/proposals?status=pending");
    const caps = queue.json.proposals.filter((p: any) => p.kind === "limits");
    expect(caps).toHaveLength(2);
    const good = caps.find((p: any) => p.trader === GOOD);
    const weak = caps.find((p: any) => p.trader === WEAK);
    expect(good.limits.after.dailyLossLimit).toBe(900);
    expect(good.reasons.length).toBeGreaterThan(2);

    expect((await call("POST", `/api/scaling/proposals/${good.id}/approve`, { comment: "ok" })).status).toBe(200);
    expect(await limitsOf(GOOD)).toEqual({ d: 900, bp: 450000 });
    expect((await call("POST", `/api/scaling/proposals/${weak.id}/reject`, {})).status).toBe(200);
    expect((await limitsOf(WEAK)).d).toBe(600);
    expect((await call("POST", `/api/scaling/proposals/${good.id}/approve`, {})).status).toBe(409);
    const audit = (await db.pool.query(`SELECT action FROM audit_log WHERE action LIKE 'capital.%' ORDER BY id`)).rows.map((r) => r.action);
    expect(audit).toEqual(["capital.recompute", "capital.apply", "capital.reject"]);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM trader_risk_limit_events WHERE trader = $1`, [GOOD])).rows[0].n).toBe(1);

    const again = await call("POST", "/api/capital/recompute", {});
    expect(again.json).toMatchObject({ created: 0, decidedThisWeek: 1 }); // the rejected cut is not re-proposed; the raised one is at its cap now

    const after = await call("GET", "/api/capital/plan");
    const change = after.json.history.find((h: any) => h.trader === GOOD);
    expect(change).toMatchObject({ action: "raise", reverted: false });
    expect((await call("POST", `/api/capital/history/${change.id}/revert`, {})).status).toBe(200);
    expect(await limitsOf(GOOD)).toEqual({ d: 800, bp: 400000 });
    expect((await call("POST", `/api/capital/history/${change.id}/revert`, {})).status).toBe(409);
  }, 120_000);

  it("a tier proposal withdraws a pending capital proposal (the ladder goes first)", async () => {
    await db.pool.query(
      `INSERT INTO scaling_proposals (trader, action, from_tier, to_tier, status, source, reasons, kind, limits, created_by)
       VALUES ($1, 'raise', 'trader', 'trader', 'pending', 'auto', '[]', 'limits', '{"week":"x","direction":"raise","before":{"dailyLossLimit":600,"buyingPower":null},"after":{"dailyLossLimit":660,"buyingPower":null}}', 'system')`,
      [THIRD],
    );
    const r = await call("POST", "/api/scaling/proposals", { trader: THIRD, action: "promote" });
    expect(r.status).toBe(201);
    const rows = (await db.pool.query(`SELECT kind, status FROM scaling_proposals WHERE trader = $1 ORDER BY id`, [THIRD])).rows;
    expect(rows).toEqual([{ kind: "limits", status: "rejected" }, { kind: "tier", status: "pending" }]);
  }, 60_000);
});
