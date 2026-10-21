/**
 * PropReports re-import replacement (phase 3, ACCURACY).
 *
 * PropReports keeps a re-imported record's data but gives it a NEW `propReportsId` (API v2 docs, fills/adjustments).
 * Anything keyed by that id would see the old record vanish and a "new" one appear — a duplicate fill / adjustment.
 *
 * Rule (multiset-safe): a record is identified by its data fingerprint (everything except propReportsId / fillId).
 * Within one fingerprint group, ids present on both sides are the same record; every NEW id is paired one-to-one with
 * a VANISHED id (known before, absent from the authoritative fetch now) → the new id replaces the old one. What is left
 * over is a genuinely new record (fresh) or a genuinely removed one (vanished). Two distinct fills with identical data
 * (partial fills of one order in the same millisecond) keep two ids on both sides, so they are never merged.
 *
 *   fillFingerprint(fill)                  stable data key of a fill
 *   pairReplacements(vanished, fresh, key) pure pairing used for fills and adjustments (adjustments.ts)
 *   canonicalizeFillIds(fills)             DB: table propreports_fill_identity (migration 0222) maps every id ever seen
 *                                          to the id the fill was first seen with; returns the fills with
 *                                          propReportsId rewritten to that canonical id, so a re-imported fill lands on
 *                                          the same row / execution as before (no duplicate trades).
 *
 * CORE calls it once in the fills path, right after the fetch and before storing fills / building round trips:
 *   fills = (await canonicalizeFillIds(fills)).fills;
 * Never throws for data reasons; a DB failure (table missing on an old database) returns the fills unchanged.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import type { Fill } from "./types";

type Queryable = { query: (typeof pool)["query"] };

/** Numbers as data, not text: "12.50" ≡ "12.5" ≡ 12.5. */
function numKey(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return String(Math.round(Number(n) * 1e6) / 1e6);
}

/** Data identity of a fill: account, time (to the ms as exported), side, qty, symbol, price, order id, trade date. */
export function fillFingerprint(f: Pick<Fill, "account" | "dateTime" | "side" | "qty" | "symbol" | "price" | "orderId" | "tradeDate">): string {
  return [
    f.account.trim(),
    f.dateTime.trim().replace("T", " "),
    f.side,
    numKey(f.qty),
    f.symbol.trim().toUpperCase(),
    numKey(f.price),
    (f.orderId ?? "").trim(),
    (f.tradeDate ?? "").trim(),
  ].join("|");
}

export interface PairResult<K, I> {
  /** [vanished, fresh] pairs: the fresh record is the vanished one re-imported under a new id. */
  pairs: Array<[K, I]>;
  /** Fresh records with no vanished twin — genuinely new. */
  fresh: I[];
  /** Vanished records with no fresh twin — genuinely removed upstream. */
  vanished: K[];
}

/**
 * Pair vanished and fresh records with equal keys, one-to-one, in input order (pass both sides in a stable order —
 * time, then id — so re-runs pair the same way).
 */
export function pairReplacements<K, I>(vanished: K[], fresh: I[], keyOfVanished: (k: K) => string, keyOfFresh: (i: I) => string): PairResult<K, I> {
  const pool_ = new Map<string, K[]>();
  for (const k of vanished) {
    const key = keyOfVanished(k);
    const arr = pool_.get(key);
    if (arr) arr.push(k); else pool_.set(key, [k]);
  }
  const pairs: Array<[K, I]> = [];
  const leftFresh: I[] = [];
  for (const i of fresh) {
    const arr = pool_.get(keyOfFresh(i));
    const k = arr?.shift();
    if (k !== undefined) pairs.push([k, i]); else leftFresh.push(i);
  }
  const leftVanished = [...pool_.values()].flat();
  return { pairs, fresh: leftFresh, vanished: leftVanished };
}

/** A row of propreports_fill_identity as the planner needs it. */
export interface KnownFillId {
  propReportsId: string;
  canonicalId: string;
  fingerprint: string;
}

export interface FillIdPlan {
  /** id as fetched → canonical id (only entries that differ from the fetched id). */
  rewrite: Map<string, string>;
  /** New ids never seen before (canonical = own id). */
  inserts: Array<{ propReportsId: string; fingerprint: string; account: string; tradeDate: string }>;
  /** New id that replaces a vanished one: insert it with the old canonical id, mark the old id replaced. */
  replacements: Array<{ oldId: string; newId: string; canonicalId: string; fingerprint: string; account: string; tradeDate: string }>;
  /** Ids already known (touch last_seen_at). */
  seen: string[];
}

/**
 * Pure planner. `known` = identity rows for the incoming ids PLUS the active (not replaced) rows that share a
 * fingerprint with an unknown incoming id. Fills without a propReportsId are left alone.
 */
export function planFillIds(fills: Fill[], known: KnownFillId[]): FillIdPlan {
  const byId = new Map(known.map((k) => [k.propReportsId, k]));
  const incomingIds = new Set(fills.map((f) => f.propReportsId).filter((x): x is string => !!x));
  const rewrite = new Map<string, string>();
  const seen: string[] = [];
  const unknown: Fill[] = [];
  const dupInBatch = new Set<string>();
  for (const f of fills) {
    const id = f.propReportsId;
    if (!id) continue;
    if (dupInBatch.has(id)) continue; // the same id twice in one batch (overlapping pages) is one record
    dupInBatch.add(id);
    const k = byId.get(id);
    if (k) {
      seen.push(id);
      if (k.canonicalId !== id) rewrite.set(id, k.canonicalId);
    } else unknown.push(f);
  }
  // vanished = known ids with a fingerprint some unknown fill has, absent from this fetch, not replaced yet
  const unknownFps = new Set(unknown.map(fillFingerprint));
  const vanished = known
    .filter((k) => unknownFps.has(k.fingerprint) && !incomingIds.has(k.propReportsId))
    .sort((a, b) => a.propReportsId.localeCompare(b.propReportsId, "en", { numeric: true }));
  const fresh = [...unknown].sort((a, b) => a.dateTime.localeCompare(b.dateTime) || String(a.propReportsId).localeCompare(String(b.propReportsId), "en", { numeric: true }));
  const paired = pairReplacements<KnownFillId, Fill>(vanished, fresh, (k) => k.fingerprint, (f) => fillFingerprint(f));
  const replacements: FillIdPlan["replacements"] = [];
  for (const [old, f] of paired.pairs) {
    rewrite.set(f.propReportsId!, old.canonicalId);
    replacements.push({ oldId: old.propReportsId, newId: f.propReportsId!, canonicalId: old.canonicalId, fingerprint: old.fingerprint, account: f.account, tradeDate: f.tradeDate });
  }
  const inserts = paired.fresh.map((f) => ({ propReportsId: f.propReportsId!, fingerprint: fillFingerprint(f), account: f.account, tradeDate: f.tradeDate }));
  return { rewrite, inserts, replacements, seen };
}

/** Drop exact repeats of one propReportsId inside a batch (overlapping pages / merged fetches). */
export function dedupeFillBatch(fills: Fill[]): Fill[] {
  const ids = new Set<string>();
  return fills.filter((f) => {
    if (!f.propReportsId) return true;
    if (ids.has(f.propReportsId)) return false;
    ids.add(f.propReportsId);
    return true;
  });
}

export interface CanonicalizeResult {
  fills: Fill[];
  replaced: number;
  fresh: number;
  /** false when the identity table could not be used (fills returned de-duplicated but otherwise unchanged). */
  applied: boolean;
}

/**
 * Rewrite each fill's propReportsId to its canonical (first-seen) id and remember new ids. Idempotent: running it
 * twice over the same fetch changes nothing the second time.
 */
export async function canonicalizeFillIds(fillsIn: Fill[], db: Queryable = pool): Promise<CanonicalizeResult> {
  const fills = dedupeFillBatch(fillsIn);
  const withId = fills.filter((f) => !!f.propReportsId);
  if (!withId.length) return { fills, replaced: 0, fresh: 0, applied: true };
  try {
    const ids = [...new Set(withId.map((f) => f.propReportsId!))];
    const knownRes = await db.query(
      `SELECT propreports_id, canonical_id, fingerprint FROM propreports_fill_identity WHERE propreports_id = ANY($1::text[])`,
      [ids],
    );
    const known: KnownFillId[] = knownRes.rows.map((r: any) => ({ propReportsId: String(r.propreports_id), canonicalId: String(r.canonical_id), fingerprint: String(r.fingerprint) }));
    const knownIds = new Set(known.map((k) => k.propReportsId));
    const unknownFps = [...new Set(withId.filter((f) => !knownIds.has(f.propReportsId!)).map(fillFingerprint))];
    if (unknownFps.length) {
      const cand = await db.query(
        `SELECT propreports_id, canonical_id, fingerprint FROM propreports_fill_identity
          WHERE fingerprint = ANY($1::text[]) AND replaced_by IS NULL AND NOT (propreports_id = ANY($2::text[]))`,
        [unknownFps, ids],
      );
      for (const r of cand.rows as any[]) known.push({ propReportsId: String(r.propreports_id), canonicalId: String(r.canonical_id), fingerprint: String(r.fingerprint) });
    }
    const plan = planFillIds(withId, known);
    if (plan.seen.length) {
      await db.query(`UPDATE propreports_fill_identity SET last_seen_at = NOW() WHERE propreports_id = ANY($1::text[])`, [plan.seen]);
    }
    for (const r of plan.replacements) {
      await db.query(
        `INSERT INTO propreports_fill_identity (propreports_id, canonical_id, fingerprint, account, trade_date)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (propreports_id) DO NOTHING`,
        [r.newId, r.canonicalId, r.fingerprint, r.account, r.tradeDate],
      );
      await db.query(`UPDATE propreports_fill_identity SET replaced_by = $2, replaced_at = NOW() WHERE propreports_id = $1 AND replaced_by IS NULL`, [r.oldId, r.newId]);
    }
    if (plan.inserts.length) {
      await db.query(
        `INSERT INTO propreports_fill_identity (propreports_id, canonical_id, fingerprint, account, trade_date)
         SELECT x.id, x.id, x.fp, x.acc, x.td FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[]) AS x(id, fp, acc, td)
         ON CONFLICT (propreports_id) DO NOTHING`,
        [plan.inserts.map((i) => i.propReportsId), plan.inserts.map((i) => i.fingerprint), plan.inserts.map((i) => i.account), plan.inserts.map((i) => i.tradeDate)],
      );
    }
    if (plan.replacements.length) logger.info({ replaced: plan.replacements.length }, "propreports: re-imported fills mapped to their original ids");
    const out = fills.map((f) => (f.propReportsId && plan.rewrite.has(f.propReportsId) ? { ...f, propReportsId: plan.rewrite.get(f.propReportsId)! } : f));
    return { fills: out, replaced: plan.replacements.length, fresh: plan.inserts.length, applied: true };
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "propreports: fill identity unavailable, ids left as fetched");
    return { fills, replaced: 0, fresh: 0, applied: false };
  }
}
