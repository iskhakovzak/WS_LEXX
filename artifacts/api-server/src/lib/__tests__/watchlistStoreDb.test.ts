/**
 * lib/watchlist/store.ts on a scratch Postgres built from the repository migrations (0233: watchlist.owner, list_name):
 * the existing rows stay on the desk list, lists are separate (same ticker in both), inserts land in the right list,
 * flags and content writes, «мои сделки» counts only the caller's own trades. Skipped when the local Postgres is down.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";

const holder = vi.hoisted(() => ({ pool: null as unknown as { query: (...a: unknown[]) => unknown } }));
vi.mock("@workspace/db", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pool: { query: (...a: unknown[]) => holder.pool.query(...a) },
}));

const { resolveMigrationsDir, runMigrationFiles } = await import("../../db/runner");
const { createScratchDb, pgAvailable } = await import("../../db/__tests__/scratchDb");
const store = await import("../watchlist/store");

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("watchlist store on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let legacyId = 0;

  beforeAll(async () => {
    db = await createScratchDb("watchlist");
    holder.pool = db.pool as unknown as pg.Pool;
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: resolveMigrationsDir() });
    const { rows } = await db.pool.query(`INSERT INTO watchlist (ticker, status, created_by) VALUES ('AAPL', 'watching', 'Old') RETURNING id`);
    legacyId = Number(rows[0].id);
  }, 180_000);
  afterAll(async () => {
    await db?.drop();
  });

  it("an existing row is a desk row; lists are separate", async () => {
    expect((await store.listRows(null)).map((r) => r.id)).toEqual([legacyId]);
    expect(await store.listRows(5)).toEqual([]);
    const [mine] = await store.insertRows([{ ticker: "AAPL", status: "watching", createdBy: "T", catalyst: "gap" }], 5, "today");
    expect(mine).toMatchObject({ ticker: "AAPL", owner: 5, list: "today", inPlay: true, catalyst: "gap", createdBy: "T" });
    expect((await store.activeByTickers(["aapl"], 5)).map((r) => r.id)).toEqual([mine!.id]);
    expect((await store.activeByTickers(["AAPL"], null)).map((r) => r.id)).toEqual([legacyId]);
    expect(await store.ownersOf([legacyId, mine!.id, 999999])).toEqual(new Map([[legacyId, null], [mine!.id, 5]]));
  });

  it("content, list, «В игре», status, delete / restore, score", async () => {
    const [r] = await store.insertRows([{ ticker: "MU", status: "watching", createdBy: "T" }], 5);
    expect(r!.list).toBe("watch");
    const u = await store.updateContent(r!.id, { notes: "n", targetPrice: "12.5" });
    expect([u!.notes, Number(u!.targetPrice)]).toEqual(["n", 12.5]);
    await store.setList([r!.id], "swing");
    expect((await store.getRow(r!.id))!.list).toBe("swing");
    await store.setInPlay([r!.id], true);
    expect(await store.getRow(r!.id)).toMatchObject({ list: "today", inPlay: true });
    await store.setInPlay([r!.id], false);
    expect(await store.getRow(r!.id)).toMatchObject({ list: "watch", inPlay: false });
    expect(await store.setStatus([r!.id], "passed")).toBe(1);
    expect(await store.setDeleted([r!.id], true)).toEqual([r!.id]);
    expect(await store.getRow(r!.id)).toBeNull();
    expect(await store.setDeleted([r!.id], false)).toEqual([r!.id]);
    expect((await store.setScore(r!.id, 70, "{}"))!.score).toBe(70);
    expect((await store.rowsToScore(5, 10)).length).toBe(2);
  });

  it("«мои сделки» = the caller's own trades only", async () => {
    await db.pool.query(
      `INSERT INTO trades (trader, ticker, date, result) VALUES ('T', 'MU', '2026-10-20', 'win'), ('Other', 'MU', '2026-10-21', 'open')`,
    ).catch(async () => {
      // the trades table needs more columns on this schema — insert with the minimum it accepts
      await db.pool.query(`INSERT INTO trades (trader, ticker, date) VALUES ('T', 'MU', '2026-10-20'), ('Other', 'MU', '2026-10-21')`);
    });
    const s = await store.tickerStats(["MU"], "T");
    expect(s.trades.get("MU")).toEqual({ count: 1, last: "2026-10-20" });
  });
});
