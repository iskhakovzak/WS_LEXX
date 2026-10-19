import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/lib/api/keys";
import { addToPlan } from "./api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const DATE = "2026-10-19";
const stored = { marketView: "Риск-офф", focus: "Только A+", setups: [4], inPlay: [{ ticker: "AAPL", catalyst: "" }] };

describe("addToPlan («в план»)", () => {
  it("reads the plan fresh, PUTs the whole doc plus the ticker, keeps the status and fills the cache", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { date: DATE, plan: { id: 1, status: "ready", doc: stored }, prevDate: null }))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => json(200, { id: 1, status: "ready", doc: JSON.parse(String(init.body)) }));
    const qc = new QueryClient();
    const out = await addToPlan(qc, DATE, { ticker: "nvda", catalyst: "Gap +5.0%" });
    expect(out).toBe("added");
    const [getUrl] = fetchMock.mock.calls[0];
    expect(String(getUrl)).toContain("/api/game-plan/my?date=2026-10-19");
    const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(putUrl)).toContain("/api/game-plan/my/2026-10-19");
    expect(putInit.method).toBe("PUT");
    const body = JSON.parse(String(putInit.body));
    expect(body).toMatchObject({ marketView: "Риск-офф", focus: "Только A+", setups: [4], status: "ready" });
    expect(body.inPlay.map((i: { ticker: string }) => i.ticker)).toEqual(["AAPL", "NVDA"]);
    expect(body.inPlay[1]).toMatchObject({ catalyst: "Gap +5.0%", bias: "neutral", horizon: "intraday" });
    const cached = qc.getQueryData<{ plan: { doc: { inPlay: unknown[] } } }>(KEYS.myPlan(DATE));
    expect(cached?.plan.doc.inPlay).toHaveLength(2);
  });

  it("no plan yet → a draft with the one ticker", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { date: DATE, plan: null, prevDate: null }))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => json(200, { id: 2, status: "draft", doc: JSON.parse(String(init.body)) }));
    const out = await addToPlan(new QueryClient(), DATE, { ticker: "TSLA", catalyst: "" });
    expect(out).toBe("added");
    const body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(body.status).toBe("draft");
    expect(body.inPlay).toHaveLength(1);
  });

  it("already in the plan → no write", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { date: DATE, plan: { id: 1, status: "draft", doc: stored }, prevDate: null }));
    expect(await addToPlan(new QueryClient(), DATE, { ticker: "aapl", catalyst: "" })).toBe("exists");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a server error on save is thrown to the caller (toast)", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { date: DATE, plan: null, prevDate: null }))
      .mockResolvedValueOnce(json(400, { error: "inPlay.0.ticker: invalid ticker", code: "VALIDATION" }));
    await expect(addToPlan(new QueryClient(), DATE, { ticker: "TSLA", catalyst: "" })).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
  });
});
