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
