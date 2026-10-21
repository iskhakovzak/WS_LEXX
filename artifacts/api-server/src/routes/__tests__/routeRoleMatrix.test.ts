/**
 * Волна 2 п. 2.3 — «маршрут × роль → код» for EVERY mutating route of the API (POST / PUT / PATCH / DELETE), checked
 * against the permission matrix (lib/permissionsMatrix, default grants). The routes are read from the live router
 * (routes/index.ts), so a new mutating route is in the table the moment it is registered.
 *
 * Each route is called with an empty JSON body by five callers — trader, curator (default caps, nothing extra),
 * admin, guest, anonymous — through the real global gate and the real matrix, on an empty fake DB (harness.ts).
 * The rule for a route is
 *   - DERIVED when a role is refused with 403 FORBIDDEN naming a capability (lib/permissions forbiddenError): then
 *     every role that lacks one of those capabilities in the default matrix must get 403, every role holding them
 *     must not get 401/403 — admin above all;
 *   - otherwise EXPLICIT: an entry in routeMatrix/expectations.ts with a kind and a one-line reason (member-own data,
 *     staff role check, admin-only, owner-only, public, retired, behind a desk switch, capability checked after the
 *     row lookup). A mutating route with neither fails the test — add a capability guard or an entry.
 * Always: anonymous → 401 and guest → 403 on every non-public mutation (the gate); admin never 401/403 unless the
 * entry says the route is owner-only by design.
 *
 * ROUTE_MATRIX_DUMP=<file> writes the observed table as JSON (for writing entries), e.g.
 *   ROUTE_MATRIX_DUMP=../../tmp/matrix.json npx vitest run src/routes/__tests__/routeRoleMatrix.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { writeFileSync } from "node:fs";

const ids = vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
  process.env.JWT_SECRET ??= "vitest-only-secret";
  return { 1: { id: 1, name: "Admin A.", role: "admin" }, 3: { id: 3, name: "Curator C.", role: "curator" }, 5: { id: 5, name: "Trader T.", role: "trader" } } as Record<number, { id: number; name: string; role: string }>;
});

// Empty fake DB: the users-by-id lookups (lib/permissions resolveActor, lib/auth viewerRole …) see the caller; every
// other query has no rows. Drizzle chains resolve to [].
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const answer = async (q: unknown, params?: unknown[]) => {
    const text = typeof q === "string" ? q : String((q as { text?: string } | null)?.text ?? "");
    const values = Array.isArray(params) ? params : ((q as { values?: unknown[] } | null)?.values ?? []);
    if (/\bFROM\s+users\b/i.test(text) && /\bWHERE\s+(u\.)?id\s*=\s*\$1/i.test(text)) {
      const u = ids[Number(values[0])];
      if (u) return { rows: [{ ...u, active: true, banned: false, locale: "ru", token_version: 0 }], rowCount: 1 };
    }
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
    ...schema,
    db,
    pool: { query: vi.fn(answer), connect: vi.fn(async () => client), end: vi.fn(async () => undefined), on: vi.fn() },
    setPoolErrorHandler: vi.fn(),
    poolConfig: vi.fn(() => ({})),
    createPool: vi.fn(),
  };
});
// No rate limits in this table (the limiters key on 127.0.0.1 and would answer 429 before the rights checks).
vi.mock("express-rate-limit", () => {
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { default: pass, rateLimit: pass, ipKeyGenerator: (ip: string) => ip };
});

// The staff «refresh analyst actions» scan walks hundreds of tickers with pauses: answered at once here.
vi.mock("../../lib/marketDataService", async (orig) => {
  const zero = async () => ({ rowsInserted: 0, inserted: 0, durationMs: 0, scanned: 0, tickersWithData: 0, rowsTotal: 0 });
  return {
    ...(await orig<Record<string, unknown>>()),
    scanWatchlistAnalystActions: zero, scanNewsForAnalystActions: zero, scanSeekingAlphaForAnalystActions: zero,
    scanNasdaqAnalystActions: zero, scanGeneralFinanceFeedsForAnalystActions: zero, getDynamicAnalystTickers: async () => [],
  };
});

const realFetch = globalThis.fetch;
// Outbound calls (Telegram, market data, AI): answered locally, never sent.
vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));

const { CALLERS, collectRoutes, startServer } = await import("./routeMatrix/harness");
const { EXPECTATIONS } = await import("./routeMatrix/expectations");
const { checkRoute, routeKey } = await import("./routeMatrix/rules");
const { default: apiRouter } = await import("../index");

type Row = { key: string; obs: Record<string, { status: number; code: string | null; capability: string | null }> };
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const routes = collectRoutes(apiRouter as unknown as Parameters<typeof collectRoutes>[0]).filter((r) => MUTATING.has(r.method));
const rows: Row[] = [];
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer();
  const seen = new Set<string>();
  for (const r of routes) {
    const key = routeKey(r);
    if (seen.has(key)) continue; // the same method + path registered twice: the first handler answers
    seen.add(key);
    const obs: Row["obs"] = {};
    for (const c of CALLERS) obs[c] = await server.call(c, r);
    rows.push({ key, obs });
  }
  if (process.env.ROUTE_MATRIX_DUMP) writeFileSync(process.env.ROUTE_MATRIX_DUMP, JSON.stringify(rows, null, 1));
}, 110_000);

afterAll(async () => {
  await server?.close();
  vi.stubGlobal("fetch", realFetch);
});

describe("route × role matrix (every mutating route)", () => {
  it("finds the API's mutating routes", () => {
    expect(rows.length).toBeGreaterThan(300);
  });

  it("every mutating route has a rule (derived from a capability check or an entry in expectations.ts)", () => {
    const problems = rows.flatMap((row) => checkRoute(row.key, row.obs, EXPECTATIONS[row.key]));
    expect(problems).toEqual([]);
  });

  it("removed routes (Волна 2 п. 2.15) answer a JSON 404 to every member", async () => {
    const gone = [
      { method: "POST", path: "/research" }, { method: "PATCH", path: "/research/:id" }, { method: "DELETE", path: "/research/:id" },
      { method: "POST", path: "/research/:id/pin" }, { method: "POST", path: "/research/:id/link-trade" },
      { method: "GET", path: "/research/:id/candidates" }, { method: "POST", path: "/checklist-template" },
      { method: "POST", path: "/checklist-responses" }, { method: "GET", path: "/checklist-template" },
      { method: "GET", path: "/risk/check" }, { method: "POST", path: "/playbook/auto-link" }, { method: "GET", path: "/playbook/unlinked-suggestions" },
    ];
    for (const r of gone) {
      for (const c of ["trader", "curator", "admin"] as const) {
        const o = await server.call(c, r);
        expect([r.method, r.path, c, o.status]).toEqual([r.method, r.path, c, 404]);
        expect(o.code).not.toBeNull();
      }
    }
  });

  it("expectations.ts names only routes that exist, each with a one-line reason", () => {
    const keys = new Set(rows.map((r) => r.key));
    const stale = Object.keys(EXPECTATIONS).filter((k) => !keys.has(k));
    expect(stale).toEqual([]);
    const badReason = Object.entries(EXPECTATIONS).filter(([, e]) => !e.reason || e.reason.length < 8 || /\n/.test(e.reason)).map(([k]) => k);
    expect(badReason).toEqual([]);
  });
});
