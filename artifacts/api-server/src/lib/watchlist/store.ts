/**
 * watchlist table access for routes/watchlist.ts (raw SQL: owner / list_name / in_play are not in the drizzle schema).
 * Every list read is scoped by owner (null = the desk list, migration 0233). Nothing is hard-deleted (deleted_at).
 * Rows come back in the API's camelCase shape (the same fields the drizzle select used to send) plus `list`.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";

export type ListName = "today" | "swing" | "watch";
const LISTS = new Set<string>(["today", "swing", "watch"]);

export type WatchRow = {
  id: number; ticker: string; catalyst: string | null; targetPrice: string | null; stopPrice: string | null; status: string;
  notes: string | null; sector: string | null; screenshotUrl: string | null; tags: string | null; score: number | null;
  scoreBreakdown: string | null; scoredAt: Date | null; marketCap: string | null; float: string | null; adv: string | null;
  atr: string | null; relativeVolume: string | null; beta: string | null; shortInterest: string | null; longName: string | null;
  createdBy: string | null; createdAt: Date; deletedAt: Date | null; owner: number | null;
  inPlay: boolean; inPlayAt: string | null; list: ListName;
};

/** Writable content columns: API field → column. */
export const CONTENT_COLUMNS = {
  ticker: "ticker", catalyst: "catalyst", targetPrice: "target_price", stopPrice: "stop_price", status: "status", notes: "notes",
  sector: "sector", tags: "tags", marketCap: "market_cap", float: "float", adv: "adv", atr: "atr", relativeVolume: "relative_volume",
  beta: "beta", shortInterest: "short_interest", longName: "long_name",
} as const;
export type ContentField = keyof typeof CONTENT_COLUMNS;
export type ContentPatch = Partial<Record<ContentField, string | null>>;

const SELECT = `SELECT id, ticker, catalyst, target_price, stop_price, status, notes, sector, screenshot_url, tags, score,
  score_breakdown, scored_at, market_cap, "float", adv, atr, relative_volume, beta, short_interest, long_name, created_by,
  created_at, deleted_at, owner, in_play, in_play_at, list_name FROM watchlist`;

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));

export function toRow(r: Raw): WatchRow {
  const inPlay = !!r.in_play;
  const list = typeof r.list_name === "string" && LISTS.has(r.list_name) ? (r.list_name as ListName) : inPlay ? "today" : "watch";
  return {
    id: Number(r.id), ticker: String(r.ticker), catalyst: s(r.catalyst), targetPrice: s(r.target_price), stopPrice: s(r.stop_price),
    status: String(r.status ?? "watching"), notes: s(r.notes), sector: s(r.sector), screenshotUrl: s(r.screenshot_url), tags: s(r.tags),
    score: r.score == null ? null : Number(r.score), scoreBreakdown: s(r.score_breakdown), scoredAt: (r.scored_at as Date | null) ?? null,
    marketCap: s(r.market_cap), float: s(r.float), adv: s(r.adv), atr: s(r.atr), relativeVolume: s(r.relative_volume), beta: s(r.beta),
    shortInterest: s(r.short_interest), longName: s(r.long_name), createdBy: s(r.created_by), createdAt: r.created_at as Date,
    deletedAt: (r.deleted_at as Date | null) ?? null, owner: r.owner == null ? null : Number(r.owner),
    inPlay, inPlayAt: r.in_play_at ? new Date(r.in_play_at as string).toISOString() : null, list,
  };
}

const ownerClause = (owner: number | null, i: number) => (owner == null ? "owner IS NULL" : `owner = $${i}`);
const ownerParams = (owner: number | null) => (owner == null ? [] : [owner]);

/** Active rows of one list (owner null = desk), best score first. */
export async function listRows(owner: number | null, limit = 2000): Promise<WatchRow[]> {
  const { rows } = await pool.query(
    `${SELECT} WHERE deleted_at IS NULL AND ${ownerClause(owner, 1)} ORDER BY COALESCE(score, -1) DESC, created_at DESC LIMIT ${Math.max(1, Math.min(limit, 2000))}`,
    ownerParams(owner),
  );
  return rows.map(toRow);
}

export async function getRow(id: number, withDeleted = false): Promise<WatchRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1 ${withDeleted ? "" : "AND deleted_at IS NULL"}`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Owner of each row (deleted ones included) — the rights check of every write. */
export async function ownersOf(ids: readonly number[]): Promise<Map<number, number | null>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query<{ id: number; owner: number | null }>(`SELECT id, owner FROM watchlist WHERE id = ANY($1::int[])`, [ids]);
  return new Map(rows.map((r) => [Number(r.id), r.owner == null ? null : Number(r.owner)]));
}

/** Active rows of these tickers in one list (duplicates are per list). */
export async function activeByTickers(tickers: readonly string[], owner: number | null): Promise<{ id: number; ticker: string; status: string }[]> {
  if (!tickers.length) return [];
  const { rows } = await pool.query<{ id: number; ticker: string; status: string }>(
    `SELECT id, ticker, status FROM watchlist WHERE deleted_at IS NULL AND UPPER(ticker) = ANY($1::text[]) AND ${ownerClause(owner, 2)}`,
    [tickers.map((t) => t.toUpperCase()), ...ownerParams(owner)],
  );
  return rows.map((r) => ({ id: Number(r.id), ticker: String(r.ticker), status: String(r.status ?? "") }));
}

export type NewRow = ContentPatch & { ticker: string; status: string; createdBy: string | null; score?: number | null; scoreBreakdown?: string | null; scoredAt?: Date | null };

/** Inserts rows into one list; `list` sets the working list (and «В игре» for today). */
export async function insertRows(values: readonly NewRow[], owner: number | null, list: ListName = "watch"): Promise<WatchRow[]> {
  const out: WatchRow[] = [];
  for (const v of values) {
    const fields = (Object.keys(CONTENT_COLUMNS) as ContentField[]).filter((k) => v[k] !== undefined);
    const cols = [...fields.map((k) => `"${CONTENT_COLUMNS[k]}"`), "created_by", "owner", "list_name", "in_play", "in_play_at", "score", "score_breakdown", "scored_at"];
    const params: unknown[] = [...fields.map((k) => v[k]), v.createdBy, owner, list, list === "today", list === "today" ? new Date() : null, v.score ?? null, v.scoreBreakdown ?? null, v.scoredAt ?? null];
    const { rows } = await pool.query(
      `INSERT INTO watchlist (${cols.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      params,
    );
    const row = await getRow(Number(rows[0].id));
    if (row) out.push(row);
  }
  return out;
}

/** Content columns of one active row; null when it is gone. */
export async function updateContent(id: number, patch: ContentPatch): Promise<WatchRow | null> {
  const fields = (Object.keys(patch) as ContentField[]).filter((k) => k in CONTENT_COLUMNS && patch[k] !== undefined);
  if (fields.length) {
    await pool.query(
      `UPDATE watchlist SET ${fields.map((k, i) => `"${CONTENT_COLUMNS[k]}" = $${i + 2}`).join(", ")} WHERE id = $1 AND deleted_at IS NULL`,
      [id, ...fields.map((k) => patch[k])],
    );
  }
  return getRow(id);
}

export async function setScore(id: number, total: number, breakdown: string): Promise<WatchRow | null> {
  await pool.query(`UPDATE watchlist SET score = $2, score_breakdown = $3, scored_at = NOW() WHERE id = $1`, [id, total, breakdown]);
  return getRow(id);
}

export async function setStatus(ids: readonly number[], status: string): Promise<number> {
  const { rowCount } = await pool.query(`UPDATE watchlist SET status = $1 WHERE id = ANY($2::int[]) AND deleted_at IS NULL`, [status, ids]);
  return rowCount ?? 0;
}

/** Soft delete (true) / restore (false). Returns the ids changed. */
export async function setDeleted(ids: readonly number[], deleted: boolean): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    deleted
      ? `UPDATE watchlist SET deleted_at = NOW() WHERE id = ANY($1::int[]) AND deleted_at IS NULL RETURNING id`
      : `UPDATE watchlist SET deleted_at = NULL WHERE id = ANY($1::int[]) RETURNING id`,
    [ids],
  );
  return rows.map((r) => Number(r.id));
}

/** «В игре» ⇔ list «Сегодня». */
export async function setInPlay(ids: readonly number[], inPlay: boolean): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE watchlist SET in_play = $1, in_play_at = CASE WHEN $1 THEN COALESCE(CASE WHEN in_play THEN in_play_at END, NOW()) ELSE NULL END,
       list_name = CASE WHEN $1 THEN 'today' WHEN list_name IS NULL OR list_name = 'today' THEN 'watch' ELSE list_name END
      WHERE id = ANY($2::int[]) AND deleted_at IS NULL`,
    [inPlay, ids],
  );
  return rowCount ?? 0;
}

export async function setList(ids: readonly number[], list: ListName): Promise<number> {
  if (!ids.length) return 0;
  const { rowCount } = await pool.query(
    `UPDATE watchlist SET list_name = $1, in_play = ($1 = 'today'),
       in_play_at = CASE WHEN $1 = 'today' THEN CASE WHEN in_play THEN in_play_at ELSE NOW() END ELSE NULL END
      WHERE id = ANY($2::int[]) AND deleted_at IS NULL`,
    [list, ids],
  );
  return rowCount ?? 0;
}

/** Rows of one list to rescore, least recently scored first. */
export async function rowsToScore(owner: number | null, limit: number): Promise<{ id: number; ticker: string; catalyst: string | null; sector: string | null }[]> {
  const { rows } = await pool.query(
    `SELECT id, ticker, catalyst, sector FROM watchlist WHERE deleted_at IS NULL AND ${ownerClause(owner, 1)} ORDER BY scored_at ASC NULLS FIRST LIMIT ${Math.max(1, limit)}`,
    ownerParams(owner),
  );
  return rows.map((r) => ({ id: Number(r.id), ticker: String(r.ticker), catalyst: s(r.catalyst), sector: s(r.sector) }));
}

export type TickerStats = {
  ideas: Map<string, { count: number; last: string | null }>;
  /** The viewer's OWN trades per ticker («Торговал», «мои сделки»). */
  trades: Map<string, { count: number; last: string | null }>;
  open: Map<string, { count: number; traders: string[]; ids: number[] }>;
};

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { logger.warn({ err, label }, "watchlist list: stats failed"); return fallback; }
}

/**
 * Cross-links of the list (best effort, never fails it): ideas (desk), the viewer's own trades, open positions — the
 * desk's for staff (`deskOpen`), else only the viewer's own (own trades only, owner rule 2026-10-21).
 */
export async function tickerStats(tickers: readonly string[], trader: string | null, deskOpen = false): Promise<TickerStats> {
  const out: TickerStats = { ideas: new Map(), trades: new Map(), open: new Map() };
  if (!tickers.length) return out;
  await Promise.all([
    deskOpen || trader ? safe("open", async () => {
      const { rows } = await pool.query<{ t: string; c: string; traders: string[] | null; ids: number[] | null }>(
        `SELECT UPPER(ticker) AS t, COUNT(*) AS c, ARRAY_REMOVE(ARRAY_AGG(DISTINCT trader), NULL) AS traders, ARRAY_AGG(id ORDER BY id DESC) AS ids
           FROM trades WHERE deleted_at IS NULL AND LOWER(TRIM(result)) = 'open' AND UPPER(ticker) = ANY($1::text[])
            AND ($2::text IS NULL OR trader = $2) GROUP BY UPPER(ticker)`,
        [tickers, deskOpen ? null : trader],
      );
      for (const r of rows) out.open.set(r.t, { count: Number(r.c) || 0, traders: r.traders ?? [], ids: (r.ids ?? []).slice(0, 5) });
    }, undefined) : Promise.resolve(),
    safe("ideas", async () => {
      const { rows } = await pool.query<{ t: string; c: string; last: Date | null }>(
        `SELECT UPPER(ticker) AS t, COUNT(*) AS c, MAX(created_at) AS last
           FROM trade_ideas WHERE deleted_at IS NULL AND UPPER(ticker) = ANY($1::text[]) GROUP BY UPPER(ticker)`,
        [tickers],
      );
      for (const r of rows) out.ideas.set(r.t, { count: Number(r.c) || 0, last: r.last ? new Date(r.last).toISOString() : null });
    }, undefined),
    trader
      ? safe("trades", async () => {
        const { rows } = await pool.query<{ t: string; c: string; last: string | null }>(
          `SELECT UPPER(ticker) AS t, COUNT(*) AS c, MAX(date) AS last
             FROM trades WHERE deleted_at IS NULL AND trader = $2 AND UPPER(ticker) = ANY($1::text[]) GROUP BY UPPER(ticker)`,
          [tickers, trader],
        );
        for (const r of rows) out.trades.set(r.t, { count: Number(r.c) || 0, last: r.last ?? null });
      }, undefined)
      : Promise.resolve(),
  ]);
  return out;
}
