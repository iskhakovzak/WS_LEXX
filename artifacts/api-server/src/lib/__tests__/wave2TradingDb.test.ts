/**
 * Волна 2, cluster R on a scratch Postgres built from the repository migrations (0235):
 *  - 2.6 the stage rule set: seeded once, a Джун (default stage) gets the junior set, a stage assignment (setStage)
 *    switches the set at once;
 *  - 2.8 one errors store: the 0235 backfill of trade tags / journal mistakes is idempotent (trade + code), key M and the
 *    journal write / archive rows and mirror each other;
 *  - 2.6 the examples seed is idempotent;
 *  - 2.12 drawings by ticker (one set across days; the backfill merges the per-day rows).
 * Skipped when the local Postgres is down.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { pg } from "@workspace/db";

const holder = vi.hoisted(() => ({ pool: null as unknown as pg.Pool }));
vi.mock("@workspace/db", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pool: {
    query: async (...a: unknown[]) => (holder.pool.query as (...x: unknown[]) => unknown)(...a),
    connect: async () => holder.pool.connect(),
  },
}));

const { resolveMigrationsDir, runMigrationFiles } = await import("../../db/runner");
const { createScratchDb, pgAvailable } = await import("../../db/__tests__/scratchDb");

const here = path.dirname(fileURLToPath(import.meta.url));
const SQL_0235 = readFileSync(path.join(here, "../../db/migrations/0235_stage_rules_one_errors_store_ticker_drawings.sql"), "utf8");
const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("wave 2 trading depth on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

  beforeAll(async () => {
    db = await createScratchDb("wave2r");
    holder.pool = db.pool;
    q = (sql, params) => db.pool.query(sql, params as unknown[]);
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: resolveMigrationsDir() });
    await q(`INSERT INTO users (name, role) VALUES ('Jun J.', 'trader'), ('Tra T.', 'trader'), ('Cur C.', 'curator')`);
  }, 180_000);
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 200)); // let background re-scans settle before the database goes
    await db?.drop();
  });

  describe("2.6 rules by ladder level", () => {
    it("the migration seeds the junior and trader sets once (re-run adds nothing)", async () => {
      const count = async () => (await q(`SELECT stage, COUNT(*)::int AS n FROM trading_rules WHERE trader = '*' AND template_key IS NOT NULL GROUP BY stage ORDER BY stage`)).rows;
      expect(await count()).toEqual([{ stage: "junior", n: 5 }, { stage: "trader", n: 4 }]);
      await q(SQL_0235);
      expect(await count()).toEqual([{ stage: "junior", n: 5 }, { stage: "trader", n: 4 }]);
    });

    it("a trader without a stage is a Джун and gets the junior set; a stage assignment switches the set at once", async () => {
      const { fetchRulesFor } = await import("../rulesEngine");
      const keys = async (who: string) => (await fetchRulesFor(who, { enabledOnly: true })).map((r) => r.templateKey).filter(Boolean).sort();
      expect(await keys("Jun J.")).toEqual(["junior.daily_stop", "junior.max_trades", "junior.no_overnight", "junior.no_size_up", "junior.stop_after_losses"]);
      expect(await keys("Tra T.")).toHaveLength(5); // cached: junior until assigned
      const { setStage } = await import("../academy/stage-actions");
      await (await import("../academyPathStore")).ensureAcademyPathSeed();
      await setStage("Tra T.", "junior", "trader", "Cur C.", "assign", null, null, null);
      expect(await keys("Tra T.")).toEqual(["trader.daily_stop", "trader.max_trades", "trader.no_size_up", "trader.stop_after_losses"]);
      // the assignment also filled the limits template (buying power stays per trader, never from the template)
      const lim = (await q(`SELECT tier, daily_loss_limit, buying_power FROM trader_risk_limits WHERE trader = 'Tra T.'`)).rows[0];
      expect(lim).toMatchObject({ tier: "trader", daily_loss_limit: 600, buying_power: null });
      expect((await q(`SELECT since FROM academy_trader_stage WHERE user_name = 'Tra T.'`)).rows[0]?.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("2.8 one errors store", () => {
    let tradeA = 0;
    let tradeB = 0;
    beforeAll(async () => {
      const ins = async (tags: string | null) =>
        Number((await q(`INSERT INTO trades (trader, ticker, date, result, pnl, tags) VALUES ('Jun J.', 'AAPL', '2026-10-15', 'loss', -40, $1) RETURNING id`, [tags])).rows[0].id);
      tradeA = await ins("FOMO, Спокойствие, Реванш");
      tradeB = await ins(null);
      await q(`INSERT INTO eod_trade_reviews (trade_id, trader, mistakes) VALUES ($1, 'Jun J.', ARRAY['Двигал стоп', 'FOMO']), ($2, 'Jun J.', ARRAY['Ранний выход'])`, [tradeA, tradeB]);
      await q(`INSERT INTO trading_errors (trader, error_type, description, trade_id) VALUES ('Jun J.', 'Отыгрыш после убытка', 'by hand', $1), ('Jun J.', 'что-то своё', 'x', $1)`, [tradeA]);
    });

    it("the backfill writes one row per trade + code from tags and the journal; a second run adds nothing", async () => {
      const rows = async () => (await q(`SELECT trade_id, code, source FROM trading_errors WHERE trader = 'Jun J.' ORDER BY trade_id, code NULLS LAST, source`)).rows;
      await q(SQL_0235);
      const first = await rows();
      expect(first).toEqual([
        { trade_id: tradeA, code: "fomo", source: "tag" },
        { trade_id: tradeA, code: "movedStop", source: "journal" },
        { trade_id: tradeA, code: "revenge", source: "manual" }, // logged by hand: kept, got its code, not duplicated
        { trade_id: tradeA, code: null, source: "manual" },
        { trade_id: tradeB, code: "earlyExit", source: "journal" },
      ]);
      await q(SQL_0235);
      expect(await rows()).toEqual(first);
    });

    it("key M: a mistake added → a row (+ journal mirror); taken off → archived, gone from tags and the journal", async () => {
      const { syncMarkerErrors } = await import("../tradingErrors");
      const base = { trader: "Jun J.", tradeId: tradeA, ticker: "AAPL", source: "tag" as const, actor: "Jun J." };
      await syncMarkerErrors(base, "FOMO, Спокойствие, Реванш", "FOMO, Спокойствие, Реванш, Большой размер");
      expect((await q(`SELECT code, source, severity, error_type FROM trading_errors WHERE trade_id = $1 AND code = 'oversize'`, [tradeA])).rows)
        .toEqual([{ code: "oversize", source: "tag", severity: "high", error_type: "Завышенный размер" }]);
      expect((await q(`SELECT mistakes FROM eod_trade_reviews WHERE trade_id = $1`, [tradeA])).rows[0].mistakes).toContain("Завышенный размер");

      await q(`UPDATE trades SET tags = 'Спокойствие, Реванш, Большой размер' WHERE id = $1`, [tradeA]);
      await syncMarkerErrors(base, "FOMO, Спокойствие, Реванш, Большой размер", "Спокойствие, Реванш, Большой размер");
      expect((await q(`SELECT 1 FROM trading_errors WHERE trade_id = $1 AND code = 'fomo'`, [tradeA])).rows).toHaveLength(0);
      expect((await q(`SELECT payload->>'code' AS code FROM trading_errors_archive WHERE (payload->>'trade_id')::int = $1`, [tradeA])).rows).toEqual([{ code: "fomo" }]);
      expect((await q(`SELECT mistakes FROM eod_trade_reviews WHERE trade_id = $1`, [tradeA])).rows[0].mistakes).toEqual(["Двигал стоп", "Завышенный размер"]);
    });

    it("the journal: a mistake → a row and the tag on the trade", async () => {
      const { syncMarkerErrors } = await import("../tradingErrors");
      await syncMarkerErrors({ trader: "Jun J.", tradeId: tradeB, ticker: null, source: "journal", actor: "Jun J." }, ["Ранний выход"], ["Ранний выход", "Без плана"]);
      expect((await q(`SELECT code, source FROM trading_errors WHERE trade_id = $1 ORDER BY code`, [tradeB])).rows)
        .toEqual([{ code: "earlyExit", source: "journal" }, { code: "offPlan", source: "journal" }]);
      expect((await q(`SELECT tags FROM trades WHERE id = $1`, [tradeB])).rows[0].tags).toBe("Вход не по плану");
    });
  });

  describe("2.6 examples seed", () => {
    it("adds the best winners of each office setup up to 3; a second run adds nothing", async () => {
      const setup = Number((await q(`INSERT INTO playbook (name, space) VALUES ('1.3 ORB', 'office') RETURNING id`)).rows[0].id);
      const personal = Number((await q(`INSERT INTO playbook (name, space, trader) VALUES ('mine', 'personal', 'Jun J.') RETURNING id`)).rows[0].id);
      const trade = async (day: string, grade: string | null, pnl: number, pb = setup) =>
        Number((await q(`INSERT INTO trades (trader, ticker, date, result, pnl, confidence_grade, playbook_id) VALUES ('Tra T.', 'MU', $1, $2, $3, $4, $5) RETURNING id`,
          [day, pnl > 0 ? "win" : "loss", pnl, grade, pb])).rows[0].id);
      const best = await trade("2026-10-01", "A+", 120);
      await trade("2026-10-01", "A", 90); // same trader-day as `best`
      const b = await trade("2026-10-02", "B", 30);
      const cc = await trade("2026-10-03", "C", 10);
      await trade("2026-10-04", "A", -50);
      await trade("2026-10-05", "A", 70, personal);
      const { seedPlaybookExamples } = await import("../playbook/examplesSeed");
      const dry = await seedPlaybookExamples({ actor: "Cur C.", dryRun: true });
      expect(dry.added).toBe(3);
      expect((await q(`SELECT COUNT(*)::int AS n FROM playbook_examples`)).rows[0].n).toBe(0);
      const first = await seedPlaybookExamples({ actor: "Cur C." });
      expect(first.setups).toEqual([{ setupId: setup, name: "1.3 ORB", before: 0, added: [best, b, cc] }]);
      expect((await q(`SELECT trade_id, tier FROM playbook_examples ORDER BY id`)).rows).toEqual([
        { trade_id: best, tier: 1 }, { trade_id: b, tier: 2 }, { trade_id: cc, tier: 2 },
      ]);
      expect((await seedPlaybookExamples({ actor: "Cur C." })).added).toBe(0);
      // a curator removes one: it never comes back, the slot takes nothing else (no other winner left)
      await q(`UPDATE playbook_examples SET deleted_at = now() WHERE trade_id = $1`, [cc]);
      expect((await seedPlaybookExamples({ actor: "Cur C." })).added).toBe(0);
    });
  });

  describe("2.12 drawings by ticker", () => {
    it("one set per ticker across days; the backfill merges the per-day rows", async () => {
      const uid = Number((await q(`SELECT id FROM users WHERE name = 'Jun J.'`)).rows[0].id);
      const h = (id: string, p: number) => ({ id, kind: "hline", points: [{ t: 1760621400, p }], label: null, color: null });
      await q(`INSERT INTO chart_drawings (user_id, ticker, day, drawings, updated_at) VALUES
                 ($1, 'INTC', '2026-10-14', $2::jsonb, '2026-10-14T20:00:00Z'), ($1, 'INTC', '2026-10-15', $3::jsonb, '2026-10-15T20:00:00Z')`,
        [uid, JSON.stringify([h("a", 20), h("b", 21)]), JSON.stringify([h("b", 22), h("c", 23)])]);
      await q(SQL_0235);
      const { loadTickerDrawings, saveTickerDrawings } = await import("../chartDrawings");
      const merged = await loadTickerDrawings(uid, "INTC");
      expect(merged.map((d) => [d.id, d.points[0]!.p])).toEqual([["a", 20], ["b", 22], ["c", 23]]);
      await saveTickerDrawings(uid, "INTC", [h("z", 30)] as never);
      expect((await loadTickerDrawings(uid, "INTC")).map((d) => d.id)).toEqual(["z"]);
      await q(SQL_0235); // the ticker set exists: the backfill leaves it alone
      expect((await loadTickerDrawings(uid, "INTC")).map((d) => d.id)).toEqual(["z"]);
      expect(await loadTickerDrawings(uid, "AMD")).toEqual([]);
    });
  });
});
