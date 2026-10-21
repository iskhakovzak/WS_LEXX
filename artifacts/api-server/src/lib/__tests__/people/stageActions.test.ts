/**
 * Волна 1 п. 1.1: a stage change (promotion approve / direct assign → lib/academy/stage-actions setStage) writes the
 * stage, its history, the risk tier and — inside the same transaction — the ladder template limits when the trader has
 * none yet. A failure rolls everything back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sqls: string[] = [];
let limitsRow: Record<string, unknown> | null = { tier: "junior" };
let updated = true;
const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => client) } }));
vi.mock("../../academyPathStore", () => ({ loadTiers: vi.fn(async () => (await import("../../scalingSeed")).DEFAULT_TIERS) }));
vi.mock("../../riskData", () => ({ ensureTables: vi.fn(async () => undefined) }));

const { setStage } = await import("../../academy/stage-actions");

beforeEach(() => {
  sqls.length = 0;
  limitsRow = { tier: "junior" };
  updated = true;
  client.query.mockReset();
  client.query.mockImplementation(async (sql: string) => {
    sqls.push(sql.replace(/\s+/g, " ").trim());
    if (/^SELECT tier FROM trader_risk_limits/.test(sql.trim())) return { rows: limitsRow ? [limitsRow] : [] };
    if (/^UPDATE trader_risk_limits SET account_size/.test(sql.trim())) return { rows: updated ? [{ trader: "Олег Е." }] : [] };
    return { rows: [] };
  });
});

describe("setStage → limits by level", () => {
  it("a trader without limits gets the template of his tier in the same transaction (+ change log)", async () => {
    const out = await setStage("Олег Е.", null, "junior", "Закир", "assign", "старт", null, null);
    expect(out).toEqual({ limitsApplied: true });
    const i = (re: RegExp) => sqls.findIndex((s) => re.test(s));
    expect(i(/^BEGIN/)).toBe(0);
    expect(i(/INSERT INTO academy_trader_stage/)).toBeGreaterThan(0);
    expect(i(/INSERT INTO trader_risk_limits AS l/)).toBeGreaterThan(i(/INSERT INTO academy_stage_history/)); // syncRiskTier
    expect(i(/^UPDATE trader_risk_limits SET account_size/)).toBeGreaterThan(i(/INSERT INTO trader_risk_limits AS l/));
    expect(i(/INSERT INTO trader_risk_limit_events/)).toBeGreaterThan(i(/^UPDATE trader_risk_limits SET account_size/));
    expect(sqls.at(-1)).toBe("COMMIT");
    const upd = client.query.mock.calls.find(([s]) => /^UPDATE trader_risk_limits SET account_size/.test(String(s).trim()))!;
    expect(String(upd[0])).toContain("daily_loss_limit IS NULL"); // only when every limit is empty
    expect(upd[1]).toEqual(expect.arrayContaining(["Олег Е.", 25_000, 300, 900, 2_000]));
  });

  it("limits already set → nothing overwritten, no change-log row", async () => {
    updated = false;
    expect(await setStage("Умид", "junior", "trader", "Закир", "promote", null, 3, null)).toEqual({ limitsApplied: false });
    expect(sqls.some((s) => /trader_risk_limit_events/.test(s))).toBe(false);
  });

  it("an error rolls the whole stage change back", async () => {
    client.query.mockImplementation(async (sql: string) => {
      sqls.push(sql.trim());
      if (/INSERT INTO academy_stage_history/.test(sql)) throw new Error("boom");
      return { rows: [] };
    });
    await expect(setStage("Олег Е.", null, "junior", "Закир", "assign", null, null, null)).rejects.toThrow("boom");
    expect(sqls).toContain("ROLLBACK");
    expect(sqls.some((s) => /UPDATE trader_risk_limits SET account_size/.test(s))).toBe(false);
  });
});
