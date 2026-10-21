/**
 * Finviz Elite export client. One function: `fetchExport(params)` → parsed rows. Gentle by construction:
 *   • every request in this process waits for the previous one + MIN_GAP_MS (3 s) — a single queue, so concurrent
 *     jobs / a staff refresh never burst;
 *   • one call covers many tickers (≤ 100 per `t=` list — the caller batches);
 *   • 20 s timeout, no automatic retry (the next scheduled run is the retry); a 429 pauses the queue for 60 s;
 *   • the queue is capped for interactive callers (member screener themes / boards, quotes): with MAX_QUEUED requests
 *     already waiting a new one is refused at once with FinvizQueueFullError (→ 503 FINVIZ_BUSY), so the scheduled
 *     jobs (lib/finviz/jobs, `{ scheduled: true }`) always get in and are never starved behind user traffic.
 * The token (config.finvizAuth ← env FINVIZ_AUTH) is added here only and never logged, thrown or returned: error
 * messages carry the HTTP status, not the URL.
 */
import { config } from "../../config";
import { parseFinvizCsv, type FinvizRow } from "./csv";

const FINVIZ_BASE = "https://elite.finviz.com/export/screener";
export const MIN_GAP_MS = 3_000;
export const RATE_LIMIT_PAUSE_MS = 60_000;
const TIMEOUT_MS = 20_000;
export const MAX_TICKERS_PER_CALL = 100;
/** Requests (waiting + running) beyond which an interactive caller is refused; scheduled jobs are always queued. */
export const MAX_QUEUED = 6;

/**
 * Custom view (v=152) columns: Ticker, Company, Sector, Industry, Country, Market Cap, Shares Outstanding, Float,
 * Short Float, Short Ratio, Beta, ATR, Gap, Average Volume, Relative Volume, Price, Change, Volume, Earnings Date.
 * The parser maps by header name, so a renumbered id only drops a column — it never shifts values.
 */
export const COLUMNS = [1, 2, 3, 4, 5, 6, 24, 25, 30, 31, 48, 49, 61, 63, 64, 65, 66, 67, 68];

export type ExportParams = {
  /** Screener filters, e.g. ["geo_usa", "ta_gap_u4"]. */
  filters?: readonly string[];
  /** Sort, e.g. "-gap". */
  order?: string;
  /** Ticker list (≤ MAX_TICKERS_PER_CALL). */
  tickers?: readonly string[];
};

/** `scheduled`: a job of lib/finviz/jobs — never refused by the queue cap. */
export type ExportOptions = { scheduled?: boolean };

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

let deps: { fetch: FetchLike; sleep: (ms: number) => Promise<void>; now: () => number; gapMs: number; token: () => string | null } = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  gapMs: MIN_GAP_MS,
  token: () => config.finvizAuth,
};

/** Tests: inject fetch / clock / gap / token. Returns a restore function. */
export function setFinvizClientDeps(d: Partial<typeof deps>): () => void {
  const prev = deps;
  deps = { ...deps, ...d };
  queue = Promise.resolve();
  nextAt = 0;
  pending = 0;
  return () => {
    deps = prev;
    queue = Promise.resolve();
    nextAt = 0;
    pending = 0;
  };
}

export class FinvizError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "FinvizError";
  }
}

/** The queue already holds MAX_QUEUED requests: an interactive caller is refused (the error middleware: 503 FINVIZ_BUSY). */
export class FinvizQueueFullError extends FinvizError {
  readonly code = "FINVIZ_BUSY" as const;
  constructor() {
    super("finviz: queue full", 503);
    this.name = "FinvizQueueFullError";
  }
}

export function hasFinvizToken(): boolean {
  return !!deps.token();
}

const FILTER_RE = /^[a-z0-9_.\-]{2,60}$/;
const ORDER_RE = /^-?[a-z0-9_]{1,40}$/;
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** The export URL without the token (tests / debugging); `withToken` adds it (only inside fetchExport). */
export function buildExportUrl(p: ExportParams, token?: string): string {
  const q = new URLSearchParams();
  q.set("v", "152");
  const f = (p.filters ?? []).filter((x) => FILTER_RE.test(x));
  if (f.length) q.set("f", f.join(","));
  if (p.order && ORDER_RE.test(p.order)) q.set("o", p.order);
  const t = (p.tickers ?? []).map((x) => x.toUpperCase()).filter((x) => TICKER_RE.test(x));
  if (t.length > MAX_TICKERS_PER_CALL) throw new FinvizError(`finviz: ${t.length} tickers in one call (max ${MAX_TICKERS_PER_CALL})`);
  if (t.length) q.set("t", t.join(","));
  q.set("c", COLUMNS.join(","));
  if (token) q.set("auth", token);
  return `${FINVIZ_BASE}?${q.toString().replace(/%2C/g, ",")}`;
}

let queue: Promise<unknown> = Promise.resolve();
let nextAt = 0;
/** Requests waiting or running in the queue. */
let pending = 0;

/** Requests waiting or running right now (tests / status). */
export function finvizQueueLength(): number {
  return pending;
}

/**
 * Serialises calls with ≥ gapMs between request starts (and a pause after a 429). An interactive call (not
 * `scheduled`) is refused with FinvizQueueFullError when MAX_QUEUED requests are already in the queue.
 */
function throttled<T>(fn: () => Promise<T>, opts: ExportOptions = {}): Promise<T> {
  if (!opts.scheduled && pending >= MAX_QUEUED) return Promise.reject(new FinvizQueueFullError());
  pending++;
  const run = async () => {
    const wait = nextAt - deps.now();
    if (wait > 0) await deps.sleep(wait);
    try {
      return await fn();
    } finally {
      nextAt = Math.max(nextAt, deps.now() + deps.gapMs);
    }
  };
  const p = queue.then(run, run).finally(() => { pending = Math.max(0, pending - 1); });
  queue = p.catch(() => undefined);
  return p;
}

/** One export request → rows. Throws FinvizError (no token, HTTP error, HTML instead of CSV, timeout). */
export function fetchExport(p: ExportParams, today: string, signal?: AbortSignal, opts: ExportOptions = {}): Promise<FinvizRow[]> {
  const token = deps.token();
  if (!token) return Promise.reject(new FinvizError("finviz: FINVIZ_AUTH is not set"));
  const url = buildExportUrl(p, token);
  return throttled(async () => {
    if (signal?.aborted) throw new FinvizError("finviz: aborted");
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let resp: Awaited<ReturnType<FetchLike>>;
    try {
      resp = await deps.fetch(url, { signal: sig, headers: { Accept: "text/csv" } });
    } catch (err) {
      // never pass the original error on: some runtimes put the URL (with the token) into the message
      throw new FinvizError(`finviz: request failed (${err instanceof Error ? err.name : "error"})`);
    }
    if (resp.status === 429) {
      nextAt = deps.now() + RATE_LIMIT_PAUSE_MS;
      throw new FinvizError("finviz: HTTP 429 (rate limited)", 429);
    }
    if (!resp.ok) throw new FinvizError(`finviz: HTTP ${resp.status}`, resp.status);
    const text = await resp.text();
    try {
      return parseFinvizCsv(text, today);
    } catch (err) {
      throw new FinvizError(err instanceof Error ? err.message : "finviz: bad CSV");
    }
  }, opts);
}

/** Many tickers → batched calls (≤ 100 each), sequential through the throttle. Failed batches are reported, not thrown. */
export async function fetchTickers(
  tickers: readonly string[],
  today: string,
  signal?: AbortSignal,
  opts: ExportOptions = {},
): Promise<{ rows: FinvizRow[]; batches: number; failed: number; errors: string[] }> {
  const uniq = [...new Set(tickers.map((t) => t.toUpperCase()).filter((t) => TICKER_RE.test(t)))];
  const rows: FinvizRow[] = [];
  const errors: string[] = [];
  let batches = 0;
  let failed = 0;
  for (let i = 0; i < uniq.length; i += MAX_TICKERS_PER_CALL) {
    if (signal?.aborted) break;
    batches++;
    try {
      rows.push(...(await fetchExport({ tickers: uniq.slice(i, i + MAX_TICKERS_PER_CALL) }, today, signal, opts)));
    } catch (err) {
      failed++;
      errors.push(err instanceof Error ? err.message : String(err));
      if (err instanceof FinvizError && (err.status === 429 || err instanceof FinvizQueueFullError)) break;
    }
  }
  return { rows, batches, failed, errors };
}
