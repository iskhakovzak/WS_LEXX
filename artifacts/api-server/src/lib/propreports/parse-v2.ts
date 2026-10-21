/**
 * Typed readers for the PropReports API v2 CSV actions that have no dedicated parser yet (pure).
 * Columns are matched by header name (normHeader), never by index: the vendor adds optional columns
 * (`optionalFields`) and fee columns vary by firm. Unknown columns are kept in `extra`.
 *
 *   reports        Type,Description,Group/Account,Multi-Currency
 *   positions      Date,Account,Qty,Symbol,Avg,Close,Unrealized Delta,Unrealized,Qty Traded,Realized,<fees…>,Currency,Spot Rate
 *   locates        Date/Time,Account,Qty,Symbol,Cost,Locate Id (+ PropReports Id, Account Name, …)
 *   instruments    Date,Symbol,Price,Volume,Currency,Multiplier,ISIN,CUSIP,SEDOL,FIGI,Description,Listing Exchange,Tape,
 *                  Subtype,Underlying Symbol,Strike Price,Maturity,Coupon (+ Close Source, Is Complete)
 *   profiles       Profile Id,Salutation,First,Last,Title,Company,Street,City,State,Postal Code,Country,Primary E-mail,
 *                  Secondary E-mail,Evening Phone,Day Phone,Mobile Phone,Fax,User Id,Access
 *   upload / uploadSearch / uploadStatus summary
 *                  Upload Id,Date/Time,Replacement Key,File Name,File Size,Source,Parser,Status,Comment,Errors,Notes
 *   uploadStatus details (second section after a blank line)
 *                  Upload Id,Date,Data Type,Entries,Status
 */
import { normHeader, parseCsvRows, parseCsvTable, parseNum, type CsvTable } from "./csv";

/** Row accessor by header name; `extra` = columns no reader asked for. */
export function tableReader(t: CsvTable) {
  const idx = new Map<string, number>();
  t.header.forEach((h, i) => { if (!idx.has(normHeader(h))) idx.set(normHeader(h), i); });
  const used = new Set<number>();
  const col = (name: string): number => {
    const i = idx.get(normHeader(name));
    if (i != null) used.add(i);
    return i ?? -1;
  };
  return {
    has: (name: string) => idx.has(normHeader(name)),
    str(row: string[], name: string): string | null {
      const i = col(name);
      if (i < 0) return null;
      const v = (row[i] ?? "").trim();
      return v === "" ? null : v;
    },
    num(row: string[], name: string): number | null {
      const i = col(name);
      if (i < 0) return null;
      const v = (row[i] ?? "").trim();
      if (v === "") return null;
      const n = parseNum(v);
      return Number.isFinite(n) ? n : null;
    },
    yn(row: string[], name: string): boolean | null {
      const i = col(name);
      if (i < 0) return null;
      const v = (row[i] ?? "").trim().toUpperCase();
      return v === "Y" || v === "TRUE" || v === "1" ? true : v === "N" || v === "FALSE" || v === "0" ? false : null;
    },
    extra(row: string[]): Record<string, string> {
      const out: Record<string, string> = {};
      t.header.forEach((h, i) => { if (!used.has(i) && (row[i] ?? "").trim() !== "") out[h] = (row[i] ?? "").trim(); });
      return out;
    },
  };
}

// ── reports ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReportType {
  /** identifier for `report&type=` */
  type: string;
  description: string;
  /** whether `report` takes accountId or groupId */
  scope: "account" | "group";
  multiCurrency: boolean;
}

export function parseReportsList(t: CsvTable): ReportType[] {
  const r = tableReader(t);
  return t.rows
    .map((row) => ({
      type: r.str(row, "Type") ?? "",
      description: r.str(row, "Description") ?? "",
      scope: (r.str(row, "Group/Account") ?? "").toLowerCase().startsWith("g") ? ("group" as const) : ("account" as const),
      multiCurrency: r.yn(row, "Multi-Currency") ?? false,
    }))
    .filter((x) => x.type);
}

/** Report types whose `mode` parameter the docs define (other types ignore it). */
export const REPORT_MODES: Record<string, Record<string, string>> = {
  totalsByAccount: { "1": "inactive aggregated", "2": "inactive individually" },
  totalsByGroup: { "1": "inactive aggregated", "2": "inactive individually" },
  totalsByAggregationUnit: { "1": "inactive aggregated", "2": "inactive individually" },
  performance: { "1": "daytrade + overnight", "2": "daytrade only", "3": "overnight only" },
  performanceForGroup: { "1": "daytrade + overnight", "2": "daytrade only", "3": "overnight only" },
  performanceByAccount: { "1": "daytrade + overnight", "2": "daytrade only", "3": "overnight only" },
};

// ── positions ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface PositionRow {
  date: string;
  account: string;
  /** 0 = closed during the day */
  qty: number;
  symbol: string;
  avg: number | null;
  close: number | null;
  unrealizedDelta: number | null;
  unrealized: number | null;
  qtyTraded: number | null;
  realized: number | null;
  currency: string | null;
  spotRate: number | null;
  /** fee columns as sent (Comm, Ecn Fee, SEC, TAF, NSCC, Clr, Misc, …) */
  fees: Record<string, number>;
  accountName: string | null;
}

const POSITION_FIXED = ["date", "account", "qty", "open qty", "symbol", "avg", "close", "unrealized delta", "unrealized", "qty traded", "realized", "currency", "spot rate", "account name", "clearing name", "aggregation unit"];

export function parsePositions(t: CsvTable): PositionRow[] {
  const r = tableReader(t);
  const feeCols = t.header.map((h, i) => ({ h, i })).filter(({ h }) => !POSITION_FIXED.includes(normHeader(h)));
  return t.rows
    .map((row) => {
      const fees: Record<string, number> = {};
      for (const { h, i } of feeCols) {
        const n = parseNum(row[i] ?? "");
        if (Number.isFinite(n)) fees[h] = n;
      }
      return {
        date: r.str(row, "Date") ?? "",
        account: r.str(row, "Account") ?? "",
        qty: r.num(row, "Qty") ?? r.num(row, "Open Qty") ?? 0,
        symbol: (r.str(row, "Symbol") ?? "").toUpperCase(),
        avg: r.num(row, "Avg"),
        close: r.num(row, "Close"),
        unrealizedDelta: r.num(row, "Unrealized Delta"),
        unrealized: r.num(row, "Unrealized"),
        qtyTraded: r.num(row, "Qty Traded"),
        realized: r.num(row, "Realized"),
        currency: r.str(row, "Currency"),
        spotRate: r.num(row, "Spot Rate"),
        fees,
        accountName: r.str(row, "Account Name"),
      };
    })
    .filter((p) => p.date && p.account && p.symbol);
}

// ── locates ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LocateRow {
  dateTime: string;
  account: string;
  qty: number;
  symbol: string;
  cost: number;
  locateId: string | null;
  propReportsId: string | null;
  accountName: string | null;
  extra: Record<string, string>;
}

export function parseLocates(t: CsvTable): LocateRow[] {
  const r = tableReader(t);
  return t.rows
    .map((row) => {
      const out = {
        dateTime: r.str(row, "Date/Time") ?? r.str(row, "Date") ?? "",
        account: r.str(row, "Account") ?? "",
        qty: r.num(row, "Qty") ?? 0,
        symbol: (r.str(row, "Symbol") ?? "").toUpperCase(),
        cost: r.num(row, "Cost") ?? 0,
        locateId: r.str(row, "Locate Id"),
        propReportsId: r.str(row, "PropReports Id"),
        accountName: r.str(row, "Account Name"),
        extra: {} as Record<string, string>,
      };
      out.extra = r.extra(row);
      return out;
    })
    .filter((l) => l.dateTime && l.account && l.symbol);
}

// ── instruments (superuser) ─────────────────────────────────────────────────────────────────────────────────────

export interface InstrumentRow {
  date: string;
  symbol: string;
  price: number | null;
  volume: number | null;
  currency: string | null;
  multiplier: number | null;
  isin: string | null;
  cusip: string | null;
  sedol: string | null;
  figi: string | null;
  description: string | null;
  listingExchange: string | null;
  tape: string | null;
  subtype: string | null;
  underlyingSymbol: string | null;
  strikePrice: number | null;
  maturity: string | null;
  coupon: number | null;
  closeSource: string | null;
  isComplete: boolean | null;
}

export function parseInstruments(t: CsvTable): InstrumentRow[] {
  const r = tableReader(t);
  return t.rows
    .map((row) => ({
      date: r.str(row, "Date") ?? "",
      symbol: (r.str(row, "Symbol") ?? "").toUpperCase(),
      price: r.num(row, "Price"),
      volume: r.num(row, "Volume"),
      currency: r.str(row, "Currency"),
      multiplier: r.num(row, "Multiplier"),
      isin: r.str(row, "ISIN"),
      cusip: r.str(row, "CUSIP"),
      sedol: r.str(row, "SEDOL"),
      figi: r.str(row, "FIGI"),
      description: r.str(row, "Description"),
      listingExchange: r.str(row, "Listing Exchange"),
      tape: r.str(row, "Tape"),
      subtype: r.str(row, "Subtype"),
      underlyingSymbol: r.str(row, "Underlying Symbol"),
      strikePrice: r.num(row, "Strike Price"),
      maturity: r.str(row, "Maturity"),
      coupon: r.num(row, "Coupon"),
      closeSource: r.str(row, "Close Source"),
      isComplete: r.yn(row, "Is Complete"),
    }))
    .filter((i) => i.symbol);
}

// ── profiles (superuser) ────────────────────────────────────────────────────────────────────────────────────────

export interface ProfileRow {
  profileId: string;
  salutation: string | null;
  first: string | null;
  last: string | null;
  title: string | null;
  company: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  primaryEmail: string | null;
  secondaryEmail: string | null;
  eveningPhone: string | null;
  dayPhone: string | null;
  mobilePhone: string | null;
  fax: string | null;
  userId: string | null;
  access: string | null;
}

export function parseProfiles(t: CsvTable): ProfileRow[] {
  const r = tableReader(t);
  return t.rows
    .map((row) => ({
      profileId: r.str(row, "Profile Id") ?? "",
      salutation: r.str(row, "Salutation"),
      first: r.str(row, "First"),
      last: r.str(row, "Last"),
      title: r.str(row, "Title"),
      company: r.str(row, "Company"),
      street: r.str(row, "Street"),
      city: r.str(row, "City"),
      state: r.str(row, "State"),
      postalCode: r.str(row, "Postal Code"),
      country: r.str(row, "Country"),
      primaryEmail: r.str(row, "Primary E-mail"),
      secondaryEmail: r.str(row, "Secondary E-mail"),
      eveningPhone: r.str(row, "Evening Phone"),
      dayPhone: r.str(row, "Day Phone"),
      mobilePhone: r.str(row, "Mobile Phone"),
      fax: r.str(row, "Fax"),
      userId: r.str(row, "User Id"),
      access: r.str(row, "Access"),
    }))
    .filter((p) => p.profileId);
}

// ── uploads (superuser) ─────────────────────────────────────────────────────────────────────────────────────────

export const UPLOAD_TYPES = ["fill", "adjustment", "position", "instrument", "locate", "account", "user", "payout", "document"] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

/** Summary statuses as `uploadStatus` prints them. */
export type UploadStatusName = "Scheduling" | "Pending" | "In Progress" | "Uploaded" | "Reconciled" | "Aborted" | string;
/** `uploadSearch&status=` filter values. */
export const UPLOAD_SEARCH_STATUSES = ["scheduling", "pending", "inProgress", "uploaded", "reconciled", "aborted", "deleted"] as const;
export type UploadSearchStatus = (typeof UPLOAD_SEARCH_STATUSES)[number];

/** Upload is still moving through the queue (poll again). */
export const isUploadRunning = (s: string | null | undefined): boolean => /^(scheduling|pending|in ?progress)$/i.test((s ?? "").trim());
/** Upload reached a final state. */
export const isUploadFinal = (s: string | null | undefined): boolean => /^(uploaded|reconciled|aborted)$/i.test((s ?? "").trim());

export interface UploadSummary {
  uploadId: string;
  dateTime: string | null;
  replacementKey: string | null;
  fileName: string | null;
  fileSize: number | null;
  source: string | null;
  parser: string | null;
  status: UploadStatusName;
  comment: string | null;
  /** `uploadMessages` has errors */
  hasErrors: boolean;
  /** `uploadMessages` has notes */
  hasNotes: boolean;
}

export interface UploadDetail {
  uploadId: string;
  date: string;
  dataType: string;
  entries: number | null;
  /** Uploaded · Reconciled · "Deleted on YYYY-MM-DD" */
  status: string;
  deletedOn: string | null;
}

export function parseUploadSummaries(t: CsvTable): UploadSummary[] {
  const r = tableReader(t);
  return t.rows
    .map((row) => ({
      uploadId: r.str(row, "Upload Id") ?? "",
      dateTime: r.str(row, "Date/Time"),
      replacementKey: r.str(row, "Replacement Key"),
      fileName: r.str(row, "File Name"),
      fileSize: r.num(row, "File Size"),
      source: r.str(row, "Source"),
      parser: r.str(row, "Parser"),
      status: r.str(row, "Status") ?? "",
      comment: r.str(row, "Comment"),
      hasErrors: r.yn(row, "Errors") ?? false,
      hasNotes: r.yn(row, "Notes") ?? false,
    }))
    .filter((u) => u.uploadId);
}

export function parseUploadDetails(t: CsvTable): UploadDetail[] {
  const r = tableReader(t);
  return t.rows
    .map((row) => {
      const status = r.str(row, "Status") ?? "";
      const del = /^deleted on (\d{4}-\d{2}-\d{2})/i.exec(status);
      return {
        uploadId: r.str(row, "Upload Id") ?? "",
        date: r.str(row, "Date") ?? "",
        dataType: r.str(row, "Data Type") ?? "",
        entries: r.num(row, "Entries"),
        status,
        deletedOn: del ? del[1] : null,
      };
    })
    .filter((d) => d.uploadId);
}

/**
 * Split a multi-section CSV body on blank lines (outside quotes). `uploadStatus` returns the summary, then — after a
 * blank line — the per-date details. parseCsvRows drops empty rows, so the split has to happen on the raw text.
 */
export function splitCsvSections(text: string): string[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sections: string[] = [];
  let cur = "";
  let inQuotes = false;
  let lineStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "\n" && !inQuotes) {
      const line = src.slice(lineStart, i).replace(/\r$/, "");
      if (line.trim() === "") {
        if (cur.trim()) sections.push(cur);
        cur = "";
      } else cur += `${line}\n`;
      lineStart = i + 1;
    }
  }
  const tail = src.slice(lineStart).replace(/\r$/, "");
  if (tail.trim()) cur += tail;
  if (cur.trim()) sections.push(cur);
  return sections;
}

export interface UploadStatusResult {
  summaries: UploadSummary[];
  details: UploadDetail[];
}

export function parseUploadStatus(text: string): UploadStatusResult {
  const out: UploadStatusResult = { summaries: [], details: [] };
  for (const sec of splitCsvSections(text)) {
    const t = parseCsvTable(sec);
    const h = t.header.map(normHeader);
    if (h.includes("data type") && h.includes("entries")) out.details.push(...parseUploadDetails(t));
    else if (h.includes("upload id")) out.summaries.push(...parseUploadSummaries(t));
  }
  return out;
}

/** `uploadMessages` plain text → blocks per "--- Source ---" header (empty body = still running / nothing to say). */
export interface UploadMessages {
  empty: boolean;
  text: string;
  sections: Array<{ title: string; body: string }>;
}

export function parseUploadMessages(text: string): UploadMessages {
  const body = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return { empty: true, text: "", sections: [] };
  const sections: UploadMessages["sections"] = [];
  let title = "";
  let buf: string[] = [];
  const flush = () => { if (title || buf.join("").trim()) sections.push({ title, body: buf.join("\n").trim() }); };
  for (const line of body.split("\n")) {
    const m = /^-{3}\s*(.+?)\s*-{3}$/.exec(line.trim());
    if (m) { flush(); title = m[1]; buf = []; } else buf.push(line);
  }
  flush();
  return { empty: false, text: body, sections };
}

// ── groups ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GroupRow {
  groupId: string;
  name: string;
  /** negative ids are system groups (-4 My Accounts, -2 All Accounts) */
  system: boolean;
}

export function parseGroups(t: CsvTable): GroupRow[] {
  const r = tableReader(t);
  return t.rows
    .map((row) => {
      const groupId = r.str(row, "Group Id") ?? (row[0] ?? "").trim();
      return { groupId, name: r.str(row, "Group Name") ?? (row[1] ?? "").trim(), system: Number(groupId) < 0 };
    })
    .filter((g) => g.groupId);
}

/** `Page X/Y` read off a body that is not a table (helper for callers that keep the raw text). */
export function pageOf(text: string): { current: number; total: number } | null {
  const rows = parseCsvRows(text);
  const last = rows[rows.length - 1];
  const m = last && last.length === 1 ? /^Page\s+(\d+)\s*\/\s*(\d+)\s*$/i.exec(last[0].trim()) : null;
  return m ? { current: Number(m[1]), total: Number(m[2]) } : null;
}
