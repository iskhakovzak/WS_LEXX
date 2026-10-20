/**
 * lib/options/chainService — provider order Yahoo → NASDAQ with injected providers (no network), the 5-minute cache,
 * honest `sourceUnavailable`, NO_DATA / EXPIRATION_NOT_FOUND; the NASDAQ fallback parser through a stubbed fetch;
 * the AI advisor's chain table on the new contract shape.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/yahoo-options-aapl.json";
import { AppError } from "../../http";
import { aiChainTable } from "../../options/aiChainTable";
import { _resetChainCache, CHAIN_CACHE_TTL, getOptionsChain, type ChainDeps } from "../../options/chainService";
import { nasdaqChainProvider, parseExpiryGroup, type NasdaqResponse } from "../../options/nasdaqChain";
import type { ChainProvider, ProviderOutcome } from "../../options/types";
import { parseYahooChain, type YahooOptionsResponse } from "../../options/yahooChain";

const NOW_MS = Date.UTC(2026, 9, 21, 15, 0);
const yahooOk = (requested: string | null): ProviderOutcome => parseYahooChain(fixture as unknown as YahooOptionsResponse, requested, new Date(NOW_MS));

function deps(yahoo: ChainProvider, nasdaq: ChainProvider, clock = { t: NOW_MS }): ChainDeps {
  return { providers: [{ id: "yahoo", fetch: yahoo }, { id: "nasdaq", fetch: nasdaq }], now: () => new Date(clock.t) };
}
const failed: ChainProvider = async () => ({ kind: "failed", error: "down" });
const empty: ChainProvider = async () => ({ kind: "empty" });

describe("getOptionsChain", () => {
  afterEach(() => { _resetChainCache(); vi.unstubAllGlobals(); });

  it("Yahoo answers → source yahoo, NASDAQ never asked; underlying + delay + nearest chain in one answer", async () => {
    const nasdaq = vi.fn(failed);
    const p = await getOptionsChain("AAPL", null, deps(async (_s, e) => yahooOk(e), nasdaq));
    expect(nasdaq).not.toHaveBeenCalled();
    expect(p.source).toBe("yahoo");
    expect(p.sourceUnavailable).toBe(false);
    expect(p.delayMinutes).toBe(15);
    expect(p.underlying).toEqual({ price: 258.45, change: 3.12, changePct: 1.22 });
    expect(p.spot).toBe(258.45);
    expect(p.expirations).toHaveLength(6);
    expect(p.expiration).toBe("2026-10-23");
    expect(p.daysToExpiry).toBe(2);
    expect(p.calls?.find((c) => c.strike === 257.5)?.greeks?.delta).toBeGreaterThan(0.5);
  });

  it("Yahoo fails → NASDAQ fallback, source nasdaq", async () => {
    const nasdaq: ChainProvider = async () => ({
      kind: "ok",
      data: { name: "AAPL", underlying: { price: 258, change: null, changePct: null }, expirations: [{ timestamp: 1, label: "2026-10-23", dte: 2 }], chain: null },
    });
    const p = await getOptionsChain("AAPL", null, deps(failed, nasdaq));
    expect(p.source).toBe("nasdaq");
    expect(p.spot).toBe(258);
  });

  it("every source failed → 200-style payload with sourceUnavailable, not cached", async () => {
    const yahoo = vi.fn(failed);
    const p = await getOptionsChain("AAPL", null, deps(yahoo, failed));
    expect(p).toMatchObject({ symbol: "AAPL", sourceUnavailable: true, source: null, expirations: [] });
    await getOptionsChain("AAPL", null, deps(yahoo, failed));
    expect(yahoo).toHaveBeenCalledTimes(2);
  });

  it("a provider says the symbol has no options and nobody answered → NO_DATA", async () => {
    await expect(getOptionsChain("ZZZZ", null, deps(empty, failed))).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(getOptionsChain("ZZZZ", null, deps(failed, empty))).rejects.toBeInstanceOf(AppError);
  });

  it("an expiration the winner does not list → EXPIRATION_NOT_FOUND with the available dates", async () => {
    const err = await getOptionsChain("AAPL", "2026-10-24", deps(async (_s, e) => yahooOk(e), failed)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("EXPIRATION_NOT_FOUND");
    expect((err as AppError).details).toMatchObject({ available: expect.arrayContaining(["2026-10-23", "2026-10-30"]) });
  });

  it("5-minute cache: repeat requests and the nearest date's own key are served from memory", async () => {
    const clock = { t: NOW_MS };
    const yahoo = vi.fn<ChainProvider>(async (_s, e) => yahooOk(e));
    const d = deps(yahoo, failed, clock);
    await getOptionsChain("AAPL", null, d);
    await getOptionsChain("AAPL", null, d);
    const dated = await getOptionsChain("AAPL", "2026-10-23", d);
    expect(dated.expiration).toBe("2026-10-23");
    expect(yahoo).toHaveBeenCalledTimes(1);
    clock.t += CHAIN_CACHE_TTL + 1;
    await getOptionsChain("AAPL", null, d);
    expect(yahoo).toHaveBeenCalledTimes(2);
  });
});

describe("NASDAQ fallback provider (stubbed fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const raw: NasdaqResponse = {
    data: {
      totalRecord: 4,
      lastTrade: "LAST TRADE: $258.45 (AS OF OCT 21, 2026)",
      table: {
        rows: [
          { expirygroup: "October 23, 2026", expiryDate: null, strike: null, c_Last: null, c_Change: null, c_Bid: null, c_Ask: null, c_Volume: null, c_Openinterest: null, c_colour: false, p_Last: null, p_Change: null, p_Bid: null, p_Ask: null, p_Volume: null, p_Openinterest: null, p_colour: false, drillDownURL: null },
          { expirygroup: "", expiryDate: "Oct 23", strike: "255.00", c_Last: "4.10", c_Change: "0.30", c_Bid: "4.00", c_Ask: "4.20", c_Volume: "1,204", c_Openinterest: "3,310", c_colour: true, p_Last: "0.80", p_Change: "-0.2", p_Bid: "0.78", p_Ask: "0.82", p_Volume: "900", p_Openinterest: "2,000", p_colour: false, drillDownURL: "/market-activity/stocks/aapl/option-chain/call-put-options/aapl--261023c00255000" },
          { expirygroup: "", expiryDate: "Oct 23", strike: "260.00", c_Last: "1.10", c_Change: "--", c_Bid: "1.05", c_Ask: "1.15", c_Volume: "800", c_Openinterest: "1,500", c_colour: false, p_Last: "2.70", p_Change: "--", p_Bid: "2.65", p_Ask: "2.75", p_Volume: "--", p_Openinterest: "700", p_colour: true, drillDownURL: null },
          { expirygroup: "October 30, 2026", expiryDate: null, strike: null, c_Last: null, c_Change: null, c_Bid: null, c_Ask: null, c_Volume: null, c_Openinterest: null, c_colour: false, p_Last: null, p_Change: null, p_Bid: null, p_Ask: null, p_Volume: null, p_Openinterest: null, p_colour: false, drillDownURL: null },
        ],
      },
    },
  };

  it("parses the grouped table into expirations + the nearest chain (no IV, no greeks)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 })));
    const out = await nasdaqChainProvider("AAPL", null, new Date(NOW_MS));
    if (out.kind !== "ok") throw new Error(`expected ok, got ${out.kind}`);
    expect(out.data.expirations.map((e) => e.label)).toEqual(["2026-10-23", "2026-10-30"]);
    expect(out.data.underlying.price).toBe(258.45);
    const c = out.data.chain!;
    expect(c.strikes).toEqual([255, 260]);
    expect(c.calls[0]).toMatchObject({ strike: 255, bid: 4, ask: 4.2, mid: 4.1, volume: 1204, openInterest: 3310, inTheMoney: true, iv: null, greeks: null });
    expect(c.calls[0].contractSymbol).toBe("AAPL--261023C00255000");
    expect(c.puts[1]).toMatchObject({ strike: 260, volume: 0, inTheMoney: true });
  });

  it("every asset class failing → failed (so the service can say sourceUnavailable)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect((await nasdaqChainProvider("AAPL", null, new Date(NOW_MS))).kind).toBe("failed");
  });

  it("expiry group headers → UTC calendar date", () => {
    expect(parseExpiryGroup("May 26, 2026")?.label).toBe("2026-05-26");
    expect(parseExpiryGroup("garbage")).toBeNull();
  });
});

describe("aiChainTable (AI advisor on the new chain shape)", () => {
  it("ATM ±10 strikes with IV and Δ when present; tolerates missing fields", () => {
    const out = yahooOk(null);
    if (out.kind !== "ok") throw new Error("expected ok");
    const c = out.data.chain!;
    const table = aiChainTable(258.45, c.strikes, c.calls, c.puts);
    const lines = table.split("\n");
    expect(lines.length).toBeLessThanOrEqual(19);
    const atm = lines.find((l) => l.startsWith("$257.5"))!;
    expect(atm).toContain("← ATM");
    expect(atm).toMatch(/C: bid=\d+\.\d\d ask=\d+\.\d\d mid=\d+\.\d\d vol=\d+ oi=\d+ iv=26\.4% delta=0\.\d\d ITM/);
    expect(aiChainTable(100, undefined, [{ strike: 100 }], [])).toBe("$100.0 | C: bid=n/a ask=n/a mid=n/a vol=0 oi=0 | P: n/a");
  });
});
