import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { scopeTrader } from "../lib/auth";
import { closeDateSql, horizonSql, netPnlSql, resultSql, signedRSql } from "../lib/tradeMath";
import { loadViewer, visibleSql } from "../lib/playbookAccess";
import { GetResearchParams, ListResearchResponse, GetResearchResponse } from "@workspace/api-zod";
import { badRequest, notFound, sendError, unauthorized } from "../lib/http";
import { winRateOf } from "../lib/coreMetrics/kpi";

/**
 * Research notes («Исследования») — a read-only archive since Волна 2 п. 2.15 (nothing new is written: earnings and
 * reactions live in «Катализаторы», repeatable patterns in the Playbook; the old notes stay readable).
 *
 *   GET    /research?ticker&q&tag&limit&offset   member; SQL-filtered; each note carries derived evidence
 *                                                (tradeCount / winRate / sumR / netPnl from trades.pattern_id, scoped) + viewer pin
 *   GET    /research/:id
 *   GET    /research/:id/trades                  scoped trades linked via pattern_id + net stats
 *   GET    /research/:id/setups                  playbook setups promoted from the note (viewer-visible, lean)
 * Any other method on /research… answers 404 (routes/index.ts JSON fallback).
 */
const router: IRouter = Router();

const strToNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

type ResearchRow = {
  id: number; pattern_name: string; ticker: string | null; context: string | null; market_condition: string | null;
  what_worked: string | null; what_failed: string | null; repeat_count: number | null; confidence_level: number | null;
  screenshot_url: string | null; screenshot_notes: string | null; tags: string | null; market_cap: string | null; float: string | null;
  adv: string | null; atr: string | null; relative_volume: string | null; beta: string | null; short_interest: string | null;
  sector: string | null; long_name: string | null; created_at: Date; deleted_at: Date | null; created_by: string | null;
  date: string | null; playbook_id: number | null;
  // derived (joined)
  trade_count?: string; wins?: string; losses?: string; be?: string; sum_r?: string | null; gross?: string | null; fees?: string | null; pinned?: boolean;
};

const COLS = `r.id, r.pattern_name, r.ticker, r.context, r.market_condition, r.what_worked, r.what_failed, r.repeat_count, r.confidence_level,
  r.screenshot_url, r.screenshot_notes, r.tags, r.market_cap, r.float, r.adv, r.atr, r.relative_volume, r.beta, r.short_interest,
  r.sector, r.long_name, r.created_at, r.deleted_at, r.created_by, r.date, r.playbook_id`;

/** Scoped evidence per note: trades linked via pattern_id (one math, net money). */
const EVIDENCE = (scopeParam: string) => `LEFT JOIN LATERAL (
    SELECT COUNT(*)::text AS trade_count,
           COUNT(*) FILTER (WHERE ${resultSql("t")} = 'win')::text AS wins,
           COUNT(*) FILTER (WHERE ${resultSql("t")} = 'loss')::text AS losses,
           COUNT(*) FILTER (WHERE ${resultSql("t")} = 'be')::text AS be,
           SUM(${signedRSql("t")})::text AS sum_r,
           SUM(t.pnl)::text AS gross,
           SUM(ABS(COALESCE(t.fees, 0))) FILTER (WHERE t.pnl IS NOT NULL)::text AS fees
      FROM trades t
     WHERE t.deleted_at IS NULL AND t.pattern_id = r.id AND (${scopeParam}::text IS NULL OR t.trader = ${scopeParam})
  ) ev ON TRUE`;

function serializeResearch(r: ResearchRow, viewer: string | null) {
  const base = {
    id: r.id, patternName: r.pattern_name, ticker: r.ticker, context: r.context, marketCondition: r.market_condition,
    whatWorked: r.what_worked, whatFailed: r.what_failed, repeatCount: r.repeat_count, confidenceLevel: r.confidence_level,
    screenshotUrl: r.screenshot_url, screenshotNotes: r.screenshot_notes, tags: r.tags, marketCap: r.market_cap, float: r.float,
    adv: r.adv, atr: strToNum(r.atr), relativeVolume: strToNum(r.relative_volume), beta: strToNum(r.beta),
    shortInterest: strToNum(r.short_interest), sector: r.sector, longName: r.long_name, createdAt: r.created_at.toISOString(),
  };
  const n = Number(r.trade_count ?? 0), wins = Number(r.wins ?? 0), losses = Number(r.losses ?? 0), be = Number(r.be ?? 0);
  const gross = strToNum(r.gross), fees = strToNum(r.fees);
  const decided = wins + losses;
  const evidence = {
    tradeCount: n, wins, losses, be,
    winRate: decided ? r2(((winRateOf(wins, losses) ?? 0)) * 100) : null,
    sumR: strToNum(r.sum_r) == null ? null : r2(strToNum(r.sum_r)!),
    grossPnl: gross == null ? null : r2(gross), fees: gross == null ? null : r2(fees ?? 0), netPnl: gross == null ? null : r2(gross - (fees ?? 0)),
  };
  // Derived confidence: manual slider until there is real evidence (≥5 decided trades), then the observed win rate.
  const derivedConfidence = decided >= 5 ? evidence.winRate : null;
  const extra = {
    createdBy: r.created_by,
    date: r.date ?? r.created_at.toISOString().slice(0, 10),
    playbookId: r.playbook_id,
    evidence,
    derivedConfidence,
    confidenceSource: derivedConfidence != null ? "trades" : "manual",
    pinned: !!r.pinned,
    viewer,
  };
  return { ...GetResearchResponse.parse(base), ...extra };
}

async function loadResearch(id: number, viewer: string | null, scope: string | null): Promise<ResearchRow | null> {
  const { rows } = await pool.query<ResearchRow>(
    `SELECT ${COLS}, ev.*, (p.research_id IS NOT NULL) AS pinned
       FROM research r
       ${EVIDENCE("$2")}
       LEFT JOIN research_pins p ON p.research_id = r.id AND p.user_name = $3
      WHERE r.id = $1 AND r.deleted_at IS NULL LIMIT 1`,
    [id, scope, viewer],
  );
  return rows[0] ?? null;
}

function parseId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { sendError(res, badRequest("INVALID_ID")); return null; }
  return id;
}

/** Trader scope for evidence: staff → everyone (or ?trader), trader → own, guest → nothing. */
async function evidenceScope(req: Request): Promise<string | null | undefined> {
  const scope = await scopeTrader(req, typeof req.query.trader === "string" ? req.query.trader : null);
  return scope;
}

const ListQuery = z.object({
  ticker: z.string().trim().max(12).optional(),
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(60).optional(),
  pinned: z.enum(["1", "true"]).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get("/research", asyncHandler(async (req, res): Promise<void> => {
  const scope = await evidenceScope(req);
  if (scope === undefined) throw unauthorized();
  const q = ListQuery.safeParse({
    ticker: req.query.ticker || undefined, q: req.query.q || undefined, tag: req.query.tag || undefined,
    pinned: req.query.pinned || undefined, limit: req.query.limit, offset: req.query.offset,
  });
  if (!q.success) throw q.error;
  const viewer = req.authUser?.name ?? null;
  const where: string[] = ["r.deleted_at IS NULL"];
  const params: unknown[] = [scope, viewer];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (q.data.ticker) where.push(`(',' || regexp_replace(UPPER(COALESCE(r.ticker, '')), '[[:space:],;/]+', ',', 'g') || ',') LIKE ('%,' || ${p(q.data.ticker.toUpperCase())} || ',%')`);
  if (q.data.tag) where.push(`(',' || LOWER(regexp_replace(COALESCE(r.tags, ''), '\\s*,\\s*', ',', 'g')) || ',') LIKE ('%,' || ${p(q.data.tag.toLowerCase())} || ',%')`);
  if (q.data.q) {
    const like = p(`%${q.data.q}%`);
    where.push(`(r.pattern_name ILIKE ${like} OR COALESCE(r.context, '') ILIKE ${like} OR COALESCE(r.what_worked, '') ILIKE ${like}
      OR COALESCE(r.what_failed, '') ILIKE ${like} OR COALESCE(r.market_condition, '') ILIKE ${like} OR COALESCE(r.tags, '') ILIKE ${like} OR COALESCE(r.ticker, '') ILIKE ${like})`);
  }
  if (q.data.pinned) where.push(`p.research_id IS NOT NULL`);
  const limit = q.data.limit ?? 500, offset = q.data.offset ?? 0;
  const { rows } = await pool.query<ResearchRow>(
    `SELECT ${COLS}, ev.*, (p.research_id IS NOT NULL) AS pinned
       FROM research r
       ${EVIDENCE("$1")}
       LEFT JOIN research_pins p ON p.research_id = r.id AND p.user_name = $2
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(r.date, substring(r.created_at::text, 1, 10)) DESC, r.created_at DESC
      LIMIT ${p(limit)} OFFSET ${p(offset)}`,
    params,
  );
  const items = rows.map((r) => serializeResearch(r, viewer));
  ListResearchResponse.parse(items);
  res.json(items);
}));

router.get("/research/:id", asyncHandler(async (req, res): Promise<void> => {
  const scope = await evidenceScope(req);
  if (scope === undefined) throw unauthorized();
  const params = GetResearchParams.safeParse(req.params);
  if (!params.success) throw params.error;
  const viewer = req.authUser?.name ?? null;
  const entry = await loadResearch(params.data.id, viewer, scope);
  if (!entry) throw notFound("RESEARCH_NOT_FOUND");
  res.json(serializeResearch(entry, viewer));
}));

// ─── Evidence: linked trades ───────────────────────────────────────────────

const TRADE_SELECT = `t.id, t.ticker, t.date, t.exit_date, ${closeDateSql("t")} AS close_date, t.side, t.setup, t.result,
  ${horizonSql("t")} AS horizon, t.pnl, t.fees, ${netPnlSql("t")} AS net_pnl, t.r_multiple, ${signedRSql("t")} AS signed_r,
  ${resultSql("t")} AS res, t.trader, t.source, t.broker_account, t.qty, t.pattern_id`;

router.get("/research/:id/trades", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  const scope = await evidenceScope(req);
  if (scope === undefined) throw unauthorized();
  const { rows: exists } = await pool.query(`SELECT 1 FROM research WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!exists.length) throw notFound("RESEARCH_NOT_FOUND");
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${TRADE_SELECT} FROM trades t
      WHERE t.deleted_at IS NULL AND t.pattern_id = $1 AND ($2::text IS NULL OR t.trader = $2)
      ORDER BY ${closeDateSql("t")} DESC, t.id DESC LIMIT 200`,
    [id, scope],
  );
  let wins = 0, losses = 0, be = 0, open = 0, sumR = 0, hasR = false, gross = 0, fees = 0, hasPnl = false;
  const trades = rows.map((r) => {
    const resv = String(r.res ?? "");
    if (resv === "win") wins++; else if (resv === "loss") losses++; else if (resv === "be") be++; else if (resv === "open") open++;
    const sr = strToNum(r.signed_r); if (sr != null) { sumR += sr; hasR = true; }
    const pnl = strToNum(r.pnl); if (pnl != null) { gross += pnl; fees += Math.abs(strToNum(r.fees) ?? 0); hasPnl = true; }
    return {
      id: Number(r.id), ticker: String(r.ticker ?? ""), date: String(r.date ?? "").slice(0, 10), exitDate: r.exit_date ? String(r.exit_date) : null,
      closeDate: String(r.close_date ?? "").slice(0, 10), side: (r.side as string | null) ?? null, setup: (r.setup as string | null) ?? null,
      result: (r.result as string | null) ?? null, horizon: String(r.horizon ?? "intraday"), pnl, fees: strToNum(r.fees), netPnl: strToNum(r.net_pnl),
      rMultiple: strToNum(r.r_multiple), signedR: sr, trader: (r.trader as string | null) ?? null, source: (r.source as string | null) ?? null,
      brokerAccount: (r.broker_account as string | null) ?? null, qty: strToNum(r.qty), linked: true,
    };
  });
  const decided = wins + losses;
  res.json({
    scope, trades,
    stats: {
      n: rows.length, wins, losses, be, open, winRate: decided ? r2(((winRateOf(wins, losses) ?? 0)) * 100) : null, sumR: hasR ? r2(sumR) : null,
      grossPnl: hasPnl ? r2(gross) : null, fees: hasPnl ? r2(fees) : null, netPnl: hasPnl ? r2(gross - fees) : null,
    },
  });
}));

/**
 * Playbook setups promoted from this note (source_type = 'research', or the note's own playbook_id), limited to what
 * the viewer may read. The note preview used to load the whole /playbook list (~300 KB) just for this lookup.
 */
router.get("/research/:id/setups", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  const { rows: exists } = await pool.query<{ playbook_id: number | null }>(`SELECT playbook_id FROM research WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!exists.length) throw notFound("RESEARCH_NOT_FOUND");
  const params: unknown[] = [id, exists[0].playbook_id];
  const vis = visibleSql(await loadViewer(req), params, "p");
  const { rows } = await pool.query<{ id: number; name: string; folder: string | null; source_type: string | null; source_id: number | null }>(
    `SELECT p.id, p.name, p.folder, p.source_type, p.source_id
       FROM playbook p
      WHERE p.deleted_at IS NULL AND ((p.source_type = 'research' AND p.source_id = $1) OR p.id = $2::int) AND ${vis}
      ORDER BY p.created_at ASC LIMIT 20`,
    params,
  );
  res.json(rows.map((r) => ({ id: r.id, name: r.name, folder: r.folder, sourceType: r.source_type, sourceId: r.source_id })));
}));

export default router;
