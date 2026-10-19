/**
 * PropReports API v2 pure pieces: fills advanced filters, the 40 / 4 s limiter, readers for reports / positions /
 * locates / instruments / profiles / uploads, optionalFields and HTTP status meaning. No network.
 */
import { describe, it, expect } from "vitest";
import { fillFilterParams, FilterError, serializeNumericFilter, serializeTextFilter } from "../../propreports/filters";
import { SlidingWindowLimiter } from "../../propreports/rate-limit";
import {
  parseGroups, parseInstruments, parseLocates, parsePositions, parseProfiles, parseReportsList, parseUploadMessages,
  parseUploadStatus, parseUploadSummaries, splitCsvSections, isUploadFinal, isUploadRunning,
} from "../../propreports/parse-v2";
import { classifyStatus, isRetryable, isYmd, optionalFieldsParam } from "../../propreports/spec";
import { parseCsvTable } from "../../propreports/csv";

describe("fills advanced filters", () => {
  it("text: exact, list, trailing wildcard, empty value, mixed", () => {
    expect(serializeTextFilter("symbol", "AAPL")).toBe("AAPL");
    expect(serializeTextFilter("symbol", "AAPL, MSFT,NVDA")).toBe("AAPL,MSFT,NVDA");
    expect(serializeTextFilter("symbol", { prefix: "AAPL" })).toBe("AAPL%");
    expect(serializeTextFilter("route", { values: [""] })).toBe('""');
    expect(serializeTextFilter("route", { values: ["ARCA", ""] })).toBe('ARCA,""');
    expect(serializeTextFilter("route", 'ARCA,""')).toBe('ARCA,""');
  });

  it("text: a leading or inner wildcard is rejected (server would match it exactly)", () => {
    expect(() => serializeTextFilter("symbol", "%AAPL")).toThrow(FilterError);
    expect(() => serializeTextFilter("symbol", "AA%PL")).toThrow(FilterError);
    expect(() => serializeTextFilter("symbol", { values: ["A,B"] })).toThrow(FilterError);
  });

  it("numeric: every documented form", () => {
    expect(serializeNumericFilter("quantity", { gt: 1000 })).toBe(">1000");
    expect(serializeNumericFilter("quantity", { gte: 1000 })).toBe(">=1000");
    expect(serializeNumericFilter("quantity", { ne: 1000 })).toBe("!=1000");
    expect(serializeNumericFilter("quantity", { between: [2000, 1000] })).toBe("1000-2000");
    expect(serializeNumericFilter("quantity", { notBetween: [1000, 2000] })).toBe("!=1000-2000");
    expect(serializeNumericFilter("quantity", { in: [1000, 1500, 2000] })).toBe("1000,1500,2000");
    expect(serializeNumericFilter("quantity", { notIn: [1000, 2000] })).toBe("!=1000,2000");
    expect(serializeNumericFilter("price", 58.5)).toBe("58.5");
    expect(serializeNumericFilter("price", ">= 10.25")).toBe(">=10.25");
    expect(() => serializeNumericFilter("price", "<5")).toThrow(FilterError);
    expect(() => serializeNumericFilter("price", { in: [] })).toThrow(FilterError);
  });

  it("fillFilterParams sets only given keys and validates the side list", () => {
    expect(fillFilterParams({ symbol: "AAPL,NVDA", type: ["B", "T", "B"], quantity: { gte: 100 }, orderId: { prefix: "3792" } }))
      .toEqual({ symbol: "AAPL,NVDA", type: "B,T", quantity: ">=100", orderId: "3792%" });
    expect(() => fillFilterParams({ type: "X" as never })).toThrow(FilterError);
    expect(fillFilterParams()).toEqual({});
  });
});

describe("SlidingWindowLimiter (40 / 4 s)", () => {
  it("lets 40 through at once, holds the 41st until the first leaves the window", async () => {
    let t = 1_000;
    const slept: number[] = [];
    const l = new SlidingWindowLimiter(40, 4000, () => t, async (ms) => { slept.push(ms); t += ms; });
    for (let i = 0; i < 40; i++) await l.acquire();
    expect(slept).toEqual([]);
    expect(l.inWindow).toBe(40);
    await l.acquire();
    expect(slept).toEqual([4000]);
    expect(t).toBe(5_000);
  });

  it("queued callers get slots in call order", async () => {
    let t = 0;
    const l = new SlidingWindowLimiter(2, 1000, () => t, async (ms) => { t += ms; });
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => l.acquire().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3, 4]);
    expect(t).toBe(1000);
  });
});

describe("readers", () => {
  it("reports: type, scope, multi-currency", () => {
    const t = parseCsvTable("Type,Description,Group/Account,Multi-Currency\ndetailed,Detailed,Account,N\nperformanceForGroup,Group Trade Performance,Group,Y\n");
    expect(parseReportsList(t)).toEqual([
      { type: "detailed", description: "Detailed", scope: "account", multiCurrency: false },
      { type: "performanceForGroup", description: "Group Trade Performance", scope: "group", multiCurrency: true },
    ]);
  });

  it("positions: v2 order (Qty before Symbol), fee columns collected, closed = qty 0", () => {
    const t = parseCsvTable([
      "Date,Account,Qty,Symbol,Avg,Close,Unrealized Delta,Unrealized,Qty Traded,Realized,Comm,Ecn Fee,SEC,TAF,NSCC,Clr,Misc,Currency,Spot Rate",
      "2011-07-01,ACCOUNT1,100,QQQ,58.5,60,150,150,0,0,0,0,0,0,0,0,0,USD,1",
      "2011-07-01,ACCOUNT1,0,SPY,0,0,0,0,200,12.5,0.4,0.1,0,0,0,0,0,USD,1",
      "Page 1/1",
    ].join("\n"));
    const rows = parsePositions(t);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2011-07-01", account: "ACCOUNT1", qty: 100, symbol: "QQQ", avg: 58.5, close: 60, unrealized: 150, currency: "USD", spotRate: 1 });
    expect(rows[1]).toMatchObject({ qty: 0, realized: 12.5 });
    expect(rows[1].fees).toMatchObject({ Comm: 0.4, "Ecn Fee": 0.1 });
  });

  it("locates with propReportsId", () => {
    const t = parseCsvTable("Date/Time,Account,Qty,Symbol,Cost,Locate Id,PropReports Id\n2020-05-03 09:30:15,ACCOUNT1,1000,bac,10.0,ABC-123,991\nPage 1/1");
    expect(parseLocates(t)[0]).toMatchObject({ dateTime: "2020-05-03 09:30:15", account: "ACCOUNT1", qty: 1000, symbol: "BAC", cost: 10, locateId: "ABC-123", propReportsId: "991" });
  });

  it("instruments and profiles (quoted commas)", () => {
    const ins = parseInstruments(parseCsvTable("Date,Symbol,Price,Volume,Currency,Multiplier,ISIN,CUSIP,SEDOL,FIGI,Description,Listing Exchange,Tape,Subtype,Underlying Symbol,Strike Price,Maturity,Coupon,Close Source,Is Complete\n2017-01-10,BAC,22.94,100860600,USD,1.0000,US06051GFH74,06051GFH7,,BBG00717KNY7,BANK OF AMERICA CORP,NYQ,A,,,,,,EOD,Y\n"));
    expect(ins[0]).toMatchObject({ symbol: "BAC", price: 22.94, volume: 100860600, multiplier: 1, figi: "BBG00717KNY7", sedol: null, closeSource: "EOD", isComplete: true });
    const prof = parseProfiles(parseCsvTable('Profile Id,Salutation,First,Last,Title,Company,Street,City,State,Postal Code,Country,Primary E-mail,Secondary E-mail,Evening Phone,Day Phone,Mobile Phone,Fax,User Id,Access\n1,Mr.,John,Doe,President,"Widgets, Inc.","1 Main St., Ste 114",New York,NY,10069,US,john@test.com,,555-555-5555,,,,jdoe,User\nPage 1/1'));
    expect(prof[0]).toMatchObject({ profileId: "1", company: "Widgets, Inc.", street: "1 Main St., Ste 114", primaryEmail: "john@test.com", userId: "jdoe", access: "User", secondaryEmail: null });
  });

  it("groups mark system groups", () => {
    expect(parseGroups(parseCsvTable("Group Id,Group Name\n49,Day Traders\n-4,My Accounts\n"))).toEqual([
      { groupId: "49", name: "Day Traders", system: false },
      { groupId: "-4", name: "My Accounts", system: true },
    ]);
  });
});

describe("uploads", () => {
  const summary = "Upload Id,Date/Time,Replacement Key,File Name,File Size,Source,Parser,Status,Comment,Errors,Notes\n42,2026-05-01 10:30:00,batch-2026-05-01,fills_2026-05-01.csv,24576,Sterling,Sterling (Generic),Uploaded,,N,Y";
  const details = "Upload Id,Date,Data Type,Entries,Status\n42,2026-05-01,Fill,5876,Uploaded\n42,2026-04-30,Fill,10,Deleted on 2026-05-02";

  it("uploadStatus: summary + details split on the blank line", () => {
    const r = parseUploadStatus(`${summary}\n\n${details}\n`);
    expect(r.summaries).toHaveLength(1);
    expect(r.summaries[0]).toMatchObject({ uploadId: "42", fileSize: 24576, parser: "Sterling (Generic)", status: "Uploaded", hasErrors: false, hasNotes: true });
    expect(r.details).toEqual([
      { uploadId: "42", date: "2026-05-01", dataType: "Fill", entries: 5876, status: "Uploaded", deletedOn: null },
      { uploadId: "42", date: "2026-04-30", dataType: "Fill", entries: 10, status: "Deleted on 2026-05-02", deletedOn: "2026-05-02" },
    ]);
  });

  it("uploadStatus without details, CRLF, and a quoted blank line stays inside its field", () => {
    expect(parseUploadStatus(summary.replace(/\n/g, "\r\n")).details).toEqual([]);
    expect(splitCsvSections('a,b\n"x\n\ny",2\n\nc\n1\n')).toEqual(['a,b\n"x\n\ny",2\n', "c\n1\n"]);
  });

  it("uploadSearch rows and status helpers", () => {
    const rows = parseUploadSummaries(parseCsvTable(`${summary}\nPage 1/4`));
    expect(rows[0].uploadId).toBe("42");
    expect(isUploadRunning("In Progress")).toBe(true);
    expect(isUploadRunning("Pending")).toBe(true);
    expect(isUploadFinal("Reconciled")).toBe(true);
    expect(isUploadFinal("Scheduling")).toBe(false);
  });

  it("uploadMessages: empty body = nothing yet; sections by --- Source ---", () => {
    expect(parseUploadMessages("")).toEqual({ empty: true, text: "", sections: [] });
    const m = parseUploadMessages("--- EODHistorical ---\n\n*** Instruments ***\n\nSymbols not imported: NTEST\n");
    expect(m.empty).toBe(false);
    expect(m.sections).toEqual([{ title: "EODHistorical", body: "*** Instruments ***\n\nSymbols not imported: NTEST" }]);
  });
});

describe("spec helpers", () => {
  it("optionalFields drops unknown names and duplicates", () => {
    expect(optionalFieldsParam("fills", ["fillId", "propReportsId", "fillId", "bogus"])).toBe("fillId,propReportsId");
    expect(optionalFieldsParam("adjustments", ["bogus"])).toBeUndefined();
  });

  it("HTTP status meaning and retry policy", () => {
    expect(classifyStatus(401)).toBe("auth");
    expect(classifyStatus(403)).toBe("forbidden");
    expect(classifyStatus(405)).toBe("method");
    expect(classifyStatus(503)).toBe("unavailable");
    expect(isRetryable(classifyStatus(429))).toBe(true);
    expect(isRetryable(classifyStatus(400))).toBe(false);
  });

  it("YYYY-MM-DD only", () => {
    expect(isYmd("2024-01-05")).toBe(true);
    expect(isYmd("1/5/2024")).toBe(false);
    expect(isYmd("2024-13-40")).toBe(false);
  });
});
