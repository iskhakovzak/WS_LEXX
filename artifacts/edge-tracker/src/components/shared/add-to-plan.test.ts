import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/lib/api/keys";

const usage = vi.hoisted(() => ({ trackAction: vi.fn() }));
vi.mock("@/lib/usage", () => usage);
const { addToPlan, buildPlanItem, levelsFromBars, mergeIntoDoc, planLevels, registerPlanDraftSink } = await import("./add-to-plan");

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  usage.trackAction.mockClear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const DATE = "2026-10-19";
const stored = { marketView: "Риск-офф", focus: "Только A+", setups: [4], inPlay: [{ ticker: "AAPL", catalyst: "" }] };
const myPlan = (plan: unknown) => json(200, { date: DATE, plan, prevDate: null });
const echoPut = async (_url: string, init: RequestInit) => json(200, { id: 1, status: "draft", doc: JSON.parse(String(init.body)) });
/** Epoch seconds of a NY wall time in October 2026 (EDT, UTC−4). */
const et = (day: string, hh: number, mm: number) => Date.parse(`${day}T${String(hh + 4).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`) / 1000;

describe("levels prefill", () => {
  it("PDH / PDL / PMH / PML + stop / target around the price, nearest first, ≤ 4 a side", () => {
    expect(planLevels({ price: 100, pdh: 104.123, pdl: 95, pmh: 101, pml: 98.5, stop: 97, target: 110 })).toEqual({
      support: [98.5, 97, 95], resistance: [101, 104.12, 110],
    });
    expect(planLevels({ pdh: 104 })).toEqual({ support: [], resistance: [] });
    expect(planLevels(null)).toEqual({ support: [], resistance: [] });
  });

  it("from 5-minute bars: the last regular session before the day, the day's premarket, the last price", () => {
    const bars = [
      { t: et("2026-10-16", 8, 0), h: 120, l: 80, c: 100 }, // premarket of the previous day: ignored
      { t: et("2026-10-16", 9, 30), h: 105, l: 99, c: 104 },
      { t: et("2026-10-16", 15, 55), h: 106, l: 98, c: 101 },
      { t: et("2026-10-16", 17, 0), h: 130, l: 70, c: 101 }, // after hours: ignored
      { t: et("2026-10-19", 7, 0), h: 103, l: 100.5, c: 102 },
      { t: et("2026-10-19", 9, 0), h: 102.5, l: 101, c: 102.2 },
    ];
    expect(levelsFromBars(bars, "2026-10-19")).toEqual({ price: 102.2, pdh: 106, pdl: 98, pmh: 103, pml: 100.5 });
  });

  it("the item carries the caller's bias / horizon / plan / risk note", () => {
    const item = buildPlanItem({ ticker: "x", date: DATE, catalyst: "c".repeat(300), bias: "bull", horizon: "swing", plan: "p", riskNote: "stop 9" }, "NVDA", { price: 10, pdl: 9 });
    expect(item).toMatchObject({ ticker: "NVDA", bias: "bull", horizon: "swing", plan: "p", risk_note: "stop 9", levels: { support: [9], resistance: [] } });
    expect(item.catalyst).toHaveLength(240);
  });
});

describe("merge", () => {
  it("appends, keeps every stored field; exists / full answer without a doc", () => {
    const item = buildPlanItem({ ticker: "NVDA", date: DATE, catalyst: "" }, "NVDA", null);
    const m = mergeIntoDoc(stored, item);
    expect(m.kind).toBe("added");
    expect(m.kind === "added" && m.doc).toMatchObject({ marketView: "Риск-офф", setups: [4] });
    expect(mergeIntoDoc(stored, { ...item, ticker: "AAPL" }).kind).toBe("exists");
    expect(mergeIntoDoc({ inPlay: Array.from({ length: 30 }, (_, i) => ({ ticker: `T${i}` })) }, item).kind).toBe("full");
  });
});

describe("addToPlan («в план»)", () => {
  it("reads the plan fresh, PUTs the whole doc plus the ticker with its levels, keeps the status, fills the cache, credits once", async () => {
    fetchMock.mockResolvedValueOnce(myPlan({ id: 1, status: "ready", doc: stored })).mockImplementationOnce(echoPut);
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, "invalidateQueries");
    const out = await addToPlan(qc, { ticker: "nvda", date: DATE, catalyst: "Gap +5.0%", levels: { price: 100, pdh: 104, pml: 97 } });
    expect(out).toMatchObject({ kind: "added", via: "server", levels: [97, 104] });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/game-plan/my?date=2026-10-19");
    const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(putUrl)).toContain("/api/game-plan/my/2026-10-19");
    const body = JSON.parse(String(putInit.body));
    expect(body).toMatchObject({ marketView: "Риск-офф", focus: "Только A+", setups: [4], status: "ready" });
    expect(body.inPlay.map((i: { ticker: string }) => i.ticker)).toEqual(["AAPL", "NVDA"]);
    expect(body.inPlay[1]).toMatchObject({ catalyst: "Gap +5.0%", levels: { support: [97], resistance: [104] } });
    expect(qc.getQueryData<{ plan: { doc: { inPlay: unknown[] } } }>(KEYS.myPlan(DATE))?.plan.doc.inPlay).toHaveLength(2);
    expect(inv.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(KEYS.questsMe()))).toHaveLength(1);
    expect(usage.trackAction).toHaveBeenCalledTimes(1);
  });

  it("without hints it looks the levels up from the session bars (one candles call, cached)", async () => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/candles/NVDA")) return json(200, { candles: [{ t: et(day, 9, 0), h: 11, l: 9, c: 10 }] });
      if (init?.method === "PUT") return echoPut(u, init);
      return myPlan(null);
    });
    const qc = new QueryClient();
    const a = await addToPlan(qc, { ticker: "NVDA", date: DATE, catalyst: "" });
    const candleCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/candles/")).length;
    expect(candleCalls()).toBe(1);
    // weekend: the day's premarket bar is not «today» → only the price is known; on a weekday PMH / PML are levels
    expect(a.kind).toBe("added");
    await addToPlan(qc, { ticker: "NVDA", date: "2026-10-20", catalyst: "" });
    expect(candleCalls()).toBe(1);
    await addToPlan(qc, { ticker: "AMD", date: DATE, catalyst: "", levels: null });
    expect(candleCalls()).toBe(1);
  });

  it("an open plan editor takes it into its draft — no plan read, no PUT behind its back", async () => {
    const draft: string[] = ["AAPL"];
    const off = registerPlanDraftSink(DATE, (item) => (draft.includes(item.ticker) ? "exists" : (draft.push(item.ticker), "added")));
    const qc = new QueryClient();
    expect((await addToPlan(qc, { ticker: "msft", date: DATE, catalyst: "", levels: null })).kind).toBe("added");
    expect((await addToPlan(qc, { ticker: "aapl", date: DATE, catalyst: "", levels: null })).kind).toBe("exists");
    expect(draft).toEqual(["AAPL", "MSFT"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usage.trackAction).toHaveBeenCalledTimes(1);
    off();
    fetchMock.mockResolvedValueOnce(myPlan(null)).mockImplementationOnce(echoPut);
    expect((await addToPlan(qc, { ticker: "TSLA", date: DATE, catalyst: "", levels: null })).via).toBe("server");
  });

  it("already in the plan → no write, no credit; a save error goes to the caller", async () => {
    fetchMock.mockResolvedValueOnce(myPlan({ id: 1, status: "draft", doc: stored }));
    expect((await addToPlan(new QueryClient(), { ticker: "aapl", date: DATE, catalyst: "", levels: null })).kind).toBe("exists");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage.trackAction).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(myPlan(null)).mockResolvedValueOnce(json(400, { error: "inPlay.0.ticker: invalid ticker", code: "VALIDATION" }));
    await expect(addToPlan(new QueryClient(), { ticker: "TSLA", date: DATE, catalyst: "", levels: null })).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
  });
});
