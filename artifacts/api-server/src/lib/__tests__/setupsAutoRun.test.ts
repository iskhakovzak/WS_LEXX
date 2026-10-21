/**
 * Wave 1, 1.2 — the after-sync classifier run (lib/setupsAuto runAutoClassify) and the setup ↔ playbook helpers
 * (lib/tradesSetupLink). The run picks closed broker trades WITHOUT playbook_id (never touching trades), skips trades
 * with a current suggestion, and writes suggestions only. Pool, behavior rows and candles are faked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({ sql: [] as { sql: string; params: unknown[] }[], existing: [] as unknown[] }));
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      st.sql.push({ sql, params });
      if (/SELECT t\.id FROM trades t/.test(sql)) return { rows: [{ id: 1 }, { id: 2 }] };
      if (/FROM trade_setup_suggestions WHERE trade_id = ANY/.test(sql)) return { rows: st.existing };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
const trade = (id: number) => ({
  id, ticker: "AAPL", date: "2026-10-19", side: "long" as const, entry: 100, qty: 10, setup: null, trader: "T", result: "win",
  net: 5, entryMin: 575, holdMin: 3, horizon: "intraday" as const, entryAt: Date.parse("2026-10-19T13:35:00Z"), exitAt: Date.parse("2026-10-19T13:38:00Z"),
});
vi.mock("../../routes/behavior", () => ({
  loadBehaviorRows: vi.fn(async (_s: unknown, _f: unknown, _t: unknown, ids: number[]) => ids.map((id) => ({ id, exit: 101 }))),
  rowToBehaviorTrade: vi.fn((r: { id: number }) => trade(r.id)),
}));
vi.mock("../candles/market", () => ({
  parseDateStrict: (d: string) => new Date(`${d}T00:00:00Z`),
  pickIntervalForAge: () => "1m",
  ageDaysOf: () => 1,
  fetchSingleDayWithCache: vi.fn(async () => null),
  fetchDailyRange: vi.fn(async () => null),
  getPrevDailyCloseCached: vi.fn(async () => null),
}));

const A = await import("../setupsAuto");
const L = await import("../tradesSetupLink");
const { inputsHash } = await import("../setupClassifier");

beforeEach(() => { st.sql.length = 0; st.existing = []; });

describe("runAutoClassify (after each sync)", () => {
  it("only closed broker trades without a playbook link; suggestions written, trades untouched", async () => {
    const r = await A.runAutoClassify({ now: new Date("2026-10-20T21:00:00Z") });
    expect(r).toEqual({ candidates: 2, computed: 2 });
    const pick = st.sql.find((c) => /SELECT t\.id FROM trades t/.test(c.sql))!;
    expect(pick.sql).toContain("t.playbook_id IS NULL");
    expect(pick.sql).toContain("t.source = 'propreports'");
    expect(pick.sql).toContain("status = 'rejected'");
    expect(pick.params).toEqual(["2026-10-10"]);
    expect(st.sql.filter((c) => /INSERT INTO trade_setup_suggestions/.test(c.sql))).toHaveLength(2);
    expect(st.sql.some((c) => /UPDATE trades/.test(c.sql))).toBe(false);
  });

  it("a trade with a current suggestion (same inputs) is not recomputed", async () => {
    const hash = inputsHash(A.toClassifierTrade(trade(2) as never, 101));
    st.existing = [{ trade_id: 2, inputs_hash: hash, setup: "ORB пробой", status: "suggested" }];
    const r = await A.runAutoClassify({ now: new Date("2026-10-20T21:00:00Z") });
    expect(r).toEqual({ candidates: 1, computed: 1 });
  });
});

describe("setup ↔ playbook helpers", () => {
  const office = [
    { id: 205, code: "1.3", name: "1.3 ORB 5 минут", folder: null, minTier: null },
    { id: 211, code: "3.1", name: "3.1 VWAP Fade", folder: null, minTier: null },
  ];
  it("matchOfficeSetup: exact name (case / spaces), number, number-prefixed text; else null", () => {
    expect(L.matchOfficeSetup("1.3 orb 5  минут", office)?.id).toBe(205);
    expect(L.matchOfficeSetup("3.1", office)?.id).toBe(211);
    expect(L.matchOfficeSetup("3.1 мой VWAP", office)?.id).toBe(211);
    expect(L.matchOfficeSetup("VWAP Fade", office)).toBeNull();
    expect(L.matchOfficeSetup("", office)).toBeNull();
  });
  it("suggestionLink maps a stored class to the office setup", () => {
    expect(A.suggestionLink({ setup: "Возврат к VWAP" }, office)?.id).toBe(211);
    expect(A.suggestionLink({ setup: "Скальп" }, office)).toBeNull();
    expect(A.suggestionLink(null, office)).toBeNull();
  });
  it("touchesSetup: setup or playbookId present", () => {
    expect(L.touchesSetup({ setup: null })).toBe(true);
    expect(L.touchesSetup({ playbookId: 5 })).toBe(true);
    expect(L.touchesSetup({ tags: "x" })).toBe(false);
  });
});
