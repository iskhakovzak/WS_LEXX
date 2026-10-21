/**
 * PropReports client (v2 only): token on every call, User-Agent, no v1 login fallback, deadline-capped requests,
 * paged fills, accounts with status fields, adjustments. fetch is mocked — never a real host.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const { PropReportsClient, PropReportsError, parseAccountsTable, parseAdjustmentsTable, USER_AGENT } = await import("../../propreports/client");
const { parseCsvTable } = await import("../../propreports/csv");

type Sent = { params: URLSearchParams; headers: Record<string, string> };

function mockFetch(reply: (p: URLSearchParams) => { status?: number; body: string }, log: Sent[]): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const params = new URLSearchParams(String(init?.body ?? ""));
    log.push({ params, headers: init?.headers as Record<string, string> });
    const r = reply(params);
    return new Response(r.body, { status: r.status ?? 200, headers: { "x-api-version": "2" } });
  }) as typeof fetch;
}

const cfg = { domain: "demo-firm", token: "tok-123", userAgent: USER_AGENT };

describe("PropReportsClient (v2 only)", () => {
  it("sends the token and User-Agent WS_LEXX/1.0 on every call", async () => {
    const log: Sent[] = [];
    const c = new PropReportsClient(cfg, { fetchImpl: mockFetch(() => ({ body: "2.3.1\n" }), log), persistChecks: false });
    const r = await c.checkConnection();
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("v2");
    expect(r.version).toBe("2.3.1");
    expect(log[0].params.get("token")).toBe("tok-123");
    expect(log[0].params.get("action")).toBe("version");
    expect(log[0].headers["User-Agent"]).toBe("WS_LEXX/1.0");
    expect(c.host).toBe("demo-firm.propreports.com");
  });

  it("a rejected token is an error — no legacy login is ever attempted", async () => {
    const log: Sent[] = [];
    const c = new PropReportsClient(cfg, { fetchImpl: mockFetch(() => ({ status: 401, body: "Invalid token" }), log), persistChecks: false });
    const r = await c.checkConnection();
    expect(r.ok).toBe(false);
    expect(r.mode).toBeNull();
    expect(r.errorKey).toBe("conn.tokenRejected");
    expect(r.error).toContain("PROPREPORTS_TOKEN");
    expect(log.some((l) => l.params.get("action") === "login")).toBe(false);
    await expect(c.version()).rejects.toBeInstanceOf(PropReportsError);
  });

  it("refuses to start a request past the deadline", async () => {
    const log: Sent[] = [];
    const c = new PropReportsClient(cfg, { fetchImpl: mockFetch(() => ({ body: "ok" }), log), persistChecks: false, deadline: Date.now() + 500 });
    await expect(c.version()).rejects.toMatchObject({ key: "conn.deadline" });
    expect(log).toHaveLength(0);
  });

  it("fillsPage requests fillId + propReportsId, the group scope and reads the Page trailer", async () => {
    const log: Sent[] = [];
    const csv = [
      "Date/Time,Account,B/S,Qty,Symbol,Price,Route,Comm,Trade Date,Order Id,Status,Fill Id,PropReports Id",
      "2026-10-19 09:35:12.120,DEMO1,B,100,AAPL,150.00,ARCA,0.50,2026-10-19,1001,,F1,PR1",
      "Page 2/3",
    ].join("\n");
    const c = new PropReportsClient({ ...cfg, groupId: "77" }, { fetchImpl: mockFetch(() => ({ body: csv }), log), persistChecks: false });
    const r = await c.fillsPage("2026-10-18", "2026-10-19", 2);
    expect(r.page).toEqual({ current: 2, total: 3 });
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]).toMatchObject({ account: "DEMO1", symbol: "AAPL", fillId: "F1", propReportsId: "PR1" });
    const p = log[0].params;
    expect(p.get("optionalFields")).toBe("fillId,propReportsId");
    expect(p.get("groupId")).toBe("77");
    expect(p.get("page")).toBe("2");
  });

  it("accounts asks for the status fields by default", async () => {
    const log: Sent[] = [];
    const csv = "Account Id,Account,Groups,Account Name,Status,Close Date,Deactivation Date\n12,WSL007,Desk|A,Alice,Inactive,2026-09-30,2026-10-01\n";
    const c = new PropReportsClient(cfg, { fetchImpl: mockFetch(() => ({ body: csv }), log), persistChecks: false });
    const list = await c.accounts();
    expect(log[0].params.get("optionalFields")).toBe("accountName,groups,status,closeDate,deactivationDate");
    expect(list[0]).toMatchObject({ accountId: "12", account: "WSL007", groups: ["Desk", "A"], accountName: "Alice", status: "inactive", closeDate: "2026-09-30", deactivationDate: "2026-10-01" });
  });
});

describe("table parsers", () => {
  it("accounts without the optional columns → nulls", () => {
    const t = parseCsvTable("Account Id,Account\n1,A1\n");
    expect(parseAccountsTable(t)[0]).toMatchObject({ account: "A1", status: null, closeDate: null, deactivationDate: null });
  });
  it("adjustments: amounts with $ / parentheses, both legs of a pair kept", () => {
    const t = parseCsvTable([
      "Date,Account,Category,Amount,Comment,Qty,Symbol,Price,PropReports Id",
      "2026-10-17,DEMO1,Fee,\"($12.50)\",platform,,,,P9",
      "2026-10-17,DEMO1,Fee,12.50,platform reversal,,,,P10",
      "2026-10-17,,Fee,1,no account,,,,P11",
    ].join("\n"));
    const a = parseAdjustmentsTable(t);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ date: "2026-10-17", account: "DEMO1", category: "Fee", amount: -12.5, comment: "platform", qty: null, propReportsId: "P9" });
    expect(a[1].amount).toBe(12.5);
  });
});
