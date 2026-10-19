/**
 * PropReports web API client (research summary, confirmed against the vendor docs on 2026-10-19:
 * https://propreports.atlassian.net/wiki/spaces/PR/pages/589971/API ("API v2", PropReports ≥ v1.22.12),
 * the v2 migration guide (page 3486613523) and page 589962 (Generic Executions Format)). Reference data — actions,
 * page sizes, optionalFields by access level, HTTP status meaning — lives in ./spec.ts.
 *
 *   Endpoint    POST https://<firm>.propreports.com/api.php  (HTTPS only; form-urlencoded, multipart for `upload`)
 *   Auth        every request carries `token`: the v2 pre-generated token (Profile → API Tokens, up to 10, revocable)
 *               → PROPREPORTS_TOKEN. The v1 `action=login` flow is deprecated by the vendor and NOT supported here.
 *               Responses carry `X-Api-Version`; every request sends `User-Agent: WS_LEXX/1.0`.
 *   Rate limit  40 requests / 4 s per host: one SlidingWindowLimiter per host shared by every client instance in the
 *               process (./rate-limit.ts). Retries (≤ 2, backoff 1 s · 2 s or Retry-After ≤ 10 s) only on 429 / 503 /
 *               other 5xx / a dropped connection, never on our own timeout, and only while the deadline leaves room;
 *               `upload` is retried only on 429 / 503 (the server did not take the file). Errors carry `kind`
 *               (badRequest/auth/forbidden/notFound/method/rateLimited/unavailable/server/network).
 *               Per-request timeout ≤ 25 s and never past `deadline` (the tick budget).
 *   Pagination  `page` (1-based); CSV body ends with a trailer line `Page X/Y`.
 *   Actions     version · accounts · groups · fills (advanced filters ./filters.ts, optionalFields by access level)
 *               positions (+ typed rows) · adjustments · reports · report (mode / baseCurrency checked, accountId or
 *               groupId by the type's scope) · locates · superuser only (403 otherwise): instruments · profiles ·
 *               upload (multipart) · uploadStatus (two CSV sections) · uploadMessages (text) · uploadSearch.
 *   Dates       YYYY-MM-DD. Fill timestamps are naive Eastern Time "YYYY-MM-DD HH:MM:SS.mmm".
 *   CSV shapes  ./parse-v2.ts (reports, positions, locates, instruments, profiles, uploads), ./client-tables.ts
 *               (fills, accounts, adjustments). Fee columns vary by firm — parse-fills maps by header name.
 *
 * Safety: the token comes only from env (never logged, never echoed to clients — upstream texts are redacted); nothing
 * in this module runs unless `isConfigured()` and a curator triggers a call, or the tick runs.
 */
import { createHash } from "node:crypto";
import { logger } from "../logger";
import { config } from "../../config";
import { parseCsvTable, type CsvTable } from "./csv";
import type { DetectedFeeColumn } from "./fees";
import { getSettings, setSetting, type ConnectionState } from "./settings";
import type { Fill } from "./types";
import { propreportsT } from "../../i18n/ns";
import type { Lang } from "../../i18n";
import { allowedFields, classifyStatus, isFieldLevel, isRetryable, type ApiErrorKind, type FieldLevel } from "./spec";
import { fillFilterParams, type FillFilters } from "./filters";
import { limiterFor } from "./rate-limit";
import {
  parseReportsList, parsePositions, parseLocates, parseInstruments, parseProfiles, parseUploadSummaries, parseUploadStatus,
  parseUploadMessages, type ReportType, type PositionRow, type LocateRow, type InstrumentRow, type ProfileRow, type UploadSummary,
  type UploadStatusResult, type UploadMessages,
} from "./parse-v2";
import { reportParams, uploadIdsParam, uploadParams, uploadSearchParams, type UploadOptions, type UploadSearchOptions } from "./params-v2";
import { parseAccountsTable, parseAdjustmentsTable, parseFillsTable, type PropReportsAccount, type PropReportsAdjustment } from "./client-tables";

export { parseAccountsTable, parseAdjustmentsTable, parseFillsTable, type PropReportsAccount, type PropReportsAdjustment };

export interface PropReportsConfig {
  domain: string; // "<firm>" or "<firm>.propreports.com"
  token: string;
  groupId?: string;
  accountIds?: string[];
  userAgent: string;
  /** Which optionalFields the token may ask for (PROPREPORTS_ACCESS_LEVEL, default "permissioned"). */
  accessLevel?: FieldLevel;
}

export interface PropReportsStatusConfig {
  configured: boolean;
  domain: string | null;
  /** "token" when configured (API v2 only). */
  authMode: "token" | null;
  groupId: string | null;
  accountIds: string[];
  syncMinutes: number | null;
  /** Env var names the owner sets in the Vercel env (never values). */
  envVars: string[];
  missing: string[];
  /** CRON_SECRET is set (the /api/cron/tick heartbeat can authenticate). Never the value. */
  cronConfigured: boolean;
}

export const ENV_VARS = {
  domain: "PROPREPORTS_DOMAIN",
  token: "PROPREPORTS_TOKEN",
  groupId: "PROPREPORTS_GROUP_ID",
  accountIds: "PROPREPORTS_ACCOUNT_IDS",
  syncMinutes: "PROPREPORTS_SYNC_MINUTES",
  cronSecret: "CRON_SECRET",
} as const;

/** Optional: all | permissioned | superuser — caps the optionalFields the client asks for. */
export const ACCESS_LEVEL_ENV = "PROPREPORTS_ACCESS_LEVEL";

/** Sent on every request (the vendor asks integrations to identify themselves). */
export const USER_AGENT = "WS_LEXX/1.0";

const env = (k: string): string => config.propreportsEnv(k);

export function readConfig(): PropReportsConfig | null {
  const domain = env(ENV_VARS.domain).toLowerCase();
  const token = env(ENV_VARS.token);
  if (!domain || !token) return null;
  const level = env(ACCESS_LEVEL_ENV).toLowerCase();
  return {
    domain,
    token,
    groupId: env(ENV_VARS.groupId) || undefined,
    accountIds: env(ENV_VARS.accountIds) ? env(ENV_VARS.accountIds).split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    userAgent: USER_AGENT,
    accessLevel: isFieldLevel(level) ? level : undefined,
  };
}

export function syncMinutes(): number | null {
  const raw = env(ENV_VARS.syncMinutes);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 5 ? Math.round(n) : null;
}

/** `_lang` kept for callers that pass the reader language (texts are rendered by the route). */
export function statusConfig(_lang?: Lang): PropReportsStatusConfig {
  const cfg = readConfig();
  const missing: string[] = [];
  if (!env(ENV_VARS.domain)) missing.push(ENV_VARS.domain);
  if (!env(ENV_VARS.token)) missing.push(ENV_VARS.token);
  return {
    configured: !!cfg,
    domain: cfg ? hostFor(cfg.domain) : null,
    authMode: cfg ? "token" : null,
    groupId: cfg?.groupId ?? null,
    accountIds: cfg?.accountIds ?? [],
    syncMinutes: syncMinutes(),
    envVars: Object.values(ENV_VARS),
    missing,
    cronConfigured: !!env(ENV_VARS.cronSecret),
  };
}

export function isConfigured(): boolean {
  return readConfig() != null;
}

function hostFor(domain: string): string {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(d)) throw new PropReportsError(propreportsT.tFor("ru")("conn.domainInvalid", { name: ENV_VARS.domain }), 0, "conn.domainInvalid", { name: ENV_VARS.domain });
  return d.endsWith(".propreports.com") ? d : `${d}.propreports.com`;
}

export class PropReportsError extends Error {
  /** `propreports` namespace key + params for the message (rendered per reader language), when it is ours. */
  key?: string;
  params?: Record<string, string | number>;
  /** What the HTTP status means (0 = no answer: network / timeout / deadline). */
  readonly kind: ApiErrorKind;
  constructor(message: string, public readonly status: number, key?: string, params?: Record<string, string | number>) {
    super(message);
    this.key = key;
    this.params = params;
    this.kind = classifyStatus(status);
    this.name = "PropReportsError";
  }
  /** Repeating the same request may help (never for our own deadline / config errors). */
  get retryable(): boolean {
    return isRetryable(this.kind) && !this.key;
  }
}

export interface ClientOptions {
  /** Injected for offline tests; defaults to global fetch. Never pointed at a real host in tests. */
  fetchImpl?: typeof fetch;
  /** Persist the result of checkConnection() to propreports_settings (default true; off in tests). */
  persistChecks?: boolean;
  /** Epoch ms: no request runs past it (the tick budget); each request is cut at min(timeoutMs, deadline − now). */
  deadline?: number;
  /** Per-request timeout (default 25 s). */
  timeoutMs?: number;
  /** Retry backoff sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** Only API v2 (pre-generated token) is supported. */
export type AuthMode = "v2";

/** Scope of a data call: explicit account ids win, else the group (env → UI setting → "-4" My Accounts). */
export interface Scope { accountIds?: string[]; groupId?: string }

/** A file for `upload` (multipart part "file"). */
export interface UploadFile { name: string; data: Blob | Uint8Array; contentType?: string }

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 10_000;
const REPORTS_TTL_MS = 60 * 60_000;
export const DEFAULT_ACCOUNT_FIELDS = "accountName,groups,status,closeDate,deactivationDate";
/** Every accounts optionalField (permissioned on the vendor side). */
export const ALL_ACCOUNT_FIELDS = "accountName,groups,status,closeDate,deactivationDate,clearingName,aggregationUnit,clearingFirmName,source,creationDate,activationDate,suspensionDate";
/** Always requested on fills: the sync keys on them. */
export const FILL_BASE_FIELDS = ["fillId", "propReportsId"] as const;
/** Some installations answer 200 with an error line instead of an HTTP status. */
const ERROR_LINE = /^(error|invalid (token|credentials|login)|unauthori[sz]ed|access denied|authentication (failed|required))/i;

/** `reports` per host, shared by every client (the tick builds a fresh client each run). null = action unavailable. */
const reportsCache = new Map<string, { at: number; list: ReportType[] | null }>();
/** Tests: forget the cached report list. */
export function resetReportsCache(): void { reportsCache.clear(); }

type Attempt = { ok: true; text: string; apiVersion: string | null } | { ok: false; err: PropReportsError; retryAfterMs: number | null; final: boolean };

function retryAfter(h: string | null): number | null {
  const s = Number(h);
  return h && Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, MAX_RETRY_AFTER_MS) : null;
}

export class PropReportsClient {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly persistChecks: boolean;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Epoch ms cap for every request (the tick sets it); null = no cap. */
  deadline: number | null;
  /** "v2" after the first accepted call (kept for the status UI). */
  mode: AuthMode | null = null;
  apiVersionHeader: string | null = null;
  lastCheck: ConnectionState = { checkedAt: null, ok: null, mode: null, version: null, error: null };
  /** Group chosen in the UI (settings); env PROPREPORTS_GROUP_ID wins, then this, then "-4" (My Accounts). */
  defaultGroupId: string | null = null;
  /** Requests sent by this instance (tick summaries report it; the vendor limit is 40 / 4 s per host). */
  requests = 0;
  readonly accessLevel: FieldLevel;

  constructor(private readonly cfg: PropReportsConfig, opts: ClientOptions = {}) {
    this.url = `https://${hostFor(cfg.domain)}/api.php`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.persistChecks = opts.persistChecks ?? true;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.deadline = opts.deadline ?? null;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.accessLevel = cfg.accessLevel ?? "permissioned";
  }

  get host(): string { return hostFor(this.cfg.domain); }

  /** Stable, non-reversible id of host + token (remembering "this token is / is not superuser"); never the token. */
  get tokenFingerprint(): string {
    return createHash("sha256").update(`${this.host}\n${this.cfg.token}`).digest("hex").slice(0, 16);
  }

  private groupFor(explicit?: string): string { return explicit ?? this.cfg.groupId ?? this.defaultGroupId ?? "-4"; }

  /** `accountId=…` (comma list) or `groupId=…` for a data action. */
  scopeParams(scope: Scope = {}): Record<string, string> {
    const accountIds = scope.accountIds ?? this.cfg.accountIds;
    if (accountIds?.length) return { accountId: accountIds.join(",") };
    return { groupId: this.groupFor(scope.groupId) };
  }

  private budget(): number {
    return this.deadline == null ? this.timeoutMs : Math.min(this.timeoutMs, this.deadline - Date.now());
  }

  private deadlineError(action: string): PropReportsError {
    return new PropReportsError(`PropReports ${action}: deadline reached`, 0, "conn.deadline");
  }

  private redact(s: string): string {
    return this.cfg.token ? s.split(this.cfg.token).join("***") : s;
  }

  private body(params: Record<string, string>, file?: UploadFile): URLSearchParams | FormData {
    if (!file) return new URLSearchParams(params);
    const fd = new FormData();
    for (const [k, v] of Object.entries(params)) fd.append(k, v);
    const blob = file.data instanceof Blob ? file.data : new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.contentType ?? "application/octet-stream" });
    fd.append("file", blob, file.name);
    return fd;
  }

  private async attempt(params: Record<string, string>, file?: UploadFile): Promise<Attempt> {
    const limiter = limiterFor(this.host);
    if (this.deadline != null && limiter.waitTime() > this.budget() - 1000) throw this.deadlineError(params.action);
    await limiter.acquire();
    const budget = this.budget();
    if (budget < 1000) throw this.deadlineError(params.action);
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, budget);
    try {
      this.requests++;
      const headers: Record<string, string> = { "User-Agent": this.cfg.userAgent, Accept: "text/csv, text/plain" };
      if (!file) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const res = await this.fetchImpl(this.url, { method: "POST", headers, body: this.body(params, file), signal: ctrl.signal });
      const text = await res.text();
      const apiVersion = res.headers.get("x-api-version");
      this.apiVersionHeader = apiVersion ?? this.apiVersionHeader;
      if (res.ok && ERROR_LINE.test(text.trim())) {
        return { ok: false, err: new PropReportsError(`PropReports ${params.action}: ${this.redact(text.trim().slice(0, 200))}`, 401), retryAfterMs: null, final: true };
      }
      if (res.ok) return { ok: true, text, apiVersion };
      const err = new PropReportsError(`PropReports ${params.action}: HTTP ${res.status} ${this.redact(text.slice(0, 200))}`, res.status);
      return { ok: false, err, retryAfterMs: retryAfter(res.headers.get("retry-after")), final: false };
    } catch (e) {
      const msg = timedOut ? "timeout" : this.redact(e instanceof Error ? e.message : String(e));
      return { ok: false, err: new PropReportsError(`PropReports ${params.action}: ${msg}`, 0), retryAfterMs: null, final: timedOut };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * One request with retries on 429 / 503 / 5xx / network only (not on our own timeout). `idempotent: false`
   * (upload) retries only when the server refused it outright (429 / 503).
   */
  private async post(params: Record<string, string>, opts: { file?: UploadFile; idempotent?: boolean } = {}): Promise<{ text: string; apiVersion: string | null }> {
    const idempotent = opts.idempotent ?? true;
    for (let n = 1; ; n++) {
      const r = await this.attempt(params, opts.file);
      if (r.ok) return r;
      const kind = r.err.kind;
      const may = !r.final && n < MAX_ATTEMPTS && (idempotent ? isRetryable(kind) : kind === "rateLimited" || kind === "unavailable");
      const wait = r.retryAfterMs ?? 1000 * 2 ** (n - 1);
      if (!may || this.budget() < wait + 5000) throw r.err;
      logger.warn({ action: params.action, status: r.err.status, kind, attempt: n, waitMs: wait }, "propreports: retrying");
      await this.sleep(wait);
    }
  }

  /** One API call with the v2 token (no login fallback: the v1 flow is deprecated). */
  async call(action: string, params: Record<string, string> = {}, opts: { file?: UploadFile; idempotent?: boolean } = {}): Promise<string> {
    const { text } = await this.post({ action, ...params, token: this.cfg.token }, opts);
    this.mode = "v2";
    return text;
  }

  /**
   * Read-only connection probe (action=version). Persists the result for the setup wizard; never throws — the result
   * carries the error text instead.
   */
  async checkConnection(): Promise<ConnectionState & { apiVersionHeader: string | null; host: string }> {
    let version: string | null = null;
    let error: string | null = null;
    let errorKey: string | undefined;
    let errorParams: Record<string, string | number> | undefined;
    try {
      version = await this.version();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (e instanceof PropReportsError && e.key) { errorKey = e.key; errorParams = e.params; }
      if (e instanceof PropReportsError && (e.status === 401 || e.status === 403)) {
        errorKey = "conn.tokenRejected";
        errorParams = { status: e.status, token: ENV_VARS.token };
        error = propreportsT.tryFor("ru", errorKey, errorParams) ?? error;
      }
    }
    const state: ConnectionState = {
      checkedAt: new Date().toISOString(),
      ok: error == null,
      mode: error == null ? "v2" : null,
      version,
      error,
      ...(errorKey ? { errorKey, errorParams } : {}),
    };
    this.lastCheck = state;
    if (this.persistChecks) await setSetting("connection", state).catch((err) => logger.warn({ err }, "propreports: could not persist connection check"));
    return { ...state, apiVersionHeader: this.apiVersionHeader, host: this.host };
  }

  async callCsv(action: string, params: Record<string, string> = {}): Promise<CsvTable> {
    return parseCsvTable(await this.call(action, params));
  }

  /** Follows the `Page X/Y` trailer; the header row is kept once. */
  async callCsvAllPages(action: string, params: Record<string, string> = {}, maxPages = 50): Promise<CsvTable> {
    const first = await this.callCsv(action, { ...params, page: "1" });
    const total = Math.min(first.page?.total ?? 1, maxPages);
    for (let p = 2; p <= total; p++) {
      const next = await this.callCsv(action, { ...params, page: String(p) });
      first.rows.push(...next.rows);
    }
    if ((first.page?.total ?? 1) > maxPages) logger.warn({ action, total: first.page?.total }, "propreports: page cap reached");
    return first;
  }

  /** One page when `page` is given, else every page. */
  private pageOrAll(action: string, params: Record<string, string>, page?: number | null): Promise<CsvTable> {
    return page ? this.callCsv(action, { ...params, page: String(page) }) : this.callCsvAllPages(action, params);
  }

  async version(): Promise<string> {
    return (await this.call("version")).trim();
  }

  /**
   * Accounts of the group (all visible ones for "-4"), with the status fields by default
   * (optionalFields=accountName,groups,status,closeDate,deactivationDate; ALL_ACCOUNT_FIELDS for everything).
   */
  async accounts(opts: { optionalFields?: string | readonly string[]; groupId?: string } = {}): Promise<PropReportsAccount[]> {
    const f = opts.optionalFields;
    const params: Record<string, string> = { optionalFields: f == null ? DEFAULT_ACCOUNT_FIELDS : typeof f === "string" ? f : f.join(",") };
    const g = this.groupFor(opts.groupId);
    if (g !== "-4") params.groupId = g;
    return parseAccountsTable(await this.callCsvAllPages("accounts", params));
  }

  async groups(): Promise<Array<{ groupId: string; name: string }>> {
    const t = await this.callCsv("groups");
    return t.rows.map((r) => ({ groupId: (r[0] ?? "").trim(), name: (r[1] ?? "").trim() })).filter((g) => g.groupId);
  }

  /** fills optionalFields: fillId + propReportsId always, plus the extras this token's access level may ask for. */
  fillFields(extra: readonly string[] = []): string {
    return [...new Set([...FILL_BASE_FIELDS, ...allowedFields("fills", extra, this.accessLevel)])].join(",");
  }

  private fillParams(startDate: string, endDate: string, scope: FillQuery): Record<string, string> {
    return { startDate, endDate, optionalFields: this.fillFields(scope.optionalFields), ...fillFilterParams(scope.filters), ...this.scopeParams(scope) };
  }

  /** Fills for a date range (all pages); advanced filters and extra optionalFields per `scope`. */
  async fills(startDate: string, endDate: string, scope: FillQuery = {}): Promise<{ fills: Fill[]; raw: string; issues: Array<{ line: number; message: string }>; feeColumns: DetectedFeeColumn[] }> {
    // Re-assemble pages into one CSV text so the file parser is the single source of truth.
    return parseFillsTable(await this.callCsvAllPages("fills", this.fillParams(startDate, endDate, scope)), scope.lang);
  }

  /**
   * One page of fills (1-based), for callers that page under a deadline. `page.total` comes from the `Page X/Y`
   * trailer (1 when absent).
   */
  async fillsPage(startDate: string, endDate: string, page: number, scope: FillQuery = {}): Promise<{ fills: Fill[]; table: CsvTable; page: { current: number; total: number }; issues: Array<{ line: number; message: string }>; feeColumns: DetectedFeeColumn[] }> {
    const t = await this.callCsv("fills", { ...this.fillParams(startDate, endDate, scope), page: String(page) });
    const parsed = parseFillsTable(t, scope.lang);
    return { fills: parsed.fills, table: t, page: t.page ?? { current: page, total: 1 }, issues: parsed.issues, feeColumns: parsed.feeColumns };
  }

  /** Raw positions table (RISK-LIVE parses it); optionalFields accountName,clearingName,aggregationUnit. */
  async positions(startDate: string, endDate: string, type: PositionType = "open", scope: Scope = {}, opts: { optionalFields?: readonly string[] } = {}): Promise<CsvTable> {
    const params: Record<string, string> = { startDate, endDate, type, ...this.scopeParams(scope) };
    const fields = allowedFields("positions", opts.optionalFields ?? [], this.accessLevel);
    if (fields.length) params.optionalFields = fields.join(",");
    return this.callCsvAllPages("positions", params);
  }

  /** Typed positions (v2: Qty before Symbol, Qty 0 = closed, fee columns collected by name). */
  async positionRows(startDate: string, endDate: string, type: PositionType = "open", scope: Scope = {}, opts: { optionalFields?: readonly string[] } = {}): Promise<PositionRow[]> {
    return parsePositions(await this.positions(startDate, endDate, type, scope, opts));
  }

  /** Cash adjustments (fees, transfers, corrections…) for a date range; propReportsId is requested by default. */
  async adjustments(params: { startDate: string; endDate: string; optionalFields?: string } & Scope): Promise<{ adjustments: PropReportsAdjustment[]; table: CsvTable }> {
    const { startDate, endDate, optionalFields, ...scope } = params;
    const t = await this.callCsvAllPages("adjustments", { startDate, endDate, optionalFields: optionalFields ?? "propReportsId", ...this.scopeParams(scope) });
    return { adjustments: parseAdjustmentsTable(t), table: t };
  }

  /** Locates for a date range (one page when `page` is set). */
  async locates(o: { startDate: string; endDate: string; page?: number | null; optionalFields?: readonly string[] } & Scope): Promise<{ locates: LocateRow[]; page: { current: number; total: number } | null }> {
    const fields = allowedFields("locates", o.optionalFields ?? ["propReportsId"], this.accessLevel);
    const params: Record<string, string> = { startDate: o.startDate, endDate: o.endDate, ...this.scopeParams(o) };
    if (fields.length) params.optionalFields = fields.join(",");
    const t = await this.pageOrAll("locates", params, o.page);
    return { locates: parseLocates(t), page: t.page };
  }

  /** Report types (cached per host for an hour; null when the server has no `reports` action). */
  async reports(opts: { fresh?: boolean } = {}): Promise<ReportType[]> {
    const c = reportsCache.get(this.host);
    if (!opts.fresh && c?.list && Date.now() - c.at < REPORTS_TTL_MS) return c.list;
    const list = parseReportsList(await this.callCsv("reports"));
    reportsCache.set(this.host, { at: Date.now(), list });
    return list;
  }

  /** The type's row from `reports` (null when unknown or the list is unavailable — the caller's scope is used then). */
  private async reportInfo(type: string): Promise<ReportType | null> {
    const c = reportsCache.get(this.host);
    if (c && Date.now() - c.at < (c.list ? REPORTS_TTL_MS : REPORTS_TTL_MS / 6)) return c.list?.find((r) => r.type === type) ?? null;
    try {
      return (await this.reports({ fresh: true })).find((r) => r.type === type) ?? null;
    } catch (e) {
      if (e instanceof PropReportsError && e.key === "conn.deadline") throw e;
      reportsCache.set(this.host, { at: Date.now(), list: null });
      return null;
    }
  }

  /**
   * One report as text. accountId or groupId by the type's scope (from `reports`; a group-scoped type gets the group
   * even when an account was passed), `mode` checked against the documented values, `baseCurrency` for multi-currency
   * types. Throws FilterError on bad parameters.
   */
  async report(type: string, startDate: string, endDate: string, scope: { accountId?: string; groupId?: string }, mode?: string, opts: { baseCurrency?: string } = {}): Promise<string> {
    const info = await this.reportInfo(type);
    const params = reportParams({ type, startDate, endDate, mode, baseCurrency: opts.baseCurrency }, info);
    if (info?.scope === "group") params.groupId = this.groupFor(scope.groupId);
    else if (scope.accountId) params.accountId = scope.accountId;
    else if (info?.scope === "account" && this.cfg.accountIds?.length) params.accountId = this.cfg.accountIds.join(",");
    else params.groupId = this.groupFor(scope.groupId);
    return this.call("report", params);
  }

  // ── superuser only (403 without the right) ──────────────────────────────────────────────────────────────────

  async instruments(o: { tradeDate: string; optionalFields?: readonly string[] } & Scope): Promise<InstrumentRow[]> {
    const params: Record<string, string> = { tradeDate: o.tradeDate };
    if (o.accountIds?.length) params.accountId = o.accountIds.join(",");
    else if (o.groupId) params.groupId = o.groupId;
    const fields = allowedFields("instruments", o.optionalFields ?? [], this.accessLevel);
    if (fields.length) params.optionalFields = fields.join(",");
    return parseInstruments(await this.callCsv("instruments", params));
  }

  async profiles(o: { email?: string; userId?: string; page?: number | null } = {}): Promise<{ profiles: ProfileRow[]; page: { current: number; total: number } | null }> {
    const params: Record<string, string> = {};
    if (o.email) params.email = o.email;
    if (o.userId) params.userid = o.userId;
    const t = await this.pageOrAll("profiles", params, o.page);
    return { profiles: parseProfiles(t), page: t.page };
  }

  /** multipart upload; a ZIP is queued file by file (except type=document). Returns the queued upload rows. */
  async upload(file: UploadFile, opts: UploadOptions): Promise<UploadSummary[]> {
    return parseUploadSummaries(parseCsvTable(await this.call("upload", uploadParams(opts), { file, idempotent: false })));
  }

  async uploadStatus(uploadIds: string | readonly string[]): Promise<UploadStatusResult> {
    return parseUploadStatus(await this.call("uploadStatus", { uploadId: uploadIdsParam(uploadIds) }));
  }

  /** Empty body (200) = still processing or nothing to report. */
  async uploadMessages(uploadId: string): Promise<UploadMessages> {
    return parseUploadMessages(await this.call("uploadMessages", { uploadId: uploadIdsParam(uploadId) }));
  }

  /** 25 rows per page; aborted / deleted are hidden unless asked for in `status`. */
  async uploadSearch(o: UploadSearchOptions = {}): Promise<{ uploads: UploadSummary[]; page: { current: number; total: number } | null }> {
    const t = await this.callCsv("uploadSearch", uploadSearchParams(o));
    return { uploads: parseUploadSummaries(t), page: t.page };
  }
}

export type PositionType = "all" | "open" | "closed" | "long" | "short";
/** fills/fillsPage options: scope + reader language + advanced filters + extra optionalFields. */
export type FillQuery = Scope & { lang?: Lang; filters?: FillFilters; optionalFields?: readonly string[] };

let shared: PropReportsClient | null = null;
/** Lazily built from env; returns null when not configured. */
export function getClient(): PropReportsClient | null {
  const cfg = readConfig();
  if (!cfg) return null;
  if (!shared || shared.host !== hostFor(cfg.domain)) shared = new PropReportsClient(cfg);
  return shared;
}

/** getClient() + UI settings applied (group chosen in /integrations; env still wins). */
export async function getConfiguredClient(): Promise<PropReportsClient | null> {
  const client = getClient();
  if (!client) return null;
  const settings = await getSettings().catch(() => null);
  client.defaultGroupId = settings?.groupId ?? null;
  return client;
}

/**
 * A fresh client for one tick / background run (not the shared one: its `deadline` caps every request), with the UI
 * group applied. Null when not configured. The 40 / 4 s limiter is per host, so it is shared with every other client.
 */
export async function createTickClient(opts: { deadline: number; fetchImpl?: typeof fetch }): Promise<PropReportsClient | null> {
  const cfg = readConfig();
  if (!cfg) return null;
  const client = new PropReportsClient(cfg, { deadline: opts.deadline, fetchImpl: opts.fetchImpl });
  const settings = await getSettings().catch(() => null);
  client.defaultGroupId = settings?.groupId ?? null;
  return client;
}

/** Effective group for API calls: env → settings → "-4" (My Accounts). */
export function effectiveGroupId(settingsGroupId: string | null | undefined): { groupId: string; source: "env" | "settings" | "default" } {
  const envGroup = env(ENV_VARS.groupId);
  if (envGroup) return { groupId: envGroup, source: "env" };
  if (settingsGroupId) return { groupId: settingsGroupId, source: "settings" };
  return { groupId: "-4", source: "default" };
}
