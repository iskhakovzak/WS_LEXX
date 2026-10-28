/**
 * routes/quotes.ts — the quote library served to the web: POST /quotes/pick follows the no-repeat cycle the browser
 * sends (same slot → same quote, «next» → a fresh unseen one, categories and context tags respected), GET /quotes/items
 * answers only the asked ids, GET /quotes/orig/:id and /quotes/theme. Pure: no DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../quotes");
const { errorMiddleware } = await import("../../lib/http");
const { quotePool } = await import("../../lib/quotes/library");
const { EMPTY_ROTATION, seedFor } = await import("../../lib/quotes/rotation");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: 5, name: "Trader T.", role: "trader" };
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; cache: string | null }> {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null), cache: r.headers.get("cache-control") };
}

const pick = (extra: Record<string, unknown>) => call("POST", "/api/quotes/pick", { surface: "dash", lang: "ru", slot: "2026-10-29", seed: 42, who: "trader t.", ...extra });

describe("POST /quotes/pick", () => {
  it("draws the slot's quote once, keeps it for the same slot, moves on with next", async () => {
    const a = await pick({ state: EMPTY_ROTATION });
    expect(a.status).toBe(200);
    expect(a.json.changed).toBe(true);
    expect(a.json.state.seen).toEqual([a.json.id]);
    expect(a.json.state.current).toEqual({ id: a.json.id, slot: "2026-10-29" });
    expect(a.json.quote).toMatchObject({ id: a.json.id, text: expect.any(String), authorName: expect.any(String), workName: expect.any(String) });
    expect(a.json.total).toBe(quotePool().length);
    expect(a.cache).toContain("no-store");

    const again = await pick({ state: a.json.state });
    expect(again.json).toMatchObject({ id: a.json.id, changed: false });

    const next = await pick({ state: a.json.state, next: true });
    expect(next.json.changed).toBe(true);
    expect(next.json.id).not.toBe(a.json.id);
    expect(next.json.state.seen).toEqual([a.json.id, next.json.id]);

    const tomorrow = await pick({ state: next.json.state, slot: "2026-10-30" });
    expect(tomorrow.json.changed).toBe(true);
    expect(tomorrow.json.state.seen).toHaveLength(3);
    expect(new Set(tomorrow.json.state.seen).size).toBe(3);
  });

  it("is deterministic and the language only changes the text", async () => {
    const ru = await pick({ state: EMPTY_ROTATION });
    const en = await pick({ state: EMPTY_ROTATION, lang: "en" });
    expect(en.json.id).toBe(ru.json.id);
    expect(en.json.quote.text).not.toBe(ru.json.quote.text);
  });

  it("respects the categories and the context tags", async () => {
    const r = await pick({ state: EMPTY_ROTATION, cats: ["olympus"], tags: ["patience"] });
    expect(r.json.quote.cat).toBe("olympus");
    expect(r.json.quote.tags).toContain("patience");
    // The stored quote of a slot stays only while its category is on.
    const off = await pick({ state: r.json.state, cats: ["trading"] });
    expect(off.json.changed).toBe(true);
    expect(off.json.quote.cat).toBe("trading");
  });

  it("the seed falls back to the name's hash, salted per surface", () => {
    expect(seedFor(undefined, "Trader T.", "dash")).toBe(seedFor(null, "trader t.", "dash"));
    expect(seedFor(7, "x", "dash")).not.toBe(seedFor(7, "x", "lock"));
  });

  it("treats a malformed state as an empty cycle and rejects bad input", async () => {
    const r = await pick({ state: { v: 9, junk: true }, surface: "lock", slot: "5m:123" });
    expect(r.status).toBe(200);
    expect(r.json.state.cycle).toBe(0);
    expect((await pick({ lang: "de" })).status).toBe(400);
    expect((await pick({ slot: "a b" })).status).toBe(400);
  });
});

describe("GET /quotes/items, /quotes/orig/:id, /quotes/theme", () => {
  it("answers only the asked ids in the asked language, cached for a day", async () => {
    const [a, b] = quotePool();
    const r = await call("GET", `/api/quotes/items?lang=uz&ids=${a!.id},nope-000,${b!.id},${a!.id},bad id`);
    expect(r.status).toBe(200);
    expect(r.json.quotes.map((q: { id: string }) => q.id)).toEqual([a!.id, b!.id]);
    expect(r.cache).toBe("private, max-age=86400");
    expect((await call("GET", "/api/quotes/items?lang=xx&ids=a")).status).toBe(400);
  });

  it("serves an original by id, 404 when there is none", async () => {
    const withOrig = quotePool().find((q) => q.o === 1)!;
    const r = await call("GET", `/api/quotes/orig/${withOrig.id}`);
    expect(r.json).toEqual({ id: withOrig.id, text: expect.any(String) });
    expect(r.json.text.length).toBeGreaterThan(0);
    const without = quotePool().find((q) => q.o !== 1)!;
    expect((await call("GET", `/api/quotes/orig/${without.id}`)).status).toBe(404);
  });

  it("orders the theme's ids per seed", async () => {
    const r = await call("GET", "/api/quotes/theme?tag=patience&seed=144:2026-10-21");
    expect(r.json.ids.length).toBeGreaterThan(0);
    const byId = new Map(quotePool().map((q) => [q.id, q]));
    for (const id of r.json.ids) expect(byId.get(id)!.tags).toContain("patience");
    expect((await call("GET", "/api/quotes/theme?tag=patience&seed=144:2026-10-21")).json.ids).toEqual(r.json.ids);
  });
});
