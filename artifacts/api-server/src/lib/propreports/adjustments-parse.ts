/**
 * PropReports `adjustments` CSV → typed rows (pure, phase 3 ACCURACY).
 *
 *   columns  Date,Account,Category,Amount,Comment,Qty,Symbol,Price (+ optionalFields propReportsId)
 *   kind     "fee"      — a cost of trading booked outside the fills (software, market data, locate/borrow, desk fee,
 *                         commission corrections, interest charged…): part of net P&L and of equity;
 *            "transfer" — money moved in or out (deposit, withdrawal, wire, payout, profit split, journal between
 *                         accounts): changes equity, NOT P&L;
 *            "other"    — any other booked P&L item (dividends, rebates, corrections, credits): part of net P&L.
 *   A fee word wins over a transfer word ("Wire fee" is a fee). An adjustment inside the scope can appear twice, + and −
 *   (reversal, or a journal between two accounts of the group): both rows are kept, the sums cancel on their own.
 *
 * Identity: `propReportsId` when the API sends it (de-dup key); otherwise the data fingerprint + its occurrence
 * number inside one fetch (two identical rows on one day are two rows, the same two rows on the next fetch).
 */
import { round4 } from "./csv";

export type AdjustmentKind = "fee" | "transfer" | "other";

export interface AdjustmentRow {
  /** YYYY-MM-DD */
  date: string;
  account: string;
  category: string;
  amount: number;
  comment: string | null;
  qty: number | null;
  symbol: string | null;
  price: number | null;
  propReportsId: string | null;
  kind: AdjustmentKind;
  fingerprint: string;
  /** 1-based index among rows with the same fingerprint in this fetch. */
  occurrence: number;
}

const FEE_FIRST = /\b(fees?|commissions?|charges?|costs?)\b/i;
const TRANSFER = /(deposit|withdraw|transfer|wire|\bach\b|pay ?out|distribution|funding|\bfund(s|ed)?\b|capital|contribution|journal|\bdraw\b|profit ?split|\bsplit\b|cash ?(in|out)|bonus)/i;
const FEE_WORDS = /(software|platform|market ?data|\bdata\b|quote|locate|borrow|\binterest\b|ticket|\bdesk\b|\bseat\b|rent|licen[cs]e|subscription|clearing|regulatory|\breg\b|\bsec\b|\btaf\b|finra|\bnscc\b|\becn\b|routing|\bcomm\b|\bhtb\b|short ?stock|margin)/i;

/** Category (+ comment as a hint) → kind. */
export function adjustmentKind(category: string, comment?: string | null): AdjustmentKind {
  const c = category.trim();
  if (FEE_FIRST.test(c)) return "fee";
  if (TRANSFER.test(c)) return "transfer";
  if (FEE_WORDS.test(c)) return "fee";
  // an empty / generic category ("Adjustment", "Misc") — let the comment decide
  const hint = (comment ?? "").trim();
  if (hint) {
    if (FEE_FIRST.test(hint)) return "fee";
    if (TRANSFER.test(hint)) return "transfer";
    if (FEE_WORDS.test(hint)) return "fee";
  }
  return "other";
}

/** "MM/DD/YYYY", "YYYY-MM-DD", "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD"; null when unreadable. */
export function normYmd(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

const numKey = (n: number | null) => (n == null ? "" : String(Math.round(n * 1e6) / 1e6));

export function adjustmentFingerprint(r: Pick<AdjustmentRow, "date" | "account" | "category" | "amount" | "comment" | "qty" | "symbol" | "price">): string {
  return [r.date, r.account.trim(), r.category.trim().toLowerCase(), numKey(r.amount), (r.comment ?? "").trim(), numKey(r.qty), (r.symbol ?? "").trim().toUpperCase(), numKey(r.price)].join("|");
}

/** The client's parsed rows (client.adjustments → PropReportsAdjustment) in the shape the store needs. */
export type RawAdjustment = {
  date: string;
  account: string;
  category: string;
  amount: number;
  comment: string | null;
  qty: number | null;
  symbol: string | null;
  price: number | null;
  propReportsId: string | null;
};

export interface AdjustmentsParse {
  rows: AdjustmentRow[];
  issues: Array<{ line: number; message: string }>;
}

/** Normalise dates / category / symbol, classify, fingerprint and number identical twins (1, 2, …) in fetch order. */
export function toAdjustmentRows(raw: RawAdjustment[]): AdjustmentsParse {
  const rows: AdjustmentRow[] = [];
  const issues: AdjustmentsParse["issues"] = [];
  const occ = new Map<string, number>();
  raw.forEach((a, idx) => {
    const date = normYmd(a.date ?? "");
    const account = (a.account ?? "").trim();
    if (!date || !account) { issues.push({ line: idx + 2, message: "row without date or account skipped" }); return; }
    if (!Number.isFinite(a.amount)) { issues.push({ line: idx + 2, message: "bad amount" }); return; }
    const category = (a.category ?? "").trim() || "Adjustment";
    const comment = (a.comment ?? "").trim() || null;
    const symbol = (a.symbol ?? "").trim().toUpperCase() || null;
    const base = { date, account, category, amount: round4(a.amount), comment, qty: a.qty ?? null, symbol, price: a.price ?? null };
    const fingerprint = adjustmentFingerprint(base);
    const n = (occ.get(fingerprint) ?? 0) + 1;
    occ.set(fingerprint, n);
    rows.push({ ...base, propReportsId: (a.propReportsId ?? "").trim() || null, kind: adjustmentKind(category, comment), fingerprint, occurrence: n });
  });
  return { rows, issues };
}

export interface DayTotals {
  fees: number;
  transfers: number;
  other: number;
  count: number;
}

/** Σ per kind (amounts as booked: fees are usually negative, a deposit positive). */
export function sumByKind(rows: Array<Pick<AdjustmentRow, "kind" | "amount">>): DayTotals {
  const out: DayTotals = { fees: 0, transfers: 0, other: 0, count: 0 };
  for (const r of rows) {
    if (r.kind === "fee") out.fees += r.amount;
    else if (r.kind === "transfer") out.transfers += r.amount;
    else out.other += r.amount;
    out.count++;
  }
  return { fees: round4(out.fees), transfers: round4(out.transfers), other: round4(out.other), count: out.count };
}
