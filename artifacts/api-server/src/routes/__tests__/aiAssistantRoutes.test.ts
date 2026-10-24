/**
 * «Ассистент WS» over HTTP: the real router behind the real auth middleware (signed tokens), the real permission
 * matrix and the real loopback path the read tools use — on a fake database, with a scripted model (no Anthropic).
 *   - not configured → 503 AI_NOT_CONFIGURED; desk switch / juniors → 403
 *   - SSE framing of a full turn (meta → tool chips → text → done), history + audit rows written
 *   - permission scoping: a junior asking for another trader's trades through the assistant gets only their own
 *     (the /trades/page route's own scope rule runs; the foreign name never reaches SQL), and another trader's trade
 *     by id is refused
 *   - budgets (429 AI_BUDGET_EXCEEDED) and the per-user request rate (429 RATE_LIMITED)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import http from "node:http";

const h = vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
  process.env.JWT_SECRET ??= "vitest-only-secret";
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  delete process.env.AI_ASSISTANT_MOCK;
  const USERS: Record<number, { id: number; name: string; role: string }> = {
    1: { id: 1, name: "Admin A.", role: "admin" },
    5: { id: 5, name: "Junior J.", role: "trader" },
    6: { id: 6, name: "Senior S.", role: "trader" },
    9: { id: 9, name: "Rate R.", role: "trader" },
    71: { id: 71, name: "Roman Foreign", role: "trader" },
  };
  const STAGE: Record<string, string> = { "Senior S.": "senior", "Rate R.": "trader" };
  const state = { usage: [] as { model: string; tokens: string }[], queries: [] as { text: string; values: unknown[] }[], msgId: 0 };
  return { USERS, STAGE, state };
});

vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const answer = async (q: unknown, params?: unknown[]) => {
    const text = typeof q === "string" ? q : String((q as { text?: string } | null)?.text ?? "");
    const values = Array.isArray(params) ? params : ((q as { values?: unknown[] } | null)?.values ?? []);
    h.state.queries.push({ text, values });
    if (/\bFROM\s+users\b/i.test(text) && /\bWHERE\s+(u\.)?id\s*=\s*\$1/i.test(text)) {
      const u = h.USERS[Number(values[0])];
      if (u) return { rows: [{ ...u, active: true, banned: false, locale: "ru", token_version: 0 }], rowCount: 1 };
    }
    if (/SELECT role FROM users WHERE name = \$1/i.test(text)) {
      const u = Object.values(h.USERS).find((x) => x.name === values[0]);
      return { rows: u ? [{ role: u.role }] : [], rowCount: u ? 1 : 0 };
    }
    if (/FROM academy_trader_stage/i.test(text)) {
      const st = h.STAGE[String(values[0])];
      return { rows: st ? [{ stage: st }] : [], rowCount: st ? 1 : 0 };
    }
    if (/FROM ai_assistant_usage/i.test(text)) return { rows: h.state.usage, rowCount: h.state.usage.length };
    if (/INSERT INTO ai_assistant_messages/i.test(text)) return { rows: [{ id: String(++h.state.msgId) }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const chain = (): unknown => {
    const p: unknown = new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve([]).then(ok, ko) : () => p),
      apply: () => p,
    });
    return p;
  };
  const db: unknown = new Proxy({}, {
    get: (_t, k) => (k === "transaction" ? async (fn: (tx: unknown) => unknown) => fn(db) : k === "execute" ? async () => ({ rows: [] }) : () => chain()),
  });
  const client = { query: vi.fn(answer), release: vi.fn() };
  return {
    ...schema, db,
    pool: { query: vi.fn(answer), connect: vi.fn(async () => client), end: vi.fn(async () => undefined), on: vi.fn() },
    setPoolErrorHandler: vi.fn(), poolConfig: vi.fn(() => ({})), createPool: vi.fn(),
  };
});

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { authMiddleware, apiAuthGate } = await import("../../lib/auth");
const { requestLang } = await import("../../i18n");
const { errorMiddleware } = await import("../../lib/http");
const { jsonBody } = await import("../../lib/security/http");
const { default: router } = await import("../index");
const { __loadSettingsCache } = await import("../../lib/settings/registry");
const { __setAssistantClientForTests } = await import("../../lib/assistant/client");
const { scriptedClient, toolResultsIn } = await import("../../lib/assistant/__tests__/scripted");

let server: http.Server;
let base = "";
const token = (id: number) => {
  const u = h.USERS[id]!;
  return jwt.sign({ sub: u.id, name: u.name, role: u.role, tv: 0, sid: `sid-${id}` }, process.env.JWT_SECRET!, { algorithm: "HS256", expiresIn: 3600 });
};
const call = (id: number, method: string, path: string, body?: unknown) =>
  fetch(`${base}/api${path}`, { method, headers: { authorization: `Bearer ${token(id)}`, "content-type": "application/json", "x-lang": "ru" }, body: body === undefined ? undefined : JSON.stringify(body) });

type Frame = { event: string; data: any };
function frames(text: string): Frame[] {
  return text.split("\n\n").filter((b) => b.startsWith("event:")).map((b) => {
    const [ev, data] = b.split("\n");
    return { event: ev!.slice(7), data: JSON.parse(data!.slice(6)) };
  });
}

beforeAll(async () => {
  const app = express();
  app.use("/api", authMiddleware, apiAuthGate, requestLang, jsonBody(), router);
  app.use(errorMiddleware);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  __setAssistantClientForTests(null);
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  __loadSettingsCache({});
  h.state.usage = [];
  h.state.queries = [];
});

describe("availability", () => {
  it("without a key (and no dev mock) the chat answers 503 AI_NOT_CONFIGURED; status says so", async () => {
    __setAssistantClientForTests(null);
    const r = await call(6, "POST", "/ai/assistant/chat", { message: "hi" });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ code: "AI_NOT_CONFIGURED" });
    const s = await (await call(1, "GET", "/ai/assistant/status")).json();
    expect(s).toMatchObject({ configured: false, allowed: false, blocked: "AI_NOT_CONFIGURED", canConfigure: true });
    const t = (await (await call(6, "GET", "/ai/assistant/status")).json()) as { canConfigure: boolean };
    expect(t.canConfigure).toBe(false);
  });

  it("the desk switch and the juniors switch close it", async () => {
    __setAssistantClientForTests(scriptedClient([{ text: "x" }]));
    __loadSettingsCache({ "assistant.enabled": false });
    expect(await (await call(6, "POST", "/ai/assistant/chat", { message: "hi" })).json()).toMatchObject({ code: "AI_ASSISTANT_OFF" });
    __loadSettingsCache({ "assistant.juniorsEnabled": false });
    const j = await call(5, "POST", "/ai/assistant/chat", { message: "hi" });
    expect(j.status).toBe(403);
    expect(await j.json()).toMatchObject({ code: "AI_ASSISTANT_STAGE" });
    expect(((await call(1, "GET", "/ai/assistant/status").then((r) => r.json())) as { blocked: unknown }).blocked).toBeNull(); // staff have no stage
  });
});

describe("a turn over SSE", () => {
  it("streams meta → tool chip → text → done, stores the exchange and audits it without bodies", async () => {
    __setAssistantClientForTests(scriptedClient([{ text: "Let me look. ", tools: [{ name: "search_help", input: { query: "day report" } }] }, { text: "See the day report." }]));
    const r = await call(6, "POST", "/ai/assistant/chat", { message: "where is my day report?", context: { route: "/trades" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const f = frames(await r.text());
    expect(f[0]).toMatchObject({ event: "meta", data: { model: "claude-haiku-5-5", reason: "default" } });
    expect(f.filter((x) => x.event === "tool").map((x) => x.data.status)).toEqual(["start", "done"]);
    expect(f.filter((x) => x.event === "text").map((x) => x.data.delta).join("")).toBe("Let me look. See the day report.");
    expect(f[f.length - 1]).toMatchObject({ event: "done", data: { model: "claude-haiku-5-5", messageId: 2 } });
    const audit = h.state.queries.find((q) => /INSERT INTO ai_assistant_audit/.test(q.text))!;
    expect(audit.values[0]).toBe("Senior S.");
    expect(audit.values[9]).toEqual(["search_help"]);
    expect(audit.values.slice(15)).toEqual([null, null]); // no bodies unless assistant.auditBodies
    expect(h.state.queries.filter((q) => /INSERT INTO ai_assistant_messages/.test(q.text))).toHaveLength(2);
  });

  it("keeps bodies in the audit only when the admin setting allows it", async () => {
    __setAssistantClientForTests(scriptedClient([{ text: "Answer." }]));
    __loadSettingsCache({ "assistant.auditBodies": true });
    await (await call(6, "POST", "/ai/assistant/chat", { message: "question" })).text();
    const audit = h.state.queries.find((q) => /INSERT INTO ai_assistant_audit/.test(q.text))!;
    expect(audit.values.slice(15)).toEqual(["question", "Answer."]);
  });
});

describe("permission scoping of the read tools", () => {
  it("a junior asking for another trader's trades gets only their own (the route's scope rule)", async () => {
    const client = scriptedClient([{ tools: [{ name: "get_trades", input: { trader: "Roman Foreign", limit: 10 } }] }, { text: "done" }]);
    __setAssistantClientForTests(client);
    const r = await call(5, "POST", "/ai/assistant/chat", { message: "show Roman's trades" });
    const f = frames(await r.text());
    expect(f.find((x) => x.event === "tool" && x.data.status !== "start")).toMatchObject({ data: { name: "get_trades", status: "done" } });
    const sqlParams = h.state.queries.filter((q) => /trades/i.test(q.text)).flatMap((q) => q.values.map(String));
    expect(sqlParams).toContain("Junior J.");
    expect(sqlParams.some((v) => v.includes("Roman Foreign"))).toBe(false);
    expect(toolResultsIn(client.calls[1]!)[0]).not.toContain("Roman Foreign");
  });

  it("another trader's trade by id is refused to a trader, through the same check as the trade sheet", async () => {
    const client = scriptedClient([{ tools: [{ name: "get_trade", input: { id: 4242 } }] }, { text: "no access" }]);
    __setAssistantClientForTests(client);
    const f = frames(await (await call(5, "POST", "/ai/assistant/chat", { message: "open trade 4242" })).text());
    expect(f.find((x) => x.event === "tool" && x.data.status !== "start")).toMatchObject({ data: { name: "get_trade", status: "error" } });
    expect(toolResultsIn(client.calls[1]!)[0]).toMatch(/status="error"/);
  });
});

describe("limits", () => {
  it("an exhausted daily budget answers 429 AI_BUDGET_EXCEEDED before any model call", async () => {
    const client = scriptedClient([{ text: "never" }]);
    __setAssistantClientForTests(client);
    __loadSettingsCache({ "assistant.dailyTokensDefault": 1000 });
    h.state.usage = [{ model: "claude-haiku-5-5", tokens: "1000" }];
    const r = await call(6, "POST", "/ai/assistant/chat", { message: "hi" });
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ code: "AI_BUDGET_EXCEEDED", details: { limit: 1000 } });
    expect(client.calls).toHaveLength(0);
  });

  it("an exhausted escalation budget falls back to the default model for «Умнее»", async () => {
    const client = scriptedClient([{ text: "cheap answer" }]);
    __setAssistantClientForTests(client);
    __loadSettingsCache({ "assistant.dailyTokensSmart": 10 });
    h.state.usage = [{ model: "claude-sonnet-5-5", tokens: "10" }];
    const f = frames(await (await call(6, "POST", "/ai/assistant/chat", { message: "hi", smart: true })).text());
    expect(f[0]).toMatchObject({ event: "meta", data: { model: "claude-haiku-5-5", reason: "smart_budget" } });
  });

  it("the per-user request rate is the desk setting (429 RATE_LIMITED past it)", async () => {
    __setAssistantClientForTests(scriptedClient([{ text: "ok" }]));
    __loadSettingsCache({ "assistant.requestsPer10Min": 2 });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) { const r = await call(9, "POST", "/ai/assistant/chat", { message: `q${i}` }); codes.push(r.status); await r.text(); }
    expect(codes).toEqual([200, 200, 429]);
  });
});

describe("history", () => {
  it("is per user and clearable (soft clear)", async () => {
    expect(await (await call(6, "GET", "/ai/assistant/history")).json()).toEqual({ messages: [] });
    await call(6, "DELETE", "/ai/assistant/history");
    const q = h.state.queries.find((x) => /UPDATE ai_assistant_messages SET cleared_at/.test(x.text))!;
    expect(q.values).toEqual(["Senior S."]);
  });
});
