import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";
import { nyDate } from "../lib/tradingDate";
import { REVIEW_SLA_HOURS, missingFields, missingList, tradingHoursBetween } from "../lib/eodLogic";
import { netPnlSql, closeDateSql, resultSql } from "../lib/tradeMath";
import { DAY_COLS, Summary, closeCheckNow, focusDayFor, isQuickClose, iso, loadCarried, loadDay, loadDayById, loadDayTrades, loadPlanTickers, loadStreaks, serializeDay, statusOf, totals, traderNote, type DayRow, type SummaryT, type TradeRow } from "../lib/eodStore";
import { marketClosedDays } from "../lib/curatorStore";
import { queueRoster, sweepOverdue } from "../lib/eodQueue";
import { forgetQuests } from "../lib/quests/cache";
import { forgetPlanPrefill } from "../lib/planPrefill";
import { QUEUE_DEFAULT_DAYS } from "../lib/curatorLogic";
import { can, requireCap } from "../lib/permissions";
import { notifyUser, notifyUsers } from "../lib/notifyUtils";
import { logActivity } from "../lib/activity";
import { activityTitle } from "../lib/activityText";
import { notifLinks } from "../lib/notificationCore";
import { claimOnce, inBackground, staffOrFallback } from "../lib/notifyEvents";
import { fmtSignedUsd, mirrorsToTelegram, preview as textPreview } from "../lib/notifyEventsCore";
import { AppError, badRequest, errorMessage, notFound, unauthorized } from "../lib/http";
import { langOf, type Lang } from "../i18n";
import { reviewT } from "../i18n/ns";
import { syncMarkerErrors } from "../lib/tradingErrors";

export { closeMinutesFor, type DayStatus, type TradeRow } from "../lib/eodStore";

/**
 * «Закрытие дня» (end-of-day close) + curator review queue.
 *
 * A trading day (New York calendar date) is CLOSED by its trader once every trade of the day has been reviewed
 * (setup + grade on the trade, plus followed-plan / mistakes / lesson in eod_trade_reviews) and the day summary is
 * written. Closed days queue up for a curator who leaves a comment + score 1–5 (reviewed).
 *
 * Trader endpoints (own days only):
 *   GET  /api/eod/day?date=YYYY-MM-DD[&trader=]       full EOD payload (trades of the day with review fields, carried
 *                                                     positions, missing items, reconcile numbers, game-plan tickers,
 *                                                     streaks). Curators/admins may pass trader=.
 *   PUT  /api/eod/trades/:id/review                   { followedPlan?, mistakes?, lesson? } — owner only, day must be open
 *   PUT  /api/eod/day/:date                           { discipline?, summary? } — save draft summary (day must be open)
 *   POST /api/eod/day/:date/close                     { discipline?, summary? } — validates; 422 { missing } when a MANUAL
 *                                                     trade lacks setup/grade (broker-imported trades never block the
 *                                                     close — they come back as `softMissing`, a reminder only);
 *                                                     422 EOD_TOO_EARLY { opensAt } for today before the market close
 *                                                     (16:00 NY, 13:00 on an early-close day — Волна 0, item 0.5);
 *                                                     stores closed_at; fills journal_days (today + tomorrow's plan)
 *                                                     where empty. A day closed by «Разобрал» (summary.via = "daily",
 *                                                     closeEodDay) is EXTENDED by the form: summary saved, closed_at,
 *                                                     the curator notice and the quest credit stay as they were.
 *   POST /api/eod/day/:date/reopen                    clears closed_at (curator review is kept)
 *   GET  /api/eod/streaks[?trader=]                   { closedStreak, reviewedStreak, closedTotal, lastClosed }
 *   GET  /api/eod/days?from=&to=[&trader=]            { trader, days: [{ date, status, closedAt, reviewedAt, reviewedBy,
 *                                                     curatorScore }] } — month calendar marks (range ≤ 120 days)
 *
 * Status (for dashboard / admin — contract):
 *   GET  /api/eod/status?date=YYYY-MM-DD[&trader=]
 *     → { date, today, traders: [{ trader, status: 'open'|'closed'|'reviewed', trades, reviewedTrades,
 *          missing: [{ tradeId, ticker, fields: ('setup'|'grade')[] }], closedAt, reviewedAt, curatorScore, discipline }] }
 *     Traders get only themselves; curators/admins get every active trader (plus anyone with trades or an EOD row that
 *     day), or one trader with trader=. "status: 'open'" with trades > 0 after the session ⇒ «не закрыл день».
 *
 * Curator queue (curator/admin):
 *   GET  /api/eod/queue?limit=50          closed & unreviewed days, newest closed_at first, with hoursWaiting / overdue
 *                                         (hoursWaiting = TRADING hours since the close: weekends and full-day holidays
 *                                         pause the 24 h SLA, lib/eodLogic tradingHoursBetween)
 *        &scope=mine|desk|unassigned      mine (default when the reader has wards) = traders assigned to the reader
 *                                         (curator / mentor / risk manager, the /curator roster); unassigned = traders
 *                                         without a curator («Без куратора», admin-owned); desk = everyone readable
 *        &reviewed=1                      instead: days reviewed in the last 7 days, newest first (mode: 'reviewed')
 *   GET  /api/eod/queue/count             { count, overdue, scope } — «ждёт разбора»: the same scope and 14-day window
 *                                         (the nav badge, the /curator KPI and the queue show one number)
 *   POST /api/eod/days/:id/review         { comment, score 1..5 } → sets reviewed_by/at; returns { day, next } where
 *                                         next = the next queue item (for the «Следующий» flow)
 *
 * One day closure (Волна 0, item 0.4, owner decision 1 — recommendation applied: «Разобрал» closes the day, the journal
 * form is its extension): POST /api/daily/review and the Telegram «Разобрал» (lib/daily/service markReviewed) call
 * closeEodDay(trader, date, {}, "daily") — the same row, the same curator notice (once per day), the same queue.
 * The trader's one-line note (daily_reviews.note) rides along in the queue items (`note`) and in GET /eod/day.
 *
 * Tables (src/db/migrations):
 *   eod_days(trader, date, closed_at, discipline, summary jsonb, reviewed_by, reviewed_at, curator_comment, curator_score)
 *   eod_trade_reviews(trade_id, trader, followed_plan, mistakes text[], lesson)
 * Per-trade setup / grade live on the trade itself (trades PATCH API); only what's missing there is stored here.
 */
const router: IRouter = Router();


// ── Helpers ───────────────────────────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));
}

/**
 * Whose day are we looking at. Traders: always themselves; holders of journal.read.team (curators/admins,
 * permissions matrix, role from the DB): `claimed` or themselves.
 */
/** Throws 401 / 403 AppErrors. */
async function scopeTrader(req: Request, claimed: unknown): Promise<{ ok: true; trader: string }> {
  const auth = req.authUser;
  if (!auth) throw unauthorized();
  const name = typeof claimed === "string" && claimed.trim() ? claimed.trim().slice(0, 120) : null;
  if (!name || name === auth.name) return { ok: true, trader: auth.name };
  if (await can(req, "journal.read.team", { trader: name })) return { ok: true, trader: name };
  throw new AppError("EOD_OWN_ONLY");
}

// ── Validation ────────────────────────────────────────────────────────────────
const DayBody = z.object({
  discipline: z.number().int().min(1).max(5).nullable().optional(),
  summary: Summary.optional(),
});
const TradeReviewBody = z.object({
  followedPlan: z.boolean().nullable().optional(),
  mistakes: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  lesson: z.string().trim().max(2000).optional(),
});
const CuratorReviewBody = z.object({
  comment: z.string().trim().max(6000).default(""),
  score: z.number().int().min(1).max(5),
});

// ── Payload ───────────────────────────────────────────────────────────────────
async function buildDay(trader: string, date: string, lang: Lang = "ru") {
  const today = nyDate();
  const [day, trades, carried, plan, streaks, note] = await Promise.all([
    loadDay(trader, date), loadDayTrades(trader, date), loadCarried(trader, date), loadPlanTickers(date), loadStreaks(trader, today),
    traderNote(trader, date),
  ]);
  const inPlay = new Set((plan?.inPlay ?? []).map((p) => p.ticker));
  const serializeTrade = (t: TradeRow) => ({
    ...t,
    reviewUpdatedAt: iso(t.reviewUpdatedAt),
    enteredToday: t.date === date,
    closedToday: t.closeDate === date && t.resultNorm != null && t.resultNorm !== "open",
    onPlan: inPlay.has(t.ticker.toUpperCase()),
    missing: missingFields(t),
  });
  const check = await closeCheckNow(date, trades);
  const brokerRows = trades.filter((t) => t.source === "propreports");
  const positions = [...trades, ...carried].filter((t) => t.resultNorm === "open");
  return {
    trader,
    date,
    today,
    day: serializeDay(day),
    status: statusOf(day),
    trades: trades.map(serializeTrade),
    carried: carried.map(serializeTrade),
    positions: positions.map((t) => t.id),
    missing: check.missing,
    softMissing: check.soft,
    canClose: check.ok,
    closeBlockedReason: check.reasonCode ? errorMessage(check.reasonCode, lang, check.opensAt ? { opensAt: check.opensAt } : undefined) : null,
    /** Today before the market close: the day opens for closing at this NY time («16:00» / «13:00»), else null. */
    closeOpensAt: check.opensAt ?? null,
    /** Closed with «Разобрал» (dashboard / Telegram) — the journal form extends it without reopening. */
    closedVia: day?.closedAt ? (isQuickClose(day) ? "daily" : "journal") : null,
    /** The trader's note to «Разобрал» (daily_reviews.note). */
    traderNote: note,
    reconcile: {
      journal: totals(trades, date),
      broker: brokerRows.length ? totals(brokerRows, date) : null,
      manualUnmatched: trades.filter((t) => t.source !== "propreports" && t.closeDate === date).length,
    },
    plan,
    streaks,
  };
}

// ── Routes: trader ────────────────────────────────────────────────────────────
router.get("/eod/day", asyncHandler(async (req, res): Promise<void> => {
  const scope = await scopeTrader(req, req.query.trader);
  const date = req.query.date === undefined || req.query.date === "" ? nyDate() : req.query.date;
  if (!isIsoDate(date)) throw badRequest("INVALID_DATE");
  res.json(await buildDay(scope.trader, date, langOf(req)));
}));

router.get("/eod/streaks", asyncHandler(async (req, res): Promise<void> => {
  const scope = await scopeTrader(req, req.query.trader);
  res.json({ trader: scope.trader, ...(await loadStreaks(scope.trader, nyDate())) });
}));

/** Month calendar marks: EOD status per day for one trader. */
router.get("/eod/days", asyncHandler(async (req, res): Promise<void> => {
  const scope = await scopeTrader(req, req.query.trader);
  const { from, to } = req.query;
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new AppError("INVALID_RANGE", 400, { max: 120 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 120) throw new AppError("INVALID_RANGE", 400, { max: 120 });
  const { rows } = await pool.query<DayRow>(
    `SELECT ${DAY_COLS} FROM eod_days d WHERE d.trader = $1 AND d.date >= $2 AND d.date <= $3 ORDER BY d.date`,
    [scope.trader, from, to],
  );
  res.json({
    trader: scope.trader,
    days: rows.map((d) => ({
      date: d.date, status: statusOf(d), closedAt: iso(d.closedAt), reviewedAt: iso(d.reviewedAt),
      reviewedBy: d.reviewedBy, curatorScore: d.curatorScore,
    })),
  });
}));

router.put("/eod/trades/:id/review", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) throw unauthorized();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID");
  const parsed = TradeReviewBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const { rows: tr } = await pool.query<{ trader: string | null; date: string; closeDate: string }>(
    `SELECT t.trader, LEFT(t.date, 10) AS date, ${closeDateSql()} AS "closeDate" FROM trades t WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [id],
  );
  if (!tr[0]) throw notFound("TRADE_NOT_FOUND");
  if (tr[0].trader !== me.name) throw new AppError("TRADE_REVIEW_OWN_ONLY");
  // The trade's review belongs to the day it is realised on (or entered, for still-open trades).
  for (const d of new Set([tr[0].date, tr[0].closeDate])) {
    const day = await loadDay(me.name, d);
    // A day closed by «Разобрал» stays open for the per-trade review — the journal form is its extension.
    if (day?.closedAt && !isQuickClose(day)) throw new AppError("EOD_DAY_CLOSED", 409, { date: d }, { date: d });
  }
  const b = parsed.data;
  const mistakes = b.mistakes ? Array.from(new Set(b.mistakes.map((m) => m.trim()).filter(Boolean))) : null;
  const before = mistakes ? (await pool.query<{ mistakes: string[] }>(`SELECT mistakes FROM eod_trade_reviews WHERE trade_id = $1`, [id])).rows[0]?.mistakes ?? [] : null;
  const { rows } = await pool.query(
    `INSERT INTO eod_trade_reviews (trade_id, trader, followed_plan, mistakes, lesson, updated_at)
     VALUES ($1, $2, $3, COALESCE($4::text[], '{}'), COALESCE($5, ''), NOW())
     ON CONFLICT (trade_id) DO UPDATE SET
       followed_plan = CASE WHEN $6 THEN EXCLUDED.followed_plan ELSE eod_trade_reviews.followed_plan END,
       mistakes = COALESCE($4::text[], eod_trade_reviews.mistakes),
       lesson = COALESCE($5, eod_trade_reviews.lesson),
       updated_at = NOW()
     RETURNING trade_id AS "tradeId", trader, followed_plan AS "followedPlan", mistakes, lesson, updated_at AS "updatedAt"`,
    [id, me.name, b.followedPlan ?? null, mistakes, b.lesson ?? null, b.followedPlan !== undefined],
  );
  // The journal's mistakes are rows of the one errors store (Волна 2 п. 2.8, lib/tradingErrors).
  if (mistakes && before) await syncMarkerErrors({ trader: me.name, tradeId: id, ticker: null, source: "journal", actor: me.name }, before, mistakes);
  res.json({ ...rows[0], updatedAt: iso(rows[0].updatedAt) });
}));

async function upsertDay(trader: string, date: string, b: z.infer<typeof DayBody>): Promise<DayRow> {
  const { rows } = await pool.query<DayRow>(
    `INSERT INTO eod_days AS d (trader, date, discipline, summary, updated_at)
     VALUES ($1, $2, $3, COALESCE($4::jsonb, '{}'::jsonb), NOW())
     ON CONFLICT (trader, date) DO UPDATE SET
       discipline = CASE WHEN $5 THEN EXCLUDED.discipline ELSE d.discipline END,
       summary = COALESCE($4::jsonb, d.summary),
       updated_at = NOW()
     RETURNING ${DAY_COLS}`,
    [trader, date, b.discipline ?? null, b.summary ? JSON.stringify(b.summary) : null, b.discipline !== undefined],
  );
  return rows[0];
}

router.put("/eod/day/:date", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) throw unauthorized();
  const date = req.params.date;
  if (!isIsoDate(date)) throw badRequest("INVALID_DATE");
  const parsed = DayBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const existing = await loadDay(me.name, date);
  if (existing?.closedAt) throw new AppError("EOD_DAY_CLOSED", 409, { date: existing.date }, { date: existing.date });
  const day = await upsertDay(me.name, date, parsed.data);
  res.json(serializeDay(day));
}));

/** Fill the trader's journal_days row for `date` (and tomorrow's plan) where it is still empty — never overwrites text. */
async function prefillJournal(trader: string, date: string, day: DayRow, trades: TradeRow[]): Promise<void> {
  const s = day.summary ?? ({} as SummaryT);
  const lessonText = trades
    .filter((t) => t.lesson.trim())
    .map((t) => `• ${t.ticker}: ${t.lesson.trim()}`)
    .join("\n");
  const mistakeText = s.stop?.trim() ? s.stop.trim() : "";
  const followed = trades.length === 0 ? null : trades.every((t) => t.followedPlan === true) ? true : trades.some((t) => t.followedPlan === false) ? false : null;
  await pool.query(
    `INSERT INTO journal_days (trader, day, plan, well, mistakes, lessons, mood, discipline, followed_plan, tags, updated_at)
     VALUES ($1, $2, '', $3, $4, $5, $6, $7, $8, '[]'::jsonb, NOW())
     ON CONFLICT (trader, day) DO UPDATE SET
       well = CASE WHEN journal_days.well = '' THEN EXCLUDED.well ELSE journal_days.well END,
       mistakes = CASE WHEN journal_days.mistakes = '' THEN EXCLUDED.mistakes ELSE journal_days.mistakes END,
       lessons = CASE WHEN journal_days.lessons = '' THEN EXCLUDED.lessons ELSE journal_days.lessons END,
       mood = COALESCE(journal_days.mood, EXCLUDED.mood),
       discipline = COALESCE(journal_days.discipline, EXCLUDED.discipline),
       followed_plan = COALESCE(journal_days.followed_plan, EXCLUDED.followed_plan),
       updated_at = NOW()`,
    [trader, date, s.repeat ?? "", mistakeText, lessonText, s.mood ?? null, day.discipline ?? null, followed],
  );
  const tomorrow = (s.tomorrow ?? "").trim();
  if (tomorrow) {
    await pool.query(
      `INSERT INTO journal_days (trader, day, plan, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (trader, day) DO UPDATE SET
         plan = CASE WHEN journal_days.plan = '' THEN EXCLUDED.plan ELSE journal_days.plan END,
         updated_at = NOW()`,
      [trader, focusDayFor(date), tomorrow],
    );
  }
}

export type CloseVia = "journal" | "daily";

/** A full EOD review = the journal form with ≥ 1 trade review or mistake verdict (roadmap R3). */
export const isFullReview = (trades: readonly Pick<TradeRow, "followedPlan" | "mistakes" | "lesson">[]): boolean =>
  trades.some((t) => t.followedPlan != null || (t.mistakes?.length ?? 0) > 0 || !!t.lesson?.trim());

/** Stamps eod_days.full_review_at once (rewards count only full reviews; the one-tap «Разобрал» is «seen»). */
async function markFullReview(dayId: number, trades: readonly TradeRow[]): Promise<void> {
  if (!isFullReview(trades)) return;
  await pool.query(`UPDATE eod_days SET full_review_at = NOW() WHERE id = $1 AND full_review_at IS NULL`, [dayId])
    .catch((err) => logger.warn({ err }, "eod: full review stamp failed"));
}

/**
 * Closes `trader`'s `date` for the curator — the one close of the day (Волна 0, item 0.4), used by the journal form
 * (POST /eod/day/:date/close, via "journal") and by «Разобрал» on the dashboard / in Telegram (lib/daily/service
 * markReviewed, via "daily"). Throws AppError: 422 EOD_TOO_EARLY { opensAt } today before the market close, 422
 * EOD_FUTURE_DAY for a future date, 422 EOD_INCOMPLETE { missing } (journal only — the button never blocks on a manual
 * trade's setup / grade), 409 EOD_ALREADY_CLOSED (the form on a day the form already closed).
 * Idempotent: «Разобрал» on a closed day changes nothing; the form on a «Разобрал» day saves its summary and keeps
 * closed_at. The curator notice goes out once per day (claimOnce) however the day was closed / reopened.
 * `changed` = this call closed the day (false: it was closed already).
 */
export async function closeEodDay(
  trader: string, date: string, body: z.infer<typeof DayBody>, via: CloseVia, now = new Date(),
): Promise<{ day: DayRow; changed: boolean; trades: TradeRow[] }> {
  const trades = await loadDayTrades(trader, date);
  const check = await closeCheckNow(date, trades, now);
  if (check.opensAt) throw new AppError("EOD_TOO_EARLY", 422, { opensAt: check.opensAt }, { opensAt: check.opensAt });
  if (!check.ok && !(via === "daily" && check.reasonCode === "EOD_INCOMPLETE")) {
    throw new AppError(check.reasonCode ?? "EOD_INCOMPLETE", 422, check.opensAt ? { opensAt: check.opensAt } : undefined, { missing: check.missing, opensAt: check.opensAt });
  }
  const existing = await loadDay(trader, date);
  if (existing?.closedAt) {
    if (via === "daily") return { day: existing, changed: false, trades };
    if (!isQuickClose(existing)) throw new AppError("EOD_ALREADY_CLOSED", 409, undefined, { day: serializeDay(existing) });
    // The journal form extends a «Разобрал» day: its summary replaces the marker, closed_at stays (no second notice).
    const day = await upsertDay(trader, date, body);
    await markFullReview(day.id, trades);
    forgetQuests(trader);
    forgetPlanPrefill(trader);
    await prefillJournal(trader, date, day, trades).catch((err) => logger.warn({ err }, "eod: journal prefill failed"));
    return { day, changed: false, trades };
  }
  let day: DayRow;
  if (via === "daily") {
    // A draft summary (if any) is kept; the marker tells the journal this day was closed by the button.
    const { rows } = await pool.query<DayRow>(
      `INSERT INTO eod_days AS d (trader, date, summary, closed_at, updated_at) VALUES ($1, $2, '{"via":"daily"}'::jsonb, NOW(), NOW())
       ON CONFLICT (trader, date) DO UPDATE SET closed_at = NOW(), summary = d.summary || '{"via":"daily"}'::jsonb, updated_at = NOW()
        WHERE d.closed_at IS NULL
       RETURNING ${DAY_COLS}`,
      [trader, date],
    );
    if (!rows[0]) { // closed by a parallel request in between
      const again = await loadDay(trader, date);
      if (again) return { day: again, changed: false, trades };
      throw new AppError("EOD_DAY_NOT_FOUND");
    }
    day = rows[0];
  } else {
    const saved = await upsertDay(trader, date, body);
    const { rows } = await pool.query<DayRow>(
      `UPDATE eod_days d SET closed_at = NOW(), updated_at = NOW() WHERE d.id = $1 RETURNING ${DAY_COLS}`,
      [saved.id],
    );
    day = rows[0];
  }
  if (via === "journal") await markFullReview(day.id, trades);
  forgetQuests(trader); // the review quest credits the closed day now, not after the quest cache expires
  forgetPlanPrefill(trader); // the suggested rule of the next plan reads the window with this day closed
  if (via === "journal") {
    try {
      await prefillJournal(trader, date, day, trades);
    } catch (err) {
      logger.warn({ err }, "eod: journal prefill failed");
    }
  }
  // Day closed → it is in the curator queue: tell the trader's assigned staff (fallback: every curator/admin), in the
  // app and in Telegram. Once per day: close → reopen → close again (or button + form) never pings the curator twice.
  inBackground("eod.close", async () => {
    const t = totals(trades, date);
    const params = {
      trader, date, trades: t.trades,
      ...(t.net != null ? { net: fmtSignedUsd(t.net) } : {}),
      ...(day.discipline != null ? { discipline: day.discipline } : {}),
    };
    // Activity log details: RU text (stored), same parts as the notification.
    const tr = reviewT.tFor("ru");
    const parts = [tr("eod.trades", { count: t.trades })];
    if (params.net) parts.push(tr("eod.net", { net: params.net }));
    if (params.discipline != null) parts.push(tr("eod.discipline", { value: params.discipline }));
    if (await claimOnce(`eod:review_request:${day.id}`)) await notifyUsers(await staffOrFallback(trader), {
      type: "eod_review_request", actor: trader, source: "eod",
      params,
      link: notifLinks.journalDay(date, trader), entityType: "eod_day", entityId: day.id,
      telegram: mirrorsToTelegram("eod_review_request"),
    }, trader);
    await logActivity({ action: "closed", section: "eod", entityId: date, entityTitle: date, trader, details: parts.join(", ") });
  });
  return { day, changed: true, trades };
}

router.post("/eod/day/:date/close", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) throw unauthorized();
  const date = req.params.date;
  if (!isIsoDate(date)) throw badRequest("INVALID_DATE");
  const parsed = DayBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const { day } = await closeEodDay(me.name, date, parsed.data, "journal");
  res.json({ day: serializeDay(day), streaks: await loadStreaks(me.name, nyDate()), journalPrefilled: true });
}));

router.post("/eod/day/:date/reopen", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) throw unauthorized();
  const date = req.params.date;
  if (!isIsoDate(date)) throw badRequest("INVALID_DATE");
  const { rows } = await pool.query<DayRow>(
    `UPDATE eod_days d SET closed_at = NULL, updated_at = NOW() WHERE d.trader = $1 AND d.date = $2 RETURNING ${DAY_COLS}`,
    [me.name, date],
  );
  if (!rows[0]) throw new AppError("EOD_DAY_NOT_FOUND");
  forgetQuests(me.name);
  inBackground("eod.reopen", () => logActivity({ action: "reopened", section: "eod", entityId: date, entityTitle: date, trader: me.name }));
  res.json(serializeDay(rows[0]));
}));

// ── Status (dashboard / admin contract) ───────────────────────────────────────
router.get("/eod/status", asyncHandler(async (req, res): Promise<void> => {
  const auth = req.authUser;
  if (!auth) throw unauthorized();
  const date = req.query.date === undefined || req.query.date === "" ? nyDate() : req.query.date;
  if (!isIsoDate(date)) throw badRequest("INVALID_DATE");
  const qTrader = typeof req.query.trader === "string" ? req.query.trader.trim() : "";
  let traders: string[];
  if (!(await can(req, "journal.read.team", { trader: qTrader || null }))) {
    if (qTrader && qTrader !== auth.name) throw new AppError("EOD_OWN_ONLY");
    traders = [auth.name];
  } else if (qTrader) {
    traders = [qTrader];
  } else {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM users WHERE active = true AND COALESCE(banned, false) = false AND role = 'trader'
       UNION SELECT trader FROM eod_days WHERE date = $1
       UNION SELECT trader FROM trades t WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL AND (LEFT(t.date, 10) = $1 OR ${closeDateSql()} = $1)
       ORDER BY 1`,
      [date],
    );
    traders = rows.map((r) => r.name);
  }
  const out = await Promise.all(
    traders.map(async (trader) => {
      const [day, trades] = await Promise.all([loadDay(trader, date), loadDayTrades(trader, date)]);
      const missing = missingList(trades);
      return {
        trader,
        status: statusOf(day),
        trades: trades.length,
        reviewedTrades: trades.length - missing.length,
        missing,
        closedAt: iso(day?.closedAt ?? null),
        reviewedAt: iso(day?.reviewedAt ?? null),
        reviewedBy: day?.reviewedBy ?? null,
        curatorScore: day?.curatorScore ?? null,
        discipline: day?.discipline ?? null,
      };
    }),
  );
  res.json({ date, today: nyDate(), traders: out });
}));

// ── Curator queue ─────────────────────────────────────────────────────────────
/** The trader's «Разобрал» note of the day (daily_reviews, migration 0202). */
const NOTE_SQL = `(SELECT r.note FROM daily_reviews r WHERE r.trader = d.trader AND r.date = d.date)`;
const QUEUE_SQL = `
  SELECT ${DAY_COLS},
         EXTRACT(EPOCH FROM (NOW() - d.closed_at)) / 3600 AS "hoursWaiting",
         (SELECT COUNT(*)::int FROM trades t WHERE t.deleted_at IS NULL AND t.trader = d.trader
             AND (LEFT(t.date, 10) = d.date OR ${closeDateSql()} = d.date)) AS trades,
         (SELECT SUM(${netPnlSql()})::float8 FROM trades t WHERE t.deleted_at IS NULL AND t.trader = d.trader
             AND ${closeDateSql()} = d.date AND ${resultSql()} IN ('win','loss','be')) AS net,
         ${NOTE_SQL} AS note
    FROM eod_days d
   WHERE d.closed_at IS NOT NULL AND d.reviewed_at IS NULL`;

/**
 * Same window as the /curator queue: days archived via «архивировать старые» (curator_queue_acks) never show, and
 * days closed more than QUEUE_DEFAULT_DAYS ago are hidden unless `?old=1` — otherwise a year of backfill buries the queue.
 */
function pendingWindowSql(includeOld: boolean): string {
  const acked = `AND NOT EXISTS (SELECT 1 FROM curator_queue_acks a WHERE a.revoked_at IS NULL AND a.item_id = 'eod:' || d.id)`;
  return includeOld ? acked : `${acked} AND d.closed_at > NOW() - INTERVAL '${QUEUE_DEFAULT_DAYS} days'`;
}

type QueueRow = DayRow & { hoursWaiting: number; trades: number; net: number | null; note?: string | null };
const SLA_HOURS = REVIEW_SLA_HOURS;
/** Pending rows: hoursWaiting = trading hours since the close (the SLA clock). Reviewed rows keep their real hours. */
function withSlaClock(rows: QueueRow[], closed: ReadonlySet<string>, now = Date.now()): QueueRow[] {
  return rows.map((r) => (r.closedAt ? { ...r, hoursWaiting: tradingHoursBetween(r.closedAt, now, closed) } : r));
}
function serializeQueue(r: QueueRow) {
  const hours = Math.round(Number(r.hoursWaiting) * 10) / 10;
  return {
    id: r.id, trader: r.trader, date: r.date, closedAt: iso(r.closedAt), discipline: r.discipline,
    trades: r.trades, net: r.net == null ? null : Math.round(r.net * 100) / 100,
    hoursWaiting: hours, overdue: hours > SLA_HOURS,
    mood: (r.summary as SummaryT | null)?.mood ?? null,
    /** The trader's note to «Разобрал» (null: none); `via` = how the day was closed. */
    note: r.note ?? null,
    via: isQuickClose(r) ? ("daily" as const) : ("journal" as const),
    reviewedAt: iso(r.reviewedAt), reviewedBy: r.reviewedBy, curatorScore: r.curatorScore,
  };
}

/** Recently reviewed days (last 7 days) — «Проверено» tab of the curator queue. hoursWaiting = closed → reviewed. */
const REVIEWED_SQL = `
  SELECT ${DAY_COLS},
         EXTRACT(EPOCH FROM (d.reviewed_at - d.closed_at)) / 3600 AS "hoursWaiting",
         (SELECT COUNT(*)::int FROM trades t WHERE t.deleted_at IS NULL AND t.trader = d.trader
             AND (LEFT(t.date, 10) = d.date OR ${closeDateSql()} = d.date)) AS trades,
         (SELECT SUM(${netPnlSql()})::float8 FROM trades t WHERE t.deleted_at IS NULL AND t.trader = d.trader
             AND ${closeDateSql()} = d.date AND ${resultSql()} IN ('win','loss','be')) AS net,
         ${NOTE_SQL} AS note
    FROM eod_days d
   WHERE d.closed_at IS NOT NULL AND d.reviewed_at IS NOT NULL AND d.reviewed_at > NOW() - INTERVAL '7 days'`;

router.get("/eod/queue", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) throw unauthorized();
  if (!(await requireCap(req, res, "journal.review", null, "STAFF_ONLY"))) return;
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
  sweepOverdue();
  const roster = await queueRoster(req, req.query.scope);
  const who = `AND ($2::text[] IS NULL OR d.trader = ANY($2::text[]))`;
  const meta = { scope: roster.scope, wards: roster.wards };
  if (req.query.reviewed === "1") {
    const { rows } = await pool.query<QueueRow>(`${REVIEWED_SQL} ${who} ORDER BY d.reviewed_at DESC LIMIT $1`, [limit, roster.traders]);
    res.json({ slaHours: SLA_HOURS, mode: "reviewed", ...meta, items: rows.map(serializeQueue) });
    return;
  }
  const [{ rows }, closed] = await Promise.all([
    pool.query<QueueRow>(`${QUEUE_SQL} ${pendingWindowSql(req.query.old === "1")} ${who} ORDER BY d.closed_at DESC LIMIT $1`, [limit, roster.traders]),
    marketClosedDays(nyDate()),
  ]);
  res.json({ slaHours: SLA_HOURS, mode: "pending", windowDays: QUEUE_DEFAULT_DAYS, ...meta, items: withSlaClock(rows, closed).map(serializeQueue) });
}));

router.get("/eod/queue/count", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) throw unauthorized();
  if (!(await requireCap(req, res, "journal.review", null, "STAFF_ONLY"))) return;
  sweepOverdue();
  const roster = await queueRoster(req, req.query.scope);
  const [{ rows }, closed] = await Promise.all([
    pool.query<{ closedAt: Date }>(
      `SELECT d.closed_at AS "closedAt" FROM eod_days d
        WHERE d.closed_at IS NOT NULL AND d.reviewed_at IS NULL ${pendingWindowSql(req.query.old === "1")}
          AND ($1::text[] IS NULL OR d.trader = ANY($1::text[]))`,
      [roster.traders],
    ),
    marketClosedDays(nyDate()),
  ]);
  const now = Date.now();
  const overdue = rows.filter((r) => tradingHoursBetween(r.closedAt, now, closed) > SLA_HOURS).length;
  res.json({ count: rows.length, overdue, slaHours: SLA_HOURS, scope: roster.scope });
}));

router.post("/eod/days/:id/review", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) throw unauthorized();
  if (!(await requireCap(req, res, "journal.review", null, "STAFF_ONLY"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID");
  const parsed = CuratorReviewBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const existing = await loadDayById(id);
  if (!existing) throw new AppError("EOD_DAY_NOT_FOUND");
  if (!existing.closedAt) throw new AppError("EOD_NOT_CLOSED");
  const { rows } = await pool.query<DayRow>(
    `UPDATE eod_days d SET reviewed_by = $2, reviewed_at = NOW(), curator_comment = $3, curator_score = $4, updated_at = NOW()
      WHERE d.id = $1 RETURNING ${DAY_COLS}`,
    [id, me.name, parsed.data.comment, parsed.data.score],
  );
  // «Следующий» = the next day of the same queue the reader works (their wards by default, ?scope= as in GET /eod/queue).
  const roster = await queueRoster(req, req.query.scope);
  const [{ rows: nextRaw }, closed] = await Promise.all([
    pool.query<QueueRow>(
      `${QUEUE_SQL} ${pendingWindowSql(false)} AND ($1::text[] IS NULL OR d.trader = ANY($1::text[])) ORDER BY d.closed_at DESC LIMIT 1`,
      [roster.traders],
    ),
    marketClosedDays(nyDate()),
  ]);
  const next = withSlaClock(nextRaw, closed);
  // Review done → tell the trader (never the reviewer about their own review).
  const reviewed = rows[0];
  if (reviewed && reviewed.trader !== me.name) {
    const reviewer = me.name;
    inBackground("eod.reviewed", () => notifyUser({
      userName: reviewed.trader, type: "eod_reviewed", actor: reviewer, source: "eod",
      params: {
        date: reviewed.date, score: reviewed.curatorScore ?? null, reviewer,
        comment: reviewed.curatorComment ? textPreview(reviewed.curatorComment, 140) : null,
      },
      link: notifLinks.journalDay(reviewed.date, reviewed.trader), entityType: "eod_day", entityId: reviewed.id,
      telegram: mirrorsToTelegram("eod_reviewed"),
    }));
  }
  // Лента активности: «разобран торговый день». entity_id = «дата|трейдер» — трейдер видит разбор своего дня (owner в /activity).
  if (reviewed) {
    const reviewer = me.name;
    inBackground("eod.reviewed.activity", () => logActivity({
      action: "reviewed", section: "eod", entityId: `${reviewed.date}|${reviewed.trader}`, entityTitle: activityTitle("eod_reviewed", { trader: reviewed.trader, date: reviewed.date }),
      params: { titleKey: "eod_reviewed", trader: reviewed.trader, date: reviewed.date },
      trader: reviewer, details: `${reviewed.curatorScore ?? "—"}/5${reviewed.curatorComment ? ` · ${textPreview(reviewed.curatorComment, 200)}` : ""}`,
    }));
  }
  res.json({ day: serializeDay(rows[0]), next: next[0] ? serializeQueue(next[0]) : null });
}));

export default router;
