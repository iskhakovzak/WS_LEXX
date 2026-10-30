/**
 * Live in-session risk signals (lib/riskSignals/*, migration 0291).
 *
 *   GET  /risk-signals/me?trader=              own (or staff with risk.read.team): today's alerts, newest first — the
 *                                              dashboard strip polls it every few seconds in the session
 *   POST /risk-signals/:id/seen                the trader closes their own alert in the strip (seen_at)
 *   GET  /risk-signals/desk?day=               risk.read.team: the day's alerts across the desk
 *   GET  /risk-signals/saved?period=           risk.read.team: «desk saved» estimate vs the traders' own history —
 *                                              day | week | month; sample sizes; hidden below the desk minimum
 * GET never writes. Alerts are created only by the scan (job «risksignals.scan»).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { personalTrader } from "../lib/auth";
import { resolveActor } from "../lib/permissions";
import { AppError, idParam, notFound, route, unauthorized } from "../lib/http";
import { nyDate } from "../lib/tradingDate";
import { weekStart } from "../lib/riskMetrics";
import { currentSignalConfig } from "../lib/riskSignals/config";
import { summarizeSaved } from "../lib/riskSignals/saved";
import { alertsBetween, alertsOfDay, markSeen, type AlertRow } from "../lib/riskSignals/store";

const router: IRouter = Router();

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

function shown(a: AlertRow) {
  return {
    id: a.id, trader: a.trader, day: a.day, signal: a.signal, level: a.level, severity: a.severity, tradeId: a.tradeId,
    triggeredAt: a.triggeredAt, detectedAt: a.detectedAt, stats: a.stats, staffNotified: a.staffNotifiedAt != null, seenAt: a.seenAt,
    settled: a.settledAt != null, restNet: a.restNet, baselineRest: a.baselineRest, baselineN: a.baselineN, saved: a.saved,
  };
}

router.get("/risk-signals/me", route({ query: z.object({ trader: z.string().trim().max(120).optional() }) }, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "risk.read.team");
  const day = nyDate();
  const alerts = await alertsOfDay(day, trader);
  return { trader, day, now: new Date().toISOString(), enabled: currentSignalConfig().enabled, alerts: alerts.map(shown) };
}));

router.post("/risk-signals/:id/seen", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  const row = await markSeen(params.id, actor.name);
  if (!row) throw notFound();
  return shown(row);
}));

router.get("/risk-signals/desk", route({ cap: "risk.read.team", query: z.object({ day: Day }) }, async ({ query }) => {
  const day = query.day ?? nyDate();
  const alerts = await alertsOfDay(day, null);
  return { day, now: new Date().toISOString(), enabled: currentSignalConfig().enabled, alerts: alerts.map(shown) };
}));

const PERIODS = ["day", "week", "month"] as const;

router.get("/risk-signals/saved", route({ cap: "risk.read.team", query: z.object({ period: z.enum(PERIODS).default("week") }) }, async ({ query }) => {
  const to = nyDate();
  const from = query.period === "day" ? to : query.period === "week" ? weekStart(to) : `${to.slice(0, 7)}-01`;
  const alerts = await alertsBetween(from, to, null);
  const summary = summarizeSaved(alerts.map((a) => ({ day: a.day, signal: a.signal, settled: a.settledAt != null, saved: a.saved, cases: a.baselineN })));
  return { period: query.period, from, to, minSample: currentSignalConfig().savedMinSample, ...summary };
}));

export default router;
