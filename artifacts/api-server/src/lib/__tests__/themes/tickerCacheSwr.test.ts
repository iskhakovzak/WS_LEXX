/**
 * lib/themes/tickerCache detailsFor `staleOkMs` (stale-while-revalidate for GET /api/watchlist/quotes): a same-session
 * quote inside the window is answered without waiting for its refresh; outside it (or of another session) the caller
 * waits as before. Mocked provider, no network.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MemberQuote } from "../../themes/logic";
import { detailsFor, seedQuotes, setTickerCacheDeps } from "../../themes/tickerCache";
import { layerStaleOkMs } from "../../watchlist/quotes";

const q = (ticker: string, today: number): MemberQuote => ({ ticker, price: 10, today, fromOpen: null, premarket: null, afterHours: null });
const TODAY = "2026-10-21";
const LAT = 80;

describe("detailsFor staleOkMs", () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  function setup() {
    let now = 1_000_000;
    const calls: string[][] = [];
    restore = setTickerCacheDeps({
      now: () => now,
      fetchQuotes: async (tickers) => {
        calls.push([...tickers]);
        await new Promise((r) => setTimeout(r, LAT));
        return { source: "yahoo", quotes: new Map(tickers.map((t) => [t, q(t, 2)])) };
      },
    });
    return { calls, advance: (ms: number) => { now += ms; }, now: () => now };
  }

  it("inside the window: the cached quote at once, the refresh still starts", async () => {
    const h = setup();
    seedQuotes(new Map([["NVDA", q("NVDA", 1)]]), "rth", h.now());
    h.advance(45_000); // older than the 30 s rth TTL, inside 2 × TTL
    const t0 = performance.now();
    const out = await detailsFor(["NVDA"], "rth", TODAY, 3_000, layerStaleOkMs("rth"));
    expect(performance.now() - t0).toBeLessThan(LAT);
    expect(out.get("NVDA")!.quote.today).toBe(1);
    expect(h.calls).toEqual([["NVDA"]]);
    await new Promise((r) => setTimeout(r, LAT * 2));
    expect((await detailsFor(["NVDA"], "rth", TODAY, 3_000, layerStaleOkMs("rth"))).get("NVDA")!.quote.today).toBe(2);
  });

  it("outside the window, another session, or the default (0) → waits for the refresh", async () => {
    const h = setup();
    seedQuotes(new Map([["AMD", q("AMD", 1)], ["MU", q("MU", 1)]]), "pre", h.now());
    h.advance(45_000);
    expect((await detailsFor(["AMD"], "rth", TODAY, 3_000, layerStaleOkMs("rth"))).get("AMD")!.quote.today).toBe(2); // other session
    h.advance(10 * 60_000);
    expect((await detailsFor(["MU"], "pre", TODAY, 3_000, layerStaleOkMs("pre"))).get("MU")!.quote.today).toBe(2); // > 3 min
    expect(layerStaleOkMs("rth")).toBe(60_000);
    expect(layerStaleOkMs("pre")).toBe(3 * 60_000);
  });
});
