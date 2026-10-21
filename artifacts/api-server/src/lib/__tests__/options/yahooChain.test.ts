/**
 * lib/options/yahooChain — Yahoo v7 options payload (fixtures/yahoo-options-aapl.json, written from the documented
 * shape: optionChain.result[0].{expirationDates, quote, options[0].{calls, puts}}) → the normalised chain; the
 * provider with a fake `get` (never yahoo.com). Plus the greeks / expiry helpers it relies on.
 */
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/yahoo-options-aapl.json";
import { bsGreeks, dteFor, expiryCloseMs, labelOfTs, tsOfLabel, yearsToExpiry } from "../../options/greeks";
import { makeYahooChainProvider, parseYahooChain, yahooIvPct, type YahooOptionsResponse } from "../../options/yahooChain";

/** 2026-10-21 11:00 New York. */
const NOW = new Date(Date.UTC(2026, 9, 21, 15, 0));
const FIX = fixture as unknown as YahooOptionsResponse;
const clone = (): YahooOptionsResponse => JSON.parse(JSON.stringify(FIX)) as YahooOptionsResponse;

describe("parseYahooChain", () => {
  it("no date → expirations (nearest first, DTE from the New York date) + the nearest chain", () => {
    const out = parseYahooChain(FIX, null, NOW);
    if (out.kind !== "ok") throw new Error(`expected ok, got ${out.kind}`);
    const d = out.data;
    expect(d.name).toBe("Apple Inc.");
    expect(d.underlying).toEqual({ price: 258.45, change: 3.12, changePct: 1.22 });
    expect(d.expirations.map((e) => [e.label, e.dte])).toEqual([
      ["2026-10-23", 2], ["2026-10-30", 9], ["2026-11-06", 16], ["2026-11-20", 30], ["2026-12-18", 58], ["2027-01-15", 86],
    ]);
    const c = d.chain!;
    expect(c.expiration).toBe("2026-10-23");
    expect(c.daysToExpiry).toBe(2);
    expect(c.calls).toHaveLength(15);
    expect(c.puts).toHaveLength(15);
    expect(c.strikes[0]).toBe(240);
    expect(c.strikes.at(-1)).toBe(275);
  });

  it("contracts: bid/ask/last/mid, IV in %, Δ from Black-Scholes, Yahoo's own ITM flag and contract symbol", () => {
    const out = parseYahooChain(FIX, null, NOW);
    if (out.kind !== "ok") throw new Error("expected ok");
    const atmCall = out.data.chain!.calls.find((x) => x.strike === 257.5)!;
    expect(atmCall.contractSymbol).toBe("AAPL261023C00257500");
    expect(atmCall.mid).toBeCloseTo((atmCall.bid + atmCall.ask) / 2, 3);
    expect(atmCall.iv).toBe(26.4);
    expect(atmCall.inTheMoney).toBe(true);
    expect(atmCall.greeks!.delta).toBeGreaterThan(0.5);
    expect(atmCall.greeks!.delta).toBeLessThan(0.7);
    expect(atmCall.greeks!.theta).toBeLessThan(0);
    const atmPut = out.data.chain!.puts.find((x) => x.strike === 257.5)!;
    expect(atmPut.greeks!.delta).toBeLessThan(0);
    expect(atmPut.greeks!.delta).toBeCloseTo(atmCall.greeks!.delta - 1, 2);
  });

  it("Yahoo quirks: junk IV → null and no greeks; missing volume → 0; no bid/ask → mid = last", () => {
    const out = parseYahooChain(FIX, null, NOW);
    if (out.kind !== "ok") throw new Error("expected ok");
    const deep = out.data.chain!.calls[0];
    expect(deep.iv).toBeNull();
    expect(deep.greeks).toBeNull();
    const lastPut = out.data.chain!.puts.at(-1)!;
    expect(lastPut.volume).toBe(0);
    expect(lastPut.mid).toBe(lastPut.last);
  });

  it("a date Yahoo does not list → ok without a chain (the service answers EXPIRATION_NOT_FOUND)", () => {
    const out = parseYahooChain(FIX, "2026-10-24", NOW);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") expect(out.data.chain).toBeNull();
  });

  it("a listed date that came back without contracts → failed (the fallback gets a try)", () => {
    const j = clone();
    j.optionChain!.result![0].options = [];
    expect(parseYahooChain(j, "2026-10-30", NOW).kind).toBe("failed");
  });

  it("no result / no expirations → empty; no price → failed", () => {
    expect(parseYahooChain({ optionChain: { result: [], error: null } }, null, NOW).kind).toBe("empty");
    const j = clone();
    j.optionChain!.result![0].expirationDates = [];
    expect(parseYahooChain(j, null, NOW).kind).toBe("empty");
    const k = clone();
    k.optionChain!.result![0].quote!.regularMarketPrice = 0;
    expect(parseYahooChain(k, null, NOW).kind).toBe("failed");
  });

  it("expired dates are dropped from the list", () => {
    const j = clone();
    j.optionChain!.result![0].expirationDates!.unshift(tsOfLabel("2026-10-16"));
    const out = parseYahooChain(j, null, NOW);
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.data.expirations[0].label).toBe("2026-10-23");
  });
});

describe("makeYahooChainProvider (fake fetch)", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("builds the v7 URL with the crumb and date=unix 00:00 UTC; parses the answer", async () => {
    const urls: string[] = [];
    const provider = makeYahooChainProvider(async (url) => { urls.push(url({ crumb: "c/1" })); return json(FIX); });
    const out = await provider("AAPL", "2026-10-23", NOW);
    expect(urls).toEqual([`https://query2.finance.yahoo.com/v7/finance/options/AAPL?crumb=c%2F1&date=${tsOfLabel("2026-10-23")}`]);
    expect(out.kind).toBe("ok");
    await provider("^SPX", null, NOW);
    expect(urls[1]).toBe("https://query2.finance.yahoo.com/v7/finance/options/%5ESPX?crumb=c%2F1");
  });

  it("404 → empty; 5xx / no session / thrown / bad JSON → failed", async () => {
    expect((await makeYahooChainProvider(async () => json({}, 404))("ZZZZ", null, NOW)).kind).toBe("empty");
    expect((await makeYahooChainProvider(async () => json({}, 503))("AAPL", null, NOW)).kind).toBe("failed");
    expect((await makeYahooChainProvider(async () => null)("AAPL", null, NOW)).kind).toBe("failed");
    expect((await makeYahooChainProvider(async () => { throw new Error("ECONNRESET"); })("AAPL", null, NOW)).kind).toBe("failed");
    expect((await makeYahooChainProvider(async () => new Response("<html>", { status: 200 }))("AAPL", null, NOW)).kind).toBe("failed");
  });
});

describe("greeks helpers", () => {
  it("yahooIvPct: decimal → %, junk → null", () => {
    expect(yahooIvPct(0.2638)).toBe(26.4);
    expect(yahooIvPct(0.00001)).toBeNull();
    expect(yahooIvPct(7)).toBeNull();
    expect(yahooIvPct(undefined)).toBeNull();
  });

  it("DTE counts New York calendar days; T runs to the 16:00 close", () => {
    expect(dteFor("2026-10-21", NOW)).toBe(0);
    expect(dteFor("2026-10-23", NOW)).toBe(2);
    expect(dteFor("2026-10-20", NOW)).toBe(0);
    // 23:30 New York is already the next UTC day — still the 21st in New York.
    expect(dteFor("2026-10-23", new Date(Date.UTC(2026, 9, 22, 3, 30)))).toBe(2);
    expect(yearsToExpiry("2026-10-21", NOW) * 365 * 24).toBeCloseTo(5, 5);
    expect(yearsToExpiry("2026-10-20", NOW)).toBe(0);
    expect(labelOfTs(tsOfLabel("2026-12-18"))).toBe("2026-12-18");
  });

  it("the expiry close is 16:00 New York in summer (EDT, 20:00 UTC) and in winter (EST, 21:00 UTC)", () => {
    expect(new Date(expiryCloseMs("2026-07-17")).toISOString()).toBe("2026-07-17T20:00:00.000Z");
    expect(new Date(expiryCloseMs("2026-12-18")).toISOString()).toBe("2026-12-18T21:00:00.000Z");
    expect(new Date(expiryCloseMs("2027-01-15")).toISOString()).toBe("2027-01-15T21:00:00.000Z");
    // winter: 15:30 New York (20:30 UTC) is still 30 min before the close, not past it
    const winterLate = new Date(Date.UTC(2026, 11, 18, 20, 30));
    expect(yearsToExpiry("2026-12-18", winterLate) * 365 * 24 * 60).toBeCloseTo(30, 5);
  });

  it("bsGreeks: ATM call Δ ≈ 0.5+, put Δ = call Δ − 1, expired → intrinsic Δ", () => {
    const c = bsGreeks(100, 100, 30 / 365, 0.045, 0.3, "call");
    const p = bsGreeks(100, 100, 30 / 365, 0.045, 0.3, "put");
    expect(c.delta).toBeGreaterThan(0.5);
    expect(c.delta).toBeLessThan(0.56);
    expect(p.delta).toBeCloseTo(c.delta - 1, 2);
    expect(c.gamma).toBeGreaterThan(0);
    expect(c.vega).toBeGreaterThan(0);
    expect(bsGreeks(110, 100, 0, 0.045, 0.3, "call")).toEqual({ delta: 1, gamma: 0, theta: 0, vega: 0 });
  });
});
