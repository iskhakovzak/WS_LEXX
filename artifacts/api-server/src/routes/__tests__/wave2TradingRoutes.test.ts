/**
 * Волна 2, cluster R — routes × roles (pool and the heavy libs are faked):
 *  - 2.6 POST /rules { desk, stage }: a desk rule for one ladder stage — staff with the whole desk only (trader → 403),
 *    a bad stage → 400; GET /rules for a trader drops desk rules of another stage;
 *  - 2.6 POST /playbook/examples/seed: curators / admins (playbook.edit.any), a trader → 403;
 *  - 2.8 PATCH /trades/:id { tags } and POST /trades/bulk add/removeTags: key M goes into the one errors store;
 *  - 2.12 GET /chart/plan-overlay: the owner's day plan for the owner and their curator, another trader sees the desk
 *    plan only; an unreadable trade → 403.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin"; wards?: string[] };
const TRADER: Who = { id: 5, name: "Jun J.", role: "trader" };
const OTHER: Who = { id: 6, name: "Other O.", role: "trader" };
const CURATOR: Who = { id: 7, name: "Cur C.", role: "curator", wards: ["Jun J."] };
const ADMIN: Who = { id: 1, name: "Adm A.", role: "admin" };
let who: Who = TRADER;

const st = vi.hoisted(() => ({
  sql: [] as { sql: string; params: unknown[] }[],
  rules: [] as Record<string, unknown>[],
  trade: null as Record<string, unknown> | null,
  sync: [] as unknown[][],
  bulk: [] as unknown[][],
  seed: [] as unknown[],
}));

vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const rows = () => (st.trade ? [{ ...st.trade }] : []);
  const select = () => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "limit", "orderBy"]) c[k] = () => c;
    c.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(rows()).then(ok, ko);
    return c;
  };
  const update = () => ({
    set: (data: Record<string, unknown>) => {
      const w: Record<string, unknown> = {};
      w.where = () => w;
      w.returning = async () => (st.trade ? [{ ...st.trade, ...data }] : []);
      w.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(undefined).then(ok, ko);
      return w;
    },
  });
  return {
    ...schema,
    db: { select, update },
    pool: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        st.sql.push({ sql, params });
        if (/INSERT INTO trading_rules/.test(sql)) {
          const row = { id: 77, trader: params[0], name: params[1], kind: params[2], threshold: JSON.parse(String(params[3])), enabled: params[4], origin: params[5], created_by: params[6], note: params[7], stage: params[8], template_key: null, created_at: new Date() };
          return { rows: [row], rowCount: 1 };
        }
        if (/FROM trading_rules WHERE deleted_at IS NULL/.test(sql)) return { rows: st.rules, rowCount: st.rules.length };
        if (/SELECT trader FROM trades WHERE id = \$1 AND deleted_at IS NULL/.test(sql)) return { rows: st.trade ? [{ trader: st.trade.trader }] : [] };
        if (/FROM trades t LEFT JOIN playbook p/.test(sql)) return { rows: st.trade ? [{ trader: st.trade.trader, ticker: "AAPL", date: "2026-10-15", setup: "1.3 ORB" }] : [] };
        if (/FROM trader_plans/.test(sql)) return { rows: [{ doc: { inPlay: [{ ticker: "AAPL", levels: { support: [180], resistance: [190] } }] } }] };
        if (/FROM game_plans/.test(sql)) return { rows: [{ in_play: [{ ticker: "AAPL", levels: { support: [175] } }] }] };
        return { rows: [], rowCount: 0 };
      }),
    },
  };
});
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const matrix = actual.buildEffectiveMatrix([]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: who.wards ?? [] });
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix),
    can: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target)),
    readScope: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.can>[1]) => actual.readableTraders(matrix, actor(), cap)),
  };
});
vi.mock("../../lib/rulesEngine", async (orig) => ({
  ...(await orig<typeof import("../../lib/rulesEngine")>()),
  ensureRulesSchema: vi.fn(async () => undefined),
  scanRulesForTrader: vi.fn(async () => ({ violationsWritten: 0, violationsRemoved: 0 })),
  scanRulesAll: vi.fn(async () => ({ tradersScanned: 0, violationsWritten: 0 })),
}));
vi.mock("../../lib/rulesTemplates", async (orig) => ({
  ...(await orig<typeof import("../../lib/rulesTemplates")>()),
  traderStage: vi.fn(async () => ({ stage: "junior", since: null })),
}));
vi.mock("../../lib/tradingErrors", async (orig) => ({
  ...(await orig<typeof import("../../lib/tradingErrors")>()),
  syncMarkerErrors: vi.fn(async (...a: unknown[]) => { st.sync.push(a); }),
  syncTagMarkersBulk: vi.fn(async (...a: unknown[]) => { st.bulk.push(a); }),
}));
vi.mock("../../lib/playbook/examplesSeed", () => ({
  seedPlaybookExamples: vi.fn(async (opts: unknown) => { st.seed.push(opts); return { perSetup: 3, dryRun: false, added: 0, setups: [] }; }),
}));
vi.mock("../../lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("../../lib/marketContext", () => ({ captureAndAttach: vi.fn(async () => undefined) }));
vi.mock("../../lib/aiReview", () => ({ maybeAutoGenerateReview: vi.fn() }));
vi.mock("../../lib/hotCache", () => ({ invalidateDashboardCache: vi.fn() }));
vi.mock("../../lib/tradesPageCache", () => ({ invalidateTradesPageCache: vi.fn() }));
vi.mock("../../lib/tradeStructureStore", () => ({ refreshTradeStructures: vi.fn(async () => undefined), structureForTrade: vi.fn(async () => null) }));
vi.mock("../../lib/playbookToday/service", () => ({ tradeTagged: vi.fn(async () => undefined), playbookToday: vi.fn(), rememberPicks: vi.fn() }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: rulesRouter } = await import("../rules");
const { default: tradesRouter } = await import("../trades");
const { default: playbookTodayRouter } = await import("../playbook-today");
const { default: chartRouter } = await import("../chart-drawings");
const { errorMiddleware } = await import("../../lib/http");

const brokerTrade = (over: Record<string, unknown> = {}) => ({
  id: 236675, ticker: "AAPL", date: "2026-10-15", side: "long", entry: "180", exit: "181", qty: "100", fees: "1", pnl: "-40", result: "loss",
  trader: TRADER.name, source: "propreports", contextSnapshot: { source: "propreports" }, setup: null, tags: "FOMO", notes: null,
  deletedAt: null, createdAt: new Date("2026-10-15T14:00:00Z"), playbookId: null, ...over,
});

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", playbookTodayRouter);
  app.use("/api", rulesRouter);
  app.use("/api", tradesRouter);
  app.use("/api", chartRouter);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = TRADER;
  st.sql.length = 0;
  st.rules = [];
  st.trade = brokerTrade();
  st.sync.length = 0;
  st.bulk.length = 0;
  st.seed.length = 0;
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "X-Lang": "en" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, json };
}

describe("2.6 desk rules per ladder stage", () => {
  const body = { desk: true, stage: "junior", name: "No overnight", kind: "no_overnight", threshold: {} };

  it("a trader cannot create a desk rule for a stage (403); the admin can, the stage is stored", async () => {
    expect((await call("POST", "/api/rules", body)).status).toBe(403);
    who = ADMIN;
    const r = await call("POST", "/api/rules", body);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ desk: true, stage: "junior", trader: "*" });
    expect(st.sql.find((x) => /INSERT INTO trading_rules/.test(x.sql))!.params[8]).toBe("junior");
    expect((await call("POST", "/api/rules", { ...body, stage: "trainee" })).status).toBe(400);
  });

  it("a trader's list keeps the desk rules of their own stage only; a seeded name comes in the reader's language", async () => {
    const row = (id: number, stage: string | null, name: string, key: string | null = null) => ({
      id, trader: "*", name, kind: "no_overnight", threshold: {}, enabled: true, created_at: new Date(), origin: "office", created_by: "system", note: null, stage, template_key: key,
    });
    st.rules = [row(1, "junior", "Без овернайта", "junior.no_overnight"), row(2, "trader", "Trader only"), row(3, null, "Everyone")];
    const r = await call("GET", "/api/rules");
    expect(r.status).toBe(200);
    expect(r.json.map((x: any) => [x.id, x.name, x.stage])).toEqual([[1, "No overnight", "junior"], [3, "Everyone", null]]);
  });
});

describe("2.6 POST /playbook/examples/seed", () => {
  it("trader → 403; curator → 200 (idempotent seed run with the actor)", async () => {
    expect((await call("POST", "/api/playbook/examples/seed", {})).status).toBe(403);
    expect(st.seed).toHaveLength(0);
    who = CURATOR;
    const r = await call("POST", "/api/playbook/examples/seed", { dryRun: true });
    expect(r.status).toBe(200);
    expect(st.seed).toEqual([{ actor: CURATOR.name, perSetup: undefined, dryRun: true }]);
    expect((await call("POST", "/api/playbook/examples/seed", { perSetup: 9 })).status).toBe(400);
  });
});

describe("2.8 key M writes the one errors store", () => {
  it("PATCH tags → syncMarkerErrors(source tag, before, after)", async () => {
    const r = await call("PATCH", "/api/trades/236675", { tags: "FOMO, Реванш" });
    expect(r.status).toBe(200);
    expect(st.sync).toHaveLength(1);
    const [base0, before, after] = st.sync[0] as [Record<string, unknown>, string, string];
    expect(base0).toMatchObject({ trader: TRADER.name, tradeId: 236675, source: "tag" });
    expect([before, after]).toEqual(["FOMO", "FOMO, Реванш"]);
  });

  it("other fields do not touch the errors store; bulk addTags does", async () => {
    await call("PATCH", "/api/trades/236675", { notes: "n" });
    expect(st.sync).toHaveLength(0);
    const r = await call("POST", "/api/trades/bulk", { action: "addTags", ids: [236675], tags: ["Большой размер"] });
    expect(r.status).toBe(200);
    expect(st.sync).toHaveLength(0); // bulk: one set-based sync for every changed trade
    expect(st.bulk).toEqual([[[{ trader: TRADER.name, tradeId: 236675, before: ["FOMO"], after: ["FOMO", "Большой размер"] }], TRADER.name]]);
    expect(st.sql.filter((x) => /UPDATE trades t SET tags/.test(x.sql)).map((x) => x.params)).toEqual([[[236675], ["FOMO, Большой размер"]]]);
    // nothing changes → no write, no sync
    st.sql.length = 0;
    st.bulk.length = 0;
    await call("POST", "/api/trades/bulk", { action: "addTags", ids: [236675], tags: ["fomo"] });
    expect(st.bulk).toHaveLength(0);
    expect(st.sql.some((x) => /UPDATE trades t SET tags/.test(x.sql))).toBe(false);
  });
});

describe("2.12 GET /chart/plan-overlay", () => {
  it("owner: own plan levels + setup label", async () => {
    const r = await call("GET", "/api/chart/plan-overlay?trade=236675");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ticker: "AAPL", date: "2026-10-15", source: "own", setup: "1.3 ORB" });
    expect(r.json.levels).toEqual([{ price: 180, kind: "support" }, { price: 190, kind: "resistance" }]);
  });

  it("the trader's curator sees the owner's plan; another trader cannot read the trade (403)", async () => {
    who = CURATOR;
    expect((await call("GET", "/api/chart/plan-overlay?trade=236675")).json.source).toBe("own");
    who = OTHER;
    expect((await call("GET", "/api/chart/plan-overlay?trade=236675")).status).toBe(403);
  });

  it("ticker + day: the viewer's own plan; bad query → 400", async () => {
    const r = await call("GET", "/api/chart/plan-overlay?ticker=aapl&date=2026-10-15");
    expect(r.json).toMatchObject({ ticker: "AAPL", source: "own", setup: null });
    expect(st.sql.find((x) => /FROM trader_plans/.test(x.sql))!.params).toEqual([TRADER.name, "2026-10-15"]);
    expect((await call("GET", "/api/chart/plan-overlay?ticker=aapl")).status).toBe(400);
  });
});
