/**
 * Idea comments reach the team activity feed (ROMAN-32): a public comment writes one activity_log row
 * (commented · trade-ideas · idea id · ticker), a private reply writes none. DB and notifications are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Q = { sql: string; params: unknown[] };
const calls: Q[] = [];

function answer(sql: string, params: unknown[] = []) {
  calls.push({ sql, params });
  if (/FROM trade_ideas WHERE id = \$1/.test(sql)) return { rows: [{ id: 570, ticker: "AAL", trader: "Роман Ж.", status: "published" }], rowCount: 1 };
  if (/INSERT INTO trade_idea_comments/.test(sql)) {
    return { rows: [{ id: 1, idea_id: 570, author_name: params[1], text: params[2], is_private: params[3], source: "website", created_at: new Date().toISOString() }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => ({
  db: {},
  pool: { query: vi.fn(async (sql: string, params?: unknown[]) => answer(sql, params)) },
}));
vi.mock("../../lib/notifyUtils", () => ({
  notifyPublicComment: vi.fn(async () => undefined), notifyTraderTelegram: vi.fn(async () => undefined), notifyUser: vi.fn(async () => undefined),
}));
vi.mock("../../lib/notifyEvents", () => ({ inBackground: () => undefined }));
vi.mock("../../i18n", async (orig) => ({ ...(await orig<typeof import("../../i18n")>()), localeOfUser: vi.fn(async () => "ru") }));
vi.mock("../../lib/permissions", async (orig) => ({ ...(await orig<typeof import("../../lib/permissions")>()), can: vi.fn(async () => false) }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../idea-comments");
const { errorMiddleware } = await import("../../lib/http");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { authUser: unknown }).authUser = { id: 135, name: "Максим Р.", role: "trader" }; next(); });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { calls.length = 0; });

const post = (body: unknown) => fetch(`${base}/api/trade-ideas/570/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const activity = () => calls.filter((c) => /INSERT INTO activity_log/.test(c.sql));

describe("POST /trade-ideas/:id/comments → activity", () => {
  it("a public comment logs commented · trade-ideas with the idea id and ticker, without the text", async () => {
    const r = await post({ text: "Стоп задет, выхожу" });
    expect(r.status).toBe(201);
    await vi.waitFor(() => expect(activity()).toHaveLength(1));
    const [action, section, entityId, title, trader, details] = activity()[0]!.params;
    expect([action, section, entityId, title, trader, details]).toEqual(["commented", "trade-ideas", "570", "AAL", "Максим Р.", null]);
  });

  it("a private reply is not logged", async () => {
    const r = await post({ text: "лично", is_private: true });
    expect(r.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activity()).toHaveLength(0);
  });
});
