/**
 * Auto setup classifier — storage and computation (split out of routes/setups-auto.ts; wave 1, 1.2 adds the after-sync
 * run and the playbook mapping).
 *
 *   ensureSuggestionsTable()   trade_setup_suggestions (idempotent)
 *   computeBatch(items, n)     classify ≤ n trades (candles via lib/candles/market cache, 2 workers, 12 s budget)
 *   loadSuggestions(ids)       the latest suggestion per trade
 *   runAutoClassify(opts)      the job hook (jobs/definitions.ts «candles.archive», after each PropReports sync): closed
 *                              broker trades of the last AUTO_DAYS days WITHOUT playbook_id and without a current
 *                              suggestion get one — nothing is written to trades (accepting stays a tap)
 *   suggestionLink(row, list)  the office setup a stored suggestion maps to (lib/tradesSetupLink CLASS_TO_OFFICE)
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { addDays, nyDate } from "./tradingDate";
import {
  parseDateStrict, pickIntervalForAge, ageDaysOf, fetchSingleDayWithCache, fetchDailyRange, getPrevDailyCloseCached,
  type Candle, type Interval,
} from "./candles/market";
import { classifySetup, inputsHash, type ClassifierTrade, type MarketInputs, type SetupSuggestion } from "./setupClassifier";
import type { BehaviorTrade } from "./behaviorEngine";
import { officeSetupForClass, type OfficeSetup } from "./tradesSetupLink";

let ensured: Promise<void> | null = null;
export function ensureSuggestionsTable(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS trade_setup_suggestions (
           id SERIAL PRIMARY KEY,
           trade_id INTEGER NOT NULL,
           inputs_hash TEXT NOT NULL,
           setup TEXT NOT NULL,
           confidence NUMERIC(4,2) NOT NULL DEFAULT 0,
           explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
           features JSONB NOT NULL DEFAULT '{}'::jsonb,
           candles_available BOOLEAN NOT NULL DEFAULT FALSE,
           interval TEXT,
           version TEXT NOT NULL DEFAULT '',
           status TEXT NOT NULL DEFAULT 'suggested',
           decided_by TEXT,
           decided_at TIMESTAMPTZ,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           UNIQUE (trade_id, inputs_hash)
         );
         CREATE INDEX IF NOT EXISTS trade_setup_suggestions_trade_idx ON trade_setup_suggestions (trade_id);`,
      )
      .then(() => undefined)
      .catch((err) => { ensured = null; throw err; });
  }
  return ensured;
}

export type SuggestionRow = {
  id: number;
  trade_id: number;
  inputs_hash: string;
  setup: string;
  confidence: unknown;
  explanation: { reasons?: string[]; alternatives?: { setup: string; score: number }[]; tags?: string[]; note?: string | null } | null;
  features: Record<string, unknown> | null;
  candles_available: boolean;
  interval: string | null;
  version: string;
  status: string;
  decided_by: string | null;
  decided_at: Date | null;
  updated_at: Date | null;
};

export function toClassifierTrade(t: BehaviorTrade, exit: number | null): ClassifierTrade {
  return {
    id: t.id, ticker: t.ticker, date: t.date, side: t.side, entry: t.entry, exit, qty: t.qty,
    entryMin: t.entryMin, holdMin: t.holdMin, horizon: t.horizon, entryAt: t.entryAt, exitAt: t.exitAt,
  };
}

/* ─── market data: per-run cache + a queue with a pause between provider calls ─── */

type MarketCacheEntry = { inputs: MarketInputs; interval: Interval | null };

/** Trades being classified right now (parallel requests / the job never compute the same trade twice). */
export const inFlight = new Set<number>();
const CONCURRENCY = 2;
const DELAY_MS = 120;
const TIME_BUDGET_MS = 12_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function loadMarket(ticker: string, date: string, cache: Map<string, Promise<MarketCacheEntry>>): Promise<MarketCacheEntry> {
  const key = `${ticker}:${date}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<MarketCacheEntry> => {
    const parsed = parseDateStrict(date);
    if (!parsed) return { inputs: { candles: null, interval: null, prevClose: null, daily: null }, interval: null };
    const interval = pickIntervalForAge(ageDaysOf(parsed));
    let candles: Candle[] | null = null;
    let daily: Candle[] | null = null;
    let prevClose: number | null = null;
    if (interval !== "1d") {
      try {
        const r = await fetchSingleDayWithCache(ticker, parsed, date, interval, true, false, logger);
        candles = r?.candles ?? null;
        if (r && !r.cached) await sleep(DELAY_MS);
      } catch (err) {
        logger.warn({ err, ticker, date }, "setups-auto: intraday candles failed");
      }
    }
    try {
      daily = await fetchDailyRange(ticker, addDays(date, -35), date);
    } catch (err) {
      logger.warn({ err, ticker, date }, "setups-auto: daily range failed");
    }
    try {
      prevClose = await getPrevDailyCloseCached(ticker, parsed, date);
    } catch {
      prevClose = null;
    }
    return { inputs: { candles, interval: candles ? interval : null, prevClose, daily }, interval: candles ? interval : null };
  })();
  cache.set(key, p);
  return p;
}

async function upsertSuggestion(tradeId: number, hash: string, s: SetupSuggestion): Promise<void> {
  await pool.query(
    `INSERT INTO trade_setup_suggestions (trade_id, inputs_hash, setup, confidence, explanation, features, candles_available, interval, version)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
     ON CONFLICT (trade_id, inputs_hash) DO UPDATE SET
       setup = EXCLUDED.setup, confidence = EXCLUDED.confidence, explanation = EXCLUDED.explanation,
       features = EXCLUDED.features, candles_available = EXCLUDED.candles_available, interval = EXCLUDED.interval,
       version = EXCLUDED.version, updated_at = NOW()`,
    [
      tradeId, hash, s.setup, s.confidence,
      JSON.stringify({ reasons: s.reasons, alternatives: s.alternatives, tags: s.tags, note: s.note }),
      JSON.stringify(s.features), s.candlesAvailable, s.features.interval, s.version,
    ],
  );
}

export type ComputeItem = { trade: BehaviorTrade; exit: number | null; hash: string };

/** Classify ≤ `budget` trades (parallelism and time limits; an aborted `signal` stops taking new ones). */
export async function computeBatch(items: ComputeItem[], budget: number, signal?: AbortSignal): Promise<number> {
  const queue = items.filter((i) => !inFlight.has(i.trade.id)).slice(0, budget);
  if (!queue.length) return 0;
  const cache = new Map<string, Promise<MarketCacheEntry>>();
  const deadline = Date.now() + TIME_BUDGET_MS;
  let done = 0;
  for (const i of queue) inFlight.add(i.trade.id);
  try {
    const worker = async () => {
      while (queue.length && Date.now() < deadline && !signal?.aborted) {
        const item = queue.shift()!;
        try {
          const market = await loadMarket(item.trade.ticker, item.trade.date, cache);
          const suggestion = classifySetup(toClassifierTrade(item.trade, item.exit), market.inputs);
          await upsertSuggestion(item.trade.id, item.hash, suggestion);
          done++;
        } catch (err) {
          logger.warn({ err, tradeId: item.trade.id }, "setups-auto: classify failed");
        } finally {
          inFlight.delete(item.trade.id);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    for (const i of queue) inFlight.delete(i.trade.id);
  }
  return done;
}

export async function loadSuggestions(ids: number[]): Promise<Map<number, SuggestionRow>> {
  const out = new Map<number, SuggestionRow>();
  if (!ids.length) return out;
  const { rows } = await pool.query<SuggestionRow>(
    `SELECT DISTINCT ON (trade_id) * FROM trade_setup_suggestions WHERE trade_id = ANY($1::int[])
     ORDER BY trade_id, updated_at DESC, id DESC`,
    [ids],
  );
  for (const r of rows) out.set(Number(r.trade_id), r);
  return out;
}

/** The office setup a stored suggestion maps to (null: a time-only class or the setup is not in the office). */
export function suggestionLink(s: Pick<SuggestionRow, "setup"> | null | undefined, setups: readonly OfficeSetup[]): OfficeSetup | null {
  return s ? officeSetupForClass(s.setup, setups) : null;
}

/* ─── after-sync run (jobs/definitions.ts «candles.archive») ─── */

/** Days back the after-sync run looks at (the evening review covers the last few sessions). */
export const AUTO_DAYS = 10;
/** Trades classified per run (each may cost a candle fetch; the archive job has just cached the bars). */
export const AUTO_BUDGET = 60;

/**
 * Suggestions for closed broker trades without a playbook link: the newest first, ≤ `budget` per run, skipping trades
 * with a current suggestion (same inputs hash) or a rejected one. Writes only trade_setup_suggestions.
 */
export async function runAutoClassify(opts: { signal?: AbortSignal; budget?: number; now?: Date } = {}): Promise<{ candidates: number; computed: number }> {
  await ensureSuggestionsTable();
  const from = addDays(nyDate(opts.now ?? new Date()), -AUTO_DAYS);
  const { rows: idRows } = await pool.query<{ id: number }>(
    `SELECT t.id FROM trades t
      WHERE t.deleted_at IS NULL AND t.playbook_id IS NULL AND t.source = 'propreports'
        AND substring(t.date, 1, 10) >= $1 AND t.exit IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM trade_setup_suggestions s WHERE s.trade_id = t.id AND s.status = 'rejected')
      ORDER BY t.date DESC, t.id DESC LIMIT 500`,
    [from],
  );
  const ids = idRows.map((r) => Number(r.id));
  if (!ids.length) return { candidates: 0, computed: 0 };
  const { loadBehaviorRows, rowToBehaviorTrade } = await import("../routes/behavior");
  const rows = await loadBehaviorRows(null, undefined, undefined, ids);
  const existing = await loadSuggestions(ids);
  const missing: ComputeItem[] = [];
  for (const r of rows) {
    const trade = rowToBehaviorTrade(r);
    if (trade.result === "open") continue;
    const exit = r.exit == null ? null : Number(r.exit);
    const hash = inputsHash(toClassifierTrade(trade, exit));
    if (existing.get(trade.id)?.inputs_hash === hash) continue;
    missing.push({ trade, exit, hash });
  }
  missing.sort((a, b) => b.trade.date.localeCompare(a.trade.date) || b.trade.id - a.trade.id);
  const computed = missing.length ? await computeBatch(missing, opts.budget ?? AUTO_BUDGET, opts.signal) : 0;
  return { candidates: missing.length, computed };
}
