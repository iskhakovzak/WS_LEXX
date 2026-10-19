/**
 * «Без сетапа» — THE definition (TRIAGE cross-area note 3; «без разбора» = no grade/review is a different word).
 * «Разметь сделки»: own closed trades without a live setup. One rule for the playbook «Сегодня» counter, the evening card
 * (EveningCard.untagged) and the daily quest «разметить вчерашние сделки» (lib/quests/catalog tag_yesterday).
 *
 * A trade is TAGGED when it is linked to a setup that is not deleted (trades.playbook_id → playbook), or when the trader
 * marked it «Не для плейбука» (playbook_inbox_dismissed — the way to say «no setup fits»). Days are New York close days
 * (the expression of the trades_live_trader_close_day_idx index, migration 0209).
 */
import { pool } from "@workspace/db";
import { addDays, isWeekend } from "../tradingDate";
import { closedSql, closeDateSql } from "../tradeMath";

export type TagDay = { trades: number; tagged: number };

/** The `n`-th weekday back from `today` (today counts when it is a weekday): the start of «the last n trading days». */
export function weekdaysBack(today: string, n: number): string {
  let d = today;
  let seen = isWeekend(d) ? 0 : 1;
  while (seen < n) {
    d = addDays(d, -1);
    if (!isWeekend(d)) seen++;
  }
  return d;
}

const day = `LEFT(${closeDateSql("t")}, 10)`;

function tagSql(withDismissed: boolean): string {
  const dismissed = withDismissed ? ` OR EXISTS (SELECT 1 FROM playbook_inbox_dismissed d WHERE d.trade_id = t.id)` : "";
  return `SELECT ${day} AS d, COUNT(*)::int AS trades, COUNT(*) FILTER (WHERE p.id IS NOT NULL${dismissed})::int AS tagged
            FROM trades t
            LEFT JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL
           WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closedSql("t")} AND ${day} >= $2 AND ${day} <= $3
           GROUP BY 1`;
}

/** Per close day of [from, to]: own closed trades and how many are tagged. */
export async function tagDays(trader: string, from: string, to: string): Promise<Map<string, TagDay>> {
  const run = (withDismissed: boolean) => pool.query<{ d: string; trades: number; tagged: number }>(tagSql(withDismissed), [trader, from, to]);
  // playbook_inbox_dismissed is created lazily by the playbook routes; without it nothing is dismissed.
  const { rows } = await run(true).catch((err: { code?: string }) => {
    if (err?.code === "42P01") return run(false);
    throw err;
  });
  return new Map(rows.map((r) => [String(r.d), { trades: Number(r.trades), tagged: Number(r.tagged) }]));
}

export function untaggedOf(days: ReadonlyMap<string, TagDay>): number {
  let n = 0;
  for (const v of days.values()) n += Math.max(0, v.trades - v.tagged);
  return n;
}

/** Own closed trades of [from, to] (NY close days, inclusive) and how many have no playbook setup («без сетапа»). */
export type UntaggedTrades = {
  from: string;
  to: string;
  /** Own closed trades in the period. */
  trades: number;
  /** Linked to a live setup, or marked «Не для плейбука». */
  tagged: number;
  /** trades − tagged: the «без сетапа» number every surface shows for this period. */
  untagged: number;
  /** Per close day (only days with trades). */
  byDay: Map<string, TagDay>;
};

/**
 * The shared entry point for «без сетапа» counts (playbook header, evening card, tag_yesterday quest, trades summary).
 * Keep this signature stable — other areas import it.
 */
export async function untaggedTrades(trader: string, from: string, to: string): Promise<UntaggedTrades> {
  const byDay = await tagDays(trader, from, to);
  let trades = 0;
  let tagged = 0;
  for (const v of byDay.values()) { trades += v.trades; tagged += Math.min(v.tagged, v.trades); }
  return { from, to, trades, tagged, untagged: trades - tagged, byDay };
}
