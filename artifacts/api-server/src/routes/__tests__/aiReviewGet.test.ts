/**
 * GET /trades/:id/ai-review — «no review yet» is a normal state: 200 with null, not a 404 (DEV-15); a stored review
 * comes back as the DTO (no model name in it).
 */
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const latest = vi.fn();
vi.mock("../../lib/assistant/review/store", () => ({ latestReview: (s: unknown, lang: unknown) => latest(s, lang) }));
vi.mock("../../lib/auth", () => ({ canAccessTrade: vi.fn(async () => true), personalTrader: vi.fn(async () => "A"), isStaffRole: () => false }));
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn() } }));

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response, next: (e?: unknown) => void) => unknown }[] } };

async function callGet(id: number): Promise<{ status: number; body: unknown }> {
  const router = (await import("../aireview")).default as unknown as { stack: Layer[] };
  const layer = router.stack.find((l) => l.route?.path === "/trades/:id/ai-review" && l.route.methods.get);
  if (!layer?.route) throw new Error("route not found");
  const out = { status: 200, body: undefined as unknown };
  return new Promise((resolve, reject) => {
    const res = {
      headersSent: false,
      status(s: number) { out.status = s; return this; },
      json(b: unknown) { out.body = b; resolve(out); return this; },
      setHeader() { return this; },
    } as unknown as Response;
    const req = { params: { id: String(id) }, query: {}, headers: {}, authUser: { name: "Anna" }, get: () => undefined } as unknown as Request;
    void layer.route!.stack[0]!.handle(req, res, (e?: unknown) => reject(e ?? new Error("next() without an answer")));
  });
}

const REVIEW = {
  verdict: { grade: "B", headline: "Clean entry, late exit", followedPlan: "partly" },
  wentWell: [], wentWrong: [], edge: null, tomorrow: { if: "when the 2nd target hits", then: "I sell half" }, whatIf: null, confidence: "medium", dataGaps: [],
};

describe("GET /trades/:id/ai-review", () => {
  it("answers 200 null when the trade has no review yet", async () => {
    latest.mockResolvedValueOnce(null);
    expect(await callGet(5)).toEqual({ status: 200, body: null });
  });

  it("answers the latest review as the DTO, without a model name", async () => {
    latest.mockResolvedValueOnce({ id: 1, kind: "trade", trader: "A", tradeId: 5, day: null, lang: "ru", review: REVIEW, facts: null, deep: true, units: 9000, createdAt: "2026-10-25T00:00:00.000Z" });
    const r = await callGet(5);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 1, tradeId: 5, tier: "deep", cached: true, whatIfRule: null, review: { verdict: { grade: "B" } } });
    expect(JSON.stringify(r.body)).not.toMatch(/claude|haiku|sonnet|opus|"model"/i);
  });
});
