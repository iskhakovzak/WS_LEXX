/**
 * A new rule raises violations only from the NY day it was created (lib/rulesEngine ruleSince / splitBySince /
 * historyPreview, used by scanRulesForTrader and the create preview). Fixture from audit 2026-10-20 (trading.md): a rule
 * «≤ 3 сделок/день» created on 2026-10-20 raised 60 open violations dated 04.05–24.09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { sql: string; params: unknown[] }[] = [];
let rules: any[] = [];
let tradeRows: any[] = [];
let storedViolations: any[] = [];

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM trading_rules/.test(sql)) return { rows: rules, rowCount: rules.length };
      if (/FROM trades t\s/.test(sql) && /SELECT t\.id, t\.trader/.test(sql)) return { rows: tradeRows, rowCount: tradeRows.length };
      if (/FROM rule_violations/.test(sql) && /SELECT/.test(sql)) {
        const keys = (params[2] as string[]) ?? [];
        const gone = storedViolations.filter((v) => !keys.includes(v.dedup_key));
        return { rows: gone, rowCount: gone.length };
      }
      if (/INSERT INTO rule_violations/.test(sql)) return { rows: [{ inserted: true }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../notifyEvents", () => ({ inBackground: vi.fn(), claimOnce: vi.fn(async () => false), staffOrFallback: vi.fn(async () => []) }));

const { ruleSince, splitBySince, historyPreview, scanRulesForTrader } = await import("../rulesEngine");

/** 4 trades a day on 15 days 2026-05-04 … 2026-09-24 (60 over a 3-per-day limit … here 1 over per day) + today. */
const HISTORY_DAYS = [
  "2026-05-04", "2026-05-12", "2026-05-20", "2026-06-02", "2026-06-10", "2026-06-18", "2026-07-01", "2026-07-09",
  "2026-07-17", "2026-08-03", "2026-08-11", "2026-08-19", "2026-09-08", "2026-09-16", "2026-09-24",
];
function tradesOf(days: readonly string[], perDay: number): any[] {
  let id = 1;
  return days.flatMap((day) => Array.from({ length: perDay }, () => ({
    id: id++, trader: "chert", date: `${day}T10:00:00`, close_date: day, result: "loss", pnl: -10, net_pnl: -11, horizon: "intraday", checklist_runs: 0,
  })));
}

describe("ruleSince / splitBySince / historyPreview", () => {
  it("the NY day of created_at (an evening UTC timestamp is still that NY day)", () => {
    expect(ruleSince("2026-10-20T15:00:00.000Z")).toBe("2026-10-20");
    expect(ruleSince("2026-10-21T02:00:00.000Z")).toBe("2026-10-20"); // 22:00 NY
    expect(ruleSince(null)).toBeNull();
    expect(ruleSince("garbage")).toBeNull();
  });

  it("60 historical drafts of a rule created on 2026-10-20: none live, all in the preview", () => {
    const drafts = Array.from({ length: 60 }, (_, i) => ({ day: HISTORY_DAYS[i % HISTORY_DAYS.length]!, costNet: -11 }));
    const { live, history } = splitBySince(drafts, "2026-10-20");
    expect(live).toHaveLength(0);
    expect(history).toHaveLength(60);
    expect(historyPreview(drafts, "2026-10-20")).toEqual({ violations: 60, from: "2026-05-04", to: "2026-09-24", costNet: -660 });
    // The creation day itself counts as live; no start day (legacy row) → everything live.
    expect(splitBySince([{ day: "2026-10-20" }, { day: "2026-10-19" }], "2026-10-20").live).toEqual([{ day: "2026-10-20" }]);
    expect(splitBySince(drafts, null).live).toHaveLength(60);
  });
});

describe("scanRulesForTrader: violations only from the rule's creation day", () => {
  beforeEach(() => {
    calls.length = 0;
    storedViolations = [];
    rules = [{ id: 309, trader: "chert", name: "≤ 3 trades", kind: "max_trades_per_day", threshold: { n: 3 }, enabled: true, created_at: "2026-10-20T14:00:00.000Z", origin: "personal" }];
  });

  it("a rule created today writes nothing for 15 past days with 4 trades each; today's breach is written", async () => {
    tradeRows = [...tradesOf(HISTORY_DAYS, 4), ...tradesOf(["2026-10-20"], 4).map((t) => ({ ...t, id: t.id + 1000 }))];
    const res = await scanRulesForTrader("chert");
    const inserts = calls.filter((c) => /INSERT INTO rule_violations/.test(c.sql));
    expect(inserts).toHaveLength(1);
    expect(String(inserts[0]!.params[7]).slice(0, 10)).toBe("2026-10-20"); // day
    expect(res.violationsWritten).toBe(1);
  });

  it("rows an older scan stored before the rule's day are kept (no delete / archive)", async () => {
    tradeRows = tradesOf(HISTORY_DAYS.slice(0, 2), 4);
    // Keys max_trades_per_day produces for the 4th trade of each day: t4, t8.
    storedViolations = [{ id: 1, dedup_key: "t4" }, { id: 2, dedup_key: "t8" }];
    const res = await scanRulesForTrader("chert");
    expect(calls.some((c) => /DELETE FROM rule_violations/.test(c.sql))).toBe(false);
    expect(calls.some((c) => /UPDATE rule_violations SET archived_at/.test(c.sql))).toBe(false);
    expect(res).toEqual({ violationsWritten: 0, violationsRemoved: 0 });
  });

  it("a legacy rule without created_at keeps the old behaviour (whole history)", async () => {
    rules = [{ ...rules[0], created_at: null }];
    tradeRows = tradesOf(HISTORY_DAYS.slice(0, 3), 4);
    const res = await scanRulesForTrader("chert");
    expect(res.violationsWritten).toBe(3);
  });
});
