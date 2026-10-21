/**
 * Boards on a scratch Postgres built from the repository migrations: 0226 moves the existing personal themes (0225)
 * into one default «Мои темы» board per owner (named in his language), keeps archived rows, leaves other users alone;
 * the board store creates / renames / reorders / archives, scoped to the owner; 0233's «archived with the board» themes
 * come back with it up to the limit. Skipped when the local Postgres is down.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveMigrationsDir, runMigrationFiles } from "../../../db/runner";
import { createScratchDb, pgAvailable } from "../../../db/__tests__/scratchDb";
import { setThemesDb } from "../../themes/db";
import {
  archiveBoardThemes, boardById, countBoards, insertBoard, listArchive, listBoards, restoreBoard, setPositions, updateBoard,
} from "../../themes/boardsStore";
import { countPersonal, insertPersonal, listPersonalOnBoard, personalById, updatePersonal } from "../../themes/personalStore";
import { movePositions } from "../../themes/boards";

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("boards on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let restore: () => void;
  let before0226 = "";
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    db = await createScratchDb("boards");
    // Migrate up to 0225 first, seed personal themes the way 0225 left them, then apply 0226.
    const all = resolveMigrationsDir();
    before0226 = mkdtempSync(path.join(os.tmpdir(), "boards-mig-"));
    for (const f of readdirSync(all)) if (f.endsWith(".sql") && f < "0226") cpSync(path.join(all, f), path.join(before0226, f));
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: before0226 });
    for (const [name, locale] of [["Ru Trader", "ru"], ["En Trader", "en"], ["No Themes", "ru"]] as const) {
      const { rows } = await db.pool.query(`INSERT INTO users (name, role, locale) VALUES ($1, 'trader', $2) RETURNING id`, [name, locale]);
      ids[name] = Number(rows[0].id);
    }
    await db.pool.query(
      `INSERT INTO user_themes (user_id, name, kind, tickers, active) VALUES
         ($1, 'Chips', 'tickers', '{MU,WDC}', true), ($1, 'Old', 'tickers', '{AMD}', false), ($2, 'Ships', 'tickers', '{ZIM}', true)`,
      [ids["Ru Trader"], ids["En Trader"]],
    );
    await runMigrationFiles({ pool: db.pool, logger: silent });
    restore = setThemesDb(db.pool);
  }, 180_000);
  afterAll(async () => {
    restore?.();
    await db?.drop();
    if (before0226) rmSync(before0226, { recursive: true, force: true });
  });

  it("0226: one default themes board per owner, in his language; every theme (archived too) moved onto it", async () => {
    const ru = await listBoards(ids["Ru Trader"]!);
    const en = await listBoards(ids["En Trader"]!);
    expect(ru.map((b) => [b.name, b.kind, b.position])).toEqual([["Мои темы", "themes", 0]]);
    expect(en.map((b) => b.name)).toEqual(["My themes"]);
    expect(await listBoards(ids["No Themes"]!)).toEqual([]);
    expect((await listPersonalOnBoard(ids["Ru Trader"]!, ru[0]!.id)).map((t) => t.name)).toEqual(["Chips"]);
    const { rows } = await db.pool.query(`SELECT name, board_id FROM user_themes WHERE user_id = $1 ORDER BY name`, [ids["Ru Trader"]]);
    expect(rows.map((r: { name: string; board_id: number }) => [r.name, r.board_id])).toEqual([["Chips", ru[0]!.id], ["Old", ru[0]!.id]]);
  });

  it("create / rename / columns / sort / reorder / archive, owner only", async () => {
    const me = ids["No Themes"]!;
    const a = await insertBoard(me, { name: "Chips", kind: "tickers", source: { kind: "tickers", tickers: ["NVDA", "AMD"] }, columns: ["today", "rvol"] });
    const b = await insertBoard(me, { name: "Energy", kind: "tickers", source: { kind: "screener", screener: { filters: ["sec_energy"], order: null }, top: 50 } });
    const c = await insertBoard(me, { name: "Watch", kind: "themes", pinned: [3, 1] });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
    expect(b.source).toEqual({ kind: "screener", screener: { filters: ["sec_energy"], order: null }, top: 50 });
    expect(c).toMatchObject({ pinned: [3, 1], source: null, columns: ["premarket", "fromOpen", "today", "afterHours"] });
    expect(await countBoards(me)).toBe(3);
    expect(await boardById(ids["Ru Trader"]!, a.id)).toBeNull();

    const renamed = await updateBoard(me, a.id, { name: "Semis", sort: { col: "rvol", dir: "desc" } }, a);
    expect(renamed).toMatchObject({ name: "Semis", sort: { col: "rvol", dir: "desc" }, columns: ["today", "rvol"] });
    expect(await updateBoard(ids["Ru Trader"]!, a.id, { name: "Hijack" }, a)).toBeNull();

    await setPositions(me, movePositions(await listBoards(me), c.id, "left"));
    expect((await listBoards(me)).map((x) => x.name)).toEqual(["Semis", "Watch", "Energy"]);

    await updateBoard(me, b.id, { active: false }, b);
    expect((await listBoards(me)).map((x) => x.name)).toEqual(["Semis", "Watch"]);
    expect(await countBoards(me)).toBe(2);
    expect((await boardById(me, b.id))!.active).toBe(false);
  });

  it("0233: an archived board takes its themes along; restore brings them back up to the limit; «Архив» lists the rest", async () => {
    const me = ids["En Trader"]!;
    const other = ids["Ru Trader"]!;
    const board = await insertBoard(me, { name: "Shipping", kind: "themes" });
    const mk = (name: string) => insertPersonal(me, { name, kind: "tickers", tickers: ["ZIM"], screener: null, boardId: board.id });
    const [a, b, c] = [await mk("A"), await mk("B"), await mk("C")];
    await mk("D");
    const solo = await mk("Solo");
    expect((await updatePersonal(me, solo.id, { active: false }, solo))!.active).toBe(false); // archived on its own
    const activeBefore = await countPersonal(me);

    expect(await archiveBoardThemes(other, board.id)).toBe(0); // owner-scoped
    await updateBoard(me, board.id, { active: false }, board);
    expect(await archiveBoardThemes(me, board.id)).toBe(4); // A, B, C, D
    expect(await countPersonal(me)).toBe(activeBefore - 4);
    const arch = await listArchive(me);
    expect(arch.boards).toContainEqual({ id: board.id, name: "Shipping", kind: "themes", themes: 4 });
    expect(arch.themes.some((t) => t.boardId === board.id)).toBe(false); // its board is archived: they come back with it
    expect((await listArchive(other)).boards.some((x) => x.id === board.id)).toBe(false);

    expect(await restoreBoard(other, board.id, 10)).toBeNull();
    const room = (await countPersonal(me)) + 2; // room for two
    const back = await restoreBoard(me, board.id, room);
    expect(back).toMatchObject({ restored: 2, skipped: 2, board: { active: true } });
    expect(back!.board.position).toBe(Math.max(...(await listBoards(me)).map((x) => x.position)));
    expect((await listPersonalOnBoard(me, board.id)).map((t) => t.name)).toEqual([a.name, b.name]);
    // The skipped ones and the theme archived on its own are in the «Архив» list of themes, on the active board.
    const left = (await listArchive(me)).themes.filter((t) => t.boardId === board.id).map((t) => t.name).sort();
    expect(left).toEqual(["C", "D", "Solo"]);
    const { rows } = await db.pool.query(`SELECT name, archived_with_board AS w FROM user_themes WHERE board_id = $1 ORDER BY name`, [board.id]);
    expect(rows.map((r: { name: string; w: boolean }) => [r.name, r.w])).toEqual([["A", false], ["B", false], ["C", true], ["D", true], ["Solo", false]]);
    // Activating one clears the flag.
    const cRec = (await personalById(me, c.id))!;
    expect((await updatePersonal(me, c.id, { active: true }, cRec))!.active).toBe(true);
    const { rows: cRow } = await db.pool.query(`SELECT archived_with_board AS w FROM user_themes WHERE id = $1`, [c.id]);
    expect(cRow[0].w).toBe(false);
  });
});
