/**
 * Request parameter builders for the PropReports API v2 actions with rules of their own (pure, validated):
 * report (mode per type, baseCurrency for multi-currency types), upload (multipart fields), uploadStatus ids,
 * uploadSearch. Malformed input throws FilterError(field, message) — the routes answer 400 with it.
 */
import { FilterError } from "./filters";
import { REPORT_MODES, UPLOAD_SEARCH_STATUSES, UPLOAD_TYPES, type ReportType, type UploadSearchStatus, type UploadType } from "./parse-v2";
import { isYmd } from "./spec";

const ID_RE = /^\d{1,12}$/;

function ymd(field: string, v: string): string {
  if (!isYmd(v)) throw new FilterError(field, `expected YYYY-MM-DD: ${v}`);
  return v;
}

/** Docs-defined `mode` values of a report type, or null when the type takes no mode. */
export function reportModes(type: string): string[] | null {
  const m = REPORT_MODES[type];
  return m ? Object.keys(m) : null;
}

/**
 * type/startDate/endDate/mode/baseCurrency for `report` (scope is added by the client). `info` = the type's row from
 * `reports` when known: baseCurrency is refused for a type that is not multi-currency.
 */
export function reportParams(o: { type: string; startDate: string; endDate: string; mode?: string | number | null; baseCurrency?: string | null }, info?: ReportType | null): Record<string, string> {
  const type = o.type.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(type)) throw new FilterError("type", `unknown report type: ${o.type}`);
  const out: Record<string, string> = { type, startDate: ymd("startDate", o.startDate), endDate: ymd("endDate", o.endDate) };
  if (out.startDate > out.endDate) throw new FilterError("endDate", "endDate is before startDate");
  if (o.mode != null && String(o.mode) !== "") {
    const modes = reportModes(type);
    const mode = String(o.mode);
    if (!modes) throw new FilterError("mode", `report type ${type} takes no mode`);
    if (!modes.includes(mode)) throw new FilterError("mode", `mode for ${type} is one of ${modes.join(", ")}`);
    out.mode = mode;
  }
  if (o.baseCurrency) {
    const cur = o.baseCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw new FilterError("baseCurrency", `expected a 3-letter currency code: ${o.baseCurrency}`);
    if (info && !info.multiCurrency) throw new FilterError("baseCurrency", `report type ${type} is not multi-currency`);
    out.baseCurrency = cur;
  }
  return out;
}

export interface UploadOptions {
  type: UploadType;
  sourceId?: string | null;
  clearingFirmId?: string | null;
  replacementKey?: string | null;
  /** type=fill only */
  processingMode?: "tradeFeeAdjustments" | null;
  /** type=fill only; "clearing" needs clearingFirmId */
  reconciliationMode?: "account" | "clearing" | null;
  forceDuplicateProcessing?: boolean | null;
}

/** Form fields of `action=upload` (the file part is added by the client). */
export function uploadParams(o: UploadOptions): Record<string, string> {
  if (!UPLOAD_TYPES.includes(o.type)) throw new FilterError("type", `one of ${UPLOAD_TYPES.join(", ")}`);
  const out: Record<string, string> = { type: o.type };
  if (o.sourceId) {
    if (!ID_RE.test(o.sourceId)) throw new FilterError("sourceId", "numeric id expected");
    out.sourceId = o.sourceId;
  }
  if (o.clearingFirmId) {
    if (!ID_RE.test(o.clearingFirmId)) throw new FilterError("clearingFirmId", "numeric id expected");
    out.clearingFirmId = o.clearingFirmId;
  }
  if (o.replacementKey) {
    const k = o.replacementKey.trim();
    if (!k || k.length > 255) throw new FilterError("replacementKey", "1–255 characters");
    out.replacementKey = k;
  }
  if (o.processingMode) {
    if (o.type !== "fill") throw new FilterError("processingMode", "only for type=fill");
    if (o.processingMode !== "tradeFeeAdjustments") throw new FilterError("processingMode", "tradeFeeAdjustments");
    out.processingMode = o.processingMode;
  }
  if (o.reconciliationMode) {
    if (o.type !== "fill") throw new FilterError("reconciliationMode", "only for type=fill");
    if (o.reconciliationMode !== "account" && o.reconciliationMode !== "clearing") throw new FilterError("reconciliationMode", "account or clearing");
    if (o.reconciliationMode === "clearing" && !out.clearingFirmId) throw new FilterError("clearingFirmId", "required with reconciliationMode=clearing");
    out.reconciliationMode = o.reconciliationMode;
  }
  if (o.forceDuplicateProcessing != null) out.forceDuplicateProcessing = o.forceDuplicateProcessing ? "true" : "false";
  return out;
}

/** `uploadId` for uploadStatus: one id or a comma list (numeric, de-duplicated, ≤ 100). */
export function uploadIdsParam(ids: string | readonly string[]): string {
  const list = [...new Set((typeof ids === "string" ? ids.split(",") : ids).map((s) => s.trim()).filter(Boolean))];
  if (!list.length) throw new FilterError("uploadId", "empty");
  if (list.length > 100) throw new FilterError("uploadId", "at most 100 ids");
  for (const id of list) if (!ID_RE.test(id)) throw new FilterError("uploadId", `numeric id expected: ${id}`);
  return list.join(",");
}

export interface UploadSearchOptions {
  sourceId?: string | null;
  type?: UploadType | null;
  /** exact, comma list or with a % wildcard */
  replacementKey?: string | null;
  /** at most one of uploadDate / actionDate */
  uploadDate?: string | null;
  actionDate?: string | null;
  /** default on the server: everything except aborted and deleted */
  status?: readonly UploadSearchStatus[] | null;
  page?: number | null;
}

export function uploadSearchParams(o: UploadSearchOptions = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (o.sourceId) {
    if (!ID_RE.test(o.sourceId)) throw new FilterError("sourceId", "numeric id expected");
    out.sourceId = o.sourceId;
  }
  if (o.type) {
    if (!UPLOAD_TYPES.includes(o.type)) throw new FilterError("type", `one of ${UPLOAD_TYPES.join(", ")}`);
    out.type = o.type;
  }
  if (o.replacementKey) {
    const k = o.replacementKey.trim();
    if (k.length > 255) throw new FilterError("replacementKey", "at most 255 characters");
    if (k) out.replacementKey = k;
  }
  if (o.uploadDate && o.actionDate) throw new FilterError("actionDate", "use uploadDate or actionDate, not both");
  if (o.uploadDate) out.uploadDate = ymd("uploadDate", o.uploadDate);
  if (o.actionDate) out.actionDate = ymd("actionDate", o.actionDate);
  if (o.status?.length) {
    for (const s of o.status) if (!UPLOAD_SEARCH_STATUSES.includes(s)) throw new FilterError("status", `unknown status ${s}`);
    out.status = [...new Set(o.status)].join(",");
  }
  if (o.page != null) {
    if (!Number.isInteger(o.page) || o.page < 1) throw new FilterError("page", "1-based page number");
    out.page = String(o.page);
  }
  return out;
}
