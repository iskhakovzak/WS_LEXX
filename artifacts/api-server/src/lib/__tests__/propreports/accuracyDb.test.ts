/**
 * Phase 3 ACCURACY against a real (scratch) Postgres built from the repository migrations (0222 included):
 * adjustments re-import / archive, fill id canonicalisation, reconcile upsert + acknowledgement re-open, per-day totals.
 * Skipped when the local Postgres is down.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrationFiles } from "../../../db/runner";
import { createScratchDb, pgAvailable } from "../../../db/__tests__/scratchDb";
import { toAdjustmentRows, type RawAdjustment } from "../../propreports/adjustments-parse";
import { adjustmentDays, relinkAdjustmentTraders, storeAdjustments } from "../../propreports/adjustments";
import { canonicalizeFillIds } from "../../propreports/replacement";
import { compareDays } from "../../propreports/reconcile-broker";
import { acknowledgeReconcileDay, listReconcileDays, loadOurDays, saveComparisons } from "../../propreports/reconcile-broker-store";
import type { AccountMapping } from "../../propreports/sync";
import type { Fill } from "../../propreports/types";

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const raw = (o: Partial<RawAdjustment> = {}): RawAdjustment => ({
  date: "2026-10-15", account: "WSL007", category: "Software Fee", amount: -45, comment: "DAS", qty: null, symbol: null, price: null, propReportsId: "A1", ...o,
});
const mappings: AccountMapping[] = [{ id: 1, account: "WSL007", accountId: "77", accountName: null, trader: "Кирилл Б.", active: true, notes: null, aliases: [], lastSyncedAt: null, lastFillAt: null }];
const W = { scope: "groupId:-4", from: "2026-10-10", to: "2026-10-16", mappings };

describe.skipIf(!available)("accuracy on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    db = await createScratchDb("accuracy");
    await runMigrationFiles({ pool: db.pool, logger: silent });
  }, 120_000);
  afterAll(async () => { await db?.drop(); });

  it("adjustments: idempotent, re-import keeps one row, vanished rows archived", async () => {
    const first = toAdjustmentRows([raw(), raw({ propReportsId: "A2", category: "Deposit", amount: 5000, comment: null })]).rows;
    expect(await storeAdjustments(first, W, db.pool)).toMatchObject({ inserted: 2 });
    expect(await storeAdjustments(first, W, db.pool)).toMatchObject({ inserted: 0, updated: 2, archived: 0 });
    // the fee is re-imported (new id), the deposit is gone upstream
    const second = toAdjustmentRows([raw({ propReportsId: "A9" })]).rows;
    expect(await storeAdjustments(second, W, db.pool)).toMatchObject({ inserted: 0, replaced: 1, archived: 1 });
    const { rows } = await db.pool.query(`SELECT propreports_id, replaced_ids, archived_at IS NOT NULL AS archived, trader FROM propreports_adjustments ORDER BY id`);
    expect(rows).toEqual([
      { propreports_id: "A9", replaced_ids: ["A1"], archived: false, trader: "Кирилл Б." },
      { propreports_id: "A2", replaced_ids: [], archived: true, trader: "Кирилл Б." },
    ]);
  });

  it("per-day totals include trade net; relink follows the mapping table", async () => {
    await db.pool.query(
      `INSERT INTO trades (ticker, date, side, entry, exit, qty, fees, pnl, result, trader, source, external_id, broker_account)
       VALUES ('AMD', '2026-10-15', 'Long', 150, 151, 100, 2, 100, 'win', 'Кирилл Б.', 'propreports', 'x1', 'WSL007')`,
    );
    const r = await adjustmentDays("Кирилл Б.", "2026-10-10", "2026-10-16", db.pool);
    expect(r.days).toEqual([{ date: "2026-10-15", tradeNet: 98, fees: -45, transfers: 0, other: 0, count: 1, netWithAdjustments: 53, equityDelta: 53 }]);
    await db.pool.query(`INSERT INTO propreports_accounts (account, account_id, trader) VALUES ('WSL007', '77', 'Анна К.')`);
    expect(await relinkAdjustmentTraders(db.pool)).toBe(2);
  });

  it("fill ids: a re-imported fill keeps its first id", async () => {
    const f: Fill = { dateTime: "2026-10-15 09:31:00.000", account: "WSL007", side: "B", qty: 100, symbol: "AMD", price: 150, route: null, fees: {}, tradeDate: "2026-10-15", orderId: "O1", fillId: "F1", propReportsId: "P1", status: null, line: 1 };
    expect((await canonicalizeFillIds([f], db.pool)).fresh).toBe(1);
    const again = await canonicalizeFillIds([{ ...f, propReportsId: "P2" }], db.pool);
    expect(again).toMatchObject({ replaced: 1, applied: true });
    expect(again.fills[0]!.propReportsId).toBe("P1");
    expect((await canonicalizeFillIds([{ ...f, propReportsId: "P2" }], db.pool)).fills[0]!.propReportsId).toBe("P1");
  });

  it("reconcile: our days from trades, upsert per day, acknowledgement re-opens when the diff moves", async () => {
    const ours = await loadOurDays(["WSL007"], "2026-10-10", "2026-10-16", db.pool);
    expect(ours.days).toEqual([{ date: "2026-10-15", trades: 1, gross: 100, fees: 2, net: 98, adjFees: -45, transfers: 0 }]);
    const acc = { account: "WSL007", accountId: "77", trader: "Кирилл Б." };
    const broker = (net: number) => [{ date: "2026-10-15", gross: 100, fees: 2, net, fills: 2, adjFees: -45, transfers: 0 }];
    await saveComparisons(acc, compareDays(ours.days, broker(90)), db.pool);
    let list = await listReconcileDays({}, db.pool);
    expect(list.openCount).toBe(1);
    expect(list.rows[0]).toMatchObject({ status: "mismatch", diff: 8, oursNet: 98, brokerNet: 90 });
    expect(await acknowledgeReconcileDay(list.rows[0]!.id, "Админ", "known", db.pool)).toBe(true);
    await saveComparisons(acc, compareDays(ours.days, broker(90.5)), db.pool); // moved by $0.50: stays acknowledged
    expect((await listReconcileDays({}, db.pool)).openCount).toBe(0);
    await saveComparisons(acc, compareDays(ours.days, broker(80)), db.pool); // moved by $10: open again
    list = await listReconcileDays({}, db.pool);
    expect(list.openCount).toBe(1);
    expect(list.rows[0]!.acknowledgedAt).toBeNull();
  });
});
