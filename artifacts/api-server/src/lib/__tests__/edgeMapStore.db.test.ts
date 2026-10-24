/**
 * Edge map store + nightly run (roadmap R4) on a scratch database built from every migration (0247 included).
 * Synthetic traders and trades only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../db/runner";
import type { EdgeMapRow } from "../edgeMap";

const holder: { pool: pg.Pool | null } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  const pool = new Proxy({}, { get: (_t, k) => { const p = holder.pool as unknown as Record<string | symbol, unknown>; const v = p[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v; } });
  return { ...real, pool };
});
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const row = (over: Partial<EdgeMapRow>): EdgeMapRow => ({
  trader: "Synth A", asOf: "2026-10-20", sliceKey: "time:11:15-13:30", family: "time", n: 80, days: 40, net: -500, xbarBps: -20, seBps: 5,
  thetaBps: -15, lo80Bps: -21, hi80Bps: -9, q: 0.01, persistBlocks: 3, verdict: "LEAK", costPerDay: -6, costLo: -8.5, costHi: -3.5, priorMu: 1, priorTau: 8, ...over,
});

describe.skipIf(!available)("edge map store (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    db = await createScratchDb("edgemap");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("a run replaces its own as-of, keeps older verdict rows, drops older NONE rows; the view shows ≤ 3 per side", async () => {
    const { saveEdgeMap, edgeMapView, leakCostsPerDay, topVerdicts } = await import("../edgeMapStore");
    await saveEdgeMap([row({ asOf: "2026-10-19" }), row({ asOf: "2026-10-19", sliceKey: "side:long", verdict: "NONE" })], "2026-10-19");
    const today = [
      row({}), row({ sliceKey: "seq:6+", costPerDay: -9 }), row({ sliceKey: "price:lt5", costPerDay: -4 }), row({ sliceKey: "rapid:yes", costPerDay: -3 }),
      row({ sliceKey: "session:pre", verdict: "STRENGTH", thetaBps: 12, lo80Bps: 5, hi80Bps: 19, costPerDay: 7, costLo: 3, costHi: 11 }),
      row({ sliceKey: "side:short", verdict: "NONE", costPerDay: -50 }),
      row({ trader: "Synth B", sliceKey: "seq:1", verdict: "NONE" }),
    ];
    expect(await saveEdgeMap(today, "2026-10-20")).toBe(today.length);
    expect(await saveEdgeMap(today, "2026-10-20")).toBe(today.length); // re-run of the same date: replaced, not doubled
    const { rows } = await db.pool.query(`SELECT to_char(as_of, 'YYYY-MM-DD') AS d, verdict, count(*)::int AS n FROM edge_map GROUP BY 1, 2 ORDER BY 1, 2`);
    expect(rows).toEqual([{ d: "2026-10-19", verdict: "LEAK", n: 1 }, { d: "2026-10-20", verdict: "LEAK", n: 4 }, { d: "2026-10-20", verdict: "NONE", n: 2 }, { d: "2026-10-20", verdict: "STRENGTH", n: 1 }]);

    const v = await edgeMapView("Synth A");
    expect(v.asOf).toBe("2026-10-20");
    expect(v.lose.map((r) => r.sliceKey)).toEqual(["seq:6+", "time:11:15-13:30", "price:lt5"]);
    expect(v.earn).toEqual([expect.objectContaining({ sliceKey: "session:pre", perDay: 7, perDayLo: 3, perDayHi: 11, verdict: "STRENGTH" })]);
    expect(JSON.stringify(v)).not.toContain("side:short"); // NONE never leaves the store
    expect((await edgeMapView("Nobody")).asOf).toBeNull();
    expect((await edgeMapView("Synth B")).lose).toEqual([]);

    const costs = await leakCostsPerDay(["Synth A", "Synth B"]);
    expect(costs.get("Synth A")).toBeCloseTo(6 + 9 + 4 + 3, 6);
    expect(costs.has("Synth B")).toBe(false);
    expect((await topVerdicts(["Synth A"])).get("Synth A")!.leaks).toHaveLength(3);
  });

  it("runEdgeMapNightly loads the desk's closed trades and stores one row per trader × slice", async () => {
    const { runEdgeMapNightly } = await import("../edgeMapStore");
    const traders = ["Synth P", "Synth Q", "Synth R"];
    const values: unknown[] = [];
    const tuples: string[] = [];
    let k = 0;
    for (const trader of traders) {
      for (let d = 1; d <= 28; d++) {
        const day = `2026-09-${String(d).padStart(2, "0")}`;
        const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        for (const [hh, mm] of [[9, 45], [11, 30], [14, 5]] as const) {
          const pnl = ((k * 37) % 41) - 20;
          values.push(trader, `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`, pnl, 1, 100, 25, "SYN");
          const b = values.length - 7;
          tuples.push(`($${b + 1}, $${b + 2}, 'win', $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, '5m', 'long')`);
          k++;
        }
      }
    }
    await db.pool.query(`INSERT INTO trades (trader, date, result, pnl, fees, qty, entry, ticker, hold_time, side) VALUES ${tuples.join(", ")}`, values);
    const out = await runEdgeMapNightly({ asOf: "2026-09-30" });
    expect(out.traders).toBe(3);
    expect(out.trades).toBe(k);
    const { rows } = await db.pool.query(`SELECT trader, count(*)::int AS n FROM edge_map WHERE as_of = '2026-09-30' GROUP BY trader ORDER BY trader`);
    expect(rows.map((r) => r.trader)).toEqual(traders);
    expect(rows.every((r) => r.n >= 5)).toBe(true);
  });
});
