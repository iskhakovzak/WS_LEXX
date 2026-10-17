import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { isGuest, scopeTrader } from "../lib/auth";
import { can, requireCap } from "../lib/permissions";
import { logger } from "../lib/logger";
import { nyDate, addDays } from "../lib/tradingDate";
import { signedRSql, netPnlSql, closeDateSql, resultSql } from "../lib/tradeMath";
import { notifyUser } from "../lib/notifyUtils";
import { notifLinks } from "../lib/notificationCore";
import { inBackground } from "../lib/notifyEvents";
import { preview as textPreview } from "../lib/notifyEventsCore";

// ─── Additive schema (gameplan pattern) ─────────────────────────────────────
// trader_ratings is created by migrate.ts; here we only add the rubric/feedback-loop columns.
let ensured: Promise<void> | null = null;
function ensureColumns(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(
        `ALTER TABLE trader_ratings ADD COLUMN IF NOT EXISTS focus TEXT;
         ALTER TABLE trader_ratings ADD COLUMN IF NOT EXISTS evidence JSONB;
         ALTER TABLE trader_ratings ADD COLUMN IF NOT EXISTS tier TEXT;
         ALTER TABLE trader_ratings ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
         ALTER TABLE trader_ratings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`,
      )
      .then(() => undefined)
      .catch((err) => {
        ensured = null;
        throw err;
      });
  }
  return ensured;
}
ensureColumns().catch((err) => logger.warn({ err }, "ratings: ensureColumns failed at init"));

/** Strict rubric score: integer 1..10, or null when the value is invalid/absent (never silently coerced). */
function parseScore(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return n;
}

const CRITERIA = ["discipline", "riskManagement", "execution", "journaling", "improvement"] as const;
type Criterion = (typeof CRITERIA)[number];
const COLUMN: Record<Criterion | "overall", string> = {
  discipline: "discipline",
  riskManagement: "risk_management",
  execution: "execution",
  journaling: "journaling",
  improvement: "improvement",
  overall: "overall",
};

/** Rubric the UI renders and the curator scores against — one source for labels and what counts as evidence. */
export const RUBRIC: ReadonlyArray<{ key: Criterion; label: string; hint: string; evidence: string[] }> = [
  { key: "discipline", label: "Дисциплина", hint: "План дня, стоп соблюдён, без тильта", evidence: ["planFollowedPct", "journalDays", "maxLossR"] },
  { key: "riskManagement", label: "Риск-менеджмент", hint: "Риск на сделку, дневной лимит, размер", evidence: ["maxLossR", "worstDayNet", "avgRiskUsd"] },
  { key: "execution", label: "Исполнение", hint: "Вход по плану, R-профиль, слиппедж", evidence: ["winRate", "avgR", "profitFactor"] },
  { key: "journaling", label: "Журнал", hint: "Дни с записью, идеи, разбор ошибок", evidence: ["journalDays", "ideasPublished", "tradesWithNotesPct"] },
  { key: "improvement", label: "Прогресс", hint: "Динамика к прошлой неделе, работа над фокусом", evidence: ["netDelta", "prevFocus"] },
];

const SELECT_COLS = `id, trader, curator, week,
  discipline, risk_management AS "riskManagement",
  execution, journaling, improvement, overall,
  comment, focus, evidence, tier, acknowledged_at AS "acknowledgedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

/** Normalises any YYYY-MM-DD to the Monday of its ISO week (pure calendar maths, no TZ drift). */
function mondayOf(dateStr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function cleanText(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Risk tier label (free text ≤40, mirrors trader_risk_limits.tier which staff set via PUT /risk/limits/:trader). */
function parseTier(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  return s.length <= 40 ? s : "invalid";
}

const router: IRouter = Router();

/** rating → the rated trader (never the curator about their own rating). Background, never blocks the response. */
function notifyRating(r: { id: number; trader: string; week: string; overall: number | null; focus: string | null; comment: string | null } | undefined, actor: string, kind: "new" | "updated"): void {
  if (!r || !r.trader || r.trader === actor) return;
  inBackground("ratings.rating", () => notifyUser({
    userName: r.trader, type: "rating", actor, source: "ratings",
    title: `${kind === "new" ? "Оценка за неделю" : "Оценка обновлена"} ${String(r.week).slice(0, 10)}: ${r.overall ?? "—"}/10`,
    message: `${actor}${r.focus ? ` · фокус: «${textPreview(r.focus, 80)}»` : ""}${r.comment ? ` · «${textPreview(r.comment, 120)}»` : ""}`,
    link: notifLinks.ratings(r.trader), entityType: "rating", entityId: r.id,
  }));
}

router.get("/ratings", asyncHandler(async (req, res): Promise<void> => {
  await ensureColumns();
  const scope = await scopeTrader(req, typeof req.query.trader === "string" ? req.query.trader : null, "ratings.read.team");
  if (scope === undefined) { res.status(401).json({ error: "Требуется вход" }); return; }
  const curator = req.query.curator as string | undefined;
  const week = typeof req.query.week === "string" ? mondayOf(req.query.week) : null;
  let sqlText = `SELECT ${SELECT_COLS} FROM trader_ratings`;
  const params: unknown[] = [];
  const where: string[] = [];
  if (scope) { where.push(`trader = $${params.length + 1}`); params.push(scope); }
  if (curator) { where.push(`curator = $${params.length + 1}`); params.push(curator); }
  if (week) { where.push(`week = $${params.length + 1}`); params.push(week); }
  if (where.length) sqlText += ` WHERE ${where.join(" AND ")}`;
  sqlText += ` ORDER BY week DESC, created_at DESC LIMIT 2000`;
  const { rows } = await pool.query<any>(sqlText, params);
  res.json(rows);
}));

router.get("/ratings/rubric", asyncHandler(async (_req, res): Promise<void> => {
  res.json({ rubric: RUBRIC, scale: { min: 1, max: 10 }, formulas: {
    winRate: "W / (W + L), безубыток исключён",
    avgR: "ΣR / число закрытых сделок (R со знаком, ±20 clamp)",
    profitFactor: "ΣR⁺ / |ΣR⁻| (null когда нет убытков)",
    net: "P&L нетто = брутто − |комиссии|; дата = exit_date ?? date (NY)",
  } });
}));

router.get("/ratings/summary", asyncHandler(async (req, res): Promise<void> => {
  await ensureColumns();
  const scope = await scopeTrader(req, typeof req.query.trader === "string" ? req.query.trader : null, "ratings.read.team");
  if (scope === undefined) { res.status(401).json({ error: "Требуется вход" }); return; }
  const params: unknown[] = [];
  const where = scope ? (params.push(scope), `WHERE trader = $1`) : "";
  const { rows } = await pool.query<any>(`
    SELECT trader,
      ROUND(AVG(discipline), 1) AS "avgDiscipline",
      ROUND(AVG(risk_management), 1) AS "avgRiskManagement",
      ROUND(AVG(execution), 1) AS "avgExecution",
      ROUND(AVG(journaling), 1) AS "avgJournaling",
      ROUND(AVG(improvement), 1) AS "avgImprovement",
      ROUND(AVG(overall), 1) AS "avgOverall",
      COUNT(*) AS "totalRatings",
      MAX(week) AS "lastWeek",
      (SELECT focus FROM trader_ratings r2 WHERE r2.trader = trader_ratings.trader AND r2.focus IS NOT NULL ORDER BY week DESC, created_at DESC LIMIT 1) AS "lastFocus"
    FROM trader_ratings
    ${where}
    GROUP BY trader
    ORDER BY "avgOverall" DESC
  `, params);
  res.json(rows.map((r: any) => ({
    ...r,
    avgDiscipline: Number(r.avgDiscipline),
    avgRiskManagement: Number(r.avgRiskManagement),
    avgExecution: Number(r.avgExecution),
    avgJournaling: Number(r.avgJournaling),
    avgImprovement: Number(r.avgImprovement),
    avgOverall: Number(r.avgOverall),
    totalRatings: Number(r.totalRatings),
  })));
}));

/**
 * GET /ratings/evidence?trader&week — the week's facts the rubric is scored against
 * (trades via shared tradeMath SQL, journal days, ideas, risk tier, previous rating's focus).
 * Trader sees own, staff anyone. Week = Monday..Sunday on the NY trading calendar (close date).
 */
router.get("/ratings/evidence", asyncHandler(async (req, res): Promise<void> => {
  await ensureColumns();
  const scope = await scopeTrader(req, typeof req.query.trader === "string" ? req.query.trader : null, "ratings.read.team");
  if (scope === undefined) { res.status(401).json({ error: "Требуется вход" }); return; }
  if (!scope) { res.status(400).json({ error: "trader required" }); return; }
  const weekRaw = typeof req.query.week === "string" ? req.query.week : nyDate();
  const monday = mondayOf(weekRaw);
  if (!monday) { res.status(400).json({ error: "week must be YYYY-MM-DD" }); return; }
  const sunday = addDays(monday, 6);
  const prevMonday = addDays(monday, -7);
  const prevSunday = addDays(monday, -1);
  const trader = scope;

  const tradeAgg = async (from: string, to: string) => {
    const { rows } = await pool.query<any>(
      `SELECT COUNT(*)::int AS trades,
         COUNT(*) FILTER (WHERE ${resultSql("t")} = 'win')::int AS wins,
         COUNT(*) FILTER (WHERE ${resultSql("t")} = 'loss')::int AS losses,
         COUNT(*) FILTER (WHERE ${resultSql("t")} = 'be')::int AS be,
         COUNT(*) FILTER (WHERE ${resultSql("t")} = 'open')::int AS open,
         SUM(${signedRSql("t")}) AS r_sum,
         SUM(CASE WHEN ${signedRSql("t")} > 0 THEN ${signedRSql("t")} END) AS r_pos,
         SUM(CASE WHEN ${signedRSql("t")} < 0 THEN ${signedRSql("t")} END) AS r_neg,
         MIN(${signedRSql("t")}) AS min_r,
         SUM(${netPnlSql("t")}) AS net,
         SUM(t.pnl) AS gross,
         AVG(t.risk_usd) AS avg_risk,
         COUNT(*) FILTER (WHERE NULLIF(TRIM(COALESCE(t.notes, '')), '') IS NOT NULL OR NULLIF(TRIM(COALESCE(t.conclusion, '')), '') IS NOT NULL)::int AS with_notes,
         COUNT(DISTINCT ${closeDateSql("t")})::int AS active_days
       FROM trades t
       WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closeDateSql("t")} BETWEEN $2 AND $3`,
      [trader, from, to],
    );
    const r = rows[0] ?? {};
    const n = (v: unknown) => (v == null ? null : Number(v));
    const wins = Number(r.wins ?? 0), losses = Number(r.losses ?? 0);
    const closed = wins + losses + Number(r.be ?? 0);
    const rNeg = n(r.r_neg), rPos = n(r.r_pos);
    return {
      trades: Number(r.trades ?? 0), wins, losses, be: Number(r.be ?? 0), open: Number(r.open ?? 0),
      winRate: wins + losses > 0 ? wins / (wins + losses) : null,
      totalR: n(r.r_sum), avgR: closed > 0 && r.r_sum != null ? Number(r.r_sum) / closed : null,
      profitFactor: rNeg != null && rNeg < 0 ? (rPos ?? 0) / Math.abs(rNeg) : null,
      maxLossR: n(r.min_r), net: n(r.net), gross: n(r.gross), avgRiskUsd: n(r.avg_risk),
      tradesWithNotesPct: Number(r.trades ?? 0) > 0 ? Number(r.with_notes ?? 0) / Number(r.trades) : null,
      activeDays: Number(r.active_days ?? 0),
    };
  };

  const [cur, prev] = await Promise.all([tradeAgg(monday, sunday), tradeAgg(prevMonday, prevSunday)]);

  let worstDayNet: number | null = null;
  try {
    const { rows } = await pool.query<{ d: string; net: string | null }>(
      `SELECT ${closeDateSql("t")} AS d, SUM(${netPnlSql("t")}) AS net FROM trades t
        WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closeDateSql("t")} BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 2 ASC NULLS LAST LIMIT 1`,
      [trader, monday, sunday],
    );
    worstDayNet = rows[0]?.net == null ? null : Number(rows[0].net);
  } catch (err) { logger.warn({ err }, "ratings evidence: worst day failed"); }

  let journal = { days: 0, avgDiscipline: null as number | null, planFollowedPct: null as number | null, mistakes: [] as string[] };
  try {
    const { rows } = await pool.query<any>(
      `SELECT COUNT(*)::int AS days, AVG(discipline) AS avg_d,
              AVG(CASE WHEN followed_plan IS NULL THEN NULL WHEN followed_plan THEN 1 ELSE 0 END) AS followed,
              ARRAY_REMOVE(ARRAY_AGG(NULLIF(TRIM(mistakes), '') ORDER BY day), NULL) AS mistakes
         FROM journal_days WHERE trader = $1 AND day BETWEEN $2::date AND $3::date`,
      [trader, monday, sunday],
    );
    const r = rows[0] ?? {};
    journal = {
      days: Number(r.days ?? 0),
      avgDiscipline: r.avg_d == null ? null : Number(r.avg_d),
      planFollowedPct: r.followed == null ? null : Number(r.followed),
      mistakes: Array.isArray(r.mistakes) ? r.mistakes.slice(0, 5).map((m: unknown) => String(m).slice(0, 200)) : [],
    };
  } catch (err) { logger.warn({ err }, "ratings evidence: journal_days unavailable"); }

  let ideas = { published: 0, converted: 0, reviewed: 0 };
  try {
    const { rows } = await pool.query<any>(
      `SELECT COUNT(*) FILTER (WHERE status <> 'draft')::int AS published,
              COUNT(*) FILTER (WHERE status = 'converted' OR converted_trade_id IS NOT NULL)::int AS converted,
              COUNT(*) FILTER (WHERE reviewed_at IS NOT NULL)::int AS reviewed
         FROM trade_ideas WHERE deleted_at IS NULL AND trader = $1
           AND COALESCE(idea_date, TO_CHAR(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')) BETWEEN $2 AND $3`,
      [trader, monday, sunday],
    );
    const r = rows[0] ?? {};
    ideas = { published: Number(r.published ?? 0), converted: Number(r.converted ?? 0), reviewed: Number(r.reviewed ?? 0) };
  } catch (err) { logger.warn({ err }, "ratings evidence: trade_ideas aggregate failed"); }

  let risk: { tier: string | null; maxRiskPerTrade: number | null; dailyLossLimit: number | null } = { tier: null, maxRiskPerTrade: null, dailyLossLimit: null };
  try {
    const { rows } = await pool.query<any>(
      `SELECT tier, max_risk_per_trade, daily_loss_limit FROM trader_risk_limits WHERE trader = $1 LIMIT 1`, [trader],
    );
    if (rows[0]) risk = {
      tier: rows[0].tier ?? null,
      maxRiskPerTrade: rows[0].max_risk_per_trade == null ? null : Number(rows[0].max_risk_per_trade),
      dailyLossLimit: rows[0].daily_loss_limit == null ? null : Number(rows[0].daily_loss_limit),
    };
  } catch (err) { logger.warn({ err }, "ratings evidence: trader_risk_limits unavailable"); }

  const { rows: prevRating } = await pool.query<any>(
    `SELECT ${SELECT_COLS} FROM trader_ratings WHERE trader = $1 AND week < $2 ORDER BY week DESC, created_at DESC LIMIT 1`,
    [trader, monday],
  );
  const { rows: thisRating } = await pool.query<any>(
    `SELECT ${SELECT_COLS} FROM trader_ratings WHERE trader = $1 AND week = $2 ORDER BY created_at DESC LIMIT 1`,
    [trader, monday],
  );

  // Breaches of the desk's own limits, from the same rows (explicit, not inferred from P&L).
  const breaches: string[] = [];
  if (risk.maxRiskPerTrade != null && cur.avgRiskUsd != null && cur.avgRiskUsd > risk.maxRiskPerTrade) breaches.push("Средний риск на сделку выше лимита");
  if (risk.dailyLossLimit != null && worstDayNet != null && worstDayNet < -Math.abs(risk.dailyLossLimit)) breaches.push("Дневной лимит убытка превышен");
  if (cur.maxLossR != null && cur.maxLossR < -2) breaches.push(`Убыток ${cur.maxLossR.toFixed(1)}R — стоп не соблюдён`);

  res.json({
    trader, week: monday, weekEnd: sunday,
    trades: cur,
    prevTrades: prev,
    netDelta: cur.net != null && prev.net != null ? cur.net - prev.net : null,
    worstDayNet,
    journal,
    ideas,
    risk,
    breaches,
    prevFocus: prevRating[0]?.focus ?? null,
    prevRating: prevRating[0] ?? null,
    currentRating: thisRating[0] ?? null,
    rubric: RUBRIC,
    formulas: {
      winRate: "W / (W + L), безубыток исключён",
      avgR: "ΣR / закрытые (win+loss+be)",
      profitFactor: "ΣR⁺ / |ΣR⁻|",
      net: "нетто = брутто − |комиссии|; неделя по дате закрытия (NY)",
    },
  });
}));

/**
 * POST /ratings — staff only. Creates, or updates this curator's existing rating for the same
 * trader+week (prevents duplicate rows when a curator re-rates). Week is normalised to Monday.
 * All six scores are required integers 1..10 (no silent defaults).
 */
router.post("/ratings", asyncHandler(async (req, res): Promise<void> => {
  await ensureColumns();
  const curator = req.authUser?.name ?? "";
  const b = req.body as Record<string, unknown>;
  const { trader, week } = b;
  if (!trader || !week) { res.status(400).json({ error: "trader, week required" }); return; }
  const traderName = String(trader).trim();
  if (!traderName || traderName.length > 100) { res.status(400).json({ error: "invalid trader" }); return; }
  if (!(await requireCap(req, res, "ratings.write", { trader: traderName }))) return;
  const monday = mondayOf(String(week));
  if (!monday) { res.status(400).json({ error: "week must be YYYY-MM-DD" }); return; }
  if (monday > nyDate()) { res.status(400).json({ error: "Нельзя оценить будущую неделю" }); return; }
  const { rows: known } = await pool.query("SELECT 1 FROM users WHERE name = $1 AND active = true", [traderName]);
  if (known.length === 0) { res.status(400).json({ error: "Трейдер не найден" }); return; }

  const scores: Record<string, number> = {};
  for (const k of [...CRITERIA, "overall"] as const) {
    const s = parseScore(b[k]);
    if (s == null) { res.status(400).json({ error: `${k}: целое число от 1 до 10` }); return; }
    scores[k] = s;
  }
  const tier = parseTier(b.tier);
  if (tier === "invalid") { res.status(400).json({ error: "invalid tier" }); return; }
  const evidence = b.evidence && typeof b.evidence === "object" ? JSON.stringify(b.evidence).slice(0, 20000) : null;
  const values = [
    scores.discipline, scores.riskManagement, scores.execution,
    scores.journaling, scores.improvement, scores.overall,
    cleanText(b.comment, 4000), cleanText(b.focus, 500), evidence, tier,
  ];
  const { rows: existing } = await pool.query<{ id: number }>(
    `SELECT id FROM trader_ratings WHERE trader = $1 AND curator = $2 AND week = $3 ORDER BY created_at DESC LIMIT 1`,
    [traderName, curator, monday],
  );
  if (existing[0]) {
    const { rows } = await pool.query<any>(
      `UPDATE trader_ratings SET discipline = $1, risk_management = $2, execution = $3, journaling = $4,
         improvement = $5, overall = $6, comment = $7, focus = $8, evidence = $9::jsonb, tier = $10,
         updated_at = NOW(), acknowledged_at = NULL
       WHERE id = $11 RETURNING ${SELECT_COLS}`,
      [...values, existing[0].id],
    );
    notifyRating(rows[0], curator, "updated");
    res.json({ ...rows[0], updated: true });
    return;
  }
  const { rows } = await pool.query<any>(
    `INSERT INTO trader_ratings (trader, curator, week, discipline, risk_management, execution, journaling, improvement, overall, comment, focus, evidence, tier)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     RETURNING ${SELECT_COLS}`,
    [traderName, curator, monday, ...values],
  );
  notifyRating(rows[0], curator, "new");
  res.status(201).json(rows[0]);
}));

/** PATCH /ratings/:id — edit scores/comment/focus of an existing rating (author curator or admin). */
router.patch("/ratings/:id", asyncHandler(async (req, res): Promise<void> => {
  await ensureColumns();
  if (!(await requireCap(req, res, "ratings.write"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const { rows: found } = await pool.query<any>(`SELECT curator FROM trader_ratings WHERE id = $1`, [id]);
  if (!found[0]) { res.status(404).json({ error: "Rating not found" }); return; }
  const actor = req.authUser!.name;
  if (found[0].curator !== actor && !(await can(req, "ratings.manage.any"))) {
    res.status(403).json({ error: "Можно редактировать только свои оценки" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of [...CRITERIA, "overall"] as const) {
    if (body[k] !== undefined) {
      const s = parseScore(body[k]);
      if (s == null) { res.status(400).json({ error: `${k}: целое число от 1 до 10` }); return; }
      params.push(s); sets.push(`${COLUMN[k]} = $${params.length}`);
    }
  }
  if (body.comment !== undefined) { params.push(cleanText(body.comment, 4000)); sets.push(`comment = $${params.length}`); }
  if (body.focus !== undefined) { params.push(cleanText(body.focus, 500)); sets.push(`focus = $${params.length}`); }
  if (body.tier !== undefined) {
    const tier = parseTier(body.tier);
    if (tier === "invalid") { res.status(400).json({ error: "invalid tier" }); return; }
    params.push(tier); sets.push(`tier = $${params.length}`);
  }
  if (sets.length === 0) { res.status(400).json({ error: "Нечего обновлять" }); return; }
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await pool.query<any>(
    `UPDATE trader_ratings SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${SELECT_COLS}`,
    params,
  );
  notifyRating(rows[0], actor, "updated");
  res.json(rows[0]);
}));

/** POST /ratings/:id/ack — the rated trader confirms they read the feedback (closes the loop). */
router.post("/ratings/:id/ack", asyncHandler(async (req, res): Promise<void> => {
  await ensureColumns();
  if (!req.authUser) { res.status(401).json({ error: "Требуется вход" }); return; }
  if (isGuest(req)) { res.status(403).json({ error: "Гостевой режим: только просмотр" }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const { rows: found } = await pool.query<any>(`SELECT trader, acknowledged_at FROM trader_ratings WHERE id = $1`, [id]);
  if (!found[0]) { res.status(404).json({ error: "Rating not found" }); return; }
  if (found[0].trader !== req.authUser.name && !(await can(req, "ratings.write", { trader: found[0].trader }))) {
    res.status(403).json({ error: "Подтвердить может только оцениваемый трейдер" }); return;
  }
  const { rows } = await pool.query<any>(
    `UPDATE trader_ratings SET acknowledged_at = COALESCE(acknowledged_at, NOW()) WHERE id = $1 RETURNING ${SELECT_COLS}`, [id],
  );
  // First acknowledgement only → the curator who wrote the rating (not when they ack it themselves).
  const r = rows[0];
  const acker = req.authUser.name;
  if (r && !found[0].acknowledged_at && r.curator && r.curator !== acker) {
    inBackground("ratings.ack", () => notifyUser({
      userName: r.curator, type: "rating_ack", actor: acker, source: "ratings",
      title: `${r.trader} подтвердил оценку`,
      message: `Неделя ${String(r.week).slice(0, 10)}: ${r.overall ?? "—"}/10${acker !== r.trader ? ` (отметил ${acker})` : ""}`,
      link: notifLinks.ratings(r.trader), entityType: "rating", entityId: r.id,
    }));
  }
  res.json(rows[0]);
}));

router.delete("/ratings/:id", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "ratings.write"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const { rows } = await pool.query<any>(`SELECT curator FROM trader_ratings WHERE id = $1`, [id]);
  if (!rows[0]) { res.status(404).json({ error: "Rating not found" }); return; }
  if (rows[0].curator !== req.authUser!.name && !(await can(req, "ratings.manage.any"))) {
    res.status(403).json({ error: "Можно удалять только свои оценки" });
    return;
  }
  await pool.query(`DELETE FROM trader_ratings WHERE id = $1`, [id]);
  res.json({ success: true });
}));

export default router;
