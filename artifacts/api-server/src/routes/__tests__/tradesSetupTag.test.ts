/**
 * Wave 1, 1.2 — the setup tag is a playbook setup. PATCH /trades/:id and POST /trades/bulk {setSetup} write
 * trades.playbook_id with the setup's name as text (an office setup by name / number, or by playbookId; null clears);
 * the auto-classifier's accept maps its class to the office setup (CLASS_TO_OFFICE); a time-only class stays text.
 * Route × role: the owner (trader) tags own trades; another trader's trade → 403. DB and pool are faked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Who = { id: number; name: string; role: "trader" | "curator" | "admin" };
const TRADER: Who = { id: 5, name: "Trader T.", role: "trader" };
const OTHER: Who = { id: 6, name: "Other O.", role: "trader" };
let who: Who = TRADER;

const OFFICE = [
  { id: 205, name: "1.3 ORB 5 минут", folder: "1 · Открытие", min_tier: "trainee" },
  { id: 210, name: "2.3 Пробой HOD / LOD", folder: "2 · Тренд дня", min_tier: "junior" },
];
const st = vi.hoisted(() => ({
  trade: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  sql: [] as { sql: string; params: unknown[] }[],
  suggestion: null as Record<string, unknown> | null,
  tagged: [] as number[],
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
      st.updates.push(data);
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
        if (/FROM playbook p\s+WHERE p\.deleted_at IS NULL AND .*'office'/s.test(sql)) return { rows: OFFICE, rowCount: OFFICE.length };
        if (/FROM playbook p WHERE p\.id = \$1/.test(sql)) {
          const id = Number(params[0]);
          if (id === 205) return { rows: [{ id: 205, name: "1.3 ORB 5 минут", trader: null, space: "office" }] };
          if (id === 900) return { rows: [{ id: 900, name: "Мой сетап", trader: OTHER.name, space: "personal" }] };
          return { rows: [] };
        }
        if (/SELECT trader FROM trades WHERE id = \$1/.test(sql)) return { rows: st.trade ? [{ trader: st.trade.trader }] : [] };
        if (/FROM trade_setup_suggestions WHERE trade_id = ANY/.test(sql)) return { rows: st.suggestion ? [st.suggestion] : [] };
        if (/SELECT id, trader FROM trades WHERE id = ANY/.test(sql)) return { rows: st.trade ? [{ id: st.trade.id, trader: st.trade.trader }] : [] };
        return { rows: [], rowCount: 0 };
      }),
    },
  };
});
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/permissions", async (orig) => {
  const actual = await orig<typeof import("../../lib/permissions")>();
  const matrix = actual.buildEffectiveMatrix([]);
  const actor = () => ({ id: who.id, name: who.name, role: who.role, guest: false, wards: [] as string[] });
  return {
    ...actual,
    resolveActor: vi.fn(async () => actor()),
    getEffectiveMatrix: vi.fn(async () => matrix),
    can: vi.fn(async (_req: unknown, cap: Parameters<typeof actual.can>[1], target?: { trader?: string | null } | null) => actual.evaluate(matrix, actor(), cap, target)),
  };
});
vi.mock("../../lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("../../lib/marketContext", () => ({ captureAndAttach: vi.fn(async () => undefined) }));
vi.mock("../../lib/aiReview", () => ({ maybeAutoGenerateReview: vi.fn() }));
vi.mock("../../lib/rulesEngine", () => ({ scanRulesForTrader: vi.fn(async () => undefined) }));
vi.mock("../../lib/hotCache", () => ({ invalidateDashboardCache: vi.fn() }));
vi.mock("../../lib/tradesPageCache", () => ({ invalidateTradesPageCache: vi.fn() }));
vi.mock("../../lib/tradeStructureStore", () => ({ refreshTradeStructures: vi.fn(async () => undefined), structureForTrade: vi.fn(async () => null) }));
vi.mock("../../lib/playbookAccess", async (orig) => ({
  ...(await orig<typeof import("../../lib/playbookAccess")>()),
  isReadableExampleTrade: vi.fn(async () => false),
  loadMoneyViewer: vi.fn(async () => ({ name: who.name, staff: false })),
}));
vi.mock("../../lib/playbookToday/service", () => ({
  tradeTagged: vi.fn(async (id: number) => { st.tagged.push(id); }),
  viewerLocks: vi.fn(async () => ({ known: new Map([[210, { locked: true }]]), lockOther: () => ({ locked: false }) })),
}));
vi.mock("../checklist", () => ({ findChecklistResponseFor: vi.fn(async () => null) }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: tradesRouter } = await import("../trades");
const { default: setupsAutoRouter } = await import("../setups-auto");
const { errorMiddleware } = await import("../../lib/http");
const link = await import("../../lib/tradesSetupLink");

const brokerTrade = (over: Record<string, unknown> = {}) => ({
  id: 236675, ticker: "SPCX", date: "2026-10-16", side: "long", entry: "147.10", exit: "147.39", qty: "100", fees: "1.2",
  pnl: "25", result: "win", trader: TRADER.name, source: "propreports", externalId: "acc|SPCX|t|long", brokerAccount: "31206881",
  contextSnapshot: { source: "propreports" }, setup: null, tags: null, notes: null, deletedAt: null,
  createdAt: new Date("2026-10-16T14:00:00Z"), playbookId: null, ...over,
});

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role }; next(); });
  app.use("/api", tradesRouter);
  app.use("/api", setupsAutoRouter);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = TRADER;
  st.trade = brokerTrade();
  st.updates.length = 0;
  st.sql.length = 0;
  st.tagged.length = 0;
  st.suggestion = null;
  link.forgetOfficeSetups();
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: r.status, json };
}

describe("PATCH /trades/:id — setup tag = playbook setup", () => {
  it("an office setup's name (the S picker) links playbook_id and keeps the name; the counters re-read", async () => {
    const r = await call("PATCH", "/api/trades/236675", { setup: "1.3 ORB 5 минут" });
    expect(r.status).toBe(200);
    expect(st.updates.at(-1)).toMatchObject({ setup: "1.3 ORB 5 минут", playbookId: 205 });
    expect(r.json.playbookId).toBe(205);
    expect(st.tagged).toEqual([236675]);
  });

  it("by number or playbookId; null clears both; free text keeps no stale link", async () => {
    await call("PATCH", "/api/trades/236675", { setup: "2.3" });
    expect(st.updates.at(-1)).toMatchObject({ setup: "2.3 Пробой HOD / LOD", playbookId: 210 });
    await call("PATCH", "/api/trades/236675", { playbookId: 205 });
    expect(st.updates.at(-1)).toMatchObject({ setup: "1.3 ORB 5 минут", playbookId: 205 });
    await call("PATCH", "/api/trades/236675", { setup: null });
    expect(st.updates.at(-1)).toMatchObject({ setup: null, playbookId: null });
    await call("PATCH", "/api/trades/236675", { setup: "мой пробой" });
    expect(st.updates.at(-1)).toMatchObject({ setup: "мой пробой", playbookId: null });
  });

  it("someone else's personal setup → 404 SETUP_NOT_FOUND; another trader's trade → 403", async () => {
    const r = await call("PATCH", "/api/trades/236675", { playbookId: 900 });
    expect(r.status).toBe(404);
    expect(st.updates).toHaveLength(0);
    who = OTHER;
    expect((await call("PATCH", "/api/trades/236675", { setup: "1.3 ORB 5 минут" })).status).toBe(403);
  });

  it("other fields leave the setup alone", async () => {
    await call("PATCH", "/api/trades/236675", { tags: "fomo" });
    expect(st.updates.at(-1)).not.toHaveProperty("playbookId");
    expect(st.tagged).toEqual([]);
  });
});

describe("POST /trades/bulk setSetup", () => {
  it("writes playbook_id + name for the selection (by name or by playbookId)", async () => {
    let r = await call("POST", "/api/trades/bulk", { action: "setSetup", ids: [236675], setup: "1.3 ORB 5 минут" });
    expect(r.status).toBe(200);
    expect(st.updates.at(-1)).toEqual({ setup: "1.3 ORB 5 минут", playbookId: 205 });
    r = await call("POST", "/api/trades/bulk", { action: "setSetup", ids: [236675], playbookId: 205 });
    expect(r.status).toBe(200);
    expect(st.updates.at(-1)).toEqual({ setup: "1.3 ORB 5 минут", playbookId: 205 });
    await call("POST", "/api/trades/bulk", { action: "setSetup", ids: [236675], setup: null });
    expect(st.updates.at(-1)).toEqual({ setup: null, playbookId: null });
    expect(st.tagged.length).toBe(3);
  });
});

describe("auto-classifier → playbook setup", () => {
  const sugg = (setup: string) => ({ id: 1, trade_id: 236675, inputs_hash: "h", setup, confidence: "0.78", explanation: {}, features: {}, candles_available: true, interval: "1m", version: "1.0", status: "suggested", decided_by: null, decided_at: null, updated_at: new Date() });

  it("every class maps to an office number or to nothing (time-only classes)", () => {
    expect(link.officeCodeForClass("ORB пробой")).toBe("1.3");
    expect(link.officeCodeForClass("hod")).toBe("2.3");
    expect(link.officeCodeForClass("Полдень")).toBeNull();
    expect(link.officeCodeForClass("что-то")).toBeNull();
    for (const code of Object.values(link.CLASS_TO_OFFICE)) if (code) expect(code).toMatch(/^[1-5]\.\d$/);
  });

  it("accept (one tap) writes the mapped office setup's playbook_id and name", async () => {
    st.suggestion = sugg("ORB пробой");
    const r = await call("POST", "/api/setups-auto/236675/accept", {});
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ playbookId: 205, setup: "1.3 ORB 5 минут" });
    expect(st.updates.at(-1)).toEqual({ setup: "1.3 ORB 5 минут", playbookId: 205 });
    expect(st.tagged).toEqual([236675]);
  });

  it("a time-only class is accepted as text only; a chosen playbookId wins", async () => {
    st.suggestion = sugg("Полдень");
    await call("POST", "/api/setups-auto/236675/accept", {});
    expect(st.updates.at(-1)).toEqual({ setup: "Полдень", playbookId: null });
    await call("POST", "/api/setups-auto/236675/accept", { playbookId: 205 });
    expect(st.updates.at(-1)).toEqual({ setup: "1.3 ORB 5 минут", playbookId: 205 });
  });

  it("accept on another trader's trade → 403", async () => {
    st.suggestion = sugg("ORB пробой");
    who = OTHER;
    expect((await call("POST", "/api/setups-auto/236675/accept", {})).status).toBe(403);
  });

  it("for-trades: own unlinked trades get the mapped suggestion; another trader gets nothing", async () => {
    st.suggestion = sugg("ORB пробой");
    let r = await call("GET", "/api/setups-auto/for-trades?ids=236675");
    expect(r.json.items).toEqual({ 236675: { playbookId: 205, name: "1.3 ORB 5 минут", confidence: 0.78 } });
    who = OTHER;
    r = await call("GET", "/api/setups-auto/for-trades?ids=236675");
    expect(r.json.items).toEqual({});
    expect((await call("GET", "/api/setups-auto/for-trades?ids=abc")).status).toBe(400);
  });

  it("the picker list marks setups above the viewer's tier as locked", async () => {
    const r = await call("GET", "/api/setups-auto/setups");
    expect(r.status).toBe(200);
    expect(r.json.setups).toEqual([
      { id: 205, code: "1.3", name: "1.3 ORB 5 минут", folder: "1 · Открытие", locked: false },
      { id: 210, code: "2.3", name: "2.3 Пробой HOD / LOD", folder: "2 · Тренд дня", locked: true },
    ]);
  });
});
