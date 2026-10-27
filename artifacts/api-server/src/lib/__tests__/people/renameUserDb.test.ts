/**
 * Cascading rename (lib/people/renameUser) on a scratch Postgres built from every repository migration:
 *  - the classification guard on the real information_schema (a new name-keyed column fails here until classified);
 *  - a dry run counts and writes nothing; refusals (name / Latin name taken, rows already under the new name, bad
 *    name) write nothing;
 *  - the real rename moves text keys (incl. unique / primary keys), json values and keys, text[] elements, ':'-joined
 *    keys, link parameters and the pilot-users list; prose and the audit history stay; one «user.rename» audit entry;
 *    the token version is bumped once. Skipped when the local Postgres is down.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrationFiles } from "../../../db/runner";
import { createScratchDb, pgAvailable } from "../../../db/__tests__/scratchDb";
import { formerNamesOf, RenameError, renameInJson, renameInLink, renameInNameList, renameUser } from "../../people/renameUser";
import { RENAME_TARGETS, staleEntries, unclassifiedColumns, type RenameTarget, type SchemaColumn } from "../../people/renameUserColumns";

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// Names as the desk stores them (Cyrillic), written as escapes: no Cyrillic literals in code.
const OLD = "Закир"; // the owner's stored name
const CURATOR = "Ольга"; // a curator
const NEW = "Zakir Iskhakov";

describe("rename helpers", () => {
  it("json: exact string values and object keys at any depth, nothing else", () => {
    const r = renameInJson({ trader: OLD, list: [OLD, `${OLD} X`], nested: { [OLD]: 3, by: { name: OLD } }, n: 1 }, OLD, NEW);
    expect(r.changed).toBe(true);
    expect(r.value).toEqual({ trader: NEW, list: [NEW, `${OLD} X`], nested: { [NEW]: 3, by: { name: NEW } }, n: 1 });
    expect(renameInJson({ trader: "other" }, OLD, NEW)).toEqual({ value: { trader: "other" }, changed: false });
  });
  it("link: a query parameter equal to the name, in either encoding; the path and other parameters stay", () => {
    expect(renameInLink(`/risk?trader=${encodeURIComponent(OLD)}`, OLD, NEW)).toBe("/risk?trader=Zakir+Iskhakov");
    expect(renameInLink(`/weekly-review?${new URLSearchParams({ trader: OLD, week: "2026-W43" })}#top`, OLD, NEW)).toBe("/weekly-review?trader=Zakir+Iskhakov&week=2026-W43#top");
    expect(renameInLink(`/curator?trader=${encodeURIComponent(CURATOR)}&tab=risk`, OLD, NEW)).toBe(`/curator?trader=${encodeURIComponent(CURATOR)}&tab=risk`);
    expect(renameInLink("/risk", OLD, NEW)).toBe("/risk");
  });
  it("name list: case-insensitive entries, separators and spacing kept", () => {
    expect(renameInNameList(`${CURATOR}, ${OLD.toUpperCase()};\n zakirx`, OLD, NEW)).toBe(`${CURATOR}, ${NEW};\n zakirx`);
  });
});

describe.skipIf(!available)("renameUser on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let ownerId = 0;
  const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows as any[];
  const targets: RenameTarget[] = [...RENAME_TARGETS, { table: "zz_people", column: "names", kind: "array" }];
  const snapshot = async () => ({
    users: await q(`SELECT id, name, name_latin, assigned_curator, token_version FROM users ORDER BY id`),
    trades: await q(`SELECT trader, count(*)::int AS n FROM trades GROUP BY trader ORDER BY trader`),
    notif: await q(`SELECT user_name, actor, params, link, entity_id, message FROM notifications ORDER BY id`),
    audit: await q(`SELECT actor, action FROM audit_log ORDER BY id`),
  });

  beforeAll(async () => {
    db = await createScratchDb("rename");
    await runMigrationFiles({ pool: db.pool, logger: silent });
    const ins = async (name: string, role: string, extra: Record<string, unknown> = {}) =>
      Number((await q(`INSERT INTO users (name, role, name_latin, assigned_curator) VALUES ($1, $2, $3, $4) RETURNING id`, [name, role, extra.latin ?? null, extra.curator ?? null]))[0].id);
    ownerId = await ins(OLD, "admin", { latin: "Zakir" });
    await ins(CURATOR, "curator", { latin: "Olga N." });
    await ins("chert", "trader", { curator: OLD });
    await db.pool.query(`
      INSERT INTO trades (ticker, date, result, trader) VALUES ('TSLA', '2026-10-20', 'win', $1), ('AAPL', '2026-10-21', 'loss', $1), ('MSFT', '2026-10-21', 'win', 'chert');
      INSERT INTO journal_days (trader, day) VALUES ($1, '2026-10-20'), ($1, '2026-10-21'), ('chert', '2026-10-20');
      INSERT INTO academy_trader_stage (user_name, stage, since) VALUES ($1, 'junior', '2026-09-01');
      INSERT INTO gamification_season_points (season, trader) VALUES ('2026-10', $1);
      INSERT INTO trader_risk_limits (trader, updated_by) VALUES ($1, $1);
      INSERT INTO notifications (user_name, type, message, actor, params, link, entity_id) VALUES
        ($1, 'risk_breach', $1 || ': limit', $2, jsonb_build_object('trader', $1, 'who', jsonb_build_object('users', jsonb_build_array($1, 'chert'))), '/risk?trader=' || $3, $1 || ':2026-10-19'),
        ($2, 'mention', 'hi @' || $1, $1, NULL, '/academy/mentor?student=' || $3 || '&tab=plan', $1 || ':2026-10-19:repeat');
      INSERT INTO notification_dedup (key) VALUES ('risk:risk_breach:' || $1 || ':2026-10-19');
      INSERT INTO audit_log (actor, action, details) VALUES ($1, 'user.update', '{"note":"history"}');
      INSERT INTO playbook (name, trader, shared_with) VALUES ('Gap', $1, jsonb_build_object('users', jsonb_build_array($1), 'cohorts', jsonb_build_array(1)));
      INSERT INTO app_settings (key, value) VALUES ('usage.pilotUsers', to_jsonb($2 || ', ' || $1));
      CREATE TABLE zz_people (id serial PRIMARY KEY, names text[]);
      INSERT INTO zz_people (names) VALUES (ARRAY[$1, 'chert']);
    `.replaceAll("$1", `'${OLD}'`).replaceAll("$2", `'${CURATOR}'`).replaceAll("$3", `'${encodeURIComponent(OLD)}'`));
  }, 300_000);
  afterAll(async () => { await db?.drop(); });

  it("guard: every person / json / text[] column of the migrated schema is classified, no stale entry", async () => {
    const rows = await q(`SELECT c.table_name, c.column_name, c.data_type, c.udt_name FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name) WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'zz_people'`);
    const schema: SchemaColumn[] = rows.map((r) => ({
      table: r.table_name,
      column: r.column_name,
      type: r.data_type === "json" || r.data_type === "jsonb" ? "json"
        : r.data_type === "ARRAY" ? (["_text", "_varchar"].includes(r.udt_name) ? "array" : "other")
        : r.data_type === "text" || r.data_type === "character varying" ? "text" : "other",
    }));
    expect(unclassifiedColumns(schema)).toEqual([]);
    expect(staleEntries(schema)).toEqual([]);
  });

  it("dry run: exact counts, nothing written", async () => {
    const before = await snapshot();
    const r = await renameUser(db.pool, { userId: ownerId, newName: NEW, nameLatin: NEW, actor: "test", dryRun: true, targets });
    expect(r).toMatchObject({ from: OLD, to: NEW, dryRun: true, nameLatin: { from: "Zakir", to: NEW } });
    const by = Object.fromEntries(r.counts.map((c) => [`${c.table}.${c.column}`, c.rows]));
    expect(by).toMatchObject({ "trades.trader": 2, "journal_days.trader": 2, "notifications.user_name": 1, "notifications.actor": 1, "notifications.params": 1, "notifications.link": 2, "notifications.entity_id": 2, "notification_dedup.key": 1, "users.assigned_curator": 1, "app_settings.value": 1, "zz_people.names": 1, "playbook.shared_with": 1 });
    expect(by["audit_log.actor"]).toBeUndefined();
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a taken name (case / Latin name, like the sign-in), rows already under the new name, a bad name", async () => {
    const before = await snapshot();
    const fail = (newName: string) => renameUser(db.pool, { userId: ownerId, newName, actor: "test", targets }).then(() => null, (e: RenameError) => e.code);
    expect(await fail(CURATOR.toUpperCase())).toBe("USER_NAME_TAKEN");
    expect(await fail("  olga  n. ")).toBe("USER_NAME_TAKEN");
    expect(await fail("   ")).toBe("INVALID_FIELD");
    expect(await fail("x".repeat(101))).toBe("INVALID_FIELD");
    await q(`INSERT INTO trades (ticker, date, result, trader) VALUES ('NVDA', '2026-10-22', 'win', 'Ghost')`);
    await expect(renameUser(db.pool, { userId: ownerId, newName: "Ghost", actor: "test", targets })).rejects.toMatchObject({ code: "RENAME_DATA_CONFLICT", details: { rows: { "trades.trader": 1 } } });
    await q(`DELETE FROM trades WHERE trader = 'Ghost'`);
    expect(await snapshot()).toEqual(before);
  });

  it("renames every reference in one go; prose and audit history stay; one audit entry; token version +1", async () => {
    const tv = Number((await q(`SELECT token_version FROM users WHERE id = $1`, [ownerId]))[0].token_version);
    const r = await renameUser(db.pool, { userId: ownerId, newName: ` ${NEW} `, nameLatin: NEW, actor: OLD, targets });
    expect(r.to).toBe(NEW);
    expect(await q(`SELECT name, name_latin, token_version FROM users WHERE id = $1`, [ownerId])).toEqual([{ name: NEW, name_latin: NEW, token_version: tv + 1 }]);
    expect(await q(`SELECT assigned_curator FROM users WHERE name = 'chert'`)).toEqual([{ assigned_curator: NEW }]);
    expect(await q(`SELECT trader, count(*)::int AS n FROM trades GROUP BY trader ORDER BY trader`)).toEqual([{ trader: NEW, n: 2 }, { trader: "chert", n: 1 }]);
    expect((await q(`SELECT trader FROM journal_days ORDER BY trader, day`)).map((x) => x.trader)).toEqual([NEW, NEW, "chert"]);
    expect(await q(`SELECT user_name FROM academy_trader_stage`)).toEqual([{ user_name: NEW }]);
    expect(await q(`SELECT trader, updated_by FROM trader_risk_limits`)).toEqual([{ trader: NEW, updated_by: NEW }]);
    expect(await q(`SELECT trader FROM gamification_season_points`)).toEqual([{ trader: NEW }]);
    const n = await q(`SELECT user_name, actor, params, link, entity_id, message FROM notifications ORDER BY id`);
    expect(n[0]).toEqual({ user_name: NEW, actor: CURATOR, params: { trader: NEW, who: { users: [NEW, "chert"] } }, link: "/risk?trader=Zakir+Iskhakov", entity_id: `${NEW}:2026-10-19`, message: `${OLD}: limit` });
    expect(n[1]).toMatchObject({ user_name: CURATOR, actor: NEW, link: "/academy/mentor?student=Zakir+Iskhakov&tab=plan", entity_id: `${NEW}:2026-10-19:repeat`, message: `hi @${OLD}` });
    expect(await q(`SELECT key FROM notification_dedup`)).toEqual([{ key: `risk:risk_breach:${NEW}:2026-10-19` }]);
    expect(await q(`SELECT trader, shared_with FROM playbook`)).toEqual([{ trader: NEW, shared_with: { users: [NEW], cohorts: [1] } }]);
    expect(await q(`SELECT value FROM app_settings WHERE key = 'usage.pilotUsers'`)).toEqual([{ value: `${CURATOR}, ${NEW}` }]);
    expect(await q(`SELECT names FROM zz_people`)).toEqual([{ names: [NEW, "chert"] }]);
    const audit = await q(`SELECT actor, action, target_id, details FROM audit_log ORDER BY id`);
    expect(audit[0]).toMatchObject({ actor: OLD, action: "user.update" });
    expect(audit[1]).toMatchObject({ actor: OLD, action: "user.rename", target_id: String(ownerId) });
    expect(JSON.parse(audit[1].details)).toMatchObject({ from: OLD, to: NEW, rows: r.total, tables: { "trades.trader": 2 }, nameLatin: { from: "Zakir", to: NEW } });
    expect(await q(`SELECT count(*)::int AS n FROM trades WHERE trader = $1`, [OLD])).toEqual([{ n: 0 }]);
    // The sign-in tells the browser the earlier name (its name-keyed storage moves along).
    expect(await formerNamesOf(db.pool, ownerId)).toEqual([OLD]);
  });
});
