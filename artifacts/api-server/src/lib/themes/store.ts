/**
 * market_themes (migration 0224) — reads and staff writes. Nothing is deleted: a theme is archived (active = false).
 */
import { pool } from "@workspace/db";

export type ThemeRecord = {
  id: number;
  name: string;
  tickers: string[];
  sortOrder: number;
  active: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

type Row = { id: number; name: string; tickers: string[] | null; sort_order: number; active: boolean; updated_by: string | null; updated_at: Date | string };

const toRecord = (r: Row): ThemeRecord => ({
  id: Number(r.id),
  name: String(r.name),
  tickers: (r.tickers ?? []).map(String),
  sortOrder: Number(r.sort_order),
  active: !!r.active,
  updatedBy: r.updated_by ?? null,
  updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
});

const COLS = "id, name, tickers, sort_order, active, updated_by, updated_at";

/** Active themes (the tracker) or all of them (staff settings), in display order. */
export async function listThemes(includeArchived: boolean): Promise<ThemeRecord[]> {
  const { rows } = await pool.query<Row>(
    `SELECT ${COLS} FROM market_themes ${includeArchived ? "" : "WHERE active"} ORDER BY active DESC, sort_order, id`,
  );
  return rows.map(toRecord);
}

export async function themeById(id: number): Promise<ThemeRecord | null> {
  const { rows } = await pool.query<Row>(`SELECT ${COLS} FROM market_themes WHERE id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export type ThemeInput = { name: string; tickers: string[]; sortOrder?: number; active?: boolean };

/** New theme; without sortOrder it goes last. A duplicate name (any case) → pg 23505 → 409 CONFLICT. */
export async function insertTheme(input: ThemeInput, actor: string): Promise<ThemeRecord> {
  const { rows } = await pool.query<Row>(
    `INSERT INTO market_themes (name, tickers, sort_order, active, updated_by)
     VALUES ($1, $2::text[], COALESCE($3, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM market_themes)), $4, $5)
     RETURNING ${COLS}`,
    [input.name, input.tickers, input.sortOrder ?? null, input.active ?? true, actor],
  );
  return toRecord(rows[0]!);
}

export type ThemePatch = Partial<ThemeInput>;

export async function updateTheme(id: number, patch: ThemePatch, actor: string): Promise<ThemeRecord | null> {
  const { rows } = await pool.query<Row>(
    `UPDATE market_themes SET
       name = COALESCE($2, name),
       tickers = COALESCE($3::text[], tickers),
       sort_order = COALESCE($4, sort_order),
       active = COALESCE($5, active),
       updated_by = $6,
       updated_at = now()
     WHERE id = $1
     RETURNING ${COLS}`,
    [id, patch.name ?? null, patch.tickers ?? null, patch.sortOrder ?? null, patch.active ?? null, actor],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}
