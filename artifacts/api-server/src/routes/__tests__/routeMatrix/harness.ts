/**
 * Harness of the route × role matrix test (routeRoleMatrix.test.ts): the whole API router (routes/index.ts) behind
 * the real global gate (lib/auth apiAuthGate) and the real permission matrix (lib/permissions, default grants), on an
 * empty fake database. Only the signed-in identity is injected (header x-who), the way app.ts's authMiddleware would
 * set it from a token. The fake DB answers the users-by-id lookups the matrix and role helpers make; every other
 * query returns no rows, so a handler either stops at its rights check or runs into «not found» / validation.
 *
 * Imported by the test only after its vi.mock() calls (the mocks below are declared there; vitest hoists them).
 */
import express, { type Request } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

export type Caller = "trader" | "curator" | "admin" | "guest" | "anon";
export const CALLERS: readonly Caller[] = ["trader", "curator", "admin", "guest", "anon"];

export type User = { id: number; name: string; role: string };
/** The guest identity matches lib/auth GUEST_USER_ID / GUEST_ROLE (isGuestUser). */
export const USERS: Record<Exclude<Caller, "anon">, User> = {
  trader: { id: 5, name: "Trader T.", role: "trader" },
  curator: { id: 3, name: "Curator C.", role: "curator" },
  admin: { id: 1, name: "Admin A.", role: "admin" },
  guest: { id: 0, name: "guest", role: "guest" },
};

export type RouteDef = { method: string; path: string };
export type Observation = { status: number; code: string | null; capability: string | null };

type Layer = { route?: { path: unknown; methods: Record<string, boolean> }; handle?: { stack?: Layer[] }; slash?: boolean; name?: string };

/** Every method + path registered on a router, sub-routers mounted without a prefix included. */
export function collectRoutes(router: { stack: Layer[] }): RouteDef[] {
  const out: RouteDef[] = [];
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) {
          if (typeof p !== "string") throw new Error(`routeMatrix: non-string route path ${String(p)} — teach collectRoutes`);
          for (const m of Object.keys(layer.route.methods)) if (m !== "_all") out.push({ method: m.toUpperCase(), path: p });
        }
      } else if (layer.handle?.stack) {
        if (!layer.slash) throw new Error(`routeMatrix: a sub-router mounted under a path prefix (${layer.name}) — teach collectRoutes`);
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  return out;
}

const SAMPLE: Record<string, string> = {
  date: "2026-10-16",
  trader: "Trader%20T.",
  name: "Trader%20T.",
  key: "x",
};

/** A concrete URL path for a route pattern: ids → 42 (no caller has it), dates → a trading day, names → the trader. */
export function samplePath(pattern: string): string {
  return pattern
    .replace(/[{}]/g, "")
    .replace(/\*(\w+)/g, "x")
    .replace(/:(\w+)/g, (_m, p: string) => SAMPLE[p] ?? (/id$/i.test(p) ? "42" : "x"));
}

export type Server = { call: (caller: Caller, route: RouteDef) => Promise<Observation>; close: () => Promise<void> };

/** Mount the router like app.ts does (identity → gate → language → JSON → router → error middleware). */
export async function startServer(): Promise<Server> {
  const [{ default: router }, { apiAuthGate }, { requestLang }, { errorMiddleware }] = await Promise.all([
    import("../../index"),
    import("../../../lib/auth"),
    import("../../../i18n"),
    import("../../../lib/http"),
  ]);
  const app = express();
  app.use("/api", (req, _res, next) => {
    const who = req.get("x-who") as Caller | undefined;
    if (who && who !== "anon") req.authUser = USERS[who] as Request["authUser"];
    next();
  });
  app.use("/api", apiAuthGate, requestLang, express.json({ limit: "1mb" }), router);
  app.use(errorMiddleware);
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });

  const call = (caller: Caller, route: RouteDef): Promise<Observation> =>
    new Promise((resolve) => {
      const body = "{}";
      const req = http.request({
        host: "127.0.0.1", port, agent, method: route.method, path: `/api${samplePath(route.path)}`,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-who": caller },
        timeout: 8_000,
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => { text += c; });
        res.on("end", () => {
          let json: { code?: unknown; details?: { capability?: unknown } } | null = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = null; }
          resolve({
            status: res.statusCode ?? 0,
            code: typeof json?.code === "string" ? json.code : null,
            capability: typeof json?.details?.capability === "string" ? json.details.capability : null,
          });
        });
      });
      req.on("timeout", () => { req.destroy(); resolve({ status: 0, code: "TIMEOUT", capability: null }); });
      req.on("error", () => resolve({ status: 0, code: "SOCKET", capability: null }));
      req.end(body);
    });

  return {
    call,
    close: () => new Promise<void>((resolve) => { agent.destroy(); server.close(() => resolve()); }),
  };
}
