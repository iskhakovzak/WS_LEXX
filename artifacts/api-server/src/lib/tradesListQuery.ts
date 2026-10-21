/**
 * Rows of the plain list GET /api/trades (routes/trades.ts builds the WHERE and the cap, lib/tradesListWindow).
 *
 *   full  every column, the broker snapshot as stored;
 *   lite  the snapshot cut to the two keys the web reads from a list row, { openedAt, closedAt } (null when neither is
 *         there). The cut is made AFTER the sort and the cap (a subquery): written in the same SELECT, Postgres builds it
 *         before the sort, i.e. detoasts the snapshot of every matching row — a 280-day desk window on 45k trades took
 *         518 ms that way and 143 ms this way (performance review 2026-10-21).
 * Newest first by trade date (date desc, id desc), as before.
 */
import { desc, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db as defaultDb, tradesTable } from "@workspace/db";

type TradeRow = typeof tradesTable.$inferSelect;
type Db = Pick<typeof defaultDb, "select">;

export async function selectTradesList(where: SQL | undefined, limit: number, lite: boolean, d: Db = defaultDb): Promise<TradeRow[]> {
  const columns = getTableColumns(tradesTable); // read per call: route tests mock @workspace/db without the table
  const page = d
    .select(columns)
    .from(tradesTable)
    .where(where)
    .orderBy(desc(tradesTable.date), desc(tradesTable.id))
    .limit(limit);
  if (!lite) return page;
  const t = page.as("t");
  const outer = Object.fromEntries(Object.keys(columns).filter((k) => k !== "contextSnapshot").map((k) => [k, t[k as keyof typeof columns]]));
  const slim = sql<TradeRow["contextSnapshot"]>`NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'openedAt', ${t.contextSnapshot} -> 'openedAt', 'closedAt', ${t.contextSnapshot} -> 'closedAt')), '{}'::jsonb)`;
  const rows = await d.select({ ...outer, contextSnapshot: slim }).from(t).orderBy(desc(t.date), desc(t.id));
  return rows as unknown as TradeRow[];
}
