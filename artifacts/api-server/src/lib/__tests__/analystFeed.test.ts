/**
 * lib/analystFeed — firm aliases, min-cap filter (pure SQL builder + row cap), scan status from job_runs (item 1.14).
 * @workspace/db is mocked: nothing here touches a database.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [] })) } }));
const { canonicalFirm, capFilterSql, capText, firmFilterSql, firmKey, parseMarketCap, rowCap, scanStatusOf, SCAN_STALE_MS } = await import("../analystFeed");

const collector = () => {
  const params: unknown[] = [];
  return { params, next: (v: unknown) => { params.push(v); return `$${params.length}`; } };
};

describe("canonicalFirm — one firm under one name", () => {
  it.each([
    ["BofA Securities", "BofA Securities"], ["B of A Securities", "BofA Securities"], ["Bank of America", "BofA Securities"],
    ["Bank Of America Merrill Lynch", "BofA Securities"], ["Citi", "Citi"], ["Citigroup", "Citi"],
    ["JP Morgan", "JPMorgan"], ["JPMorgan", "JPMorgan"], ["J.P. Morgan", "JPMorgan"], ["JPMorgan Chase & Co.", "JPMorgan"],
    ["Morgan Stanley", "Morgan Stanley"], ["Morgan Stanley & Co.", "Morgan Stanley"], ["Goldman Sachs", "Goldman Sachs"],
    ["Goldman", "Goldman Sachs"], ["Cowen & Co.", "TD Cowen"], ["TD Cowen", "TD Cowen"], ["RBC Capital Markets", "RBC Capital"],
    ["H.C. Wainwright & Co.", "H.C. Wainwright"], ["HC Wainwright", "H.C. Wainwright"], ["KeyBanc Capital Markets", "KeyBanc"],
    ["Sanford C. Bernstein", "Bernstein"], ["Robert W. Baird", "Baird"], ["Société Générale", "Societe Generale"],
  ])("%s → %s", (raw, canon) => expect(canonicalFirm(raw)).toBe(canon));

  it("does not glue different firms by a shared word", () => {
    expect(canonicalFirm("Citizens JMP")).toBe("Citizens JMP");
    expect(canonicalFirm("Morgan Stanley")).not.toBe(canonicalFirm("JP Morgan"));
    expect(canonicalFirm("Rothschild & Co Redburn")).toBe("Rothschild & Co Redburn");
  });

  it("unknown firm keeps its name (spaces collapsed); empty stays empty", () => {
    expect(canonicalFirm("  Some   Boutique ")).toBe("Some Boutique");
    expect(canonicalFirm(null)).toBe("");
    expect(firmKey("J.P. Morgan & Co.")).toBe("jp morgan and co");
  });
});

describe("firmFilterSql", () => {
  it("a dictionary firm matches every alias by key", () => {
    const c = collector();
    const sql = firmFilterSql("B of A Securities", c.next);
    expect(sql).toContain("= ANY($1::text[])");
    expect(sql).toContain("LIKE ANY($2::text[])");
    expect(c.params[0]).toEqual(expect.arrayContaining(["bofa", "b of a", "bank of america"]));
    expect(c.params[1]).toEqual(expect.arrayContaining(["b of a %"]));
  });
  it("anything else keeps the substring match", () => {
    const c = collector();
    expect(firmFilterSql("Boutique", c.next)).toBe("a.firm ILIKE $1");
    expect(c.params).toEqual(["%Boutique%"]);
  });
});

describe("min market cap filter", () => {
  it("no min cap → no condition", () => {
    expect(capFilterSql(0, false, collector().next)).toBeNull();
  });
  it("min cap, unknown excluded → strict condition, excluded count requested", () => {
    const c = collector();
    const r = capFilterSql(10e9, false, c.next)!;
    expect(r.excludesUnknown).toBe(true);
    expect(r.clause).toMatch(/^COALESCE\(fs\.market_cap.*>= \$1$/s);
    expect(c.params).toEqual([10e9]);
  });
  it("min cap with includeUnknownCap → unknown lets the row through", () => {
    const r = capFilterSql(10e9, true, collector().next)!;
    expect(r.excludesUnknown).toBe(false);
    expect(r.clause.startsWith("COALESCE(COALESCE(fs.market_cap")).toBe(true);
    expect(r.clause.endsWith(", TRUE)")).toBe(true);
  });
  it("row cap: SQL number first (Finviz), else Yahoo text; text form for the number", () => {
    expect(rowCap("3500000000000", null)).toEqual({ marketCapNum: 3.5e12, marketCap: "3.50T" });
    expect(rowCap(null, "150B")).toEqual({ marketCapNum: 150e9, marketCap: "150B" });
    expect(rowCap(null, null)).toEqual({ marketCapNum: null, marketCap: null });
    expect(parseMarketCap("1,234")).toBe(1234);
    expect(capText(250e6)).toBe("250.00M");
  });
});

describe("scanStatusOf — «обновлено» from job_runs", () => {
  const NOW = Date.parse("2026-10-20T15:00:00Z");
  it("last run ok and recent → scannedAt, available", () => {
    const fin = "2026-10-20T14:41:00Z";
    expect(scanStatusOf({ status: "ok", started_at: "2026-10-20T14:40:00Z", finished_at: fin }, fin, NOW))
      .toEqual({ scannedAt: new Date(fin).toISOString(), sourceUnavailable: false, checkedAt: new Date(fin).toISOString() });
  });
  it("last run failed → unavailable, checkedAt = when it failed, scannedAt = the last success", () => {
    const s = scanStatusOf({ status: "error", started_at: "2026-10-20T14:40:00Z", finished_at: "2026-10-20T14:42:00Z" }, "2026-10-20T14:21:00Z", NOW);
    expect(s.sourceUnavailable).toBe(true);
    expect(s.checkedAt).toBe("2026-10-20T14:42:00.000Z");
    expect(s.scannedAt).toBe("2026-10-20T14:21:00.000Z");
  });
  it("never ran → unavailable, checked now", () => {
    expect(scanStatusOf(null, null, NOW)).toEqual({ scannedAt: null, sourceUnavailable: true, checkedAt: new Date(NOW).toISOString() });
  });
  it("last success too old → unavailable", () => {
    const old = new Date(NOW - SCAN_STALE_MS - 60_000).toISOString();
    expect(scanStatusOf({ status: "ok", started_at: old, finished_at: old }, old, NOW).sourceUnavailable).toBe(true);
  });
});
