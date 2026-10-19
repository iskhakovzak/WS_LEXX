/**
 * GET /trades/:id/ai-review — «no review yet» is a normal state: 200 with null, not a 404 (DEV-15).
 */
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const latest = vi.fn();
vi.mock("../../lib/aiReview", () => ({
  generateReview: vi.fn(),
  getLatestReview: (id: number) => latest(id),
  RateLimitedError: class extends Error {},
}));
vi.mock("../../lib/auth", () => ({ canAccessTrade: vi.fn(async () => true) }));
vi.mock("@workspace/db", () => ({ db: {}, aiReviewRateLimitTable: {}, aiTradeReviewsTable: {} }));

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response, next: (e?: unknown) => void) => unknown }[] } };

async function callGet(id: number): Promise<{ status: number; body: unknown }> {
  const router = (await import("../aireview")).default as unknown as { stack: Layer[] };
  const layer = router.stack.find((l) => l.route?.path === "/trades/:id/ai-review" && l.route.methods.get);
  if (!layer?.route) throw new Error("route not found");
  const out = { status: 200, body: undefined as unknown };
  return new Promise((resolve, reject) => {
    const res = {
      status(s: number) { out.status = s; return this; },
      json(b: unknown) { out.body = b; resolve(out); return this; },
      setHeader() { return this; },
    } as unknown as Response;
    const req = { params: { id: String(id) }, query: {}, headers: {}, authUser: { name: "Анна" } } as unknown as Request;
    // asyncHandler does not return its promise: the answer arrives through res.json (or an error through next).
    void layer.route!.stack[0].handle(req, res, (e?: unknown) => reject(e ?? new Error("next() without an answer")));
  });
}

describe("GET /trades/:id/ai-review", () => {
  it("answers 200 null when the trade has no review yet", async () => {
    latest.mockResolvedValueOnce(null);
    expect(await callGet(5)).toEqual({ status: 200, body: null });
  });

  it("answers the latest review when there is one", async () => {
    latest.mockResolvedValueOnce({ id: 1, tradeId: 5, summary: "ok" });
    expect(await callGet(5)).toEqual({ status: 200, body: { id: 1, tradeId: 5, summary: "ok" } });
  });
});
