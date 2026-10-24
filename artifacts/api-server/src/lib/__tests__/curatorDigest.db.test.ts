/**
 * R11 digest items for the 17:30 curator digest (routes/curator.ts curatorDigestTop — consumed by the digest job on
 * another branch) on a scratch database built from every migration: the curator's wards only (assigned + his desk
 * group), one item per trader, never «none», at most n. Synthetic people only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../db/runner";
import { weekdays } from "./fixtures/edgeSynth";

const holder: { pool: pg.Pool | null } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  const pool = new Proxy({}, { get: (_t, k) => { const p = holder.pool as unknown as Record<string | symbol, unknown>; const v = p[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v; } });
  return { ...real, pool };
});
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("curator digest items (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    process.env.JWT_SECRET ??= "vitest-only-secret";
    db = await createScratchDb("digest");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
    await db.pool.query(
      `INSERT INTO users (name, role, active, assigned_curator) VALUES ('Digest Curator', 'curator', true, NULL),
         ('Digest Red', 'trader', true, 'Digest Curator'), ('Digest Calm', 'trader', true, 'Digest Curator'),
         ('Digest Other', 'trader', true, 'Someone Else')`,
    );
    // Red: 20 red days in a row (money at stake); Calm: small green days. Other is not a ward.
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const day of weekdays(30, "2026-09-14")) {
      for (const [trader, pnl] of [["Digest Red", -60], ["Digest Calm", 15], ["Digest Other", -500]] as const) {
        values.push(trader, `${day}T10:00:00`, pnl);
        const b = values.length - 3;
        tuples.push(`($${b + 1}, $${b + 2}, 'win', $${b + 3}, 0, 'SYN')`);
      }
    }
    await db.pool.query(`INSERT INTO trades (trader, date, result, pnl, fees, ticker) VALUES ${tuples.join(", ")}`, values);
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("wards only, one item per trader, the red trader first with money at stake in the score", async () => {
    const { wardsOf } = await import("../curatorRoster");
    expect(await wardsOf("Digest Curator")).toEqual(["Digest Calm", "Digest Red"]);
    const { curatorDigestTop } = await import("../../routes/curator");
    const items = await curatorDigestTop("Digest Curator", "2026-10-23", 3, "en");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(2);
    expect(new Set(items.map((i) => i.trader)).size).toBe(items.length);
    expect(items.some((i) => i.trader === "Digest Other")).toBe(false);
    expect(items.every((i) => i.kind !== "none")).toBe(true);
    expect(items[0]).toMatchObject({ trader: "Digest Red" });
    expect(items[0].score?.atStake).toBeGreaterThan(0);
    expect(await curatorDigestTop("Nobody", "2026-10-23")).toEqual([]);
  });
});
