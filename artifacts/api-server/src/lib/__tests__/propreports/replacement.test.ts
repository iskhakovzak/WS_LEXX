/**
 * Re-imported PropReports records (same data, new propReportsId) must never become duplicates (phase 3 ACCURACY).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const { fillFingerprint, pairReplacements, planFillIds, dedupeFillBatch, canonicalizeFillIds } = await import("../../propreports/replacement");
const { buildRoundTrips } = await import("../../propreports/round-trips");
type Fill = import("../../propreports/types").Fill;

const fill = (o: Partial<Fill> = {}): Fill => ({
  dateTime: "2026-10-16 09:31:02.120", account: "WSL007", side: "B", qty: 100, symbol: "AMD", price: 150.25, route: "ARCA",
  fees: { comm: 0.5 }, tradeDate: "2026-10-16", orderId: "O1", fillId: "F1", propReportsId: "100", status: null, line: 1, ...o,
});

describe("fillFingerprint", () => {
  it("ignores propReportsId / fillId and number formatting", () => {
    expect(fillFingerprint(fill())).toBe(fillFingerprint(fill({ propReportsId: "999", fillId: "F9", price: 150.250000001 })));
    expect(fillFingerprint(fill())).not.toBe(fillFingerprint(fill({ qty: 101 })));
    expect(fillFingerprint(fill())).not.toBe(fillFingerprint(fill({ account: "WSL008" })));
  });
});

describe("pairReplacements", () => {
  it("pairs one-to-one by key, leftovers stay fresh / vanished", () => {
    const r = pairReplacements(["a1", "a2", "b1"], ["a9", "c9"], (k) => k[0]!, (i) => i[0]!);
    expect(r.pairs).toEqual([["a1", "a9"]]);
    expect(r.fresh).toEqual(["c9"]);
    expect(r.vanished.sort()).toEqual(["a2", "b1"]);
  });
});

describe("planFillIds", () => {
  it("a re-imported fill (new id, same data) maps to the original canonical id", () => {
    const old = fill({ propReportsId: "100" });
    const reimported = fill({ propReportsId: "200" });
    const plan = planFillIds([reimported], [{ propReportsId: "100", canonicalId: "100", fingerprint: fillFingerprint(old) }]);
    expect(plan.rewrite.get("200")).toBe("100");
    expect(plan.replacements).toEqual([expect.objectContaining({ oldId: "100", newId: "200", canonicalId: "100" })]);
    expect(plan.inserts).toEqual([]);
  });

  it("two identical partial fills keep two ids; only the vanished one is replaced", () => {
    const a = fill({ propReportsId: "1" });
    const b = fill({ propReportsId: "2" });
    const fp = fillFingerprint(a);
    // b re-imported as 3; a still returned
    const plan = planFillIds([a, fill({ propReportsId: "3" })], [
      { propReportsId: "1", canonicalId: "1", fingerprint: fp },
      { propReportsId: "2", canonicalId: "2", fingerprint: fp },
    ]);
    expect(plan.seen).toEqual(["1"]);
    expect(plan.rewrite.get("3")).toBe("2");
    expect(plan.rewrite.has("1")).toBe(false);
    void b;
  });

  it("a genuinely new identical fill (no vanished twin) is inserted, not merged", () => {
    const a = fill({ propReportsId: "1" });
    const plan = planFillIds([a, fill({ propReportsId: "2" })], [{ propReportsId: "1", canonicalId: "1", fingerprint: fillFingerprint(a) }]);
    expect(plan.inserts.map((i) => i.propReportsId)).toEqual(["2"]);
    expect(plan.replacements).toEqual([]);
  });

  it("an id already re-mapped stays on its canonical id on later fetches", () => {
    const plan = planFillIds([fill({ propReportsId: "200" })], [{ propReportsId: "200", canonicalId: "100", fingerprint: fillFingerprint(fill()) }]);
    expect(plan.rewrite.get("200")).toBe("100");
    expect(plan.seen).toEqual(["200"]);
  });

  it("fills without propReportsId are left alone", () => {
    const plan = planFillIds([fill({ propReportsId: null })], []);
    expect(plan.inserts).toEqual([]);
    expect(plan.rewrite.size).toBe(0);
  });
});

describe("dedupeFillBatch", () => {
  it("the same id twice in one batch (overlapping pages) is one fill", () => {
    expect(dedupeFillBatch([fill(), fill(), fill({ propReportsId: null }), fill({ propReportsId: null })])).toHaveLength(3);
  });
});

describe("canonicalizeFillIds (DB)", () => {
  function fakeDb(identity: Array<{ propreports_id: string; canonical_id: string; fingerprint: string; replaced_by?: string | null }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("WHERE propreports_id = ANY")) {
          const ids = params[0] as string[];
          return { rows: identity.filter((r) => ids.includes(r.propreports_id)), rowCount: 0 };
        }
        if (sql.includes("WHERE fingerprint = ANY")) {
          const fps = params[0] as string[];
          const ids = params[1] as string[];
          return { rows: identity.filter((r) => fps.includes(r.fingerprint) && !r.replaced_by && !ids.includes(r.propreports_id)), rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    return { db: db as any, calls };
  }

  it("rewrites the re-imported id and records the replacement; round trips are not doubled", async () => {
    const entry = fill({ propReportsId: "100" });
    const exit = fill({ propReportsId: "101", side: "S", dateTime: "2026-10-16 09:45:00.000", price: 151, orderId: "O2", fillId: "F2" });
    const { db, calls } = fakeDb([
      { propreports_id: "100", canonical_id: "100", fingerprint: fillFingerprint(entry) },
      { propreports_id: "101", canonical_id: "101", fingerprint: fillFingerprint(exit) },
    ]);
    // the broker re-imported the exit: it now comes back as 555
    const res = await canonicalizeFillIds([entry, { ...exit, propReportsId: "555" }], db);
    expect(res.replaced).toBe(1);
    expect(res.fills.map((f) => f.propReportsId)).toEqual(["100", "101"]);
    expect(calls.some((c) => c.sql.includes("SET replaced_by") && c.params[0] === "101" && c.params[1] === "555")).toBe(true);
    expect(buildRoundTrips(res.fills).trips).toHaveLength(1);
  });

  it("a DB failure leaves the ids as fetched (never blocks the sync)", async () => {
    const db = { query: vi.fn(async () => { throw new Error("relation does not exist"); }) } as any;
    const res = await canonicalizeFillIds([fill()], db);
    expect(res.applied).toBe(false);
    expect(res.fills[0]!.propReportsId).toBe("100");
  });
});
