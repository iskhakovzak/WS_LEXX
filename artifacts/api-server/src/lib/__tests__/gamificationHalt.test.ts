/**
 * Persona fixes 2026-10-19 (area GAMIFY): titles hidden while the risk desk halts a trader (lib/gamification/halted +
 * titlesStore.activeTitles, OWNER-09), the quests loader's pure helpers (PIN flag NULL = no change required — UMID-10;
 * who is a learner — UMID-19) and the benchmark badge formats (ROMAN-30).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn(async (sql: string, _params?: unknown[]) => {
  if (sql.includes("FROM gamification_profiles")) return { rows: [{ trader: "Kirill", active_title: "risk_keeper" }, { trader: "Olga", active_title: "iron" }], rowCount: 2 };
  if (sql.includes("FROM trader_achievements")) {
    return { rows: [{ trader: "Kirill", line: "clean_month", tier: "gold", earned_on: "2026-10-01" }, { trader: "Olga", line: "contract_streak", tier: "gold", earned_on: "2026-10-02" }], rowCount: 2 };
  }
  return { rows: [], rowCount: 0 };
});
vi.mock("@workspace/db", () => ({ db: {}, pool: { query } }));

const halted = await import("../gamification/halted");
const titles = await import("../gamification/titlesStore");
const load = await import("../quests/load");
const bench = await import("../benchmark");

afterEach(() => halted.setHaltSource(null));

describe("risk halt → no titles (OWNER-09)", () => {
  it("a halted trader's chosen title is not shown; the others' are", async () => {
    halted.setHaltSource(async (names) => new Set(names.filter((n) => n === "Kirill")));
    expect(Object.fromEntries(await titles.activeTitles())).toEqual({ Olga: "iron" });
    halted.setHaltSource(async () => new Set());
    expect(Object.fromEntries(await titles.activeTitles())).toEqual({ Kirill: "risk_keeper", Olga: "iron" });
  });

  it("the halt read is cached per trader and a failing risk read means «not halted»", async () => {
    const src = vi.fn(async (names: readonly string[]) => new Set(names.filter((n) => n === "A")));
    halted.setHaltSource(src);
    expect([...(await halted.haltedTraders(["A", "B"]))]).toEqual(["A"]);
    expect([...(await halted.haltedTraders(["A", "B", "C"]))]).toEqual(["A"]);
    expect(src).toHaveBeenCalledTimes(2);
    expect(src.mock.calls[1]![0]).toEqual(["C"]); // only the missing one is read again
    halted.setHaltSource(async () => { throw new Error("risk down"); });
    expect([...(await halted.haltedTraders(["X"]))]).toEqual([]);
  });
});

describe("quests loader helpers", () => {
  it("must_change_secret NULL is «no change required» (UMID-10)", () => {
    expect(load.mustChangeOf(null)).toBe(false);
    expect(load.mustChangeOf(undefined)).toBe(false);
    expect(load.mustChangeOf(false)).toBe(false);
    expect(load.mustChangeOf(true)).toBe(true);
  });

  it("a learner: Стажёр, or no tier and no traded day in 30 days; Джун and above never (UMID-19)", () => {
    const today = "2026-10-19";
    expect(load.isLearner("trainee", [{ date: "2026-10-16" }], today)).toBe(true);
    expect(load.isLearner(null, [], today)).toBe(true);
    expect(load.isLearner(null, [{ date: "2026-10-16" }], today)).toBe(false);
    expect(load.isLearner("junior", [], today)).toBe(false);
    expect(load.isLearner("senior", [], today)).toBe(false);
  });
});

describe("benchmark badge formats (ROMAN-30)", () => {
  it("money as $880.24, the best day as a date, not raw ISO", () => {
    expect(bench.fmtMoney(880.24)).toBe("$880.24");
    expect(bench.fmtMoney(-12.5, true)).toBe("−$12.50");
    expect(bench.fmtMoney(1455)).toBe("$1,455.00");
  });
});
