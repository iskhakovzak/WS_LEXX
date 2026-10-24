/**
 * Nightly AI review batches end to end on a scratch database built from every migration (0262 included), with a
 * scripted batch client (no network) and a stub gatherer. Synthetic traders only.
 *   - waits until the desk's day closes (EODs / cutoff), then ONE batch with every trader who traded, idempotent;
 *   - the request is the live review request (advisor, structured output) with the 1-hour cache, never `fallbacks`;
 *   - polling with backoff; results in any order; a valid review lands in ai_reviews (same cache key, source batch,
 *     the day facts), an invalid one is skipped without a retry; cost at 50%; the personal budget is untouched;
 *   - notices only in the morning window, once; expired / vanished / interrupted batches end failed; no key = skip;
 *   - the nightly cap; a refused submission frees its items, an unknown outcome keeps them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../../../db/runner";
import type { BatchClient, BatchInfo, BatchRequest, BatchResultLine } from "../../batchClient";
import type { BatchSettings } from "../job";
import type { JobContext } from "../../../../jobs/registry";
import type { RouteSettings } from "../../models";

const holder: { pool: pg.Pool | null } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  const pool = new Proxy({}, { get: (_t, k) => { const p = holder.pool as unknown as Record<string | symbol, unknown>; const v = p[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v; } });
  return { ...real, pool };
});
vi.mock("../../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../../../audit", () => audit);
const stages = vi.hoisted(() => ({ juniors: new Set<string>() }));
vi.mock("../../../access/stage", () => ({ viewerStage: async (name: string) => (stages.juniors.has(name) ? "junior" : "trader") }));

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const ROUTE: RouteSettings = { defaultModel: "claude-haiku-5-5", smartModel: "claude-sonnet-5-5", autoEscalate: true, advisorEnabled: true, advisorModel: "claude-sonnet-5-5", multiplier: 5 };
const SETTINGS: BatchSettings = { enabled: true, cutoffMin: 21 * 60, scopes: { day: true, week: false, month: false }, nightlyUnits: 2_000_000, model: "claude-haiku-5-5", morningMin: 8 * 60 + 45, route: ROUTE };

const GOOD = {
  verdict: { grade: "B", headline: "Stopped after two losses, kept the rules", followedPlan: "yes" },
  wentWell: [{ text: "Stopped after the second loss", basis: "fact", evidence: [{ kind: "stat", label: "trade 4 · 11:02 · −$40", at: "11:02", ref: 4 }] }],
  wentWrong: [{ text: "Re-entered too fast after the first loss", basis: "hypothesis", evidence: [] }],
  edge: null,
  tomorrow: { if: "after a loss", then: "I wait 10 minutes before the next entry" },
  whatIf: null,
  confidence: "medium",
  dataGaps: [],
};

/** A scripted Message Batches API: records what was created, answers retrieve / results from a script. */
let providerSeq = 0;
function scriptedBatches() {
  const created: BatchRequest[][] = [];
  /** What the «provider» holds per batch id (a fresh client can be told about a batch created by an earlier run). */
  const byId = new Map<string, BatchRequest[]>();
  const s = {
    status: "in_progress" as BatchInfo["processing_status"],
    retrieveError: null as unknown,
    createError: null as unknown,
    lines: (reqs: BatchRequest[]): BatchResultLine[] => reqs.map((r) => ({ custom_id: r.custom_id, result: { type: "expired" } })),
  };
  const client: BatchClient = {
    kind: "test",
    async create(requests) {
      if (s.createError) throw s.createError;
      created.push(requests);
      const id = `msgbatch_test_${++providerSeq}`; // unique across clients, like the provider's ids
      byId.set(id, requests);
      return { id, processing_status: "in_progress", request_counts: { processing: requests.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 } };
    },
    async retrieve(id) {
      if (s.retrieveError) throw s.retrieveError;
      return { id, processing_status: s.status, request_counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 } };
    },
    async *results(id) {
      for (const line of [...s.lines(byId.get(id) ?? [])].reverse()) yield line; // any order
    },
  };
  return { client, created, byId, s };
}

const message = (text: string, usage = { input_tokens: 9_000, output_tokens: 1_500, cache_read_input_tokens: 3_000, cache_creation_input_tokens: 0 }) => ({
  id: "msg", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text }], usage: { ...usage, iterations: [{ type: "advisor_message", model: "claude-sonnet-5-5", input_tokens: 2_000, output_tokens: 300 }] },
}) as unknown as import("@workspace/integrations-anthropic-ai").Anthropic.Message;

const ctx = (trigger: JobContext["trigger"] = "schedule"): JobContext => ({ signal: new AbortController().signal, trigger, logger: silent, runId: null });
// 2026-10-22 is a Thursday (EDT, UTC−4).
const at = (hhmmNy: string, day = "2026-10-22") => new Date(`${day}T${hhmmNy}:00-04:00`);

describe.skipIf(!available)("nightly AI review batches (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let job: typeof import("../job");
  const gather = vi.fn(async (t: { trader: string }, target: { period: string }) => ({
    subject: { kind: "day" as const, day: target.period, trader: t.trader },
    data: { dayState: { trades: 2, net: -10 }, who: t.trader },
    facts: { trades: 2, net: -10, afterLoss: { n: 1, net: -5 }, afterWin: { n: 0, net: 0 }, afterPeak: { n: 0, net: 0, giveback: 0, peak: null, peakTime: null }, firstThree: { n: 2, net: -10 }, rest: { n: 0, net: 0 }, overlaps: 0, quickReentries: 0 },
    subjectLabel: `day ${target.period} of ${t.trader}`,
  }));
  const notify = vi.fn(async () => true);

  beforeAll(async () => {
    db = await createScratchDb("aibatch");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
    await db.pool.query(`INSERT INTO users (name, role, active, locale) VALUES ('Batch Ann', 'trader', true, 'en'), ('Batch Bob', 'trader', true, 'ru'), ('Batch Gone', 'trader', false, 'ru')`);
    for (const [trader, n] of [["Batch Ann", 3], ["Batch Bob", 1], ["Batch Gone", 2]] as const) {
      for (let i = 0; i < n; i++) await db.pool.query(`INSERT INTO trades (ticker, date, result, trader, pnl) VALUES ('KORU', '2026-10-22', 'win', $1, 10)`, [trader]);
    }
    job = await import("../job");
  }, 180_000);
  afterAll(async () => { await db?.drop(); });
  beforeEach(() => { job.__resetBatchJob(); gather.mockClear(); notify.mockClear(); });

  const run = (b: ReturnType<typeof scriptedBatches>, now: Date, over: Partial<BatchSettings> = {}, trigger: JobContext["trigger"] = "schedule") =>
    job.runBatchReviews(ctx(trigger), { client: () => b.client, now: () => now, settings: () => ({ ...SETTINGS, ...over }), gather: gather as never, notify });

  it("no key → a clean skip", async () => {
    const out = await job.runBatchReviews(ctx(), { client: () => null, now: () => at("22:00"), settings: () => SETTINGS, gather: gather as never, notify });
    expect(out.skipped).toBe("no API key");
  });

  it("waits for the EODs or the cutoff, then submits ONE batch for every active trader who traded — once", async () => {
    const b = scriptedBatches();
    expect((await run(b, at("15:30"))).submitted).toBeNull(); // before the close
    await db.pool.query(`INSERT INTO eod_days (trader, date, closed_at) VALUES ('Batch Ann', '2026-10-22', now())`);
    const waiting = await run(b, at("17:00"));
    expect(waiting.submitted).toBeNull();
    expect(waiting.waiting).toContain("EOD closed 1/2");
    await db.pool.query(`INSERT INTO eod_days (trader, date, closed_at) VALUES ('Batch Bob', '2026-10-22', now())`);
    const out = await run(b, at("17:05"));
    expect(out.submitted).toMatchObject({ requests: 2, skippedBudget: 0 });
    expect(b.created).toHaveLength(1);
    const req = b.created[0]![0]!;
    expect(req.custom_id).toMatch(/^r\d+$/);
    expect(req.params.model).toBe("claude-haiku-5-5");
    expect(req.params.tools?.[0]).toMatchObject({ type: "advisor_20260301", model: "claude-sonnet-5-5" });
    expect(req.params.output_config.format?.type).toBe("json_schema");
    expect(req.params.system[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(JSON.stringify(req.params)).not.toContain("fallbacks");
    expect(gather.mock.calls.map((c) => (c[0] as { trader: string }).trader).sort()).toEqual(["Batch Ann", "Batch Bob"]); // the inactive one is not reviewed

    const { rows } = await db.pool.query(`SELECT status, provider_id, requests, est_units, next_poll_at FROM ai_batches`);
    expect(rows).toEqual([expect.objectContaining({ status: "in_progress", provider_id: "msgbatch_test_1", requests: 2 })]);
    expect(Number(rows[0].est_units)).toBeGreaterThan(0);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.batch.submit" }));

    // A manual run (the admin's «Запустить») and a restart (fresh module state) submit nothing twice.
    job.__resetBatchJob();
    expect((await run(b, at("17:08"), {}, "manual")).submitted).toBeNull();
    expect(b.created).toHaveLength(1);
  });

  it("polls with backoff, stores valid reviews under the live cache key, skips an invalid one without a retry", async () => {
    const b = scriptedBatches();
    // The batch from the previous test is only in the DB (a restart): the provider still holds it under its id.
    const items = (await db.pool.query(`SELECT id, trader, input_hash, lang FROM ai_batch_items ORDER BY trader`)).rows;
    b.byId.set("msgbatch_test_1", items.map((i) => ({ custom_id: `r${i.id}`, params: {} as never })));
    const first = (await db.pool.query(`SELECT next_poll_at FROM ai_batches`)).rows[0];
    expect(new Date(first.next_poll_at).getTime()).toBe(at("17:10").getTime()); // submitted at 17:05 + 5 min

    b.s.status = "in_progress";
    const p1 = await run(b, at("17:30"));
    expect(p1).toMatchObject({ polled: 1, ended: 0 });
    const next = (await db.pool.query(`SELECT poll_count, next_poll_at FROM ai_batches`)).rows[0];
    expect(next.poll_count).toBe(1);
    expect(new Date(next.next_poll_at).getTime()).toBe(at("17:35").getTime()); // backoff: +5 min after the first poll
    expect((await run(b, at("17:32"))).polled).toBe(0); // not due yet
    b.s.status = "ended";
    b.s.lines = (reqs) => reqs.map((r, k) => ({ custom_id: r.custom_id, result: { type: "succeeded", message: message(k === 0 ? JSON.stringify(GOOD) : "{\"verdict\": \"nope\"}") } }));
    const p2 = await run(b, at("20:30")); // due since 17:35; after 20:00 → no notice tonight (the next test)
    expect(p2).toMatchObject({ polled: 1, ended: 1, stored: 1, invalid: 1 });

    const reviews = (await db.pool.query(`SELECT kind, trader, day, input_hash, lang, source, created_by, facts, cost_usd FROM ai_reviews`)).rows;
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ kind: "day", trader: "Batch Ann", day: "2026-10-22", lang: "en", source: "batch", created_by: "system", input_hash: items[0].input_hash });
    expect(reviews[0].facts).toMatchObject({ trades: 2 });
    // The cache key is the live one: the same inputs → the live path finds it without a model call.
    const { inputHash } = await import("../../review/store");
    expect(inputHash("day", "en", { dayState: { trades: 2, net: -10 }, who: "Batch Ann" })).toBe(items[0].input_hash);

    const statuses = (await db.pool.query(`SELECT trader, status, units, cost_usd FROM ai_batch_items ORDER BY trader`)).rows;
    expect(statuses.map((r) => [r.trader, r.status])).toEqual([["Batch Ann", "stored"], ["Batch Bob", "invalid"]]);
    // 50% of: Haiku 9,000 in × $0.10 + 1,500 out × $0.50 + 3,000 cache reads × $0.01, Sonnet advisor 2,000 × $2 + 300 × $10.
    const full = (9_000 * 0.1 + 1_500 * 0.5 + 3_000 * 0.01 + 2_000 * 2 + 300 * 10) / 1_000_000;
    expect(Number(statuses[0].cost_usd)).toBeCloseTo(full / 2, 6);
    expect(Number(statuses[0].units)).toBe(9_000 + 1_500 + (2_000 + 300) * 5);
    const batch = (await db.pool.query(`SELECT status, succeeded, invalid, units, cost_usd FROM ai_batches`)).rows[0];
    expect(batch).toMatchObject({ status: "ended", succeeded: 1, invalid: 1 });
    expect(Number(batch.cost_usd)).toBeCloseTo(full, 6); // two results with the same usage

    // Audit: one assistant row per stored review (mode batch); the personal budget table is untouched.
    expect((await db.pool.query(`SELECT user_name, mode FROM ai_assistant_audit`)).rows).toEqual([{ user_name: "Batch Ann", mode: "batch" }]);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM ai_assistant_usage`)).rows[0].n).toBe(0);
    expect(b.created).toHaveLength(0); // no retry for the invalid one (nothing new was created)
    expect(p2.notified).toBe(0);
  });

  it("tells the trader in the morning window only, once", async () => {
    const b = scriptedBatches();
    expect((await run(b, at("03:00", "2026-10-23"))).notified).toBe(0);
    const out = await run(b, at("09:00", "2026-10-23"));
    expect(out.notified).toBe(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "day", trader: "Batch Ann", period: "2026-10-22" }));
    expect((await run(b, at("09:05", "2026-10-23"))).notified).toBe(0);
  });

  it("an expired batch ends expired; a vanished one and a stuck submission end failed — nothing is resubmitted", async () => {
    const { createBatch, markSubmitted } = await import("../store");
    const mk = async (trader: string) => {
      const { batchId } = await createBatch({ night: "2026-10-21", model: "claude-haiku-5-5", advisor: null, kinds: ["day"], skippedBudget: 0, createdBy: "system",
        items: [{ kind: "day", trader, period: "2026-10-21", lang: "ru", inputHash: "a".repeat(64), facts: null, estUnits: 10 }] });
      return batchId;
    };
    const expiredId = await mk("Batch Ann");
    await markSubmitted(expiredId, "msgbatch_exp", new Date(Date.now() - 60_000));
    const b = scriptedBatches();
    b.byId.set("msgbatch_exp", [{ custom_id: `r${(await db.pool.query(`SELECT id FROM ai_batch_items WHERE batch_id = $1`, [expiredId])).rows[0].id}`, params: {} as never }]);
    b.s.status = "ended"; // every line expired (the default script)
    await run(b, new Date(), { enabled: false });
    expect((await db.pool.query(`SELECT status, expired FROM ai_batches WHERE id = $1`, [expiredId])).rows[0]).toEqual({ status: "expired", expired: 1 });

    const goneId = await mk("Batch Bob");
    await markSubmitted(goneId, "msgbatch_gone", new Date(Date.now() - 60_000));
    const { Anthropic } = await import("@workspace/integrations-anthropic-ai");
    b.s.retrieveError = new Anthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message: "gone" } }, "gone", new Headers());
    await run(b, new Date(), { enabled: false });
    expect((await db.pool.query(`SELECT status FROM ai_batches WHERE id = $1`, [goneId])).rows[0].status).toBe("failed");
    expect((await db.pool.query(`SELECT status FROM ai_batch_items WHERE batch_id = $1`, [goneId])).rows[0].status).toBe("errored");

    const stuckId = await mk("Batch Gone");
    await db.pool.query(`UPDATE ai_batches SET created_at = now() - interval '1 hour' WHERE id = $1`, [stuckId]);
    b.s.retrieveError = null;
    await run(b, new Date(), { enabled: false });
    expect((await db.pool.query(`SELECT status, error FROM ai_batches WHERE id = $1`, [stuckId])).rows[0]).toEqual({ status: "failed", error: "submission interrupted" });
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM ai_batch_items WHERE batch_id = $1`, [stuckId])).rows[0].n).toBe(1); // kept: never twice
  });

  it("the nightly cap: lower-priority reviews are skipped; a refused submission frees its items, an unknown outcome keeps them", async () => {
    // A new night (Wednesday 2026-10-28) with two traders: the junior with fewer trades goes first.
    for (const [trader, n] of [["Batch Ann", 3], ["Batch Bob", 1]] as const) {
      for (let i = 0; i < n; i++) await db.pool.query(`INSERT INTO trades (ticker, date, result, trader, pnl) VALUES ('KORU', '2026-10-28', 'win', $1, 10)`, [trader]);
    }
    stages.juniors = new Set(["Batch Bob"]);
    const b = scriptedBatches();
    const { Anthropic } = await import("@workspace/integrations-anthropic-ai");
    b.s.createError = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "bad" } }, "bad", new Headers());
    const night = at("21:05", "2026-10-28");
    const refused = await run(b, night, { nightlyUnits: 1 });
    expect(refused.waiting).toBe("nightly cap reached"); // the estimate of one review is above 1 unit

    const est = (await import("../plan")).estimateUnits({ promptChars: 0, model: "claude-haiku-5-5", advisor: "claude-sonnet-5-5", recentAverage: null }, ROUTE);
    job.__resetBatchJob();
    const failed = await run(b, night, { nightlyUnits: est * 50 });
    expect(failed.failed).toBe(1);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM ai_batch_items WHERE period = '2026-10-28'`)).rows[0].n).toBe(0); // freed

    b.s.createError = new Error("socket hang up"); // no HTTP answer: the outcome is unknown
    job.__resetBatchJob();
    await run(b, night, { nightlyUnits: est * 50 });
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM ai_batch_items WHERE period = '2026-10-28'`)).rows[0].n).toBe(2); // kept

    stages.juniors = new Set();
  });

  it("Fridays (when on): the weekly summary per trader, Monday's date, the week prompt; stored as kind week", async () => {
    const b = scriptedBatches();
    const out = await run(b, at("21:05", "2026-10-23"), { scopes: { day: false, week: true, month: false } });
    expect(out.submitted).toMatchObject({ requests: 2 });
    const reqs = b.created[0]!;
    expect(reqs[0]!.params.system[0]!.text).toContain("ONE TRADING WEEK");
    expect(gather.mock.calls.map((c) => c[1])).toContainEqual({ kind: "week", period: "2026-10-19", from: "2026-10-19", to: "2026-10-23" });
    const items = (await db.pool.query(`SELECT id, kind, period FROM ai_batch_items WHERE kind = 'week' ORDER BY trader`)).rows;
    expect(items.map((i) => [i.kind, i.period])).toEqual([["week", "2026-10-19"], ["week", "2026-10-19"]]);
    b.s.status = "ended";
    b.s.lines = (rs) => rs.map((r) => ({ custom_id: r.custom_id, result: { type: "succeeded", message: message(JSON.stringify(GOOD)) } }));
    await run(b, at("21:30", "2026-10-23"), { scopes: { day: false, week: true, month: false } });
    const { latestReview } = await import("../../review/store");
    expect(await latestReview({ kind: "week", day: "2026-10-19", trader: "Batch Bob" }, "ru")).toMatchObject({ kind: "week", day: "2026-10-19" });
  });

  it("the admin view lists the batches with counts, units and cost", async () => {
    const { recentBatches, nightUnits } = await import("../store");
    const rows = await recentBatches(10);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.find((r) => r.night === "2026-10-22")).toMatchObject({ status: "ended", requests: 2, succeeded: 1, invalid: 1, model: "claude-haiku-5-5", advisor: "claude-sonnet-5-5" });
    expect(await nightUnits("2026-10-22")).toBeGreaterThan(0);
  });
});
