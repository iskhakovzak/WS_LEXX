/**
 * lib/finviz/client.ts with a mocked fetch (never finviz.com): URL shape, the token stays out of errors, the 3 s
 * gap between requests, the 429 pause, batching ≤ 100 tickers per call.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildExportUrl, fetchExport, fetchTickers, FinvizError, MIN_GAP_MS, RATE_LIMIT_PAUSE_MS, setFinvizClientDeps,
} from "../../finviz/client";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const CSV = readFileSync(path.join(dir, "screener-gappers.csv"), "utf8");
const TOKEN = "SECRET-TOKEN-123";
const TODAY = "2026-10-19";

type Call = { url: string; at: number };

/** A fake clock: sleep advances it; fetch records the time and answers from `reply`. */
function harness(reply: (url: string, n: number) => { status: number; body: string } | Error) {
  let clock = 1_000_000;
  const calls: Call[] = [];
  const restore = setFinvizClientDeps({
    token: () => TOKEN,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetch: async (url) => {
      calls.push({ url, at: clock });
      const r = reply(url, calls.length);
      if (r instanceof Error) throw r;
      clock += 50;
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
    },
  });
  return { calls, restore, advance: (ms: number) => { clock += ms; } };
}

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

describe("buildExportUrl", () => {
  it("custom view, filters, order, tickers, columns; bad codes dropped; token only when given", () => {
    const u = new URL(buildExportUrl({ filters: ["geo_usa", "ta_gap_u4", "bad code;drop"], order: "-gap", tickers: ["aapl", "BRK.B", "x y"] }));
    expect(u.origin + u.pathname).toBe("https://elite.finviz.com/export/screener");
    expect(u.searchParams.get("v")).toBe("152");
    expect(u.searchParams.get("f")).toBe("geo_usa,ta_gap_u4");
    expect(u.searchParams.get("o")).toBe("-gap");
    expect(u.searchParams.get("t")).toBe("AAPL,BRK.B");
    expect(u.searchParams.get("c")?.split(",")).toContain("68");
    expect(u.searchParams.has("auth")).toBe(false);
    expect(new URL(buildExportUrl({}, "tok")).searchParams.get("auth")).toBe("tok");
  });

  it("refuses more than 100 tickers in one call", () => {
    const many = Array.from({ length: 101 }, (_, i) => `T${i}`);
    expect(() => buildExportUrl({ tickers: many })).toThrow(FinvizError);
  });
});

describe("fetchExport", () => {
  it("parses the CSV and sends the token only in the request URL", async () => {
    const h = harness(() => ({ status: 200, body: CSV }));
    restore = h.restore;
    const rows = await fetchExport({ filters: ["ta_gap_u4"], order: "-gap" }, TODAY);
    expect(rows).toHaveLength(4);
    expect(new URL(h.calls[0].url).searchParams.get("auth")).toBe(TOKEN);
  });

  it("without a token: rejects and never calls fetch", async () => {
    const h = harness(() => ({ status: 200, body: CSV }));
    restore = h.restore;
    setFinvizClientDeps({ token: () => null });
    await expect(fetchExport({}, TODAY)).rejects.toThrow(/FINVIZ_AUTH/);
    expect(h.calls).toHaveLength(0);
  });

  it("errors never carry the URL / token", async () => {
    const h = harness((url) => new Error(`connect ECONNREFUSED ${url}`));
    restore = h.restore;
    const err = await fetchExport({}, TODAY).catch((e: Error) => e);
    expect(err).toBeInstanceOf(FinvizError);
    expect(String((err as Error).message)).not.toContain(TOKEN);
    restore();
    const h2 = harness(() => ({ status: 403, body: "forbidden" }));
    restore = h2.restore;
    const e2 = await fetchExport({}, TODAY).catch((e: Error) => e);
    expect((e2 as FinvizError).status).toBe(403);
    expect((e2 as Error).message).not.toContain(TOKEN);
  });

  it("an HTML login page (token rejected) is an error, not empty data", async () => {
    const h = harness(() => ({ status: 200, body: readFileSync(path.join(dir, "login.html"), "utf8") }));
    restore = h.restore;
    await expect(fetchExport({}, TODAY)).rejects.toThrow(/HTML/);
  });

  it("keeps ≥ 3 s between request starts, also for concurrent callers", async () => {
    const h = harness(() => ({ status: 200, body: CSV }));
    restore = h.restore;
    await Promise.all([fetchExport({}, TODAY), fetchExport({}, TODAY), fetchExport({}, TODAY)]);
    expect(h.calls).toHaveLength(3);
    expect(h.calls[1].at - h.calls[0].at).toBeGreaterThanOrEqual(MIN_GAP_MS);
    expect(h.calls[2].at - h.calls[1].at).toBeGreaterThanOrEqual(MIN_GAP_MS);
  });

  it("a 429 pauses the queue for a minute", async () => {
    const h = harness((_u, n) => (n === 1 ? { status: 429, body: "" } : { status: 200, body: CSV }));
    restore = h.restore;
    await expect(fetchExport({}, TODAY)).rejects.toMatchObject({ status: 429 });
    await fetchExport({}, TODAY);
    expect(h.calls[1].at - h.calls[0].at).toBeGreaterThanOrEqual(RATE_LIMIT_PAUSE_MS);
  });
});

describe("fetchTickers", () => {
  it("batches ≤ 100 tickers per call, unique and valid only", async () => {
    const h = harness(() => ({ status: 200, body: CSV }));
    restore = h.restore;
    const list = [...Array.from({ length: 230 }, (_, i) => `T${i}`), "T1", "bad ticker"];
    const r = await fetchTickers(list, TODAY);
    expect(r.batches).toBe(3);
    expect(h.calls.map((c) => new URL(c.url).searchParams.get("t")!.split(",").length)).toEqual([100, 100, 30]);
    expect(r.failed).toBe(0);
  });

  it("a failed batch is counted, the others still run; a 429 stops the rest", async () => {
    const h = harness((_u, n) => (n === 1 ? { status: 500, body: "" } : { status: 200, body: CSV }));
    restore = h.restore;
    const r = await fetchTickers(Array.from({ length: 150 }, (_, i) => `A${i}`), TODAY);
    expect(r).toMatchObject({ batches: 2, failed: 1 });
    expect(r.rows.length).toBe(4);
    restore();
    const h2 = harness(() => ({ status: 429, body: "" }));
    restore = h2.restore;
    const r2 = await fetchTickers(Array.from({ length: 250 }, (_, i) => `B${i}`), TODAY);
    expect(r2).toMatchObject({ batches: 1, failed: 1 });
  });
});
