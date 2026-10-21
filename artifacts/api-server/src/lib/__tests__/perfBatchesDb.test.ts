/**
 * Performance review 2026-10-21 — the batched / index-friendly rewrites give the same results as the code they replace,
 * on a scratch Postgres built from the repository migrations (0238 included):
 *  - POST /trades/bulk add / removeTags: one tags UPDATE + syncTagMarkersBulk ≡ the old per-trade loop
 *    (UPDATE + syncMarkerErrors): trades.tags, trading_errors, trading_errors_archive, the journal mirror;
 *  - PropReports writeExecutions: all fills in one INSERT (order, notes, ET instants), manual fills kept;
 *  - GET /trades lite rows (lib/tradesListQuery): the same rows / values as the full read, the snapshot cut to
 *    { openedAt, closedAt } after the sort + cap;
 *  - GET /trades `from` predicate: the indexable spelling selects the same rows (blank / padded / timed values; result is NOT NULL in the schema);
 *  - the strategy backfill WHERE: `IS NULL OR < OR >` ≡ `IS DISTINCT FROM`.
 * Skipped when the local Postgres is down. Never touches the dev database (a throw-away vitest_* database).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import type { RoundTrip } from "../propreports/types";

const holder = vi.hoisted(() => ({ pool: null as unknown as pg.Pool }));
vi.mock("@workspace/db", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pool: {
    query: async (...a: unknown[]) => (holder.pool.query as (...x: unknown[]) => unknown)(...a),
    connect: async () => holder.pool.connect(),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));

const { resolveMigrationsDir, runMigrationFiles } = await import("../../db/runner");
const { createScratchDb, pgAvailable } = await import("../../db/__tests__/scratchDb");
const { bulkTags, splitTagList, syncMarkerErrors, syncTagMarkersBulk } = await import("../tradingErrors");

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("perf rewrites ≡ the old statements (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

  beforeAll(async () => {
    db = await createScratchDb("perfbatch");
    holder.pool = db.pool;
    q = (sql, params) => db.pool.query(sql, params as unknown[]);
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: resolveMigrationsDir() });
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  describe("bulk add / removeTags", () => {
    // One fixture per trade: tags, the journal review (null = none), pre-existing trading_errors rows.
    type Fx = { trader: string | null; tags: string | null; review: string[] | null; errors: { code: string; type: string; source: string }[] };
    const FIXTURES: Fx[] = [
      { trader: "Anna", tags: "FOMO, ORB", review: ["FOMO / погоня", "свой"], errors: [{ code: "fomo", type: "FOMO / погоня", source: "tag" }] },
      { trader: "Anna", tags: "Двигал стоп", review: [], errors: [{ code: "revenge", type: "Отыгрыш после убытка", source: "manual" }] },
      { trader: "Boris", tags: null, review: null, errors: [] },
      { trader: "Boris", tags: "Большой размер, VWAP", review: ["Завышенный размер"], errors: [] },
      { trader: null, tags: "FOMO", review: null, errors: [] },
    ];

    async function seed(): Promise<number[]> {
      const ids: number[] = [];
      for (const f of FIXTURES) {
        const { rows } = await q(`INSERT INTO trades (ticker, date, trader, tags, result) VALUES ('AAA', '2026-10-15', $1, $2, 'loss') RETURNING id`, [f.trader, f.tags]);
        const id = Number(rows[0].id);
        ids.push(id);
        if (f.review) await q(`INSERT INTO eod_trade_reviews (trade_id, trader, mistakes) VALUES ($1, $2, $3::text[])`, [id, f.trader ?? "x", f.review]);
        for (const e of f.errors) {
          await q(`INSERT INTO trading_errors (trader, error_type, description, trade_id, severity, code, source) VALUES ($1, $2, $2, $3, 'high', $4, $5)`, [f.trader, e.type, id, e.code, e.source]);
        }
      }
      return ids;
    }

    type Row = { id: number; trader: string | null; tags: string | null };
    const load = async (ids: number[]): Promise<Row[]> => (await q(`SELECT id, trader, tags FROM trades WHERE id = ANY($1::int[]) ORDER BY id`, [ids])).rows;

    /** The route before the rewrite: one UPDATE + one syncMarkerErrors per changed trade. */
    async function oldPath(ids: number[], tags: string[], action: "addTags" | "removeTags"): Promise<void> {
      for (const r of await load(ids)) {
        const cur = splitTagList(r.tags);
        const next = bulkTags(cur, tags, action);
        if (next.join(", ") === cur.join(", ")) continue;
        await q(`UPDATE trades SET tags = $2 WHERE id = $1`, [r.id, next.length ? next.join(", ") : null]);
        if (r.trader) await syncMarkerErrors({ trader: r.trader, tradeId: r.id, ticker: null, source: "tag", actor: "Cur C." }, cur, next);
      }
    }

    /** The route now: one tags UPDATE for every changed trade + syncTagMarkersBulk. */
    async function newPath(ids: number[], tags: string[], action: "addTags" | "removeTags"): Promise<void> {
      const changed = (await load(ids))
        .map((r) => { const cur = splitTagList(r.tags); return { r, cur, next: bulkTags(cur, tags, action) }; })
        .filter((x) => x.next.join(", ") !== x.cur.join(", "));
      if (!changed.length) return;
      await q(`UPDATE trades t SET tags = u.tags FROM unnest($1::int[], $2::text[]) AS u(id, tags) WHERE t.id = u.id`,
        [changed.map((x) => x.r.id), changed.map((x) => (x.next.length ? x.next.join(", ") : null))]);
      await syncTagMarkersBulk(changed.filter((x) => x.r.trader).map((x) => ({ trader: x.r.trader!, tradeId: x.r.id, before: x.cur, after: x.next })), "Cur C.");
    }

    /** Everything the two paths write, keyed by the trade's position in FIXTURES (ids / timestamps dropped). */
    async function state(ids: number[]) {
      const pos = (id: unknown) => ids.indexOf(Number(id));
      const tags = (await load(ids)).map((r) => [pos(r.id), r.tags]);
      const errors = (await q(`SELECT trader, error_type, description, ticker, trade_id, severity, code, source, resolved FROM trading_errors WHERE trade_id = ANY($1::int[])`, [ids]))
        .rows.map((r) => ({ ...r, trade_id: pos(r.trade_id) })).sort((a, b) => a.trade_id - b.trade_id || String(a.code).localeCompare(String(b.code)));
      const archive = (await q(`SELECT trader, archived_by, payload FROM trading_errors_archive WHERE (payload ->> 'trade_id')::int = ANY($1::int[])`, [ids]))
        .rows.map(({ payload: { id: _id, created_at: _c, trade_id, ...p }, ...r }) => ({ ...r, payload: { ...p, trade_id: pos(trade_id) } }))
        .sort((a, b) => a.payload.trade_id - b.payload.trade_id || String(a.payload.code).localeCompare(String(b.payload.code)));
      const reviews = (await q(`SELECT trade_id, mistakes FROM eod_trade_reviews WHERE trade_id = ANY($1::int[]) ORDER BY trade_id`, [ids])).rows.map((r) => [pos(r.trade_id), r.mistakes]);
      return { tags, errors, archive, reviews };
    }

    it("add then remove: the same trades.tags, errors, archive and journal mirror as the per-trade loop", async () => {
      const a = await seed();
      const b = await seed();
      expect(await state(b)).toEqual(await state(a));

      const add = ["Большой размер", "Реванш", "fomo", "Breakout"];
      await oldPath(a, add, "addTags");
      await newPath(b, add, "addTags");
      const afterAdd = await state(a);
      expect(await state(b)).toEqual(afterAdd);
      // sanity: the fixtures exercise every branch (new rows, a manual row kept, the journal mirrored)
      expect(afterAdd.errors.filter((e) => e.source === "tag").length).toBeGreaterThan(3);
      expect(afterAdd.errors.filter((e) => e.code === "revenge" && e.trade_id === 1)).toHaveLength(1);
      expect(afterAdd.reviews.find(([p]) => p === 1)![1]).toEqual(["Завышенный размер", "Отыгрыш после убытка", "FOMO / погоня"]);

      const remove = ["FOMO / погоня", "Сдвинул стоп", "ORB", "реванш"];
      await oldPath(a, remove, "removeTags");
      await newPath(b, remove, "removeTags");
      const afterRemove = await state(a);
      expect(await state(b)).toEqual(afterRemove);
      expect(afterRemove.archive.length).toBeGreaterThan(2);
      expect(afterRemove.reviews.find(([p]) => p === 0)![1]).toEqual(["свой", "Завышенный размер"]);

      // a no-op selection writes nothing
      const before = await state(b);
      await newPath(b, ["VWAP"], "removeTags");
      await newPath(b, ["VWAP"], "removeTags");
      expect((await state(b)).errors).toEqual(before.errors);
    });
  });

  describe("PropReports writeExecutions (via applySync)", () => {
    const trip = (executions: RoundTrip["executions"]): RoundTrip => ({
      externalId: "ACC|ZZZ|2026-10-20T09:31:00|Long", account: "ACC", symbol: "ZZZ", side: "Long",
      openedAt: "2026-10-20T09:31:00", closedAt: "2026-10-20T15:59:30", date: "2026-10-20", exitDate: null,
      horizon: "intraday", session: "regular", qty: 300, closedQty: 300, openQty: 0, avgEntry: 10, avgExit: 11,
      grossPnl: 300, fees: {}, totalFees: 3, netPnl: 297, result: "win", holdTime: "6h", holdSeconds: 21_600,
      executions, fillCount: executions.length, open: false,
    });
    const fills: RoundTrip["executions"] = [
      { kind: "entry", side: "B", qty: 100, price: 10.0001, at: "2026-10-20T09:31:00", fees: 1.25, fillId: "F1", orderId: "O1" },
      { kind: "add", side: "B", qty: 200, price: 10.5, at: "2026-10-20T09:45:12", fees: 0, fillId: null, orderId: null },
      { kind: "exit", side: "S", qty: 300, price: 11.25, at: "2026-10-20T15:59:30", fees: 2, fillId: "F3", orderId: "O3" },
    ] as RoundTrip["executions"];
    const plan = (action: "insert" | "update", t: RoundTrip, tradeId: number | null) => ({
      items: [{ externalId: t.externalId, action, trader: "Anna", account: "ACC", tradeId, pendingId: null, changes: [], candidates: [], trip: t }],
      counts: { insert: 0, update: 0, unchanged: 0, adopt: 0, conflict: 0, skip: 0 },
      unmappedAccounts: [], inactiveAccounts: [], dateFrom: "2026-10-20", dateTo: "2026-10-20", feeColumns: [], resolvedAccounts: {},
    });
    const execs = async (id: number) => (await q(
      `SELECT kind, price::text, qty::text, to_char(executed_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI:SS') AS at, note, sort_order, order_id
         FROM trade_executions WHERE trade_id = $1 ORDER BY sort_order, id`, [id])).rows;

    it("all fills in one statement: order, notes, ET instants; a re-sync replaces only the broker fills", async () => {
      const { applySync } = await import("../propreports/sync");
      const res = await applySync(plan("insert", trip(fills), null) as never, { actor: "test", source: "api", kick: false });
      expect(res).toMatchObject({ inserted: 1, errors: 0 });
      const id = Number((await q(`SELECT id FROM trades WHERE external_id = $1`, [trip(fills).externalId])).rows[0].id);
      expect(await execs(id)).toEqual([
        { kind: "entry", price: "10.0001", qty: "100.00", at: "2026-10-20 09:31:00", note: "PropReports B #F1 · fees 1.25", sort_order: 0, order_id: "O1" },
        { kind: "add", price: "10.5000", qty: "200.00", at: "2026-10-20 09:45:12", note: "PropReports B", sort_order: 1, order_id: null },
        { kind: "exit", price: "11.2500", qty: "300.00", at: "2026-10-20 15:59:30", note: "PropReports S #F3 · fees 2", sort_order: 2, order_id: "O3" },
      ]);
      // the strategy was derived with the fills inside the sync (MOC: the exit is in the IMX window)
      expect((await q(`SELECT strategy, strategy_sig IS NOT NULL AS signed FROM trades WHERE id = $1`, [id])).rows[0]).toEqual({ strategy: "MOC", signed: true });

      await q(`INSERT INTO trade_executions (trade_id, kind, price, qty, note, sort_order) VALUES ($1, 'stop', 9.5, 300, 'my stop', 9)`, [id]);
      const res2 = await applySync(plan("update", trip([fills[0]!, fills[2]!]), id) as never, { actor: "test", source: "api", kick: false });
      expect(res2).toMatchObject({ updated: 1, errors: 0 });
      expect((await execs(id)).map((e) => [e.kind, e.sort_order, e.note])).toEqual([
        ["entry", 0, "PropReports B #F1 · fees 1.25"], ["exit", 1, "PropReports S #F3 · fees 2"], ["stop", 9, "my stop"],
      ]);
      // no fills: only the delete runs
      await applySync(plan("update", trip([]), id) as never, { actor: "test", source: "api", kick: false });
      expect((await execs(id)).map((e) => e.note)).toEqual(["my stop"]);
    });
  });

  describe("GET /trades rows (lib/tradesListQuery)", () => {
    it("lite = full except the snapshot ({ openedAt, closedAt } or null); same order and cap", async () => {
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const { eq } = await import("drizzle-orm");
      const { tradesTable } = await import("@workspace/db");
      const { selectTradesList } = await import("../tradesListQuery");
      const d = drizzle(db.pool);
      const snaps = [{ source: "propreports", openedAt: "2026-10-01T09:31:00", closedAt: "2026-10-01T10:00:05", fills: [1, 2, 3] }, { openedAt: "2026-10-02T09:40:00" }, { market: { spy: 1 } }, null];
      for (let i = 0; i < 6; i++) {
        await q(`INSERT INTO trades (ticker, date, trader, result, pnl, context_snapshot, synced_at) VALUES ('LST', $1, 'Lister', 'win', 10.5, $2::jsonb, NOW())`,
          [`2026-10-0${1 + (i % 3)}`, JSON.stringify(snaps[i % snaps.length])]);
      }
      const where = eq(tradesTable.trader, "Lister");
      const full = await selectTradesList(where, 4, false, d);
      const lite = await selectTradesList(where, 4, true, d);
      expect(full).toHaveLength(4);
      expect(lite.map((r) => r.id)).toEqual(full.map((r) => r.id));
      const slim = (s: any) => (s && (s.openedAt || s.closedAt) ? Object.fromEntries(Object.entries({ openedAt: s.openedAt, closedAt: s.closedAt }).filter(([, v]) => v != null)) : null);
      expect(lite).toEqual(full.map((r) => ({ ...r, contextSnapshot: slim(r.contextSnapshot) })));
      expect(lite[0]!.createdAt).toBeInstanceOf(Date);
      expect(full.map((r) => r.date)).toEqual([...full.map((r) => r.date)].sort().reverse());
    });
  });

  describe("index-friendly predicates", () => {
    it("GET /trades `from`: LEFT(close day, 10) >= from OR LOWER(TRIM(result)) = 'open' ≡ the old spelling", async () => {
      const rows: [string, string | null, string | null][] = [
        ["2026-09-30", null, "win"], ["2026-09-30", "", "loss"], ["2026-09-30", "2026-10-01", "win"], ["2026-09-30 15:59", null, ""],
        ["2026-10-01", null, "breakeven"], ["2026-10-01 09:30:00", "", ""], ["2026-09-01", null, " Open "], ["2026-09-01", null, "OPEN"],
        ["2026-09-01", "", ""], ["2026-09-01", "2026-09-30 16:00", "open"], ["2026-10-02T10:00:00", "2026-10-03", "loss"], ["2026-08-01", null, "  "],
      ];
      await q(`INSERT INTO trades (ticker, date, exit_date, result, trader) SELECT 'PRD', d, e, r, 'Pred' FROM unnest($1::text[], $2::text[], $3::text[]) AS u(d, e, r)`,
        [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2])]);
      for (const from of ["2026-08-01", "2026-09-30", "2026-10-01", "2026-10-02", "2026-12-31"]) {
        const ids = async (pred: string) => (await q(`SELECT id FROM trades WHERE trader = 'Pred' AND deleted_at IS NULL AND ${pred} ORDER BY id`, [from])).rows.map((r) => r.id);
        const before = await ids(`(COALESCE(NULLIF(exit_date, ''), date) >= $1 OR LOWER(TRIM(COALESCE(result, ''))) = 'open')`);
        const after = await ids(`(LEFT(COALESCE(NULLIF(exit_date, ''), date), 10) >= $1 OR LOWER(TRIM(result)) = 'open')`);
        expect(after).toEqual(before);
      }
    });

    it("strategy backfill: strategy_sig IS NULL OR < OR > ≡ IS DISTINCT FROM", async () => {
      await q(`UPDATE trades SET strategy_sig = NULL WHERE trader = 'Pred'`);
      const sigs = [null, "v1|15:50-16:00", "v0|15:50-16:00", "v2|15:50-16:00", "v1|15:50-16:00 ", "v1|15:45-16:00"];
      const { rows } = await q(`SELECT id FROM trades WHERE trader = 'Pred' ORDER BY id`);
      for (let i = 0; i < rows.length; i++) await q(`UPDATE trades SET strategy_sig = $2 WHERE id = $1`, [rows[i].id, sigs[i % sigs.length]]);
      for (const sig of ["v1|15:50-16:00", "v9|x", ""]) {
        const ids = async (pred: string) => (await q(`SELECT id FROM trades WHERE trader = 'Pred' AND (${pred}) ORDER BY id`, [sig])).rows.map((r) => r.id);
        expect(await ids(`strategy_sig IS NULL OR strategy_sig < $1 OR strategy_sig > $1`)).toEqual(await ids(`strategy_sig IS DISTINCT FROM $1`));
      }
      expect((await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'trades_strategy_sig_idx'`)).rows[0].indexdef).toMatch(/\(strategy_sig\)/);
    });
  });
});
