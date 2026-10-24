/**
 * AI reviews without the network: the JSON schema (validation, trimming, the json_schema twin), the what-if mapping,
 * the day's state machine, the model call (structured output + advisor + cached prefix, usage at budget weights,
 * fallbacks) and the cache (same inputs → no second model call, force → a new one).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], usage: [] as unknown[][], audits: [] as unknown[][] }));
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      if (/INSERT INTO ai_assistant_usage/.test(text)) { db.usage.push(params); return { rows: [] }; }
      if (/INSERT INTO ai_assistant_audit/.test(text)) { db.audits.push(params); return { rows: [] }; }
      if (/INSERT INTO ai_reviews/.test(text)) {
        const [kind, trader, trade_id, day, version, input_hash, lang, review, facts, deep, units] = params;
        const row = { id: String(db.rows.length + 1), kind, trader, trade_id, day, version, input_hash, lang, review: JSON.parse(String(review)), facts: facts ? JSON.parse(String(facts)) : null, deep, units: String(units), created_at: new Date() };
        db.rows.push(row);
        return { rows: [row] };
      }
      if (/FROM ai_reviews/.test(text)) {
        const hash = params.find((p) => typeof p === "string" && p.length === 64);
        const hit = db.rows.filter((r) => (hash ? r.input_hash === hash : true)).at(-1);
        return { rows: hit ? [hit] : [] };
      }
      return { rows: [] };
    }),
  },
}));

const { ReviewSchema, REVIEW_JSON_SCHEMA, parseReview, whatIfRule, REVIEW_VERSION } = await import("../schema");
const { dayFacts } = await import("../gather");
const { callReview, reviewParams, reviewPlan, __resetReviewSupport, ReviewInvalid } = await import("../run");
const { reviewOrCached } = await import("../service");
const { inputHash } = await import("../store");
const { TRADE_REVIEW_SYSTEM, DAY_REVIEW_SYSTEM, reviewUserTurn } = await import("../prompt");
const { Anthropic } = await import("@workspace/integrations-anthropic-ai");
const { scriptedClient } = await import("../../__tests__/scripted");
import type { RouteSettings } from "../../models";

const S: RouteSettings = { defaultModel: "claude-haiku-5-5", smartModel: "claude-sonnet-5-5", autoEscalate: true, advisorEnabled: true, advisorModel: "claude-sonnet-5-5", multiplier: 5 };

const GOOD = {
  verdict: { grade: "B", headline: "Clean entry at VWAP, exit before the target", followedPlan: "partly" },
  wentWell: [{ text: "Entry on the reclaim of VWAP", basis: "fact", evidence: [{ kind: "fill", label: "fill 1 · 09:41:05 · entry 300 @ 12.34", at: "09:41", ref: 1 }] }],
  wentWrong: [{ text: "Sold the runner early, likely from fear of giving back", basis: "hypothesis", evidence: [{ kind: "minute", label: "10:05 high 12.90", at: "10:05", ref: null }] }],
  edge: { text: "Entries in the first 15 minutes are your STRENGTH", interval: "$12–$70 per day (80%)" },
  tomorrow: { if: "when the trade reaches +1R", then: "I move the stop to break-even and keep half" },
  whatIf: { type: "afterLoss", n: null, minutes: 10, usd: null, pct: null, from: null, to: null, value: null, items: [], why: "Most giveback came right after losses" },
  confidence: "medium",
  dataGaps: ["no stop recorded"],
};
const json = (o: unknown) => JSON.stringify(o);

beforeEach(() => { db.rows = []; db.usage = []; db.audits = []; __resetReviewSupport(); });

describe("review schema", () => {
  it("accepts a complete review and keeps facts apart from hypotheses", () => {
    const r = parseReview(json(GOOD));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.review.wentWrong[0]!.basis).toBe("hypothesis");
  });
  it("reads JSON out of a fenced / chatty answer (fallback without structured output)", () => {
    expect(parseReview("Here it is:\n```json\n" + json(GOOD) + "\n```").ok).toBe(true);
  });
  it("rejects what does not fit: a bad grade, a missing implementation intention, a bad minute, non-JSON", () => {
    expect(parseReview(json({ ...GOOD, verdict: { ...GOOD.verdict, grade: "A+" } })).ok).toBe(false);
    expect(parseReview(json({ ...GOOD, tomorrow: undefined })).ok).toBe(false);
    expect(parseReview(json({ ...GOOD, wentWell: [{ ...GOOD.wentWell[0], evidence: [{ kind: "fill", label: "x", at: "9:41", ref: 1 }] }] })).ok).toBe(false);
    expect(parseReview(json({ ...GOOD, wentWell: [{ text: "x", basis: "maybe", evidence: [] }] })).ok).toBe(false);
    expect(parseReview("no json here")).toEqual({ ok: false, issues: ["not a JSON object"] });
  });
  it("trims lists over their caps instead of failing", () => {
    const five = Array.from({ length: 6 }, () => GOOD.wentWell[0]);
    const r = parseReview(json({ ...GOOD, wentWell: five, dataGaps: ["a", "b", "c", "d", "e", "f"] }));
    expect(r.ok && r.review.wentWell.length).toBe(4);
    expect(r.ok && r.review.dataGaps.length).toBe(5);
  });
  it("clips an over-long data-gap note at a word instead of losing the whole review (seen in a real batch)", () => {
    const long = "The data does not include the playbook setup for these SOXL trades, so whether the re-entries matched a planned setup or were impulsive cannot be confirmed from here.";
    expect(long.length).toBeGreaterThan(160);
    const r = parseReview(json({ ...GOOD, dataGaps: [long] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.review.dataGaps[0]!.length).toBeLessThanOrEqual(160);
      expect(r.review.dataGaps[0]!.endsWith("…")).toBe(true);
      expect(long.startsWith(r.review.dataGaps[0]!.slice(0, -1))).toBe(true);
    }
    expect(parseReview(json({ ...GOOD, verdict: { ...GOOD.verdict, headline: "x".repeat(201) } })).ok).toBe(false); // other fields are not clipped
  });
  it("the json_schema sent to the API and the validator describe the same object", () => {
    const top = REVIEW_JSON_SCHEMA as { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> };
    expect(top.additionalProperties).toBe(false);
    expect([...top.required].sort()).toEqual(Object.keys(ReviewSchema.shape).sort());
    // every object in the JSON schema is closed and requires all its properties (structured-output rules)
    const walk = (s: unknown): void => {
      if (!s || typeof s !== "object") return;
      const o = s as Record<string, unknown>;
      if (o.type === "object") {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
      }
      Object.values(o).forEach(walk);
    };
    walk(REVIEW_JSON_SCHEMA);
  });
  it("maps a what-if idea to the simulator rule (or null when a parameter is missing)", () => {
    expect(whatIfRule(GOOD.whatIf as never)).toEqual({ type: "afterLoss", minutes: 10 });
    expect(whatIfRule({ ...GOOD.whatIf, type: "maxTradesPerDay", n: 4 } as never)).toEqual({ type: "maxTradesPerDay", n: 4 });
    expect(whatIfRule({ ...GOOD.whatIf, type: "maxTradesPerDay" } as never)).toBeNull();
    expect(whatIfRule({ ...GOOD.whatIf, type: "profitGiveback", usd: 300, pct: 50 } as never)).toEqual({ type: "profitGiveback", peak: 300, pct: 50 });
    expect(whatIfRule({ ...GOOD.whatIf, type: "excludeTickers", items: ["nvda"] } as never)).toEqual({ type: "excludeTickers", tickers: ["NVDA"] });
  });
});

describe("day state machine (deterministic facts)", () => {
  it("after-loss / after-win entries, trades after the peak and the giveback, first three vs the rest", () => {
    const f = dayFacts({
      summary: { net: 40 },
      equity: { peak: { value: 300, time: "10:10", tradeId: 2 }, giveback: 260, points: [{ tradeId: 1 }, { tradeId: 2 }, { tradeId: 3 }, { tradeId: 4 }, { tradeId: 5 }] },
      timeline: [
        { id: 1, index: 1, net: 100, afterLoss: false, gapMin: null },
        { id: 2, index: 2, net: 200, afterLoss: false, gapMin: 5 },
        { id: 3, index: 3, net: -150, afterLoss: false, gapMin: 1, overlap: true },
        { id: 4, index: 4, net: -60, afterLoss: true, gapMin: 1 },
        { id: 5, index: 5, net: -50, afterLoss: true, gapMin: 3 },
      ],
    });
    expect(f).toEqual({
      trades: 5, net: 40,
      afterLoss: { n: 2, net: -110 }, afterWin: { n: 2, net: 50 },
      afterPeak: { n: 3, net: -260, giveback: 260, peak: 300, peakTime: "10:10" },
      firstThree: { n: 3, net: 150 }, rest: { n: 2, net: -110 },
      overlaps: 1, quickReentries: 2,
    });
  });
});

describe("the model call", () => {
  it("one request: Haiku + the advisor tool (Sonnet), the frozen prompt cached, data only in the user turn, structured output", () => {
    const p = reviewParams("trade", reviewPlan(S), [{ role: "user", content: reviewUserTurn({ kind: "trade", lang: "ru", today: "2026-10-24", subject: "trade 7", data: { a: 1 } }) }]);
    expect(p.model).toBe("claude-haiku-5-5");
    expect(p.tools).toEqual([{ type: "advisor_20260301", name: "advisor", model: "claude-sonnet-5-5", max_uses: 2, max_tokens: 2048 }]);
    expect(p.system).toEqual([{ type: "text", text: TRADE_REVIEW_SYSTEM, cache_control: { type: "ephemeral" } }]);
    expect(p.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: REVIEW_JSON_SCHEMA } });
    // nothing per request in the prefix: no date / language / subject in the system prompt
    for (const sys of [TRADE_REVIEW_SYSTEM, DAY_REVIEW_SYSTEM]) expect(sys).not.toMatch(/2026-|Russian|trade 7/);
    expect(JSON.stringify(p.messages)).toMatch(/2026-10-24.*Russian/s);
    // the prefix is long enough to cache (512-token minimum on the 5.5 models; ~4 chars per token)
    expect(TRADE_REVIEW_SYSTEM.length / 4).toBeGreaterThan(1500);
  });

  it("advisor off: the escalation model alone (auto-escalation on) or the default model", () => {
    expect(reviewPlan({ ...S, advisorEnabled: false })).toEqual({ model: "claude-sonnet-5-5", advisor: null, format: true });
    expect(reviewPlan({ ...S, advisorEnabled: false, autoEscalate: false })).toEqual({ model: "claude-haiku-5-5", advisor: null, format: true });
  });

  it("counts executor tokens 1x and advisor tokens x5 (from usage.iterations)", async () => {
    const client = scriptedClient([{ text: json(GOOD), usage: { input: 3000, output: 900, cacheRead: 4000 }, iterations: [
      { type: "message", input_tokens: 3000, output_tokens: 10 },
      { type: "advisor_message", model: "claude-sonnet-5-5", input_tokens: 7000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { type: "message", input_tokens: 0, output_tokens: 890, cache_read_input_tokens: 4000 },
    ], blocks: [{ type: "server_tool_use", id: "s1", name: "advisor", input: {} }, { type: "advisor_tool_result", tool_use_id: "s1", content: { type: "advisor_redacted_result", encrypted_content: "e" } }] }]);
    const r = await callReview({ client, settings: S, kind: "trade", lang: "en", today: "2026-10-24", subject: "trade 7", data: {}, signal: new AbortController().signal });
    expect(r.review.verdict.grade).toBe("B");
    expect(r.deep).toBe(true);
    expect(r.advisorCalls).toBe(1);
    expect(r.units).toBe(3000 + 900 + (7000 + 1500) * 5);
    expect(r.usage["claude-sonnet-5-5"]).toEqual({ input: 7000, output: 1500, cacheRead: 0, cacheWrite: 0 });
  });

  it("an answer that does not fit is retried once, then fails (never shown)", async () => {
    const ok = scriptedClient([{ text: "{ broken" }, { text: json(GOOD) }]);
    expect((await callReview({ client: ok, settings: S, kind: "day", lang: "ru", today: "2026-10-24", subject: "d", data: {}, signal: new AbortController().signal })).review).toBeTruthy();
    expect(ok.calls).toHaveLength(2);
    const bad = scriptedClient([{ text: "{}" }, { text: "{}" }, { text: json(GOOD) }]);
    await expect(callReview({ client: bad, settings: S, kind: "day", lang: "ru", today: "2026-10-24", subject: "d", data: {}, signal: new AbortController().signal })).rejects.toBeInstanceOf(ReviewInvalid);
    expect(bad.calls).toHaveLength(2);
  });

  it("a 400 on structured output + advisor re-issues without the format (remembered), keeping the advisor", async () => {
    const e400 = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "x" } }, "x", new Headers());
    const client = scriptedClient([{ throw: e400 }, { text: "Sure: " + json(GOOD) }]);
    const r = await callReview({ client, settings: S, kind: "trade", lang: "ru", today: "2026-10-24", subject: "t", data: {}, signal: new AbortController().signal });
    expect(r.review.confidence).toBe("medium");
    expect(client.calls[1]!.output_config.format).toBeUndefined();
    expect(client.calls[1]!.tools?.[0]).toMatchObject({ type: "advisor_20260301" });
    expect(reviewPlan(S).format).toBe(false);
  });
});

describe("the cache: same inputs → no second model call", () => {
  const gathered = { subject: { kind: "trade" as const, tradeId: 7, trader: "Trader T." }, data: { trade: { id: 7 }, fills: [] }, facts: null, subjectLabel: "trade 7" };
  const req = (client: ReturnType<typeof scriptedClient>, force = false) => ({ client, settings: S, lang: "ru" as const, today: "2026-10-24", actor: "Trader T.", force, signal: new AbortController().signal, gathered });

  it("generates once, then serves the stored review for free; force generates again", async () => {
    const client = scriptedClient([{ text: json(GOOD) }]);
    const first = await reviewOrCached(req(client));
    expect(first).toMatchObject({ cached: false, tier: "deep", tradeId: 7, whatIfRule: { type: "afterLoss", minutes: 10 } });
    expect(JSON.stringify(first)).not.toMatch(/claude|haiku|sonnet|opus/i);
    const second = await reviewOrCached(req(client));
    expect(second).toMatchObject({ cached: true, id: first.id });
    expect(client.calls).toHaveLength(1);
    expect(db.usage).toHaveLength(1); // usage recorded once (per model row)
    await reviewOrCached(req(client, true));
    expect(client.calls).toHaveLength(2);
  });

  it("the key covers version, kind, language and data", () => {
    const h = inputHash("trade", "ru", { a: 1 });
    expect(h).toHaveLength(64);
    expect(inputHash("trade", "en", { a: 1 })).not.toBe(h);
    expect(inputHash("day", "ru", { a: 1 })).not.toBe(h);
    expect(inputHash("trade", "ru", { a: 2 })).not.toBe(h);
    expect(REVIEW_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("a failed generation is audited and nothing is stored", async () => {
    const client = scriptedClient([{ text: "{}" }, { text: "{}" }]);
    await expect(reviewOrCached(req(client))).rejects.toBeInstanceOf(ReviewInvalid);
    expect(db.rows).toHaveLength(0);
    expect(db.audits).toHaveLength(1);
  });
});
