/**
 * How the assistant's read tools reach the app's data: through the app's OWN API routes, as the caller.
 *
 * Every data tool is a GET (or the read-only POST /whatif/run) to `http://127.0.0.1:<this server's port>/api/...` with the
 * caller's own Authorization header and language. The request then passes the same global gate, the same
 * capability checks, scope helpers (scopeTrader, readScope, resolveTraderParam…), section locks and $ redaction as
 * the screens use — the assistant can never see more than the person could open in the app, and there is no second
 * copy of any permission rule to drift. The token is only forwarded to this same process over loopback; it is never
 * logged, stored or shown to the model.
 *
 * Only GET and the allowlisted read-only POSTs exist here; writes are impossible by construction (draft tools never
 * call this module — tests check it).
 */
import type { Request } from "express";
import type { Lang } from "../../i18n";

/** POST routes that compute without writing (allowlist). */
export const READ_ONLY_POSTS: ReadonlySet<string> = new Set(["/whatif/run"]);

const TIMEOUT_MS = 25_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type ApiCaller = {
  baseUrl: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  /** Tests inject a fetch; default = global fetch. */
  fetchImpl?: typeof fetch;
};

export type ApiResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; code: string; message: string };

/** Build a caller for the current request: loopback to this server, the caller's own token and language. */
export function apiCallerFor(req: Request, lang: Lang, signal?: AbortSignal): ApiCaller {
  const port = req.socket.localPort;
  const headers: Record<string, string> = { accept: "application/json", "x-lang": lang, "x-assistant": "1" };
  const auth = req.get("authorization");
  if (auth) headers.authorization = auth;
  return { baseUrl: `http://127.0.0.1:${port}`, headers, signal };
}

type Query = Record<string, string | number | boolean | null | undefined>;

function url(base: string, path: string, query?: Query): string {
  const u = new URL(`/api${path}`, base);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

async function call(c: ApiCaller, method: "GET" | "POST", path: string, query?: Query, body?: unknown): Promise<ApiResult> {
  if (!path.startsWith("/") || path.includes("..")) return { ok: false, status: 400, code: "BAD_PATH", message: "bad path" };
  if (method === "POST" && !READ_ONLY_POSTS.has(path)) return { ok: false, status: 405, code: "READ_ONLY", message: "the assistant only reads" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  c.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await (c.fetchImpl ?? fetch)(url(c.baseUrl, path, query), {
      method,
      headers: { ...c.headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, status: res.status, code: "TOO_LARGE", message: "the answer is too large; narrow the request" };
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const d = (data ?? {}) as { code?: unknown; error?: unknown };
      return { ok: false, status: res.status, code: typeof d.code === "string" ? d.code : `HTTP_${res.status}`, message: typeof d.error === "string" ? d.error : "" };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const aborted = ctl.signal.aborted;
    return { ok: false, status: 0, code: aborted ? "TIMEOUT" : "UNREACHABLE", message: aborted ? "the data request took too long" : (err as Error)?.message ?? "" };
  } finally {
    clearTimeout(timer);
    c.signal?.removeEventListener("abort", onAbort);
  }
}

export const apiGet = (c: ApiCaller, path: string, query?: Query) => call(c, "GET", path, query);
export const apiPostReadOnly = (c: ApiCaller, path: string, body: unknown) => call(c, "POST", path, undefined, body);
