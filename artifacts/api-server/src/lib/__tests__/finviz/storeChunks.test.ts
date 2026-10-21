/**
 * lib/finviz/store upsertSnapshots: a big export goes in INSERTs of ≤ SNAPSHOT_CHUNK rows (Postgres caps one statement
 * at 65 535 parameters; 19 per row), one row per ticker. A fake db records the statements (no Postgres).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const { SNAPSHOT_CHUNK, setFinvizDb, upsertSnapshots } = await import("../../finviz/store");
import type { FinvizRow } from "../../finviz/csv";

const row = (ticker: string, price = 1): FinvizRow => ({
  ticker, company: null, sector: null, industry: null, country: null, marketCap: null, sharesOutstanding: null, float: null,
  shortFloatPct: null, shortRatio: null, beta: null, atr: null, gapPct: null, avgVolume: null, relVolume: null, price,
  changePct: null, volume: null, earningsDate: null, earningsTiming: null,
});

describe("upsertSnapshots chunks", () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  it("3 500 tickers → 4 INSERTs of ≤ 1 000 rows, every one under the parameter limit; duplicates collapse (last wins)", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    restore = setFinvizDb({ query: async (sql, params = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; } });
    const rows = Array.from({ length: 3_500 }, (_, i) => row(`T${i}`));
    rows.push(row("T0", 9)); // the same ticker again in one export
    expect(await upsertSnapshots(rows, "screener")).toBe(3_501);
    const inserts = calls.filter((c) => c.sql.includes("INSERT INTO finviz_ticker_snapshot"));
    expect(SNAPSHOT_CHUNK).toBe(1_000);
    expect(inserts.map((c) => c.params.length / 19)).toEqual([1_000, 1_000, 1_000, 500]);
    expect(inserts.every((c) => c.params.length < 65_535)).toBe(true);
    // T0 once, with the later row's price
    const t0 = inserts[0]!.params;
    expect(t0[0]).toBe("T0");
    expect(t0[14]).toBe(9);
    expect(inserts.flatMap((c) => c.params.filter((_, i) => i % 19 === 0)).filter((t) => t === "T0")).toHaveLength(1);
  });
});
