/**
 * Волна 1 people (1.21 ladder without «Стажёр», 1.1 limits by level, 1.19 desk groups) on a scratch Postgres built from
 * the repository migrations. Up to 0228 first, with «trainee» rows the way the desk had them, then 0229–0231:
 *  - 0229 moves every stored «trainee» to junior (stage, enrolment, programme, risk tier), archives its criteria,
 *    withdraws its pending request, deactivates the scaling tier, adds trader_risk_limits.buying_power;
 *  - 0230 curator_requests: one open request per trader and kind;
 *  - 0231 desk_groups: one group per curator who has assigned traders, the traders moved in;
 *  - the stage default limits fill a trader without limits only; the groups store moves / re-curates / archives and
 *    feeds «my people». Skipped when the local Postgres is down.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveMigrationsDir, runMigrationFiles } from "../../../db/runner";
import { createScratchDb, pgAvailable } from "../../../db/__tests__/scratchDb";
import { applyStageDefaultLimits, buyingPowerProblem } from "../../people/stageLimits";
import { groupMembersOf, loadDeskGroups, moveTrader, myPeople, pickScope, updateGroup } from "../../people/deskGroups";
import { DEFAULT_TIERS } from "../../scalingSeed";

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("people (Волна 1) on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let before = "";
  const ids: Record<string, number> = {};
  const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows as any[];

  beforeAll(async () => {
    db = await createScratchDb("people");
    const all = resolveMigrationsDir();
    before = mkdtempSync(path.join(os.tmpdir(), "people-mig-"));
    for (const f of readdirSync(all)) if (f.endsWith(".sql") && f < "0229") cpSync(path.join(all, f), path.join(before, f));
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: before });
    for (const [name, role, curator] of [
      ["Ольга Н.", "curator", null], ["Закир", "admin", null], ["Олег Е.", "trader", "Ольга Н."], ["Умид", "trader", "Ольга Н."], ["chert", "trader", null],
    ] as const) {
      const rows = await q(`INSERT INTO users (name, role, assigned_curator) VALUES ($1, $2, $3) RETURNING id`, [name, role, curator]);
      ids[name] = Number(rows[0].id);
    }
    // Academy tables are created by their routes on first use; here the minimal shape the desk had before 0229.
    await db.pool.query(`
      CREATE TABLE academy_trader_stage (user_name text PRIMARY KEY, stage text NOT NULL, since text NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE academy_enrollments (id serial PRIMARY KEY, cohort_id int, user_name text, stage text NOT NULL DEFAULT 'trainee', status text, joined_on date, archived_at timestamptz);
      CREATE TABLE academy_programs (id serial PRIMARY KEY, stage text);
      CREATE TABLE academy_stage_criteria (id serial PRIMARY KEY, from_stage text NOT NULL, metric text, enabled boolean DEFAULT true, updated_by text, updated_at timestamptz DEFAULT now(), archived_at timestamptz);
      CREATE TABLE academy_promotion_requests (id serial PRIMARY KEY, user_name text, from_stage text, to_stage text, status text, decided_by text, decided_at timestamptz);
      CREATE TABLE trader_risk_limit_events (id serial PRIMARY KEY, trader text NOT NULL, before jsonb, after jsonb NOT NULL, reason text, changed_by text, changed_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO academy_trader_stage (user_name, stage, since) VALUES ('Олег Е.', 'trainee', '2026-09-01');
      INSERT INTO academy_enrollments (cohort_id, user_name, stage, status) VALUES (1, 'Умид', 'trainee', 'active');
      INSERT INTO academy_programs (stage) VALUES ('trainee'), ('trader');
      INSERT INTO academy_stage_criteria (from_stage, metric) VALUES ('trainee', 'net_pnl'), ('junior', 'net_pnl');
      INSERT INTO academy_promotion_requests (user_name, from_stage, to_stage, status) VALUES ('Олег Е.', 'trainee', 'junior', 'pending');
      INSERT INTO trader_risk_limits (trader, tier) VALUES ('Олег Е.', 'trainee');
      INSERT INTO trader_risk_limits (trader, tier, daily_loss_limit) VALUES ('Умид', 'junior', 111);
      INSERT INTO scaling_tiers (key, name, sort_order) VALUES ('trainee', 'Стажёр', 1), ('junior', 'Джун', 2);
    `);
    await runMigrationFiles({ pool: db.pool, logger: silent });
  }, 180_000);
  afterAll(async () => {
    await db?.drop();
    if (before) rmSync(before, { recursive: true, force: true });
  });

  it("0229: every stored «trainee» is a junior now; criteria archived, request withdrawn, tier template off; nothing deleted", async () => {
    expect(await q(`SELECT stage FROM academy_trader_stage`)).toEqual([{ stage: "junior" }]);
    expect(await q(`SELECT stage FROM academy_enrollments`)).toEqual([{ stage: "junior" }]);
    expect((await q(`SELECT stage FROM academy_programs ORDER BY id`)).map((r) => r.stage)).toEqual(["junior", "trader"]);
    expect((await q(`SELECT tier FROM trader_risk_limits WHERE trader = 'Олег Е.'`))[0].tier).toBe("junior");
    const crit = await q(`SELECT from_stage, archived_at IS NOT NULL AS archived FROM academy_stage_criteria ORDER BY id`);
    expect(crit).toEqual([{ from_stage: "trainee", archived: true }, { from_stage: "junior", archived: false }]);
    expect((await q(`SELECT status FROM academy_promotion_requests`))[0].status).toBe("withdrawn");
    expect(await q(`SELECT key, active FROM scaling_tiers ORDER BY key`)).toEqual([{ key: "junior", active: true }, { key: "trainee", active: false }]);
    expect((await q(`SELECT column_default FROM information_schema.columns WHERE table_name = 'academy_enrollments' AND column_name = 'stage'`))[0].column_default).toContain("junior");
    await db.pool.query(`UPDATE trader_risk_limits SET buying_power = 250000 WHERE trader = 'Умид'`);
    await expect(db.pool.query(`UPDATE trader_risk_limits SET buying_power = -1 WHERE trader = 'Умид'`)).rejects.toThrow();
  });

  it("1.21 BP rule: junior 25 000 – 800 000, above junior no cap", () => {
    expect(buyingPowerProblem(250_000, "junior")).toBeNull();
    expect(buyingPowerProblem(900_000, "junior")).toEqual({ min: 25_000, max: 800_000 });
    expect(buyingPowerProblem(10_000, "junior")).toEqual({ min: 25_000, max: 800_000 });
    expect(buyingPowerProblem(2_000_000, "senior")).toBeNull();
    expect(buyingPowerProblem(10_000, "trader")).toEqual({ min: 25_000, max: null });
    expect(buyingPowerProblem(null, "junior")).toBeNull();
  });

  it("1.1 stage defaults: a trader with only a tier gets the template; existing limits are never overwritten", async () => {
    const c = await db.pool.connect();
    try {
      // Олег Е.: tier row only (syncRiskTier) → the junior template + a change-log row.
      expect(await applyStageDefaultLimits(c, "Олег Е.", "junior", "Закир", DEFAULT_TIERS, "шаблон")).toBe(true);
      const junior = DEFAULT_TIERS.find((t) => t.key === "junior")!;
      const [o] = await q(`SELECT daily_loss_limit, max_drawdown, max_open_positions, allow_overnight FROM trader_risk_limits WHERE trader = 'Олег Е.'`);
      expect({ d: Number(o.daily_loss_limit), dd: Number(o.max_drawdown), n: o.max_open_positions, ov: o.allow_overnight })
        .toEqual({ d: junior.dailyLossLimit, dd: junior.maxDrawdown, n: junior.maxOpenPositions, ov: junior.allowOvernight });
      expect((await q(`SELECT reason, changed_by FROM trader_risk_limit_events WHERE trader = 'Олег Е.'`))).toEqual([{ reason: "шаблон", changed_by: "Закир" }]);
      // Умид has his own daily limit → untouched (and a second run for Олег changes nothing).
      expect(await applyStageDefaultLimits(c, "Умид", "junior", "Закир", DEFAULT_TIERS, "шаблон")).toBe(false);
      expect(Number((await q(`SELECT daily_loss_limit FROM trader_risk_limits WHERE trader = 'Умид'`))[0].daily_loss_limit)).toBe(111);
      expect(await applyStageDefaultLimits(c, "Олег Е.", "junior", "Закир", DEFAULT_TIERS, "шаблон")).toBe(false);
    } finally {
      c.release();
    }
  });

  it("0230: one open request per trader and kind; closed ones stay", async () => {
    await db.pool.query(`INSERT INTO curator_requests (trader_id, kind) VALUES ($1, 'limits')`, [ids["chert"]]);
    await expect(db.pool.query(`INSERT INTO curator_requests (trader_id, kind) VALUES ($1, 'limits')`, [ids["chert"]])).rejects.toMatchObject({ code: "23505" });
    await db.pool.query(`UPDATE curator_requests SET status = 'done', resolved_at = now() WHERE trader_id = $1`, [ids["chert"]]);
    await db.pool.query(`INSERT INTO curator_requests (trader_id, kind) VALUES ($1, 'limits')`, [ids["chert"]]);
    expect((await q(`SELECT status FROM curator_requests ORDER BY id`)).map((r) => r.status)).toEqual(["done", "open"]);
    await expect(db.pool.query(`INSERT INTO curator_requests (trader_id, kind) VALUES ($1, 'money')`, [ids["chert"]])).rejects.toThrow();
  });

  it("0231: a group per curator with assigned traders, traders moved in; «my people» = group + assignments", async () => {
    const state = await loadDeskGroups(db.pool);
    expect(state.groups.map((g) => [g.name, g.curatorName, g.members.map((m) => m.name)])).toEqual([["Группа Ольга Н.", "Ольга Н.", ["Олег Е.", "Умид"]]]);
    expect(state.ungrouped.map((m) => m.name)).toEqual(["chert"]);
    expect(state.curators.map((m) => m.name).sort()).toEqual(["Закир", "Ольга Н."]);
    expect(await groupMembersOf("Ольга Н.", db.pool)).toEqual(["Олег Е.", "Умид"]);
    expect(await groupMembersOf("Закир", db.pool)).toEqual([]);
  });

  it("store: move a trader (his curator follows), a new group curator re-assigns its traders, archive releases them", async () => {
    const [g] = (await loadDeskGroups(db.pool)).groups;
    expect(await moveTrader(ids["chert"]!, g!.id, db.pool)).toEqual({ name: "chert", from: null });
    expect((await q(`SELECT assigned_curator FROM users WHERE name = 'chert'`))[0].assigned_curator).toBe("Ольга Н.");
    expect(await myPeople("Ольга Н.", db.pool)).toEqual(["Олег Е.", "Умид", "chert"]); // RU order
    expect(await moveTrader(ids["Закир"]!, g!.id, db.pool)).toBeNull(); // only active traders move

    await updateGroup(g!.id, { name: "Утро", curator: { id: ids["Закир"]!, name: "Закир" } }, db.pool);
    expect(await groupMembersOf("Закир", db.pool)).toEqual(["chert", "Олег Е.", "Умид"]);
    expect((await q(`SELECT DISTINCT assigned_curator FROM users WHERE group_id = $1`, [g!.id])).map((r) => r.assigned_curator)).toEqual(["Закир"]);
    expect((await loadDeskGroups(db.pool)).groups[0]!.name).toBe("Утро");

    await updateGroup(g!.id, { archived: true }, db.pool);
    const after = await loadDeskGroups(db.pool);
    expect(after.groups).toEqual([]);
    expect(after.ungrouped.map((m) => m.name)).toEqual(["chert", "Олег Е.", "Умид"]);
    expect((await q(`SELECT count(*)::int AS n FROM desk_groups`))[0].n).toBe(1); // archived, not deleted
  });

  it("«Моя группа / Все»: default = my group when I lead anyone, else everyone; old mine / desk values still work", () => {
    expect(pickScope(undefined, ["a"])).toEqual({ scope: "group", names: new Set(["a"]) });
    expect(pickScope(undefined, [])).toEqual({ scope: "all", names: null });
    expect(pickScope("all", ["a"])).toEqual({ scope: "all", names: null });
    expect(pickScope("desk", ["a"]).scope).toBe("all");
    expect(pickScope("mine", []).scope).toBe("group");
  });
});
