/**
 * «Улучшенный поиск» pure parts: facet query parsing, time buckets, predicates (skip / IMX), the /trades/page WHERE
 * with facets, bucket folding / order, IMX split and the excludeImxSql guard.
 */
import { describe, expect, it } from "vitest";
import { facetPredicates, facetSqlTail, hasFacets, parseFacetQuery, timeBucketOf } from "../tradeFacetsSql";
import { Params, buildWhere } from "../tradesPageQuery";
import { buildFacetsQuery, foldFacets } from "../tradeFacetsQuery";
import { excludeImxSql, splitImx } from "../imxSummary";
import { DESK_TAGS, isDeskTag } from "../deskTags";

const DESK = ["IMX", "FOMO"];

describe("parseFacetQuery", () => {
  it("comma lists per column, trimmed and de-duplicated; excludeImx flag", () => {
    const f = parseFacetQuery({ xYears: "2024, 2025,2024", xStrategies: "MOC", xPtags: "", excludeImx: "1", other: "x" }, DESK);
    expect(f.off).toEqual({ years: ["2024", "2025"], strategies: ["MOC"] });
    expect(f.excludeImx).toBe(true);
    expect(hasFacets(f)).toBe(true);
    expect(hasFacets(parseFacetQuery({}, DESK))).toBe(false);
    expect(parseFacetQuery({ excludeImx: "0" }, DESK).excludeImx).toBe(false);
  });
  it("drops oversized keys", () => {
    expect(parseFacetQuery({ xPtags: `ok,${"x".repeat(200)}` }, DESK).off).toEqual({ ptags: ["ok"] });
  });
});

describe("timeBucketOf", () => {
  it("bucket boundaries are exclusive upper bounds", () => {
    const s = (h: number, m: number) => h * 3600 + m * 60;
    expect(timeBucketOf(null)).toBe("unknown");
    expect(timeBucketOf(s(8, 29))).toBe("before-8:30");
    expect(timeBucketOf(s(8, 30))).toBe("8:30-9:30");
    expect(timeBucketOf(s(9, 50))).toBe("9:50-10:10");
    expect(timeBucketOf(s(15, 59) + 59)).toBe("15:30-16:00");
    expect(timeBucketOf(s(16, 0))).toBe("after-16:00");
  });
});

describe("facet predicates", () => {
  const f = parseFacetQuery({ xYears: "2024", xGtags: "IMX", excludeImx: "1" }, DESK);
  it("one predicate per excluded column + IMX; skip leaves the column out", () => {
    const p = new Params();
    expect(facetPredicates(f, p)).toHaveLength(3);
    expect(facetPredicates(f, new Params(), { skip: "years" })).toHaveLength(2);
    expect(facetPredicates(f, new Params(), { imx: false })).toHaveLength(2);
    expect(p.list).toContainEqual(["2024"]);
    expect(p.list).toContainEqual(["imx", "fomo"]);
  });
  it("buildWhere appends them only when set (the plain page SQL is unchanged)", () => {
    const plain = buildWhere({ scope: "Kirill" }, new Params(), { quality: false });
    expect(plain).not.toMatch(/strategy/);
    const p = new Params();
    const w = buildWhere({ scope: "Kirill", facets: f }, p, { quality: false });
    expect(w).toMatch(/COALESCE\(t\.strategy, ''\) <> 'MOC'/);
    expect(w).toMatch(/LEFT\(t\.date, 4\)/);
  });
  it("facetSqlTail continues an existing positional list", () => {
    const params: unknown[] = [null, "2026-01-01", null];
    const tail = facetSqlTail(f, params);
    expect(tail.startsWith(" AND ")).toBe(true);
    expect(tail).toContain("$4");
    expect(facetSqlTail(undefined, params)).toBe("");
  });
});

describe("facets query + fold", () => {
  it("one statement with a bucket query per column plus total and IMX", () => {
    const { sql, params } = buildFacetsQuery({ scope: "Kirill", facets: parseFacetQuery({ xTypes: "short" }, DESK) }, false);
    for (const d of ["years", "months", "days", "times", "strategies", "types", "gtags", "ptags", "_total", "_imx"]) expect(sql).toContain(`'${d}'`);
    expect(params).toContain("Kirill");
    expect(params).toContainEqual(["short"]);
  });
  it("folds rows, orders buckets, nulls $ without money", () => {
    const rows = [
      { dim: "years", key: "2025", n: 2, net: "10.5" }, { dim: "years", key: "2026", n: 1, net: "-3" },
      { dim: "days", key: "5", n: 1, net: 1 }, { dim: "days", key: "1", n: 2, net: 2 },
      { dim: "ptags", key: "__none__", n: 5, net: 0 }, { dim: "ptags", key: "a", n: 1, net: 0 },
      { dim: "_total", key: "", n: 3, net: "7.5" }, { dim: "_imx", key: "", n: 1, net: "-3" },
    ];
    const out = foldFacets(rows, (_d, k) => `L${k}`, true, []);
    expect(out.dims.years.map((b) => b.key)).toEqual(["2026", "2025"]);
    expect(out.dims.days.map((b) => b.key)).toEqual(["1", "5"]);
    expect(out.dims.ptags.map((b) => b.key)).toEqual(["a", "__none__"]);
    expect(out.total).toEqual({ count: 3, net: 7.5 });
    expect(out.imx).toEqual({ count: 1, net: -3 });
    expect(out.dims.years[0]).toEqual({ key: "2026", label: "L2026", count: 1, net: -3 });
    expect(foldFacets(rows, (_d, k) => k, false, []).total.net).toBeNull();
  });
});

describe("IMX helpers", () => {
  it("splitImx keeps or drops IMX items and sums them either way", () => {
    const items = [{ imx: true, net: -5, item: "a" }, { imx: false, net: 10, item: "b" }, { imx: true, net: 2.25, item: "c" }];
    expect(splitImx(items, false)).toEqual({ kept: ["a", "b", "c"], imx: { count: 2, net: -2.75 } });
    expect(splitImx(items, true).kept).toEqual(["b"]);
  });
  it("excludeImxSql adds the predicate after the live-trades one and refuses a query without it", () => {
    expect(excludeImxSql("SELECT 1 FROM trades t WHERE t.deleted_at IS NULL AND t.trader = $1"))
      .toBe("SELECT 1 FROM trades t WHERE t.deleted_at IS NULL AND COALESCE(t.strategy, '') <> 'MOC' AND t.trader = $1");
    expect(() => excludeImxSql("SELECT 1")).toThrow();
  });
  it("desk tags: IMX and the mistakes vocabulary", () => {
    expect(DESK_TAGS).toContain("IMX");
    expect(isDeskTag("imx")).toBe(true);
    expect(isDeskTag("FOMO")).toBe(true);
    expect(isDeskTag("my own tag")).toBe(false);
  });
});

describe("bucket labels (routes/trade-facets facetLabeler)", () => {
  it("months / weekdays / times / types in the reader's language; data keys as they are", async () => {
    const { facetLabeler } = await import("../../routes/trade-facets");
    const en = facetLabeler("en");
    expect(en("months", "6")).toBe("Jun");
    expect(en("days", "1")).toBe("Mon");
    expect(en("days", "7")).toBe("Sun");
    expect(en("times", "before-8:30")).toBe("Before 8:30");
    expect(en("times", "9:30-9:50")).toBe("9:30–9:50");
    expect(en("types", "short")).toBe("Short");
    expect(en("gtags", "__none__")).toBe("No tags");
    expect(en("strategies", "unknown")).toBe("No data");
    expect(en("strategies", "OPGtoDAY")).toBe("OPGtoDAY");
    expect(facetLabeler("ru")("ptags", "__none__")).not.toBe("__none__");
  });
});
