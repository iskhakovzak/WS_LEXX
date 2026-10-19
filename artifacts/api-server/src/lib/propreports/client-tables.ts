/**
 * Pure readers for the PropReports API tables the sync relies on (fills, accounts, adjustments). Moved out of client.ts
 * unchanged (client.ts re-exports them); accounts gained the remaining v2 optionalFields (clearing / source / dates).
 */
import type { CsvTable } from "./csv";
import { parseFillsCsv } from "./parse-fills";
import type { DetectedFeeColumn } from "./fees";
import type { Fill } from "./types";
import type { Lang } from "../../i18n";

export interface PropReportsAccount {
  accountId: string;
  account: string;
  accountName: string | null;
  groups: string[];
  firstTraded: string | null;
  lastTraded: string | null;
  currency: string | null;
  /** optionalFields=status, lower-cased as PropReports reports it ("active", "inactive", "closed", …); null when absent. */
  status: string | null;
  /** optionalFields=closeDate / deactivationDate: "YYYY-MM-DD" or null. */
  closeDate: string | null;
  deactivationDate: string | null;
  /** The rest of the v2 optionalFields (present only when requested; permissioned on the vendor side). */
  clearingName?: string | null;
  aggregationUnit?: string | null;
  clearingFirmName?: string | null;
  source?: string | null;
  creationDate?: string | null;
  activationDate?: string | null;
  suspensionDate?: string | null;
}

export interface PropReportsAdjustment {
  /** "YYYY-MM-DD" */
  date: string;
  account: string;
  category: string;
  amount: number;
  comment: string | null;
  qty: number | null;
  symbol: string | null;
  price: number | null;
  /** optionalFields=propReportsId — changes when the record is re-imported (the data stays the same). */
  propReportsId: string | null;
  /** 0-based data row index (diagnostics). */
  line: number;
}

const colIndex = (t: CsvTable) => (...names: string[]) => t.header.findIndex((h) => names.includes(h.trim().toLowerCase()));
const cell = (r: string[], i: number): string => (i >= 0 ? (r[i] ?? "").trim() : "");
const orNull = (s: string): string | null => s || null;
const numOrNull = (s: string): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : null;
};

export function parseFillsTable(t: CsvTable, lang?: Lang): { fills: Fill[]; raw: string; issues: Array<{ line: number; message: string }>; feeColumns: DetectedFeeColumn[] } {
  if (!t.header.length) return { fills: [], raw: "", issues: [], feeColumns: [] };
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const raw = [t.header, ...t.rows].map((r) => r.map(esc).join(",")).join("\n");
  if (!t.rows.length) return { fills: [], raw, issues: [], feeColumns: [] };
  const parsed = parseFillsCsv(raw, lang);
  return { fills: parsed.fills, raw, issues: parsed.issues, feeColumns: parsed.feeColumns };
}

export function parseAccountsTable(t: CsvTable): PropReportsAccount[] {
  const col = colIndex(t);
  const iId = col("account id"), iAcc = col("account"), iName = col("account name"), iGroups = col("groups"), iFirst = col("first traded"), iLast = col("last traded"), iCur = col("currency");
  const iStatus = col("status", "account status"), iClose = col("close date", "closedate"), iDeact = col("deactivation date", "deactivationdate");
  const extra = {
    clearingName: col("clearing name", "clearingname"), aggregationUnit: col("aggregation unit", "aggregationunit"),
    clearingFirmName: col("clearing firm name", "clearingfirmname", "clearing firm"), source: col("source"),
  };
  const dates = { creationDate: col("creation date", "creationdate"), activationDate: col("activation date", "activationdate"), suspensionDate: col("suspension date", "suspensiondate") };
  return t.rows
    .filter((r) => cell(r, iAcc))
    .map((r) => {
      const a: PropReportsAccount = {
        accountId: cell(r, iId),
        account: cell(r, iAcc),
        accountName: orNull(cell(r, iName)),
        groups: iGroups >= 0 ? (r[iGroups] ?? "").split("|").map((s) => s.trim()).filter(Boolean) : [],
        firstTraded: orNull(cell(r, iFirst)),
        lastTraded: orNull(cell(r, iLast)),
        currency: orNull(cell(r, iCur)),
        status: orNull(cell(r, iStatus).toLowerCase()),
        closeDate: orNull(cell(r, iClose).slice(0, 10)),
        deactivationDate: orNull(cell(r, iDeact).slice(0, 10)),
      };
      for (const [k, i] of Object.entries(extra)) if (i >= 0) a[k as keyof typeof extra] = orNull(cell(r, i));
      for (const [k, i] of Object.entries(dates)) if (i >= 0) a[k as keyof typeof dates] = orNull(cell(r, i).slice(0, 10));
      return a;
    });
}

export function parseAdjustmentsTable(t: CsvTable): PropReportsAdjustment[] {
  const col = colIndex(t);
  const iDate = col("date"), iAcc = col("account"), iCat = col("category"), iAmt = col("amount"), iCom = col("comment"), iQty = col("qty", "quantity"), iSym = col("symbol"), iPrice = col("price"), iPr = col("propreports id", "propreportsid");
  const out: PropReportsAdjustment[] = [];
  t.rows.forEach((r, line) => {
    const amount = numOrNull(cell(r, iAmt));
    if (!cell(r, iAcc) || amount == null) return;
    out.push({
      date: cell(r, iDate).slice(0, 10),
      account: cell(r, iAcc),
      category: cell(r, iCat),
      amount,
      comment: orNull(cell(r, iCom)),
      qty: numOrNull(cell(r, iQty)),
      symbol: orNull(cell(r, iSym)),
      price: numOrNull(cell(r, iPrice)),
      propReportsId: orNull(cell(r, iPr)),
      line,
    });
  });
  return out;
}
