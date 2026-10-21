import { Router, type IRouter } from "express";
import { z } from "zod";
import { forgetQuests } from "../lib/quests/cache";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { can, readScope, requireCap } from "../lib/permissions";
import { logger } from "../lib/logger";
import { nyDate } from "../lib/tradingDate";
import { collectPlanMediaIds, softDeleteDropped } from "../lib/planMedia";
import { AppError, badRequest, unauthorized } from "../lib/http";
import { keepPlanPicks } from "../lib/playbookToday/plan";
import { planPrefill } from "../lib/planPrefill";
import { PLAN_COLS, PlanBody, TemplateBody, TraderPlanBody, isIsoDate, parsePlanId, sanitizeMedia, serializeTraderPlan, type PlanDoc, type PlanRow, type TraderPlanRow } from "../lib/gamePlan";

/**
 * «План дня».
 *
 * Desk plan — the morning meeting. A curator publishes one plan per trading date (New York calendar date); every
 * member reads it.
 *   GET  /api/game-plan?date=YYYY-MM-DD   plan for the date (default: today in New York) + my read status + neighbours
 *   GET  /api/game-plan/history?limit=30&q=  compact list of recent plans (searchable)
 *   PUT  /api/game-plan/:date             gameplan.publish — zod-validated upsert
 *   DELETE /api/game-plan/:date           gameplan.publish — soft delete
 *   POST /api/game-plan/:id/read          current user marks the plan as read
 *   GET  /api/game-plan/:id/reads         gameplan.publish — who has / hasn't read it (vs active users)
 *
 * Personal plan — each member's own plan for the day (autosaved draft → «готов»).
 *   GET  /api/game-plan/my?date=          my plan (journal.write.own)
 *   PUT  /api/game-plan/my/:date          upsert my plan (autosave); body = plan doc + status
 *   GET  /api/game-plan/my/prefill?date=  journal.write.own — what the evening hands to this plan (lib/planPrefill):
 *                                         { date, focus: { text, source, from } | null, rule: SuggestedRule | null } —
 *                                         the own «Фокус на завтра» (item 1.5) and the costliest pattern of the last two
 *                                         weeks as the suggested own rule of the contract (item 1.9)
 *   GET  /api/game-plan/traders?date=    read view: plans of the traders the caller may read (journal.read.team scope)
 *
 * Templates — reusable plan skeletons.
 *   GET    /api/game-plan/templates?kind=desk|personal   mine + shared
 *   POST   /api/game-plan/templates                       { name, kind, doc, shared? } (shared needs gameplan.publish)
 *   DELETE /api/game-plan/templates/:id                   soft delete (author, or gameplan.publish for shared)
 *
 * Screenshots are stored by routes/plan-media.ts; plans reference them as { id, caption }. TradingView links are
 * validated (https, *.tradingview.com) and never fetched by the server.
 * Tables: src/db/migrations.
 */
const router: IRouter = Router();

// Kick off at module init; handlers still await it (and retry if it failed).

// Publishing / editing the desk game plan = gameplan.publish (permissions matrix, DB role).

function zodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

// ── Desk plan routes ──────────────────────────────────────────────────────────
router.get("/game-plan/history", asyncHandler(async (req, res): Promise<void> => {
  const limitRaw = Number(req.query.limit ?? 30);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 30;
  const qRaw = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const like = qRaw ? `%${qRaw.replace(/[\\%_]/g, (m) => "\\" + m)}%` : "";
  const { rows } = await pool.query(
    `SELECT p.id, p.date, p.author, p.bias, p.risk_mode AS "riskMode",
            LEFT(p.market_view, 280) AS "marketView",
            COALESCE((SELECT jsonb_agg(x->>'ticker') FROM jsonb_array_elements(p.in_play) x), '[]'::jsonb) AS tickers,
            jsonb_array_length(p.in_play) AS "inPlayCount",
            jsonb_array_length(p.macro) AS "macroCount",
            jsonb_array_length(p.media) AS "mediaCount",
            (SELECT COUNT(*)::int FROM game_plan_reads r WHERE r.plan_id = p.id) AS "readCount",
            p.updated_at AS "updatedAt"
       FROM game_plans p
      WHERE p.deleted_at IS NULL
        AND ($2 = '' OR p.date LIKE $2 OR p.market_view ILIKE $2 OR p.in_play::text ILIKE $2
             OR p.risk_notes ILIKE $2 OR p.author ILIKE $2 OR p.focus ILIKE $2)
      ORDER BY p.date DESC
      LIMIT $1`,
    [limit, like],
  );
  res.json(rows);
}));

router.get("/game-plan", asyncHandler(async (req, res): Promise<void> => {
  const date = req.query.date === undefined || req.query.date === "" ? nyDate() : req.query.date;
  if (!isIsoDate(date)) {
    throw badRequest("INVALID_DATE");
  }
  const { rows } = await pool.query<PlanRow>(
    `SELECT ${PLAN_COLS} FROM game_plans p WHERE p.date = $1 AND p.deleted_at IS NULL LIMIT 1`,
    [date],
  );
  const plan = rows[0] ?? null;
  const [{ rows: prev }, { rows: next }] = await Promise.all([
    pool.query<{ date: string }>(
      `SELECT date FROM game_plans WHERE deleted_at IS NULL AND date < $1 ORDER BY date DESC LIMIT 1`,
      [date],
    ),
    pool.query<{ date: string }>(
      `SELECT date FROM game_plans WHERE deleted_at IS NULL AND date > $1 ORDER BY date ASC LIMIT 1`,
      [date],
    ),
  ]);
  let myReadAt: string | null = null;
  const me = req.authUser?.name;
  if (plan && me) {
    const { rows: rr } = await pool.query<{ read_at: Date }>(
      `SELECT read_at FROM game_plan_reads WHERE plan_id = $1 AND trader = $2`,
      [plan.id, me],
    );
    myReadAt = rr[0] ? new Date(rr[0].read_at).toISOString() : null;
  }
  res.json({
    date,
    today: nyDate(),
    plan,
    myReadAt,
    prevDate: prev[0]?.date ?? null,
    nextDate: next[0]?.date ?? null,
  });
}));

// ── Personal plans (registered before "/game-plan/:date" style params on purpose) ─────────────
router.get("/game-plan/my", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser?.name;
  if (!me) {
    throw unauthorized();
  }
  if (!(await requireCap(req, res, "journal.write.own", { trader: me }))) return;
  const date = req.query.date === undefined || req.query.date === "" ? nyDate() : req.query.date;
  if (!isIsoDate(date)) {
    throw badRequest("INVALID_DATE");
  }
  const [{ rows }, { rows: prev }] = await Promise.all([
    pool.query<TraderPlanRow>(
      `SELECT id, trader, date, doc, status, created_at, updated_at
         FROM trader_plans WHERE trader = $1 AND date = $2 AND deleted_at IS NULL LIMIT 1`,
      [me, date],
    ),
    pool.query<{ date: string }>(
      `SELECT date FROM trader_plans WHERE trader = $1 AND date < $2 AND deleted_at IS NULL ORDER BY date DESC LIMIT 1`,
      [me, date],
    ),
  ]);
  res.json({ date, plan: rows[0] ? serializeTraderPlan(rows[0]) : null, prevDate: prev[0]?.date ?? null });
}));

router.get("/game-plan/my/prefill", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser?.name;
  if (!me) {
    throw unauthorized();
  }
  if (!(await requireCap(req, res, "journal.write.own", { trader: me }))) return;
  const date = req.query.date === undefined || req.query.date === "" ? nyDate() : req.query.date;
  if (!isIsoDate(date)) {
    throw badRequest("INVALID_DATE");
  }
  res.json(await planPrefill(me, date));
}));

router.put("/game-plan/my/:date", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser?.name;
  if (!me) {
    throw unauthorized();
  }
  if (!(await requireCap(req, res, "journal.write.own", { trader: me }))) return;
  const date = req.params.date;
  if (!isIsoDate(date)) {
    throw badRequest("INVALID_DATE");
  }
  const parsed = TraderPlanBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw parsed.error;
  }
  const { status, ...rawDoc } = parsed.data;
  const doc = await sanitizeMedia(rawDoc, "personal", me);
  const { rows: before } = await pool.query<{ doc: Partial<PlanDoc> }>(
    `SELECT doc FROM trader_plans WHERE trader = $1 AND date = $2`,
    [me, date],
  );
  const { rows } = await pool.query<TraderPlanRow>(
    `INSERT INTO trader_plans (trader, date, doc, status)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (trader, date) DO UPDATE SET
       doc = EXCLUDED.doc, status = EXCLUDED.status, updated_at = NOW(), deleted_at = NULL, created_at = CASE WHEN trader_plans.doc - 'setups' = '{}'::jsonb THEN NOW() ELSE trader_plans.created_at END
     RETURNING id, trader, date, doc, status, created_at, updated_at`,
    [me, date, JSON.stringify(keepPlanPicks(doc, before[0]?.doc)), status],
  );
  await softDeleteDropped(collectPlanMediaIds(before[0]?.doc), collectPlanMediaIds(doc), "personal", date, me).catch((err) =>
    logger.warn({ err }, "game-plan: soft delete of dropped media failed"),
  );
  forgetQuests(me); // plan quests (onboarding: first plan with a stop, own rule; plan before the open)
  res.json(serializeTraderPlan(rows[0]!));
}));

router.get("/game-plan/traders", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) {
    throw unauthorized();
  }
  const date = req.query.date === undefined || req.query.date === "" ? nyDate() : req.query.date;
  if (!isIsoDate(date)) {
    throw badRequest("INVALID_DATE");
  }
  // null → whole desk; string[] → own name + wards; [] → guest/anonymous (nothing).
  const scope = await readScope(req, "journal.read.team");
  const team = scope === null || scope.length > 1;
  const { rows } = await pool.query<TraderPlanRow>(
    `SELECT id, trader, date, doc, status, created_at, updated_at
       FROM trader_plans
      WHERE date = $1 AND deleted_at IS NULL AND ($2::text[] IS NULL OR trader = ANY($2::text[]))
      ORDER BY status DESC, updated_at DESC`,
    [date, scope],
  );
  const { rows: roster } = await pool.query<{ name: string }>(
    `SELECT name FROM users
      WHERE active = true AND COALESCE(banned, false) = false AND role NOT IN ('admin', 'curator', 'guest')
        AND ($1::text[] IS NULL OR name = ANY($1::text[]))
      ORDER BY name`,
    [scope],
  );
  const have = new Set(rows.map((r) => r.trader));
  res.json({
    date,
    team,
    plans: rows.map(serializeTraderPlan),
    missing: roster.map((r) => r.name).filter((n) => !have.has(n)),
  });
}));

// ── Templates ─────────────────────────────────────────────────────────────────
router.get("/game-plan/templates", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser?.name;
  if (!me) {
    throw unauthorized();
  }
  const kind = req.query.kind === "desk" ? "desk" : req.query.kind === "personal" ? "personal" : null;
  const { rows } = await pool.query(
    `SELECT id, author, kind, name, doc, shared, created_at AS "createdAt"
       FROM plan_templates
      WHERE deleted_at IS NULL AND (author = $1 OR shared = true) AND ($2::text IS NULL OR kind = $2)
      ORDER BY shared ASC, created_at DESC
      LIMIT 100`,
    [me, kind],
  );
  res.json(rows);
}));

router.post("/game-plan/templates", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser?.name;
  if (!me) {
    throw unauthorized();
  }
  const parsed = TemplateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw parsed.error;
  }
  const t = parsed.data;
  const ok =
    t.kind === "desk" || t.shared
      ? await requireCap(req, res, "gameplan.publish", null, "DESK_TEMPLATES_STAFF_ONLY")
      : await requireCap(req, res, "journal.write.own", { trader: me });
  if (!ok) return;
  // Templates are skeletons: never carry screenshots (they belong to a specific day).
  const doc: PlanDoc = { ...t.doc, media: [], inPlay: t.doc.inPlay.map((i) => ({ ...i, media: [] })) };
  const { rows: count } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM plan_templates WHERE author = $1 AND deleted_at IS NULL`,
    [me],
  );
  if ((count[0]?.n ?? 0) >= 40) throw new AppError("TOO_MANY", 409, { field: "templates", max: 40 });
  const { rows } = await pool.query(
    `INSERT INTO plan_templates (author, kind, name, doc, shared)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, author, kind, name, doc, shared, created_at AS "createdAt"`,
    [me, t.kind, t.name, JSON.stringify(doc), t.shared],
  );
  res.status(201).json(rows[0]);
}));

router.delete("/game-plan/templates/:id", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser?.name;
  if (!me) {
    throw unauthorized();
  }
  const id = parsePlanId(req.params.id);
  if (!id) {
    throw badRequest("INVALID_ID");
  }
  const { rows } = await pool.query<{ author: string; shared: boolean }>(
    `SELECT author, shared FROM plan_templates WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  const t = rows[0];
  if (!t || (t.author !== me && !t.shared)) throw new AppError("TEMPLATE_NOT_FOUND");
  if (t.author !== me && !(await can(req, "gameplan.publish"))) throw new AppError("AUTHOR_OR_STAFF_ONLY");
  await pool.query(`UPDATE plan_templates SET deleted_at = NOW() WHERE id = $1`, [id]);
  res.json({ ok: true });
}));

// ── Desk plan mutations ───────────────────────────────────────────────────────
router.put("/game-plan/:date", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) {
    throw unauthorized();
  }
  if (!(await requireCap(req, res, "gameplan.publish", null, "Curator or admin role required"))) return;
  const date = req.params.date;
  if (!isIsoDate(date)) {
    throw badRequest("INVALID_DATE");
  }
  const parsed = PlanBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw parsed.error;
  }
  const b = await sanitizeMedia(parsed.data, "desk", null);
  const actor = req.authUser.name;
  const { rows: before } = await pool.query<{ media: unknown; in_play: unknown }>(
    `SELECT media, in_play FROM game_plans WHERE date = $1`,
    [date],
  );
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO game_plans (date, author, updated_by, market_view, bias, risk_mode, key_levels, in_play, risk_notes, macro,
                             focus, media, tv_links, max_loss_usd, max_trades)
     VALUES ($1, $2, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13, $14)
     ON CONFLICT (date) DO UPDATE SET
       updated_by = EXCLUDED.updated_by,
       author = CASE WHEN game_plans.deleted_at IS NOT NULL THEN EXCLUDED.author ELSE game_plans.author END,
       market_view = EXCLUDED.market_view,
       bias = EXCLUDED.bias,
       risk_mode = EXCLUDED.risk_mode,
       key_levels = EXCLUDED.key_levels,
       in_play = EXCLUDED.in_play,
       risk_notes = EXCLUDED.risk_notes,
       macro = EXCLUDED.macro,
       focus = EXCLUDED.focus,
       media = EXCLUDED.media,
       tv_links = EXCLUDED.tv_links,
       max_loss_usd = EXCLUDED.max_loss_usd,
       max_trades = EXCLUDED.max_trades,
       updated_at = NOW(),
       deleted_at = NULL
     RETURNING id`,
    [
      date,
      actor,
      b.marketView,
      b.bias,
      b.riskMode,
      JSON.stringify(b.keyLevels),
      JSON.stringify(b.inPlay),
      b.riskNotes,
      JSON.stringify(b.macro),
      b.focus,
      JSON.stringify(b.media),
      JSON.stringify(b.tvLinks),
      b.maxLossUsd,
      b.maxTrades,
    ],
  );
  if (before[0]) {
    const prevIds = collectPlanMediaIds({ media: before[0].media, inPlay: before[0].in_play });
    await softDeleteDropped(prevIds, collectPlanMediaIds(b), "desk", date, null).catch((err) =>
      logger.warn({ err }, "game-plan: soft delete of dropped media failed"),
    );
  }
  const { rows: out } = await pool.query(`SELECT ${PLAN_COLS} FROM game_plans p WHERE p.id = $1`, [rows[0]!.id]);
  res.json(out[0]);
}));

router.delete("/game-plan/:date", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) {
    throw unauthorized();
  }
  if (!(await requireCap(req, res, "gameplan.publish", null, "Curator or admin role required"))) return;
  const date = req.params.date;
  if (!isIsoDate(date)) {
    throw badRequest("INVALID_DATE");
  }
  const { rowCount } = await pool.query(
    `UPDATE game_plans SET deleted_at = NOW() WHERE date = $1 AND deleted_at IS NULL`,
    [date],
  );
  if (!rowCount) throw new AppError("PLAN_NOT_FOUND");
  res.json({ ok: true });
}));

router.post("/game-plan/:id/read", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser?.name;
  if (!me) {
    throw unauthorized();
  }
  const id = parsePlanId(req.params.id);
  if (!id) {
    throw badRequest("INVALID_ID");
  }
  const { rows: exists } = await pool.query(`SELECT 1 FROM game_plans WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!exists[0]) throw new AppError("PLAN_NOT_FOUND");
  // Re-reading after an update refreshes the timestamp (so "updated after read" clears).
  const { rows } = await pool.query<{ read_at: Date }>(
    `INSERT INTO game_plan_reads (plan_id, trader) VALUES ($1, $2)
     ON CONFLICT (plan_id, trader) DO UPDATE SET read_at = NOW()
     RETURNING read_at`,
    [id, me],
  );
  res.json({ planId: id, trader: me, readAt: new Date(rows[0]!.read_at).toISOString() });
}));

router.get("/game-plan/:id/reads", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) {
    throw unauthorized();
  }
  if (!(await requireCap(req, res, "gameplan.publish", null, "Curator or admin role required"))) return;
  const id = parsePlanId(req.params.id);
  if (!id) {
    throw badRequest("INVALID_ID");
  }
  const { rows: planRows } = await pool.query<{ updated_at: Date }>(
    `SELECT updated_at FROM game_plans WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!planRows[0]) throw new AppError("PLAN_NOT_FOUND");
  const updatedAt = new Date(planRows[0].updated_at);
  const { rows } = await pool.query<{ name: string; role: string; read_at: Date | null }>(
    `SELECT u.name, u.role, r.read_at
       FROM users u
       LEFT JOIN game_plan_reads r ON r.plan_id = $1 AND r.trader = u.name
      WHERE u.active = true AND COALESCE(u.banned, false) = false
      ORDER BY r.read_at ASC NULLS LAST, u.name ASC`,
    [id],
  );
  const read = rows
    .filter((r) => r.read_at)
    .map((r) => {
      const at = new Date(r.read_at as Date);
      return { trader: r.name, role: r.role, readAt: at.toISOString(), stale: at < updatedAt };
    });
  const unread = rows.filter((r) => !r.read_at).map((r) => ({ trader: r.name, role: r.role }));
  res.json({ planId: id, total: rows.length, readCount: read.length, read, unread });
}));

export default router;
