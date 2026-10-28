import type { NextAction, QueueItem, TodayPayload, CostQueueRow } from "./api";

/**
 * «Следующие шаги» merged with the queue by money (GET /api/curator/today `byCost`): one attention list per curator.
 *   1. cost rows the curator has not looked at yet — most expensive first (server order);
 *   2. next steps of traders without such a row — by priority (the old list);
 *   3. wards without a 1:1 for > 30 days (`oneOnOneDue`) whose next step is something else (OLGA-18);
 *   4. cost rows already reviewed — at the bottom, dimmed («Разобрано»).
 * A trader's other open days follow their most expensive day (`cont`: same trader as the row above — the view shows
 * the name once), so one trader does not take three of the top four places as separate rows. `group`: the row belongs
 * to such a run of 2+ days (its first row included) — the view marks every card of the run alike (connectedness).
 * Pure: no React, no i18n — tested in cost-queue-model.test.ts.
 */

export type TraderNext = NextAction & { trader: string };

/** The closed, not yet reviewed day behind a cost row (an «eod» item of the review queue): reviewed right in the sheet. */
export type DayReview = { eodId: number; closedAt: string | null; hoursWaiting: number | null };

export type AttentionRow =
  | { type: "cost"; key: string; trader: string; item: CostQueueRow; next: TraderNext | null; breachPending: boolean; eod: DayReview | null; cont?: boolean; group?: boolean }
  | { type: "next"; key: string; trader: string; next: TraderNext }
  | { type: "oneOnOne"; key: string; trader: string; days: number | null };

export function attentionRows(data: Pick<TodayPayload, "nextActions" | "queue"> & { byCost?: CostQueueRow[]; oneOnOneDue?: TodayPayload["oneOnOneDue"] }): AttentionRow[] {
  const nextBy = new Map(data.nextActions.map((a) => [a.trader, a]));
  const breachBy = new Set(data.queue.filter((q: QueueItem) => q.kind === "breach").map((q) => q.trader));
  const eodBy = new Map(
    data.queue
      .filter((q: QueueItem) => q.kind === "eod" && q.eodId != null && q.date)
      .map((q) => [`${q.trader}|${q.date}`, { eodId: q.eodId!, closedAt: q.since, hoursWaiting: q.hoursWaiting }]),
  );
  const cost = (data.byCost ?? []).map((item): AttentionRow => ({
    type: "cost", key: `cost:${item.trader}:${item.date}`, trader: item.trader, item,
    next: nextBy.get(item.trader) ?? null, breachPending: breachBy.has(item.trader), eod: eodBy.get(`${item.trader}|${item.date}`) ?? null,
  }));
  const open = groupByTrader(cost.filter((r) => r.type === "cost" && !r.item.resolved));
  const done = cost.filter((r) => r.type === "cost" && r.item.resolved);
  const covered = new Set(open.map((r) => r.trader));
  const rest = data.nextActions
    .filter((a) => !covered.has(a.trader))
    .map((a): AttentionRow => ({ type: "next", key: `next:${a.trader}`, trader: a.trader, next: a }));
  // A 1:1 that is long overdue is its own step unless the trader's shown next step already is the 1:1.
  const shownOneOnOne = new Set(rest.filter((r) => r.type === "next" && r.next.kind === "one_on_one").map((r) => r.trader));
  const meetings = (data.oneOnOneDue ?? [])
    .filter((m) => !shownOneOnOne.has(m.trader))
    .map((m): AttentionRow => ({ type: "oneOnOne", key: `1on1:${m.trader}`, trader: m.trader, days: m.days }));
  return [...open, ...rest, ...meetings, ...done];
}

/** Stable grouping: traders in the order of their most expensive row, each trader's rows in server order. */
function groupByTrader(rows: AttentionRow[]): AttentionRow[] {
  const by = new Map<string, AttentionRow[]>();
  for (const r of rows) by.set(r.trader, [...(by.get(r.trader) ?? []), r]);
  return [...by.values()].flatMap((list) => list.map((r, i) => (r.type === "cost" && list.length > 1 ? { ...r, group: true, ...(i > 0 ? { cont: true } : {}) } : r)));
}

export type PrimaryAction =
  | { kind: "breach" }
  | { kind: "review"; eod: DayReview }
  | { kind: "next"; href: string }
  | { kind: "day" };

/**
 * What the row's main button does (closure law, OLGA-03 — the action opens the day the row came from, and saving there
 * resolves the row): review the breached stop → the day's focus / own reasons: the EOD sheet of that closed day (saving
 * the review resolves the row), else the journal day → the trader's next step → the day.
 */
export function primaryAction(row: Extract<AttentionRow, { type: "cost" }>): PrimaryAction {
  const kinds = new Set(row.item.reasons.map((r) => r.kind));
  if (kinds.has("stop_breach") && row.breachPending) return { kind: "breach" };
  if (row.eod) return { kind: "review", eod: row.eod };
  if (kinds.has("disputed") || kinds.has("focus_broken")) return { kind: "day" };
  if (row.next && row.next.kind !== "none" && !row.next.href.startsWith("/curator?")) return { kind: "next", href: row.next.href };
  return { kind: "day" };
}

/** Money params of reason texts (formatted as $ by the view). */
export const MONEY_PARAMS = new Set(["used", "limit", "fees", "gross", "peak", "close", "net"]);
