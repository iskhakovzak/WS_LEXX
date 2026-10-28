/**
 * Live leak guard (lib/leakGuard/*, migration 0267).
 *
 *   GET  /leak-guard/me/active                  the caller's events to show now (banner / countdown / acknowledgement)
 *   POST /leak-guard/events/:id/ack             the trader acknowledges their own firm / hard event (logged time)
 *   GET  /leak-guard/impact?trader=&days=       own, or staff with risk.read.team: «сэкономлено / потеряно» over the
 *                                               period, per pattern and week, the personal pattern numbers, the level
 *   GET  /leak-guard/desk?days=                 risk.read.team: active pauses, per-trader impact, levels
 *   PUT  /leak-guard/levels/:trader             risk.limits.edit — { level: off|soft|firm|hard|null } (null = stage default),
 *                                               audited «leakGuard.level»
 *   POST /leak-guard/events/:id/release         risk.limits.edit — end a pause early, audited «leakGuard.release»
 * GET never writes. PropReports cannot block orders: «hard» marks the trader on pause and tells the risk manager.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { personalTrader } from "../lib/auth";
import { resolveActor } from "../lib/permissions";
import { AppError, assertCap, idParam, notFound, route, unauthorized } from "../lib/http";
import { addDays, nyDate } from "../lib/tradingDate";
import { viewerStage } from "../lib/access/stage";
import { currentGuardConfig } from "../lib/leakGuard/config";
import { levelFor } from "../lib/leakGuard/detect";
import { summarize, type ImpactEvent } from "../lib/leakGuard/impact";
import { profilesFor } from "../lib/leakGuard/scan";
import { ackEvent, activeEvents, eventById, listEvents, loadLevels, releaseEvent, setLevel, type GuardEventRow } from "../lib/leakGuard/store";
import { LEVEL_CHOICES } from "../lib/leakGuard/types";

const router: IRouter = Router();

const Days = z.coerce.number().int().min(5).max(365).default(60);

const lagOf = (e: GuardEventRow): number | null =>
  e.pattern === "first_trade" ? null : Math.round((Date.parse(e.detectedAt) - Date.parse(e.triggeredAt)) / 1000);

const impactOf = (e: GuardEventRow): ImpactEvent => ({ day: e.day, pattern: e.pattern, outcome: e.outcome, saved: e.saved, lost: e.lost, lagSec: lagOf(e) });

/** What the client shows of one event (no internal ids beyond the event's own). */
function shown(e: GuardEventRow) {
  return {
    id: e.id, day: e.day, pattern: e.pattern, level: e.level, triggeredAt: e.triggeredAt, detectedAt: e.detectedAt, pauseUntil: e.pauseUntil,
    late: e.late, silentReason: e.silentReason, costPerTrade: e.costPerTrade, costPerTrigger: e.costPerTrigger,
    minutes: typeof e.stats.minutes === "number" ? e.stats.minutes : null, ackedAt: e.ackedAt, escalatedAt: e.escalatedAt,
    riskNotifiedAt: e.riskNotifiedAt, releasedAt: e.releasedAt, releasedBy: e.releasedBy, outcome: e.outcome, outcomeNet: e.outcomeNet,
    saved: e.saved, lost: e.lost, atRiskTradeIds: e.atRiskTradeIds, lagSec: lagOf(e),
    // Rule patterns (lib/leakGuard/rules.ts): the ticker of a ticker-scoped stop, the entry count, the $ limit.
    ticker: typeof e.stats.ticker === "string" ? e.stats.ticker : null,
    entries: typeof e.stats.entries === "number" ? e.stats.entries : null,
    limitUsd: typeof e.stats.limit === "number" ? e.stats.limit : null,
  };
}

router.get("/leak-guard/me/active", route({}, async ({ req }) => {
  if (!req.authUser) throw unauthorized();
  const actor = await resolveActor(req);
  if (!actor || actor.guest) return { now: new Date().toISOString(), events: [] };
  const events = await activeEvents(actor.name, nyDate());
  return { now: new Date().toISOString(), events: events.map(shown) };
}));

router.post("/leak-guard/events/:id/ack", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  const row = await ackEvent(params.id, actor.name);
  if (!row) throw notFound();
  return shown(row);
}));

router.get("/leak-guard/impact", route({
  query: z.object({ trader: z.string().trim().max(120).optional(), days: Days }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "risk.read.team");
  const cfg = currentGuardConfig();
  const to = nyDate();
  const from = addDays(to, -query.days);
  const [events, profiles, levels, stage] = await Promise.all([
    listEvents(trader, from, to), profilesFor([trader], to, cfg), loadLevels(), viewerStage(trader),
  ]);
  const override = levels.get(trader) ?? null;
  return {
    trader, from, to, enabled: cfg.enabled,
    level: { effective: levelFor(stage, override, cfg), override, stage, stageDefault: cfg.levelByStage[stage] },
    summary: summarize(events.map(impactOf)),
    patterns: Object.values(profiles.get(trader) ?? {}),
    settings: { pauseMinutes: cfg.pauseMinutes, violationPauseMinutes: cfg.violationPauseMinutes, nearStopPauseMinutes: cfg.nearStopPauseMinutes, firstTradeSizeRatio: cfg.firstTradeSizeRatio },
    recent: events.slice(0, 40).map(shown),
  };
}));

router.get("/leak-guard/desk", route({ cap: "risk.read.team", query: z.object({ days: Days }) }, async ({ query }) => {
  const cfg = currentGuardConfig();
  const to = nyDate();
  const from = addDays(to, -query.days);
  const [events, levels] = await Promise.all([listEvents(null, from, to, 5000), loadLevels()]);
  const now = Date.now();
  // On pause now: firm / hard pauses still running (the first-trade event has no pause, it is not listed).
  const active = events.filter((e) => e.day === to && !e.silentReason && !e.releasedAt && (e.level === "hard" || e.level === "firm")
    && e.pauseUntil != null && Date.parse(e.pauseUntil) > now);
  const names = [...new Set([...events.map((e) => e.trader), ...levels.keys()])].sort((a, b) => a.localeCompare(b));
  const traders = await Promise.all(names.map(async (trader) => {
    const own = events.filter((e) => e.trader === trader);
    const stage = await viewerStage(trader);
    const override = levels.get(trader) ?? null;
    return {
      trader, stage, override, level: levelFor(stage, override, cfg),
      today: own.filter((e) => e.day === to).length,
      summary: summarize(own.map(impactOf)),
    };
  }));
  return { day: to, from, enabled: cfg.enabled, levelByStage: cfg.levelByStage, active: active.map((e) => ({ trader: e.trader, ...shown(e) })), traders, desk: summarize(events.map(impactOf)) };
}));

router.put("/leak-guard/levels/:trader", route({
  cap: "risk.limits.edit",
  params: z.object({ trader: z.string().trim().min(1).max(120) }),
  body: z.object({ level: z.enum(LEVEL_CHOICES).nullable() }),
}, async ({ req, params, body }) => {
  const actor = await assertCap(req, "risk.limits.edit", { trader: params.trader });
  const level = await setLevel(params.trader, body.level, actor.name);
  return { trader: params.trader, override: level };
}));

router.post("/leak-guard/events/:id/release", route({ cap: "risk.limits.edit", params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const e = await eventById(params.id);
  if (!e) throw notFound();
  const actor = await assertCap(req, "risk.limits.edit", { trader: e.trader });
  const row = await releaseEvent(params.id, actor.name);
  return shown(row ?? e);
}));

export default router;
