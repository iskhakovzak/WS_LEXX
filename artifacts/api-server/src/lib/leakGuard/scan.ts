/**
 * The leak guard scan (job «leakguard.scan», lib/leakGuard/jobDefs.ts): right after every PropReports sync that wrote
 * trades (event «propreports.synced») and every 2 minutes 08:00–16:58 New York on weekdays (risk warn rows come from
 * the positions step without a sync event; a run lost to «already running» is caught up).
 *
 *   1. detect   today's trades + today's warn row + today's auto-rule violations → drafts (detect.ts), only for the
 *               patterns that cost THIS trader money (profile.ts, history cached once per day)
 *   2. ladder   level = per-trader override, else the stage default; off → nothing. Stale / quiet hours / over the
 *               daily cap → recorded silently. Told events notify the trader (soft / firm / hard)
 *   3. steps    firm / hard without the acknowledgement after ackMinutes, or a trade inside the pause → the curator,
 *               once; hard → the risk manager, once (PropReports cannot block orders, people act in the broker platform)
 *   4. settle   finished windows → outcome + saved / lost (any unsettled day, so a missed evening catches up)
 */
import { pool } from "@workspace/db";
import { loadBehaviorRows, rowToBehaviorTrade } from "../../routes/behavior";
import { addDays, nyDate, nyMinutes } from "../tradingDate";
import { isMarketClosed, sessionFor } from "../marketDays";
import { loadEffectiveLimits } from "../riskData";
import { viewerStage } from "../access/stage";
import type { BehaviorTrade } from "../behaviorEngine";
import { currentGuardConfig, profileKey } from "./config";
import { personalProfile, type Trigger } from "./profile";
import { atRiskTrades, detectLive, dueSteps, inQuietHours, levelFor, settle, type StoredEvent } from "./detect";
import { existingKeys, insertEvent, loadLevels, markStep, openEvents, saveSettlement, toldCounts, type GuardEventRow } from "./store";
import { notifyIgnored, notifyRisk, notifyTrader } from "./notify";
import type { GuardConfig, GuardTrade, PersonalProfile, SilentReason } from "./types";

/** Minutes after the close before a day counts as over (late fills of the close are in by then). */
const SETTLE_AFTER_CLOSE_MIN = 30;

export function toGuardTrade(b: BehaviorTrade): GuardTrade {
  return { id: b.id, date: b.date, result: b.result, net: b.net, qty: b.qty, entry: b.entry, entryAt: b.entryAt, exitAt: b.exitAt, horizon: b.horizon };
}

function group<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const l = m.get(k);
    if (l) l.push(it); else m.set(k, [it]);
  }
  return m;
}

async function tradesOfDay(day: string, traders?: string[]): Promise<Map<string, GuardTrade[]>> {
  const rows = await loadBehaviorRows(null, day, day, undefined, traders);
  const out = new Map<string, GuardTrade[]>();
  for (const r of rows) {
    if (!r.trader) continue;
    const l = out.get(r.trader);
    const t = toGuardTrade(rowToBehaviorTrade(r));
    if (l) l.push(t); else out.set(r.trader, [t]);
  }
  return out;
}

// ─── personal profiles: once per day and settings fingerprint ──────────────

let profileCache: { key: string; map: Map<string, PersonalProfile> } | null = null;

/** Active traders with broker trades in the lookback (the first-trade event needs them before they trade today). */
async function activeTraders(from: string): Promise<string[]> {
  const { rows } = await pool.query<{ trader: string }>(
    `SELECT DISTINCT t.trader FROM trades t JOIN users u ON u.name = t.trader
      WHERE t.deleted_at IS NULL AND substring(t.date, 1, 10) >= $1 AND u.active = true AND COALESCE(u.banned, false) = false`,
    [from],
  );
  return rows.map((r) => r.trader);
}

export async function profilesFor(traders: readonly string[], day: string, cfg: GuardConfig): Promise<Map<string, PersonalProfile>> {
  const key = `${day}|${profileKey(cfg)}`;
  if (profileCache?.key !== key) profileCache = { key, map: new Map() };
  const cache = profileCache.map;
  const missing = traders.filter((t) => !cache.has(t));
  if (!missing.length) return cache;
  const from = addDays(day, -cfg.lookbackDays);
  const to = addDays(day, -1);
  const [rows, vio, limits] = await Promise.all([
    loadBehaviorRows(null, from, to, undefined, missing),
    pool.query<{ trader: string; trade_id: number }>(
      `SELECT trader, trade_id FROM rule_violations
        WHERE trader = ANY($1::text[]) AND archived_at IS NULL AND trade_id IS NOT NULL AND day >= $2 AND day <= $3`,
      [missing, from, to],
    ).then((r) => r.rows).catch(() => [] as { trader: string; trade_id: number }[]),
    loadEffectiveLimits(null, day).catch(() => new Map()),
  ]);
  const history = group(rows.filter((r) => r.trader).map((r) => ({ trader: r.trader!, t: toGuardTrade(rowToBehaviorTrade(r)) })), (x) => x.trader);
  const vioBy = group(vio, (v) => v.trader);
  for (const trader of missing) {
    const h = (history.get(trader) ?? []).map((x) => x.t);
    const byId = new Map(h.map((t) => [t.id, t]));
    const violations: Trigger[] = [];
    for (const v of vioBy.get(trader) ?? []) {
      const t = byId.get(Number(v.trade_id));
      if (t?.exitAt != null) violations.push({ day: t.date, at: t.exitAt });
    }
    const daily = limits.get(trader)?.dailyLossLimit ?? null;
    cache.set(trader, personalProfile({ history: h, dailyLimit: daily, violations }, cfg));
  }
  return cache;
}

/** Drop cached profiles (settings saved, tests). */
export function forgetProfiles(): void {
  profileCache = null;
}

// ─── the scan ───────────────────────────────────────────────────────────────

export type ScanResult = { skipped?: string; traders: number; created: number; told: number; escalated: number; riskTold: number; settled: number };

const ms = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

export function storedOf(e: GuardEventRow): StoredEvent {
  const med = e.stats.medianNotional;
  return {
    pattern: e.pattern, day: e.day, triggeredAt: Date.parse(e.triggeredAt), pauseUntil: ms(e.pauseUntil), late: e.late,
    costPerTrigger: e.costPerTrigger, medianNotional: typeof med === "number" ? med : null,
  };
}

async function detectAndStore(day: string, now: Date, today: Map<string, GuardTrade[]>, cfg: GuardConfig, res: ScanResult): Promise<void> {
  const [warnRows, vioRows] = await Promise.all([
    pool.query<{ trader: string; at: Date }>(
      `SELECT trader, MIN(created_at) AS at FROM risk_live_alerts WHERE date = $1 AND threshold IN ('warn', 'stop') GROUP BY trader`, [day],
    ).then((r) => r.rows).catch(() => [] as { trader: string; at: Date }[]),
    pool.query<{ id: number; trader: string; trade_id: number | null; occurred_at: Date }>(
      `SELECT id, trader, trade_id, occurred_at FROM rule_violations WHERE day = $1 AND archived_at IS NULL`, [day],
    ).then((r) => r.rows).catch(() => [] as { id: number; trader: string; trade_id: number | null; occurred_at: Date }[]),
  ]);
  const warnBy = new Map(warnRows.map((r) => [r.trader, new Date(r.at).getTime()]));
  const vioBy = group(vioRows, (v) => v.trader);
  const lookFrom = addDays(day, -cfg.lookbackDays);
  const traders = [...new Set([...today.keys(), ...warnBy.keys(), ...vioBy.keys(), ...(cfg.patterns.first_trade ? await activeTraders(lookFrom) : [])])];
  res.traders = traders.length;
  if (!traders.length) return;
  const [profiles, levels, keys, told] = await Promise.all([profilesFor(traders, day, cfg), loadLevels(), existingKeys(day), toldCounts(day)]);
  const nowMs = now.getTime();
  const nowMin = nyMinutes(now);
  for (const trader of traders) {
    const profile = profiles.get(trader);
    if (!profile || !Object.values(profile).some((s) => s?.costly)) continue;
    const dayTrades = today.get(trader) ?? [];
    const tradeExit = new Map(dayTrades.map((t) => [t.id, t.exitAt]));
    const violations = (vioBy.get(trader) ?? []).map((v) => ({
      id: Number(v.id), tradeId: v.trade_id == null ? null : Number(v.trade_id),
      at: (v.trade_id != null ? tradeExit.get(Number(v.trade_id)) : null) ?? new Date(v.occurred_at).getTime(),
    }));
    const drafts = detectLive({ trader, day, now: nowMs, nowMin, today: dayTrades, profile, cfg, warnAt: warnBy.get(trader) ?? null, violations })
      .filter((d) => !keys.has(`${d.trader}|${d.pattern}|${d.sourceKey}`));
    if (!drafts.length) continue;
    const level = levelFor(await viewerStage(trader), levels.get(trader) ?? null, cfg);
    if (level === "off") continue;
    for (const d of drafts) {
      const n = told.get(trader) ?? 0;
      const silent: SilentReason | null = d.stale ? "stale" : inQuietHours(nowMin, cfg.quiet) ? "quiet" : n >= cfg.maxEventsPerDay ? "cap" : null;
      // The first trade has no pause to put the trader «on»: its strongest step is firm (confirm + curator).
      const row = await insertEvent(d, d.pattern === "first_trade" && level === "hard" ? "firm" : level, silent, nowMs);
      if (!row) continue;
      res.created++;
      if (silent) continue;
      told.set(trader, n + 1);
      await notifyTrader(row, cfg);
      res.told++;
    }
  }
}

async function ladderSteps(day: string, now: Date, today: Map<string, GuardTrade[]>, open: GuardEventRow[], cfg: GuardConfig, res: ScanResult): Promise<void> {
  for (const e of open) {
    if (e.day !== day || e.silentReason || e.releasedAt) continue;
    const stored = storedOf(e);
    const taken = e.pattern !== "first_trade" && !e.late && atRiskTrades(stored, today.get(e.trader) ?? []).length > 0;
    const steps = dueSteps({
      level: e.level, detectedAt: Date.parse(e.detectedAt), ackedAt: ms(e.ackedAt), escalatedAt: ms(e.escalatedAt),
      riskNotifiedAt: ms(e.riskNotifiedAt), ignoredSoFar: taken,
    }, now.getTime(), cfg);
    if (steps.notifyRisk && (await markStep(e.id, "risk_notified_at"))) {
      await notifyRisk(e, cfg);
      res.riskTold++;
    }
    if (steps.escalateCurator && (await markStep(e.id, "escalated_at"))) {
      await notifyIgnored(e, taken ? "traded" : "noAck", cfg);
      res.escalated++;
    }
  }
}

async function settleOpen(day: string, now: Date, today: Map<string, GuardTrade[]>, open: GuardEventRow[], cfg: GuardConfig, res: ScanResult): Promise<void> {
  const session = await sessionFor(day);
  const todayOver = session.closed || nyMinutes(now) >= session.closeMin + SETTLE_AFTER_CLOSE_MIN;
  const pastDays = [...new Set(open.filter((e) => e.day < day).map((e) => e.day))];
  const past = new Map<string, Map<string, GuardTrade[]>>();
  for (const d of pastDays) past.set(d, await tradesOfDay(d, [...new Set(open.filter((e) => e.day === d).map((e) => e.trader))]));
  for (const e of open) {
    const trades = (e.day === day ? today : past.get(e.day))?.get(e.trader) ?? [];
    const s = settle(storedOf(e), trades, now.getTime(), e.day < day || todayOver, cfg);
    if (!s) continue;
    await saveSettlement(e.id, s);
    res.settled++;
  }
}

export async function runLeakGuardScan(now: Date = new Date()): Promise<ScanResult> {
  const res: ScanResult = { traders: 0, created: 0, told: 0, escalated: 0, riskTold: 0, settled: 0 };
  const cfg = currentGuardConfig();
  const day = nyDate(now);
  const closed = await isMarketClosed(day);
  const today = closed ? new Map<string, GuardTrade[]>() : await tradesOfDay(day);
  if (cfg.enabled && !closed) await detectAndStore(day, now, today, cfg, res);
  const open = await openEvents();
  if (cfg.enabled && !closed) await ladderSteps(day, now, today, open, cfg, res);
  await settleOpen(day, now, today, open, cfg, res);
  if (!cfg.enabled) res.skipped = "disabled";
  else if (closed) res.skipped = "market closed";
  return res;
}
