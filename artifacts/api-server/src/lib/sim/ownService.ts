/**
 * Simulator own mode («Мои худшие дни») — picks one of the VIEWER'S OWN losing trades with archived bars, builds the
 * game (own.ts) and stores it as an ordinary sim game (mode 'intraday' in the table; the marker is params.own — see
 * store.ts). Everything after creation (steps, undo, finish, reveal) is the shared service.ts path.
 *
 *   GET  /api/sim/own/candidates   the viewer's replayable losses (newest mistakes first in the UI)
 *   POST /api/sim/own              {pick: worst | random | trade, tradeId?}
 *
 * Privacy: candidates and trades are read by the viewer's own trader name only (ownStore.ts); staff get no other
 * trader's days here.
 *
 * The gap + catalyst day rule (lib/sim/catalyst.ts, owner 2026-10-25) does NOT apply here: «Мои дни» replays the
 * player's own losing trade, whatever the day was — filtering by gap would hide most of the trader's real mistakes,
 * and nothing is secret (the player knows the ticker and the date). The game still gets «Контекст дня» (context.ts).
 *
 * Trainer eligibility (lib/trainer/eligibility.ts): a trade with a fill at 15:50–16:00 NY, held < 25 min or with a
 * fill without a time is never offered, nor is any trade on a ticker-day the desk traded in the closing auction.
 */
import { notFound } from "../http";
import { logger } from "../logger";
import { addDays, nyDate } from "../tradingDate";
import { mistakesByTrade } from "../daily/service";
import { aggregate, fakeTimes, maxNotionalOf, tfSec, type IntradayTf } from "./scenario";
import {
  OWN_WINDOW_DAYS, buildOwn, feePerShareOf, netOf, ownParamsOf, pickOrder, realMistakes, realStructure, riskOf,
  type OwnBuilt, type OwnCandidate, type OwnPick, type OwnTradeRow,
} from "./own";
import * as store from "./store";
import * as ownStore from "./ownStore";
import { eligibleTrades } from "../trainer/eligibility";
import { blockedTickerDays } from "../trainer/eligibilityStore";
import { lastPlayableDay, newGameExtras, remember, settleActive, snapshotOf, type Snapshot, type Viewer } from "./service";

/** Mistake ids lib/daily attributes to each trade (every hit of the window, not only the top examples of each mistake;
 *  empty while the daily engine has nothing; never fails the game). */
async function dailyMistakesByTrade(trader: string, from: string, to: string): Promise<Map<number, string[]>> {
  try {
    return await mistakesByTrade(trader, from, to);
  } catch (err) {
    logger.warn({ err }, "sim own: daily mistakes unavailable");
    return new Map();
  }
}

const firstLast = (t: OwnTradeRow): { first: number; last: number } | null => {
  const ts = t.execs.map((e) => (e.at ? Date.parse(e.at) / 1000 : NaN)).filter(Number.isFinite);
  return ts.length ? { first: Math.min(...ts), last: Math.max(...ts) } : null;
};

/**
 * The game of one trade on `want` (null = the archived bar size). A day archived only at 5m plays at 5m whatever was
 * asked (a finer bar cannot be made up); 2m and 5m are aggregated from archived 1m bars.
 */
async function build(t: OwnTradeRow, want: IntradayTf | null): Promise<OwnBuilt | null> {
  const fl = firstLast(t);
  if (!fl) return null;
  const data = await store.loadDayBars(t.ticker, t.day);
  if (!data || (data.tf !== "1m" && data.tf !== "5m")) return null;
  const tf: IntradayTf = data.tf === "5m" ? "5m" : want ?? "1m";
  const sec = tfSec(tf);
  const prev = await store.loadPrevDay(t.ticker, t.day, sec);
  // Aggregating bars already at `sec` (a 5m archive day) is a no-op, so 1m and 5m sources go through the same path.
  const at = (bars: typeof data.bars) => (sec === 60 ? bars : aggregate(bars, sec));
  const built = buildOwn({ day: t.day, tf, dayBars: at(data.bars), prevBars: at(prev?.bars ?? []), prevLevels: prev?.levels ?? null, firstAt: fl.first, lastAt: fl.last });
  if (built && built.levels.pdc == null && data.prevClose != null) built.levels.pdc = data.prevClose;
  return built;
}

export type OwnCandidateView = {
  tradeId: number; ticker: string; date: string; side: "long" | "short"; net: number; r: number | null; mistakes: string[]; played: boolean;
};
export type OwnCandidatesView = {
  trades: OwnCandidateView[];
  /** What POST /sim/own {pick: "worst"} creates now (the same order and the same «played» set). */
  worst: number | null;
  windowDays: number;
  /** The viewer's unfinished own game (POST /sim/own settles it first): the card offers to continue it. */
  active: { gameId: number; tradeId: number | null; ticker: string; date: string } | null;
};

function viewOf(t: OwnTradeRow, mistakes: string[], played: boolean): OwnCandidateView {
  const { side, stats, maxQty } = realStructure(t);
  const risk = riskOf(t, maxQty, stats.avgEntry, 0);
  const net = netOf(t);
  return { tradeId: t.id, ticker: t.ticker, date: t.day, side, net, r: risk.source === "atr" ? null : Math.round((net / risk.usd) * 100) / 100, mistakes, played };
}

/** Own losses that pass the trainer eligibility rule (one filter for the list, the count and every pick). */
async function eligibleOwn(rows: OwnTradeRow[]): Promise<OwnTradeRow[]> {
  if (!rows.length) return rows;
  const blocked = await blockedTickerDays();
  return eligibleTrades(rows, (t) => ({ ticker: t.ticker, day: t.day, executions: t.execs.map((e) => ({ at: e.at })) }), blocked);
}

async function loadCandidates(viewer: Viewer) {
  const lastDay = lastPlayableDay();
  const rows = await eligibleOwn(await ownStore.ownCandidates(viewer.name, lastDay));
  const daily = rows.length ? await dailyMistakesByTrade(viewer.name, addDays(lastDay, -90), lastDay) : new Map<number, string[]>();
  const mistakes = new Map(rows.map((r) => [r.id, [...new Set([...realMistakes(r), ...(daily.get(r.id) ?? [])])]]));
  return { lastDay, rows, mistakes };
}

const asCandidate = (t: OwnTradeRow, mistakes: string[]): OwnCandidate => {
  const v = viewOf(t, mistakes, false);
  return { id: t.id, day: t.day, net: v.net, riskUsd: v.r != null && v.r !== 0 ? Math.abs(v.net / v.r) : null, mistakes };
};

/** The viewer's replayable losses, newest first, and which one «my worst of the last 30 days» would open. */
export async function ownCandidates(viewer: Viewer): Promise<OwnCandidatesView> {
  const [{ lastDay, rows, mistakes }, played, active] = await Promise.all([
    loadCandidates(viewer), ownStore.playedOwnTrades(viewer.id), ownStore.activeOwnGame(viewer.id),
  ]);
  const order = pickOrder(rows.map((r) => asCandidate(r, mistakes.get(r.id) ?? [])), "worst", played, lastDay, addDays(lastDay, -OWN_WINDOW_DAYS));
  const trades = rows
    .map((r) => viewOf(r, mistakes.get(r.id) ?? [], played.has(r.id)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.net - b.net);
  return { trades, worst: order[0]?.id ?? null, windowDays: OWN_WINDOW_DAYS, active };
}

/** How many replayable losses the viewer has (the trainer home «Мои дни» count) — the same eligible list. */
export async function ownCandidateCount(viewer: Viewer): Promise<number> {
  return (await eligibleOwn(await ownStore.ownCandidates(viewer.name, lastPlayableDay()))).length;
}

export async function createOwnGame(
  viewer: Viewer, pick: OwnPick, tradeId: number | null, rnd: () => number = Math.random, tf: IntradayTf | null = null,
): Promise<Snapshot> {
  // «Played» is read BEFORE the unfinished game is settled: settling an untouched game abandons it, and an abandoned
  // game does not count as played — the new game would then open that same trade instead of the card's «next».
  const playedBefore = await ownStore.playedOwnTrades(viewer.id);
  await settleActive(viewer);
  let chosen: { t: OwnTradeRow; built: OwnBuilt; mistakes: string[] } | null = null;
  if (pick === "trade") {
    const lastDay = lastPlayableDay();
    const found = tradeId != null ? await ownStore.ownTrade(viewer.name, lastDay, tradeId) : null;
    const [t] = found ? await eligibleOwn([found]) : [];
    if (!t) throw notFound("TRADE_NOT_FOUND", { reason: "notReplayable" });
    const built = await build(t, tf);
    if (!built) throw notFound("NOT_FOUND", { reason: "noBars" });
    const daily = await dailyMistakesByTrade(viewer.name, t.day, t.day);
    chosen = { t, built, mistakes: [...realMistakes(t), ...(daily.get(t.id) ?? [])] };
  } else {
    const { lastDay, rows, mistakes } = await loadCandidates(viewer);
    if (!rows.length) throw notFound("NOT_FOUND", { reason: "noOwnTrades" });
    const order = pickOrder(rows.map((r) => asCandidate(r, mistakes.get(r.id) ?? [])), pick, playedBefore, lastDay, addDays(lastDay, -OWN_WINDOW_DAYS), rnd);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const c of order.slice(0, 6)) {
      const t = byId.get(c.id)!;
      const built = await build(t, tf);
      if (built) { chosen = { t, built, mistakes: mistakes.get(t.id) ?? [] }; break; }
    }
    if (!chosen) throw notFound("NOT_FOUND", { reason: "noBars" });
  }
  const { t, built } = chosen;
  const own = ownParamsOf(t, built, pick, chosen.mistakes);
  const price = built.bars[built.decisionIdx].c;
  const realUnit = own.riskSource === "atr" ? null : own.riskUsd / own.maxQty;
  // 1R of an own replay = the real trade's risk (so a risk-sized order matches the real size at the real stop).
  const extras = await newGameExtras(viewer, price, built.bars, t.day, own.riskSource === "atr" ? null : own.riskUsd);
  const g = await store.insertGame({
    userId: viewer.id, mode: "intraday", difficulty: "medium", ticker: t.ticker, day: t.day, dayTo: null, tf: built.tf,
    bars: built.bars, startIdx: built.startIdx, endIdx: built.endIdx, cursor: built.startIdx,
    params: {
      feePerShare: feePerShareOf(t, own.maxQty) ?? (await store.deskFeePerShare(nyDate())),
      riskUnit: realUnit != null && realUnit >= 0.01 ? Math.round(realUnit * 10000) / 10000 : built.atrUnit,
      defaultQty: own.maxQty,
      maxNotional: Math.max(maxNotionalOf("intraday"), Math.ceil(own.maxQty * price * 2)),
      levels: built.levels,
      times: fakeTimes(built.bars, "intraday"),
      own,
      ...extras,
    },
  });
  return snapshotOf(remember(g), viewer);
}
