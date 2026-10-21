/**
 * PARITY: the «Фильтры» bucket keys of the web (src/lib/trade-facets.ts — /stats filters the own raw trades with them)
 * and of the server (api-server/src/lib/tradeFacetBuckets.ts — the SQL of GET /trades/facets, /trades/page and
 * /stats/aggregate is generated from the same lists, checked against Postgres in tradeFacets2Db.test.ts) must give the
 * same key for the same value. Same fixtures through both, plus the bucket lists themselves.
 */
import { describe, expect, it } from "vitest";
import * as web from "@/lib/trade-facets";
import * as api from "../../../../api-server/src/lib/tradeFacetBuckets";
import { TIME_BUCKETS as API_TIME_BUCKETS, timeBucketOf } from "../../../../api-server/src/lib/tradeFacetsSql";

const NUMS: unknown[] = [
  null, undefined, "", "x", Number.NaN, -1, 0, 0.5, 1, 1.5, 2, 3, 4, 4.99, 5, 6, 9.9999, 10, 19.99, 20, 38, 49.99, 50, 59, 60,
  99.99, 100, 199.99, 200, 299, 300, 899, 900, 1999.99, 2000, 3599, 3600, 4999, 5000, 9999.99, 10_000, 14_399, 14_400,
  24_999, 25_000, 49_999, 50_000, 99_999.99, 100_000, 1e7, "12.5000", "-3", Number.POSITIVE_INFINITY,
];

describe("web ≡ api facet buckets", () => {
  it("the bucket lists are the same", () => {
    expect(web.SEQ_BUCKETS).toEqual(api.SEQ_BUCKETS);
    expect(web.HOLD_BUCKETS).toEqual(api.HOLD_BUCKETS);
    expect(web.PRICE_BUCKETS).toEqual(api.PRICE_BUCKETS);
    expect(web.SIZE_BUCKETS).toEqual(api.SIZE_BUCKETS);
    expect(web.OVERNIGHT_KEY).toBe(api.OVERNIGHT_KEY);
    expect(web.UNKNOWN_KEY).toBe(api.UNKNOWN);
    expect(web.TIME_BUCKETS).toEqual(API_TIME_BUCKETS);
  });

  it.each(NUMS.map((v) => [String(v), v] as const))("value %s", (_name, v) => {
    expect(web.seqKeyOf(v), "seq").toBe(api.seqKeyOf(v));
    expect(web.priceKeyOf(v), "price").toBe(api.priceKeyOf(v));
    expect(web.sizeKeyOf(v), "size").toBe(api.sizeKeyOf(v));
    for (const o of [true, false, null, undefined]) expect(web.holdKeyOf(v, o), `hold ${o}`).toBe(api.holdKeyOf(v, o));
    const sec = typeof v === "number" && Number.isFinite(v) ? v * 60 : null;
    expect(web.timeBucketOfSec(sec), "time").toBe(timeBucketOf(sec));
  });

  it("result keys agree (net = pnl − |fees| to 1/10000)", () => {
    const vals: unknown[] = [null, 0, 0.1, 0.2, 0.3, -0.3, 1, -1, 2.5, "10.0001", "-0.0001", 1e-5, 0.30000000000000004];
    for (const pnl of vals) for (const fees of vals) {
      expect(web.resultKeyOf(pnl, fees), `${String(pnl)} / ${String(fees)}`).toBe(api.resultKeyOf(pnl, fees));
    }
  });
});
