/**
 * PropReports client — API v2 wiring: shared per-host limiter, error kinds + retry policy, multipart upload, reports /
 * report scope + mode / baseCurrency checks, fills filters + optionalFields by access level, typed positions, locates,
 * accounts optionalFields, upload status / messages / search, superuser memory, route error mapping.
 * fetch is mocked — never a real host.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cursors = new Map<string, unknown>();
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM propreports_cursors WHERE key = \$1/.test(sql)) return { rows: cursors.has(String(params[0])) ? [{ value: cursors.get(String(params[0])) }] : [], rowCount: 0 };
      if (/INSERT INTO propreports_cursors/.test(sql)) { cursors.set(String(params[0]), JSON.parse(String(params[1]))); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }),
  },
}));

const { PropReportsClient, PropReportsError, USER_AGENT, ALL_ACCOUNT_FIELDS, resetReportsCache } = await import("../../propreports/client");
const { limiterFor } = await import("../../propreports/rate-limit");
const { FilterError } = await import("../../propreports/filters");
const { reportParams, uploadParams, uploadIdsParam, uploadSearchParams } = await import("../../propreports/params-v2");
const { fieldsUpTo } = await import("../../propreports/spec");
const { superuserState, rememberSuperuser } = await import("../../propreports/superuser");
const { upstreamError } = await import("../../../routes/propreports-api");

type Sent = { params: URLSearchParams; form: FormData | null; headers: Record<string, string> };
type Reply = { status?: number; body: string; headers?: Record<string, string> } | Error;

function mockFetch(reply: (p: URLSearchParams, n: number) => Reply, log: Sent[]): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const form = init?.body instanceof FormData ? init.body : null;
    const params = form ? new URLSearchParams([...form.entries()].filter(([, v]) => typeof v === "string") as Array<[string, string]>) : new URLSearchParams(String(init?.body ?? ""));
    log.push({ params, form, headers: init?.headers as Record<string, string> });
    const r = reply(params, log.length);
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status ?? 200, headers: { "x-api-version": "2", ...(r.headers ?? {}) } });
  }) as typeof fetch;
}

const cfg = { domain: "demo-firm", token: "tok-123", userAgent: USER_AGENT };
const make = (reply: (p: URLSearchParams, n: number) => Reply, log: Sent[], extra: Partial<typeof cfg & { accessLevel: "all" | "permissioned" | "superuser"; groupId: string }> = {}, slept: number[] = []) =>
  new PropReportsClient({ ...cfg, ...extra }, { fetchImpl: mockFetch(reply, log), persistChecks: false, sleep: async (ms) => { slept.push(ms); } });

beforeEach(() => { resetReportsCache(); cursors.clear(); });

describe("rate limit: one sliding window per host for every client", () => {
  it("two instances count into the same limiter", async () => {
    const log: Sent[] = [];
    const host = "limiter-test.propreports.com";
    const before = limiterFor(host).inWindow;
    await make(() => ({ body: "2" }), log, { domain: "limiter-test" }).version();
    await make(() => ({ body: "2" }), log, { domain: "limiter-test" }).version();
    expect(limiterFor(host)).toBe(limiterFor(host));
    expect(limiterFor(host).inWindow).toBe(before + 2);
    expect(limiterFor(host).max).toBe(40);
    expect(limiterFor(host).windowMs).toBe(4000);
  });
});

describe("errors and retries", () => {
  it("503 then 200: retried once after 1 s", async () => {
    const log: Sent[] = [];
    const slept: number[] = [];
    const c = make((_p, n) => (n === 1 ? { status: 503, body: "maintenance" } : { body: "2.1" }), log, {}, slept);
    expect(await c.version()).toBe("2.1");
    expect(log).toHaveLength(2);
    expect(slept).toEqual([1000]);
  });

  it("429 honours Retry-After; gives up after 3 attempts with kind rateLimited", async () => {
    const log: Sent[] = [];
    const slept: number[] = [];
    const c = make(() => ({ status: 429, body: "slow down", headers: { "retry-after": "3" } }), log, {}, slept);
    const err = await c.version().catch((e) => e);
    expect(err).toBeInstanceOf(PropReportsError);
    expect(err.kind).toBe("rateLimited");
    expect(err.retryable).toBe(true);
    expect(log).toHaveLength(3);
    expect(slept).toEqual([3000, 3000]);
  });

  it("400 / 401 / 403 / 404 / 405 are classified and never retried", async () => {
    for (const [status, kind] of [[400, "badRequest"], [401, "auth"], [403, "forbidden"], [404, "notFound"], [405, "method"]] as const) {
      const log: Sent[] = [];
      const err = await make(() => ({ status, body: "nope" }), log).version().catch((e) => e);
      expect(err.kind).toBe(kind);
      expect(err.retryable).toBe(false);
      expect(log).toHaveLength(1);
    }
  });

  it("network errors are retried; 5xx is kind server", async () => {
    const log: Sent[] = [];
    const c = make((_p, n) => (n < 3 ? new TypeError("fetch failed") : { body: "ok" }), log);
    expect(await c.version()).toBe("ok");
    expect(log).toHaveLength(3);
    const err = await make(() => ({ status: 502, body: "bad gateway" }), []).version().catch((e) => e);
    expect(err.kind).toBe("server");
  });

  it("a 200 error line is an auth error (no retry) and the token never leaks into messages", async () => {
    const log: Sent[] = [];
    const err = await make(() => ({ body: "Invalid token tok-123" }), log).version().catch((e) => e);
    expect(err.kind).toBe("auth");
    expect(log).toHaveLength(1);
    expect(err.message).not.toContain("tok-123");
    const e2 = await make(() => ({ status: 400, body: "bad token=tok-123" }), []).version().catch((e) => e);
    expect(e2.message).toContain("***");
    expect(e2.message).not.toContain("tok-123");
  });
});

describe("upload (multipart, superuser)", () => {
  const summary = "Upload Id,Date/Time,Replacement Key,File Name,File Size,Source,Parser,Status,Comment,Errors,Notes\n42,2026-05-01 10:30:00,k1,fills.csv,10,Sterling,Generic,Scheduling,,N,N\n";

  it("sends FormData with the file Blob, the fields and the token; no urlencoded content type", async () => {
    const log: Sent[] = [];
    const c = make(() => ({ body: summary }), log);
    const rows = await c.upload({ name: "fills.csv", data: new TextEncoder().encode("a,b\n1,2\n"), contentType: "text/csv" }, { type: "fill", replacementKey: "k1", reconciliationMode: "account", forceDuplicateProcessing: false });
    expect(rows[0]).toMatchObject({ uploadId: "42", status: "Scheduling" });
    const s = log[0];
    expect(s.form).not.toBeNull();
    const file = s.form!.get("file") as File;
    expect(file.name).toBe("fills.csv");
    expect(await file.text()).toBe("a,b\n1,2\n");
    expect(s.params.get("action")).toBe("upload");
    expect(s.params.get("type")).toBe("fill");
    expect(s.params.get("token")).toBe("tok-123");
    expect(s.params.get("forceDuplicateProcessing")).toBe("false");
    expect(s.headers["Content-Type"]).toBeUndefined();
  });

  it("is retried on 503 but not on 500 (the file may have been taken)", async () => {
    const log: Sent[] = [];
    await make((_p, n) => (n === 1 ? { status: 503, body: "" } : { body: summary }), log).upload({ name: "f.csv", data: new Uint8Array([1]) }, { type: "fill" });
    expect(log).toHaveLength(2);
    const log2: Sent[] = [];
    const err = await make(() => ({ status: 500, body: "" }), log2).upload({ name: "f.csv", data: new Uint8Array([1]) }, { type: "fill" }).catch((e) => e);
    expect(err.kind).toBe("server");
    expect(log2).toHaveLength(1);
  });

  it("uploadStatus (two sections), uploadMessages (empty = running), uploadSearch params", async () => {
    const details = "Upload Id,Date,Data Type,Entries,Status\n42,2026-05-01,Fill,5,Uploaded\n";
    const log: Sent[] = [];
    const c = make((p) => (p.get("action") === "uploadStatus" ? { body: `${summary}\n${details}` } : p.get("action") === "uploadMessages" ? { body: "" } : { body: `${summary}Page 1/2\n` }), log);
    const st = await c.uploadStatus(["42", "43", "42"]);
    expect(log[0].params.get("uploadId")).toBe("42,43");
    expect(st.summaries).toHaveLength(1);
    expect(st.details[0]).toMatchObject({ dataType: "Fill", entries: 5 });
    expect((await c.uploadMessages("42")).empty).toBe(true);
    const s = await c.uploadSearch({ status: ["aborted", "deleted"], uploadDate: "2026-05-01", page: 1 });
    expect(s.page).toEqual({ current: 1, total: 2 });
    expect(log[2].params.get("status")).toBe("aborted,deleted");
  });
});

describe("reports + report", () => {
  const list = "Type,Description,Group/Account,Multi-Currency\nsummary,Summary by Date,Account,N\ntotalsByAccount,Totals by Account,Group,Y\n";

  it("group-scoped type gets groupId, account type keeps accountId; the list is cached across clients", async () => {
    const log: Sent[] = [];
    const reply = (p: URLSearchParams) => (p.get("action") === "reports" ? { body: list } : { body: "Date,Net\n" });
    const c = make(reply, log, { groupId: "77" });
    await c.report("totalsByAccount", "2026-10-01", "2026-10-02", { accountId: "5" }, "2", { baseCurrency: "usd" });
    const r1 = log.find((l) => l.params.get("action") === "report")!.params;
    expect(r1.get("groupId")).toBe("77");
    expect(r1.get("accountId")).toBeNull();
    expect(r1.get("mode")).toBe("2");
    expect(r1.get("baseCurrency")).toBe("USD");
    const log2: Sent[] = [];
    await make(reply, log2).report("summary", "2026-10-01", "2026-10-02", { accountId: "5" });
    expect(log2.map((l) => l.params.get("action"))).toEqual(["report"]);
    expect(log2[0].params.get("accountId")).toBe("5");
  });

  it("mode and baseCurrency are checked before any report request", async () => {
    const log: Sent[] = [];
    const c = make((p) => (p.get("action") === "reports" ? { body: list } : { body: "x" }), log);
    await expect(c.report("totalsByAccount", "2026-10-01", "2026-10-02", {}, "3")).rejects.toBeInstanceOf(FilterError);
    await expect(c.report("summary", "2026-10-01", "2026-10-02", { accountId: "1" }, "1")).rejects.toBeInstanceOf(FilterError);
    await expect(c.report("summary", "2026-10-01", "2026-10-02", { accountId: "1" }, undefined, { baseCurrency: "EUR" })).rejects.toThrow(/multi-currency/);
    expect(log.filter((l) => l.params.get("action") === "report")).toHaveLength(0);
  });

  it("no reports action on the server: the caller's scope is used", async () => {
    const log: Sent[] = [];
    const c = make((p) => (p.get("action") === "reports" ? { status: 404, body: "unknown action" } : { body: "x" }), log);
    await c.report("summary", "2026-10-01", "2026-10-02", { accountId: "9" });
    await c.report("summary", "2026-10-01", "2026-10-02", { accountId: "9" });
    expect(log.map((l) => l.params.get("action"))).toEqual(["reports", "report", "report"]);
    expect(log[1].params.get("accountId")).toBe("9");
  });
});

describe("fills, positions, accounts, locates", () => {
  it("fills: advanced filters and optionalFields capped by the access level (fillId + propReportsId always)", async () => {
    const log: Sent[] = [];
    const body = "Date/Time,Account,B/S,Qty,Symbol,Price,Route\n";
    await make(() => ({ body }), log, { accessLevel: "all" }).fills("2026-10-01", "2026-10-01", { filters: { symbol: { prefix: "AAP" }, type: ["B", "T"], quantity: { gte: 100 } }, optionalFields: ["currency", "accountName", "execBroker"] });
    const p = log[0].params;
    expect(p.get("optionalFields")).toBe("fillId,propReportsId,currency");
    expect(p.get("symbol")).toBe("AAP%");
    expect(p.get("type")).toBe("B,T");
    expect(p.get("quantity")).toBe(">=100");
    const log2: Sent[] = [];
    await make(() => ({ body }), log2, { accessLevel: "superuser" }).fillsPage("2026-10-01", "2026-10-01", 1, { optionalFields: ["execBroker", "accountName"], filters: { contra: "NSDQ" } });
    expect(log2[0].params.get("optionalFields")).toBe("fillId,propReportsId,execBroker,accountName");
    expect(log2[0].params.get("contra")).toBe("NSDQ");
    await expect(make(() => ({ body }), []).fills("2026-10-01", "2026-10-01", { filters: { symbol: "%AAPL" } })).rejects.toBeInstanceOf(FilterError);
    expect(fieldsUpTo("fills", "all")).not.toContain("accountName");
  });

  it("positions: raw table kept for RISK-LIVE, typed rows, optionalFields", async () => {
    const log: Sent[] = [];
    const csv = "Date,Account,Qty,Symbol,Avg,Close,Unrealized Delta,Unrealized,Qty Traded,Realized,Comm,Currency,Spot Rate,Account Name\n2026-10-19,A1,0,spy,0,0,0,0,200,12.5,0.4,USD,1,Alice\n";
    const c = make(() => ({ body: csv }), log);
    expect((await c.positions("2026-10-19", "2026-10-19")).header[2]).toBe("Qty");
    expect(log[0].params.get("optionalFields")).toBeNull();
    const rows = await c.positionRows("2026-10-19", "2026-10-19", "all", {}, { optionalFields: ["accountName"] });
    expect(log[1].params.get("optionalFields")).toBe("accountName");
    expect(log[1].params.get("type")).toBe("all");
    expect(rows[0]).toMatchObject({ qty: 0, symbol: "SPY", realized: 12.5, accountName: "Alice", fees: { Comm: 0.4 } });
  });

  it("accounts: every optional field parsed", async () => {
    const log: Sent[] = [];
    const csv = "Account Id,Account,Clearing Name,Aggregation Unit,Clearing Firm Name,Source,Creation Date,Activation Date,Suspension Date\n1,A1,CLR1,AU,Firm,Sterling,2024-01-02 10:00,2024-01-03,\n";
    const list = await make(() => ({ body: csv }), log).accounts({ optionalFields: ALL_ACCOUNT_FIELDS });
    expect(log[0].params.get("optionalFields")).toBe(ALL_ACCOUNT_FIELDS);
    expect(list[0]).toMatchObject({ clearingName: "CLR1", aggregationUnit: "AU", clearingFirmName: "Firm", source: "Sterling", creationDate: "2024-01-02", activationDate: "2024-01-03", suspensionDate: null });
  });

  it("locates: scope, page, propReportsId by default", async () => {
    const log: Sent[] = [];
    const csv = "Date/Time,Account,Qty,Symbol,Cost,Locate Id,PropReports Id\n2026-10-19 09:30:00,A1,500,bac,5,L1,9\nPage 1/3\n";
    const r = await make(() => ({ body: csv }), log).locates({ startDate: "2026-10-19", endDate: "2026-10-19", accountIds: ["5"], page: 1 });
    expect(r.page).toEqual({ current: 1, total: 3 });
    expect(r.locates[0]).toMatchObject({ symbol: "BAC", qty: 500, locateId: "L1", propReportsId: "9" });
    expect(log[0].params.get("accountId")).toBe("5");
    expect(log[0].params.get("optionalFields")).toBe("propReportsId");
  });
});

describe("params-v2", () => {
  it("report params", () => {
    expect(reportParams({ type: "performance", startDate: "2026-01-01", endDate: "2026-01-31", mode: 3 })).toMatchObject({ mode: "3" });
    expect(() => reportParams({ type: "performance", startDate: "2026-02-01", endDate: "2026-01-31" })).toThrow(FilterError);
    expect(() => reportParams({ type: "x", startDate: "1/1/2026", endDate: "2026-01-31" })).toThrow(FilterError);
  });
  it("upload params: fill-only modes, clearing needs a firm", () => {
    expect(uploadParams({ type: "fill", processingMode: "tradeFeeAdjustments", reconciliationMode: "clearing", clearingFirmId: "12" })).toEqual({ type: "fill", processingMode: "tradeFeeAdjustments", reconciliationMode: "clearing", clearingFirmId: "12" });
    expect(() => uploadParams({ type: "adjustment", processingMode: "tradeFeeAdjustments" })).toThrow(/only for type=fill/);
    expect(() => uploadParams({ type: "fill", reconciliationMode: "clearing" })).toThrow(/clearingFirmId/);
    expect(() => uploadParams({ type: "bogus" as never })).toThrow(FilterError);
  });
  it("upload ids and search", () => {
    expect(uploadIdsParam("1, 2,2")).toBe("1,2");
    expect(() => uploadIdsParam("1,x")).toThrow(FilterError);
    expect(() => uploadSearchParams({ uploadDate: "2026-01-01", actionDate: "2026-01-02" })).toThrow(FilterError);
    expect(uploadSearchParams({ replacementKey: "batch-%", type: "locate" })).toEqual({ replacementKey: "batch-%", type: "locate" });
  });
});

describe("superuser memory and route error mapping", () => {
  it("remembers per token fingerprint", async () => {
    const a = make(() => ({ body: "" }), []);
    const b = make(() => ({ body: "" }), [], { token: "other" } as never);
    expect(a.tokenFingerprint).not.toContain("tok-123");
    expect((await superuserState(a)).superuser).toBeNull();
    await rememberSuperuser(a, false, "uploadSearch");
    expect((await superuserState(a)).superuser).toBe(false);
    expect((await superuserState(b)).superuser).toBeNull();
  });

  it("maps kinds to API error codes", () => {
    const code = (e: unknown) => (upstreamError(e) as { code: string }).code;
    expect(code(new PropReportsError("x", 403))).toBe("PROPREPORTS_SUPERUSER_REQUIRED");
    expect(code(new PropReportsError("x", 401))).toBe("PROPREPORTS_TOKEN_REJECTED");
    expect(code(new PropReportsError("x", 429))).toBe("PROPREPORTS_BUSY");
    expect(code(new PropReportsError("x", 400))).toBe("PROPREPORTS_REJECTED");
    expect(code(new PropReportsError("x", 0))).toBe("UPSTREAM_FAILED");
    expect(code(new PropReportsError("x", 0, "conn.deadline"))).toBe("TIMEOUT");
    expect(code(new FilterError("mode", "bad"))).toBe("PROPREPORTS_REQUEST_INVALID");
  });
});
