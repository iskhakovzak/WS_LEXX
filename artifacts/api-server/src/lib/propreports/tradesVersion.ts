/**
 * Cross-instance trade-cache invalidation. Every API instance (Vercel functions run many) keeps in-memory caches of
 * trade-derived data (dashboard, /trades/page aggregates, office stats). A sync applied on instance A used to clear only
 * A's caches; B served stale numbers until its TTLs ran out.
 *
 *   invalidateTradeCaches()   clear this instance's caches + bump the DB stamp (cache_versions.name = 'trades')
 *   tradesVersionMiddleware   before a request: at most once per CHECK_TTL_MS per instance, read the stamp; when it moved
 *                             since this instance last saw it, clear the local caches (without bumping again)
 *
 * The check is one indexed single-row SELECT every ≤ 15 s per instance; a DB error never fails the request.
 */
import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { invalidateDashboardCache } from "../hotCache";
import { invalidateTradesPageCache } from "../tradesPageCache";
import { invalidateOfficeStatsCache } from "../../routes/officeStats";

export const CHECK_TTL_MS = 15_000;

type Queryable = { query: (typeof pool)["query"] };

function clearLocal(): void {
  invalidateDashboardCache();
  invalidateTradesPageCache();
  invalidateOfficeStatsCache();
}

let seen: string | null = null;
let checkedAt = 0;
let inflight: Promise<void> | null = null;

/** Bump the DB stamp (returns the new version, or null when the table is missing / the DB failed). */
export async function bumpTradesVersion(db: Queryable = pool): Promise<string | null> {
  const { rows } = await db.query(
    `INSERT INTO cache_versions (name, version, updated_at) VALUES ('trades', 1, NOW())
     ON CONFLICT (name) DO UPDATE SET version = cache_versions.version + 1, updated_at = NOW()
     RETURNING version::text AS v`,
  );
  const v = rows[0]?.v != null ? String(rows[0].v) : null;
  if (v) { seen = v; checkedAt = Date.now(); }
  return v;
}

/** The broker book changed: drop every trade-derived cache here and tell the other instances (DB stamp). */
export function invalidateTradeCaches(): void {
  clearLocal();
  void bumpTradesVersion().catch((e) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "trades_version bump failed"));
}

/** Read the stamp (≤ once per CHECK_TTL_MS) and clear local caches when another instance bumped it. */
export function checkTradesVersion(now = Date.now(), db: Queryable = pool): Promise<void> {
  if (now - checkedAt < CHECK_TTL_MS) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { rows } = await db.query(`SELECT version::text AS v FROM cache_versions WHERE name = 'trades'`);
      const v = rows[0]?.v != null ? String(rows[0].v) : "0";
      if (seen !== null && v !== seen) clearLocal();
      seen = v;
    } catch {
      // table not migrated yet / DB hiccup: keep serving; retry after the TTL
    } finally {
      checkedAt = now;
      inflight = null;
    }
  })();
  return inflight;
}

/** Express middleware (mounted once in routes/index.ts). */
export function tradesVersionMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  if (Date.now() - checkedAt < CHECK_TTL_MS) { next(); return; }
  checkTradesVersion().then(() => next(), () => next());
}

/** Tests only. */
export function __resetTradesVersionForTests(): void {
  seen = null; checkedAt = 0; inflight = null;
}
