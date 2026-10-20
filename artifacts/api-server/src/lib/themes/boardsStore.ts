/**
 * user_boards (migration 0226) — every query scoped to the owner's user id. Nothing is deleted (active = false).
 * Also: the Finviz ticker snapshot's float for tickers boards (finviz_ticker_snapshot, migration 0223).
 */
import { db } from "./db";
import { normalizeBoardSort, normalizeColumns, type BoardColumn, type BoardKind, type BoardSource, type BoardTop } from "./boards";
import type { ColumnSort } from "./personal";

export type BoardRecord = {
  id: number;
  userId: number;
  name: string;
  kind: BoardKind;
  position: number;
  columns: BoardColumn[];
  sort: ColumnSort<BoardColumn> | null;
  pinned: number[];
  source: BoardSource | null;
  resolvedTickers: string[];
  resolvedAt: number | null;
  active: boolean;
};

type Row = {
  id: number; user_id: number; name: string; kind: BoardKind; position: number; columns: string[] | null; sort: unknown;
  pinned: number[] | null; source: "tickers" | "screener" | null; tickers: string[] | null; filters: string[] | null;
  sort_order: string | null; top_n: number; resolved_tickers: string[] | null; resolved_at: Date | string | null; active: boolean;
};

function sourceOf(r: Row): BoardSource | null {
  if (r.kind !== "tickers" || !r.source) return null;
  if (r.source === "tickers") return { kind: "tickers", tickers: (r.tickers ?? []).map(String) };
  return { kind: "screener", screener: { filters: (r.filters ?? []).map(String), order: r.sort_order ?? null }, top: Number(r.top_n) === 50 ? 50 : 25 };
}

const toRecord = (r: Row): BoardRecord => ({
  id: Number(r.id),
  userId: Number(r.user_id),
  name: String(r.name),
  kind: r.kind,
  position: Number(r.position),
  columns: normalizeColumns(r.kind, r.columns),
  sort: normalizeBoardSort(r.kind, r.sort),
  pinned: (r.pinned ?? []).map(Number),
  source: sourceOf(r),
  resolvedTickers: (r.resolved_tickers ?? []).map(String),
  resolvedAt: r.resolved_at == null ? null : new Date(r.resolved_at).getTime(),
  active: !!r.active,
});

const COLS = "id, user_id, name, kind, position, columns, sort, pinned, source, tickers, filters, sort_order, top_n, resolved_tickers, resolved_at, active";

export async function listBoards(userId: number): Promise<BoardRecord[]> {
  const { rows } = await db().query<Row>(`SELECT ${COLS} FROM user_boards WHERE user_id = $1 AND active ORDER BY position, id`, [userId]);
  return rows.map(toRecord);
}

export async function boardById(userId: number, id: number): Promise<BoardRecord | null> {
  const { rows } = await db().query<Row>(`SELECT ${COLS} FROM user_boards WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function countBoards(userId: number): Promise<number> {
  const { rows } = await db().query<{ n: string }>(`SELECT count(*)::text AS n FROM user_boards WHERE user_id = $1 AND active`, [userId]);
  return Number(rows[0]?.n ?? 0);
}

export type BoardInput = {
  name: string;
  kind: BoardKind;
  columns?: BoardColumn[];
  pinned?: number[];
  source?: BoardSource | null;
};

function sourceParams(source: BoardSource | null | undefined): [string | null, string[], string[], string | null, BoardTop] {
  if (!source) return [null, [], [], null, 25];
  if (source.kind === "tickers") return ["tickers", source.tickers, [], null, 25];
  return ["screener", [], source.screener.filters, source.screener.order, source.top];
}

/** New board at the end of the strip. */
export async function insertBoard(userId: number, input: BoardInput): Promise<BoardRecord> {
  const [source, tickers, filters, order, top] = sourceParams(input.source);
  const { rows } = await db().query<Row>(
    `INSERT INTO user_boards (user_id, name, kind, position, columns, pinned, source, tickers, filters, sort_order, top_n)
     VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM user_boards WHERE user_id = $1 AND active),
             $4::text[], $5::int[], $6, $7::text[], $8::text[], $9, $10)
     RETURNING ${COLS}`,
    [userId, input.name, input.kind, input.columns ?? [], input.pinned ?? [], source, tickers, filters, order, top],
  );
  return toRecord(rows[0]!);
}

export type BoardPatch = {
  name?: string;
  columns?: BoardColumn[];
  sort?: ColumnSort<BoardColumn> | null;
  pinned?: number[];
  source?: BoardSource;
  active?: boolean;
};

/** Changes what the patch names; a new source drops the resolved screener list. */
export async function updateBoard(userId: number, id: number, patch: BoardPatch, current: BoardRecord): Promise<BoardRecord | null> {
  const srcChanged = patch.source !== undefined && JSON.stringify(patch.source) !== JSON.stringify(current.source);
  const [source, tickers, filters, order, top] = sourceParams(patch.source ?? current.source);
  const { rows } = await db().query<Row>(
    `UPDATE user_boards SET name = $3, columns = $4::text[], sort = $5::jsonb, pinned = $6::int[],
       source = $7, tickers = $8::text[], filters = $9::text[], sort_order = $10, top_n = $11,
       resolved_tickers = CASE WHEN $12 THEN '{}'::text[] ELSE resolved_tickers END,
       resolved_at = CASE WHEN $12 THEN NULL ELSE resolved_at END,
       active = $13, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`,
    [
      id, userId, patch.name ?? current.name, patch.columns ?? current.columns,
      JSON.stringify(patch.sort !== undefined ? patch.sort : current.sort), patch.pinned ?? current.pinned,
      current.kind === "tickers" ? source : null, tickers, filters, order, top, srcChanged, patch.active ?? current.active,
    ],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function setPositions(userId: number, order: readonly { id: number; position: number }[]): Promise<void> {
  for (const o of order) {
    await db().query(`UPDATE user_boards SET position = $3 WHERE id = $1 AND user_id = $2`, [o.id, userId, o.position]);
  }
}

// ─── archive / restore (migration 0233: user_themes.archived_with_board) ──────

/** A board being archived archives its active themes with it (they come back with the board). Returns how many. */
export async function archiveBoardThemes(userId: number, boardId: number): Promise<number> {
  const { rowCount } = await db().query(
    `UPDATE user_themes SET active = false, archived_with_board = true, updated_at = now()
      WHERE user_id = $1 AND board_id = $2 AND active`,
    [userId, boardId],
  );
  return rowCount ?? 0;
}

export type ArchivedBoard = { id: number; name: string; kind: BoardKind; themes: number };
export type ArchivedTheme = { id: number; name: string; kind: "tickers" | "screener"; boardId: number; boardName: string };
export const ARCHIVE_LIST_MAX = 50;

/**
 * The owner's «Архив»: archived boards (+ how many themes come back with each) and archived themes sitting on an
 * active board (archived on their own, or left over when the board came back at the theme limit). Newest first.
 */
export async function listArchive(userId: number): Promise<{ boards: ArchivedBoard[]; themes: ArchivedTheme[] }> {
  const [boards, themes] = await Promise.all([
    db().query<{ id: number; name: string; kind: BoardKind; themes: string }>(
      `SELECT b.id, b.name, b.kind,
              (SELECT count(*) FROM user_themes t
                WHERE t.user_id = b.user_id AND t.board_id = b.id AND NOT t.active AND t.archived_with_board)::text AS themes
         FROM user_boards b WHERE b.user_id = $1 AND NOT b.active
        ORDER BY b.updated_at DESC, b.id DESC LIMIT ${ARCHIVE_LIST_MAX}`,
      [userId],
    ),
    db().query<{ id: number; name: string; kind: "tickers" | "screener"; board_id: number; board_name: string }>(
      `SELECT t.id, t.name, t.kind, t.board_id, b.name AS board_name
         FROM user_themes t JOIN user_boards b ON b.id = t.board_id AND b.user_id = t.user_id
        WHERE t.user_id = $1 AND NOT t.active AND b.active
        ORDER BY t.updated_at DESC, t.id DESC LIMIT ${ARCHIVE_LIST_MAX}`,
      [userId],
    ),
  ]);
  return {
    boards: boards.rows.map((r) => ({ id: Number(r.id), name: String(r.name), kind: r.kind, themes: Number(r.themes) })),
    themes: themes.rows.map((r) => ({ id: Number(r.id), name: String(r.name), kind: r.kind, boardId: Number(r.board_id), boardName: String(r.board_name) })),
  };
}

/**
 * Bring an archived board back at the end of the strip with the themes archived with it, as many as the personal
 * limit leaves room for (oldest first; the rest stay in the archive). null: not this user's board.
 */
export async function restoreBoard(userId: number, id: number, maxThemes: number): Promise<{ board: BoardRecord; restored: number; skipped: number } | null> {
  const { rows } = await db().query<Row>(
    `UPDATE user_boards SET active = true, updated_at = now(),
       position = (SELECT COALESCE(MAX(position), -1) + 1 FROM user_boards WHERE user_id = $2 AND active)
     WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`,
    [id, userId],
  );
  if (!rows[0]) return null;
  const back = await db().query(
    `WITH room AS (SELECT GREATEST(0, $3::int - count(*))::int AS n FROM user_themes WHERE user_id = $1 AND active),
          pick AS (SELECT id FROM user_themes WHERE user_id = $1 AND board_id = $2 AND NOT active AND archived_with_board
                    ORDER BY id LIMIT (SELECT n FROM room))
     UPDATE user_themes t SET active = true, archived_with_board = false, updated_at = now()
       FROM pick WHERE t.id = pick.id`,
    [userId, id, maxThemes],
  );
  const left = await db().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM user_themes WHERE user_id = $1 AND board_id = $2 AND NOT active AND archived_with_board`,
    [userId, id],
  );
  return { board: toRecord(rows[0]), restored: back.rowCount ?? 0, skipped: Number(left.rows[0]?.n ?? 0) };
}

export async function saveBoardResolved(id: number, tickers: string[], at: number): Promise<void> {
  await db().query(`UPDATE user_boards SET resolved_tickers = $2::text[], resolved_at = $3 WHERE id = $1`, [id, tickers, new Date(at)]);
}

/** Float (shares) from the Finviz ticker snapshot, for tickers the quote provider sent without one. */
export async function floatsFor(tickers: readonly string[]): Promise<Map<string, number>> {
  if (!tickers.length) return new Map();
  const { rows } = await db()
    .query<{ ticker: string; float_shares: string | number | null }>(
      `SELECT ticker, float_shares FROM finviz_ticker_snapshot WHERE ticker = ANY($1::text[]) AND float_shares IS NOT NULL`,
      [tickers],
    )
    .catch(() => ({ rows: [] as { ticker: string; float_shares: string | number | null }[] }));
  return new Map(rows.map((r) => [String(r.ticker), Number(r.float_shares)]));
}
