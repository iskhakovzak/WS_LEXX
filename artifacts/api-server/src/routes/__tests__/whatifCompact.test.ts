import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { WHATIF_COLS, compactTrades, regulatoryFees, resultKey, sendJsonGz } from "../whatif";
import type { SimTrade } from "../../lib/whatIf";

const trade = (p: Partial<SimTrade>): SimTrade => ({
  id: 1, day: "2026-10-01", entryMin: 570.123, ticker: "AAA", side: "long", qty: 100, entry: 10, exit: 11, gross: 5, fees: 0.4,
  holdSec: 60, r: null, stop: null, setup: null, tags: [], horizon: "intraday", result: "win", seq: 0, ...p,
});

describe("/whatif/base?enc=2 — compact trade table (DEV-10)", () => {
  it("one tuple per trade, repeated strings as dictionary indexes, regulatory fees as one sum", () => {
    const rows = [
      trade({ id: 7, seq: 0, setup: "ORB", feeBreakdown: { comm: 0.3, sec: 0.02, taf: -0.01, ecn: 0.05 } }),
      trade({ id: 8, seq: 1, day: "2026-10-02", ticker: "BBB", side: "short", setup: "ORB", grade: "A", entryMin: null, feeBreakdown: null }),
    ];
    const c = compactTrades(rows);
    expect(c.cols).toBe(WHATIF_COLS);
    expect(c.dicts.day).toEqual(["2026-10-01", "2026-10-02"]);
    expect(c.dicts.setup).toEqual(["ORB"]);
    const col = (r: (string | number | null)[], k: (typeof WHATIF_COLS)[number]) => r[WHATIF_COLS.indexOf(k)];
    expect(col(c.rows[0], "id")).toBe(7);
    expect(col(c.rows[0], "entryMin")).toBe(570.12);
    expect(col(c.rows[0], "reg")).toBe(0.03);
    expect(col(c.rows[1], "reg")).toBeNull();
    expect(c.dicts.side[col(c.rows[1], "side") as number]).toBe("short");
    expect(col(c.rows[1], "grade")).toBe(0);
    expect(col(c.rows[0], "grade")).toBeNull();
  });

  it("new columns: trader / tag lists as dictionaries, flags as 1/0, stop as 1/0/null", () => {
    const rows = [
      trade({ id: 1, trader: "A", imx: true, reentry: false, sizeRel: 2.5, hasStop: true, ptags: ["news", "halt"], mistakes: ["fomo", "revenge"] }),
      trade({ id: 2, trader: "B", imx: false, reentry: true, sizeRel: null, hasStop: false, ptags: [], mistakes: [] }),
      trade({ id: 3, trader: "A", hasStop: null, ptags: ["news", "halt"] }),
    ];
    const c = compactTrades(rows);
    expect(WHATIF_COLS.slice(-7)).toEqual(["trader", "imx", "reentry", "sizeRel", "hasStop", "ptags", "mistakes"]);
    const col = (r: (string | number | null)[], k: (typeof WHATIF_COLS)[number]) => r[WHATIF_COLS.indexOf(k)];
    expect(c.dicts.trader).toEqual(["A", "B"]);
    expect(c.dicts.ptags).toEqual(["news,halt"]);
    expect(c.dicts.mistakes).toEqual(["fomo,revenge"]);
    expect(c.rows.map((r) => [col(r, "trader"), col(r, "imx"), col(r, "reentry"), col(r, "sizeRel"), col(r, "hasStop"), col(r, "ptags"), col(r, "mistakes")])).toEqual([
      [0, 1, 0, 2.5, 1, 0, 0],
      [1, 0, 1, null, 0, null, null],
      [0, 0, 0, null, null, 0, null],
    ]);
    expect(c.rows.every((r) => r.length === WHATIF_COLS.length)).toBe(true);
  });

  it("regulatory sum uses the same keys as the engine's tariff (sec, taf, cat, orf, nfa)", () => {
    expect(regulatoryFees({ sec: 0.1, taf: 0.02, cat: 0.001, orf: 0.003, nfa: 0.004, comm: 5, ecn: 1 })).toBe(0.128);
    expect(regulatoryFees(undefined)).toBeNull();
  });
});

describe("what-if result cache key", () => {
  const req = (role: string, lang = "ru") => ({ authUser: { role }, lang, headers: {} }) as unknown as Request;
  it("staff and members never share an entry, even for the same trader and period", () => {
    expect(resultKey(req("admin"), "Максим Р.", "2026-01-01", undefined)).not.toBe(resultKey(req("trader"), "Максим Р.", "2026-01-01", undefined));
    expect(resultKey(req("curator"), null, undefined, undefined)).toContain("staff|*|");
    expect(resultKey(req("trader"), "A", "2026-01-01", "2026-02-01")).toBe(resultKey(req("trader"), "A", "2026-01-01", "2026-02-01"));
  });
});

describe("sendJsonGz", () => {
  function fakeRes() {
    const headers: Record<string, string> = {};
    const out: { body?: unknown } = {};
    const res = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; }, type: () => res, send: (b: unknown) => { out.body = b; return res; } };
    return { res: res as unknown as Response, headers, out };
  }
  const big = { rows: "x".repeat(70_000) };
  it("gzips a large body when the client accepts gzip (the check used to be a broken regex)", async () => {
    const { res, headers, out } = fakeRes();
    await sendJsonGz({ headers: { "accept-encoding": "gzip, deflate" } } as unknown as Request, res, big);
    expect(headers["content-encoding"]).toBe("gzip");
    expect(Buffer.isBuffer(out.body)).toBe(true);
  });
  it("sends plain JSON without gzip in Accept-Encoding", async () => {
    const { res, headers, out } = fakeRes();
    await sendJsonGz({ headers: {} } as unknown as Request, res, big);
    expect(headers["content-encoding"]).toBeUndefined();
    expect(typeof out.body).toBe("string");
  });
});
