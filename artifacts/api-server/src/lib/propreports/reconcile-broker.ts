/**
 * Nightly broker reconciliation — pure part (phase 3 ACCURACY). Per account per day: our journal net vs the
 * PropReports report ("Summary by Date", `report&type=summary`, one call per account).
 *
 *   parseSummaryByDate(text)  CSV → per-day broker numbers. Columns are found by header name (firms differ):
 *                             Date, Type, Orders, Fills, Qty, Gross, <fee columns>, Trade Fees, Net, Adj Fees, Adj Net,
 *                             Unrealized Δ, Total Δ, Transfer, Cash, Unrealized, End Balance. Several header rows
 *                             (sections) are allowed; rows of one date with different Type (Eq / Opt …) are summed;
 *                             "Total" rows are skipped.
 *   compareDays(ours, broker) → one row per day present on either side:
 *                             ok              |our net − broker Net| ≤ $1
 *                             mismatch        both sides have the day and differ by > $1
 *                             missing_ours    broker booked |Net| > $1, we have nothing
 *                             missing_broker  we booked |net| > $1, the broker has nothing
 *                             `carry` marks days touched by a multi-day / still-open trade: the broker books realized
 *                             P&L and fees per fill day, the journal books a whole trip on its close day — a mismatch
 *                             there is expected and shown as such, not hidden.
 *   Adjustments (when the report has Adj Fees / Transfer) are compared separately (adjDiff / transferDiff) and never
 *   change the trade-net status.
 */
import { normHeader, parseCsvRows, parseNum, round4 } from "./csv";
import { normYmd } from "./adjustments-parse";

export const MISMATCH_THRESHOLD = 1;

export interface BrokerDay {
  date: string;
  gross: number | null;
  fees: number | null;
  net: number;
  fills: number | null;
  /** "Adj Fees" (broker adjustments booked in P&L) when the report has it. */
  adjFees: number | null;
  /** "Transfer" when the report has it. */
  transfers: number | null;
}

export interface OurDay {
  date: string;
  trades: number;
  gross: number;
  fees: number;
  net: number;
  /** Σ stored adjustments of the account that day (fees + other), when known. */
  adjFees?: number | null;
  transfers?: number | null;
}

export type ReconcileStatus = "ok" | "mismatch" | "missing_ours" | "missing_broker";

export interface DayComparison {
  date: string;
  status: ReconcileStatus;
  ours: OurDay | null;
  broker: BrokerDay | null;
  /** ours.net − broker.net (missing side counted as 0). */
  diff: number;
  carry: boolean;
  adjDiff: number | null;
  transferDiff: number | null;
}

const TOTAL_RE = /^(grand\s*)?totals?\b/i;

/** Summary-by-date report text → one BrokerDay per date (sections and Type rows summed). */
export function parseSummaryByDate(text: string): { days: BrokerDay[]; columns: string[] } {
  const rows = parseCsvRows(text);
  const byDate = new Map<string, BrokerDay>();
  let idx: Record<string, number> | null = null;
  let columns: string[] = [];
  const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
  for (const r of rows) {
    const h = r.map(normHeader);
    if (h.includes("date") && h.includes("net")) {
      const f = (...names: string[]) => h.findIndex((x) => names.includes(x));
      idx = {
        date: f("date"), type: f("type"), gross: f("gross"), fees: f("trade fees", "fees", "total fees"), net: f("net"),
        fills: f("fills"), adj: f("adj fees", "adjustment fees", "adjustments"), transfer: f("transfer", "transfers"),
      };
      columns = r.map((c) => c.trim());
      continue;
    }
    if (!idx) continue;
    if (/^page\s+\d+\s*\/\s*\d+$/i.test((r[0] ?? "").trim())) continue;
    const date = normYmd(r[idx.date] ?? "");
    if (!date) continue; // section titles, totals, blank lines
    if (idx.type >= 0 && TOTAL_RE.test((r[idx.type] ?? "").trim())) continue;
    const num = (i: number): number | null => {
      if (i < 0) return null;
      const s = (r[i] ?? "").trim();
      if (!s) return null;
      const n = parseNum(s);
      return Number.isFinite(n) ? n : null;
    };
    const net = num(idx.net);
    if (net == null) continue;
    const gross = num(idx.gross);
    const fees = num(idx.fees) ?? (gross != null ? round4(gross - net) : null);
    const prev = byDate.get(date);
    const cur: BrokerDay = { date, gross, fees, net, fills: num(idx.fills), adjFees: num(idx.adj), transfers: num(idx.transfer) };
    byDate.set(date, prev ? {
      date,
      gross: add(prev.gross, cur.gross), fees: add(prev.fees, cur.fees), net: prev.net + cur.net, fills: add(prev.fills, cur.fills),
      adjFees: add(prev.adjFees, cur.adjFees), transfers: add(prev.transfers, cur.transfers),
    } : cur);
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
    ...d, net: round4(d.net), gross: d.gross == null ? null : round4(d.gross), fees: d.fees == null ? null : round4(d.fees),
    adjFees: d.adjFees == null ? null : round4(d.adjFees), transfers: d.transfers == null ? null : round4(d.transfers),
  }));
  return { days, columns };
}

/** Days [from, to] touched by a trade that spans several sessions or is still open. */
export function carryDays(trades: Array<{ date: string; closeDate: string | null; open: boolean }>, from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const t of trades) {
    const end = t.open ? to : (t.closeDate ?? t.date);
    if (!t.open && end <= t.date) continue;
    const start = t.date < from ? from : t.date;
    const stop = end > to ? to : end;
    for (let d = start; d <= stop; d = nextDay(d)) out.add(d);
  }
  return out;
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function compareDays(ours: OurDay[], broker: BrokerDay[], opts: { carry?: Set<string>; threshold?: number; from?: string; to?: string } = {}): DayComparison[] {
  const thr = opts.threshold ?? MISMATCH_THRESHOLD;
  const o = new Map(ours.map((d) => [d.date, d]));
  const b = new Map(broker.map((d) => [d.date, d]));
  const dates = [...new Set([...o.keys(), ...b.keys()])]
    .filter((d) => (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to))
    .sort();
  return dates.map((date) => {
    const od = o.get(date) ?? null;
    const bd = b.get(date) ?? null;
    const diff = round4((od?.net ?? 0) - (bd?.net ?? 0));
    // a day with only adjustments on our side has no journal trades: the broker's Net there is "missing on ours"
    const hasOurs = !!od && od.trades > 0;
    let status: ReconcileStatus;
    if (Math.abs(diff) <= thr) status = "ok";
    else if (hasOurs && bd) status = "mismatch";
    else if (bd) status = "missing_ours";
    else status = "missing_broker";
    const adjDiff = bd?.adjFees != null && od?.adjFees != null ? round4(od.adjFees - bd.adjFees) : null;
    const transferDiff = bd?.transfers != null && od?.transfers != null ? round4(od.transfers - bd.transfers) : null;
    return { date, status, ours: od, broker: bd, diff, carry: !!opts.carry?.has(date), adjDiff, transferDiff };
  });
}
