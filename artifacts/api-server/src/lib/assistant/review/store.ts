/**
 * AI reviews storage (table ai_reviews, migrations 0261 / 0262). The cache key of a generation is (kind, subject, version,
 * input hash, language): the same inputs under the same REVIEW_VERSION are served from here — opening a review again
 * never calls the model. The latest row of the current version is what the trade sheet / day report shows.
 * Kinds: trade, day, and the period reviews week / month (written by the nightly batch, lib/assistant/batch; `day` =
 * the period's first day). `source` = live (a person pressed «Review») or batch.
 */
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../../logger";
import type { Lang } from "../../../i18n";
import { REVIEW_VERSION, ReviewSchema, type Review } from "./schema";
import type { DayFacts } from "./gather";
import { DAY_REVIEW_SYSTEM, MONTH_REVIEW_SYSTEM, TRADE_REVIEW_SYSTEM, WEEK_REVIEW_SYSTEM } from "./prompt";

export type ReviewKind = "trade" | "day" | "week" | "month";
export type PeriodKind = "week" | "month";
export type Subject =
  | { kind: "trade"; tradeId: number; trader: string }
  | { kind: "day"; day: string; trader: string }
  | { kind: PeriodKind; day: string; trader: string };
export type ReviewSource = "live" | "batch";

export type StoredReview = {
  id: number; kind: ReviewKind; trader: string; tradeId: number | null; day: string | null; lang: Lang;
  review: Review; facts: DayFacts | null; deep: boolean; units: number; createdAt: string;
};

/** Fingerprint of the frozen prompts + schema: any edit to them is a new cache key without a manual version bump. */
const PROMPT_FINGERPRINT = crypto.createHash("sha256").update(TRADE_REVIEW_SYSTEM).update(DAY_REVIEW_SYSTEM).digest("hex").slice(0, 16);
/** The period prompts have their own fingerprint (adding them did not move the trade / day cache keys). */
const PERIOD_FINGERPRINT = crypto.createHash("sha256").update(WEEK_REVIEW_SYSTEM).update(MONTH_REVIEW_SYSTEM).digest("hex").slice(0, 16);

/**
 * The cache key of a set of inputs (stable JSON: key order as built by gather.ts): version + prompt fingerprint +
 * kind + language + data. Reading the latest review (latestReview) ignores it; generating reuses only an exact hit.
 */
export function inputHash(kind: ReviewKind, lang: Lang, data: unknown): string {
  const p = kind === "week" || kind === "month" ? PERIOD_FINGERPRINT : PROMPT_FINGERPRINT;
  return crypto.createHash("sha256").update(JSON.stringify({ v: REVIEW_VERSION, p, kind, lang, data })).digest("hex");
}

type Row = { id: string; kind: ReviewKind; trader: string; trade_id: number | null; day: string | null; lang: Lang; review: unknown; facts: unknown; deep: boolean; units: string; created_at: Date };

function fromRow(r: Row): StoredReview | null {
  const parsed = ReviewSchema.safeParse(r.review);
  if (!parsed.success) return null; // a row written by an older shape never reaches the web
  return {
    id: Number(r.id), kind: r.kind, trader: r.trader, tradeId: r.trade_id, day: r.day, lang: r.lang, review: parsed.data,
    facts: (r.facts as DayFacts | null) ?? null, deep: r.deep, units: Number(r.units) || 0, createdAt: new Date(r.created_at).toISOString(),
  };
}

const SELECT = `SELECT id, kind, trader, trade_id, day, lang, review, facts, deep, units, created_at FROM ai_reviews`;

function subjectWhere(s: Subject, params: unknown[]): string {
  if (s.kind === "trade") { params.push(s.tradeId); return `kind = 'trade' AND trade_id = $${params.length}`; }
  params.push(s.kind, s.trader, s.day);
  return `kind = $${params.length - 2} AND trader = $${params.length - 1} AND day = $${params.length}`;
}

/** The latest review of a subject under the current version; the requester's language first. */
export async function latestReview(s: Subject, lang: Lang): Promise<StoredReview | null> {
  const params: unknown[] = [];
  const where = subjectWhere(s, params);
  params.push(REVIEW_VERSION, lang);
  const { rows } = await pool.query<Row>(
    `${SELECT} WHERE ${where} AND version = $${params.length - 1} ORDER BY (lang = $${params.length}) DESC, created_at DESC LIMIT 1`, params,
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** A review generated from exactly these inputs (cache hit), or null. */
export async function cachedReview(s: Subject, hash: string, lang: Lang): Promise<StoredReview | null> {
  const params: unknown[] = [];
  const where = subjectWhere(s, params);
  params.push(REVIEW_VERSION, hash, lang);
  const { rows } = await pool.query<Row>(
    `${SELECT} WHERE ${where} AND version = $${params.length - 2} AND input_hash = $${params.length - 1} AND lang = $${params.length} ORDER BY created_at DESC LIMIT 1`, params,
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** The stored day reviews of a trader between two days (latest per day, current version): input of the period reviews. */
export async function dayReviewsBetween(trader: string, from: string, to: string, lang: Lang): Promise<{ day: string; grade: string; headline: string; tomorrow: Review["tomorrow"] }[]> {
  const { rows } = await pool.query<Row>(
    `SELECT DISTINCT ON (day) id, kind, trader, trade_id, day, lang, review, facts, deep, units, created_at FROM ai_reviews
      WHERE kind = 'day' AND trader = $1 AND day BETWEEN $2 AND $3 AND version = $4
      ORDER BY day, (lang = $5) DESC, created_at DESC`,
    [trader, from, to, REVIEW_VERSION, lang],
  );
  return rows.map(fromRow).filter((r): r is StoredReview => !!r)
    .map((r) => ({ day: r.day ?? "", grade: r.review.verdict.grade, headline: r.review.verdict.headline, tomorrow: r.review.tomorrow }));
}

/** Traders (of `traders`) that already have a review of this kind and period under the current version. */
export async function reviewedTraders(kind: Exclude<ReviewKind, "trade">, day: string, traders: readonly string[]): Promise<Set<string>> {
  if (!traders.length) return new Set();
  const { rows } = await pool.query<{ trader: string }>(
    `SELECT DISTINCT trader FROM ai_reviews WHERE kind = $1 AND day = $2 AND version = $3 AND trader = ANY($4::text[])`,
    [kind, day, REVIEW_VERSION, traders],
  );
  return new Set(rows.map((r) => r.trader));
}

export async function saveReview(a: {
  subject: Subject; hash: string; lang: Lang; review: Review; facts: DayFacts | null; deep: boolean; units: number; costUsd: number; by: string; source?: ReviewSource;
}): Promise<StoredReview> {
  const s = a.subject;
  const { rows } = await pool.query<Row>(
    `INSERT INTO ai_reviews (kind, trader, trade_id, day, version, input_hash, lang, review, facts, deep, units, cost_usd, created_by, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14)
     RETURNING id, kind, trader, trade_id, day, lang, review, facts, deep, units, created_at`,
    [s.kind, s.trader, s.kind === "trade" ? s.tradeId : null, s.kind === "trade" ? null : s.day, REVIEW_VERSION, a.hash, a.lang,
      JSON.stringify(a.review), a.facts ? JSON.stringify(a.facts) : null, a.deep, Math.round(a.units), a.costUsd, a.by, a.source ?? "live"],
  ).catch((err) => { logger.warn({ err }, "ai review: could not store"); return { rows: [] as Row[] }; });
  const saved = rows[0] ? fromRow(rows[0]) : null;
  return saved ?? {
    id: 0, kind: s.kind, trader: s.trader, tradeId: s.kind === "trade" ? s.tradeId : null, day: s.kind === "trade" ? null : s.day, lang: a.lang,
    review: a.review, facts: a.facts, deep: a.deep, units: Math.round(a.units), createdAt: new Date().toISOString(),
  };
}
