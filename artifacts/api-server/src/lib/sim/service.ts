/**
 * Simulator service: picks a fair scenario, runs the game one request at a time and builds what the player may see.
 *
 * No-leak rules (tests: lib/__tests__/simNoLeak.test.ts):
 *   - a snapshot of an active game carries bars [0 … cursor] only, with fake times, and no ticker / date / real time;
 *   - state numbers come from engine.simulate over bars ≤ cursor;
 *   - the reveal (ticker, dates, real times, desk trades, mistakes judged with later bars) exists only once the game
 *     is finished, and the bars served then never go past the game's last bar.
 * One request per game at a time (in-process lock), so a burst of key presses cannot interleave two steps.
 */
import { badRequest, conflict, notFound } from "../http";
import { nyDate, addDays } from "../tradingDate";
import { netPnl, signedR } from "../tradeMath";
import { canSeeTradeMoney } from "../playbookPrivacy";
import { orderDelta, resultOf, simulate, type OrderKind, type SimConfig, type SimEvent, type SimFill, type SimResult, type SimState, type SimTrade } from "./engine";
import {
  defaultQty, displayTfsOf, fakeTimes, judgeOpts, maxNotionalOf, tfSec, toWire,
  type Difficulty, type DisplayTf, type IntradayTf, type Levels, type SimMode, type SimTf, type WireBar,
} from "./scenario";
import * as store from "./store";
import type { GameRow } from "./store";
import { pickScenario } from "./pick";
import { findEvent, type MarketEvent } from "./events";
import type { NoTradeVerdict } from "./noTrade";
import { seriesStateOf, type SeriesState } from "./seriesStore";
import { compareOwn, publicOf, type OwnPublic, type OwnReveal } from "./own";
import { dayVolume, marketPx, newGameExec, publicExec, riskQty, type ExecModel } from "./exec";
import { setting } from "../settings/registry";

export type Viewer = { id: number; name: string; staff: boolean };

/* ─────────────────────────── Cache + lock ─────────────────────────── */

const CACHE_MAX = 300;
const cache = new Map<number, GameRow>();
const locks = new Map<number, Promise<unknown>>();

export function remember(g: GameRow): GameRow {
  cache.delete(g.id);
  cache.set(g.id, g);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as number);
  return g;
}

export function withLock<T>(id: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(id, tail);
  void tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return run;
}

/** The viewer's game (a prepared series game is not theirs to see until «next» deals it). */
export async function ownGame(viewer: Viewer, id: number): Promise<GameRow> {
  const g = cache.get(id) ?? (await store.loadGame(id));
  if (!g || g.userId !== viewer.id || g.status === "prepared") throw notFound("NOT_FOUND");
  return remember(g);
}

/** For tests: forget cached games. */
export function _resetSimCache(): void { cache.clear(); locks.clear(); }

/* ─────────────────────────── Scenario picking: pick.ts ─────────────────────────── */

export { lastPlayableDay } from "./pick";

/* ─────────────────────────── Views ─────────────────────────── */

export function cfgOf(g: GameRow): SimConfig {
  return {
    startIdx: g.startIdx, endIdx: g.endIdx, feePerShare: g.params.feePerShare, riskUnit: g.params.riskUnit, exec: g.params.exec ?? null,
    ...(g.params.intrabar ? { intrabar: true } : {}),
  };
}

/** Bar size of the stored series (finer than the display tf on «Тренажёр 2» free games). */
export const baseTfOf = (g: GameRow): SimTf => g.params.baseTf ?? g.tf;

/** 1R ($) of a game for risk-sized orders: frozen at creation; older games use the desk fallback. */
export const oneROf = (g: GameRow): number => (g.params.oneR != null && g.params.oneR > 0 ? g.params.oneR : setting("trainer.oneRUsd"));

/** Execution model and 1R a new game freezes (the play day's volume drives the low-ADV spread). */
export async function newGameExtras(viewer: Viewer, price: number, dayBars: readonly { t: number; v: number }[], day: string, oneR?: number | null) {
  const vol = dayVolume(dayBars.filter((b) => nyDate(new Date(b.t * 1000)) === day));
  const exec: ExecModel | null = newGameExec(price, vol > 0 ? vol : null);
  const r = oneR != null && oneR > 0 ? oneR : (await store.oneRUsdOf(viewer.name, nyDate())) ?? setting("trainer.oneRUsd");
  return { exec, oneR: Math.round(r * 100) / 100 };
}

export type PublicState = {
  pos: number; avg: number | null; stop: number | null; target: number | null;
  realized: number; fees: number; unrealized: number; net: number;
  fills: SimFill[]; trades: SimTrade[]; canUndo: boolean;
};

function lastReq(g: GameRow): number | null {
  const e = g.events[g.events.length - 1];
  return e && e.idx === g.cursor && !(e.type === "order" && e.auto) ? e.req ?? null : null;
}

function publicState(g: GameRow, s: SimState): PublicState {
  return {
    pos: s.pos, avg: s.avg, stop: s.stop, target: s.target, realized: s.realized, fees: s.fees, unrealized: s.unrealized, net: s.net,
    fills: s.fills, trades: s.trades, canUndo: g.status === "active" && lastReq(g) != null,
  };
}

export type DeskFill = { idx: number; price: number; side: "in" | "out" };
export type DeskTrader = {
  key: string;
  /** Real name for staff and for the viewer's own trades; null ⇒ shown as «Trader {label}». */
  name: string | null;
  label: string;
  own: boolean;
  trades: { side: "long" | "short"; r: number | null; perShare: number | null; net: number | null; fills: DeskFill[] }[];
};
export type DeskView = { traders: DeskTrader[]; outside: number; intradayCount: number | null };

export type Reveal = {
  ticker: string;
  longName: string | null;
  day: string;
  dayTo: string | null;
  /** Real epoch seconds of every bar (the axis switches to real time after the reveal). */
  realTimes: number[];
  result: SimResult & { equity: number[] };
  desk: DeskView;
  /** Own mode («Мои худшие дни»): the real trade next to the sim decision. */
  own: OwnReveal | null;
};

export type Snapshot = {
  id: number;
  mode: SimMode;
  difficulty: Difficulty;
  tf: SimTf;
  status: GameRow["status"];
  startIdx: number;
  endIdx: number;
  cursor: number;
  feePerShare: number;
  riskUnit: number;
  defaultQty: number;
  maxNotional: number;
  levels: Levels;
  bars: WireBar[];
  state: PublicState;
  createdAt: string;
  reveal: Reveal | null;
  /** Own mode: the player's own trade (ticker and date are not secret there) and the bar where they really entered. */
  own: OwnPublic | null;
  /** Spread / slippage model of this game ($ per share paid by a market order; full spread); null on older games. */
  slippage: { perShare: number; spread: number } | null;
  /** 1R in $ used by risk-sized orders (step order.sizeMode "risk"). */
  oneR: number;
  /** «Тренажёр» mode of the game when it is not a plain free game. */
  trainer: { mode: "daily"; date: string } | null;
  /** Bar size of `bars` / cursor / indexes / step advance; `tf` is the default display timeframe. */
  baseTf: SimTf;
  /** Timeframes the client may aggregate the base bars into (key order). */
  displayTfs: DisplayTf[];
  /** Series game: the series and the 0-based position in it. */
  series: { id: number; index: number; size: number } | null;
  /** Finished through «Не торгую»: the verdict. */
  noTrade: NoTradeVerdict | null;
};

export async function snapshotOf(g: GameRow, viewer: Viewer): Promise<Snapshot> {
  const s = simulate(g.bars, cfgOf(g), g.events, g.cursor);
  return {
    id: g.id, mode: g.mode, difficulty: g.difficulty, tf: g.tf, status: g.status,
    startIdx: g.startIdx, endIdx: g.endIdx, cursor: g.cursor,
    feePerShare: g.params.feePerShare, riskUnit: g.params.riskUnit, defaultQty: g.params.defaultQty, maxNotional: g.params.maxNotional,
    levels: g.params.levels,
    bars: toWire(g.bars, g.params.times, 0, g.cursor),
    state: publicState(g, s),
    createdAt: g.createdAt,
    reveal: g.status === "finished" ? await revealOf(g, viewer) : null,
    own: g.params.own ? publicOf(g.params.own) : null,
    slippage: publicExec(g.params.exec),
    oneR: oneROf(g),
    trainer: g.params.daily ? { mode: "daily", date: g.params.daily.date } : null,
    baseTf: baseTfOf(g),
    displayTfs: displayTfsOf(baseTfOf(g)),
    series: g.params.series ? { id: g.params.series.id, index: g.params.series.index, size: g.params.series.size } : null,
    noTrade: ((g.result as { noTrade?: NoTradeVerdict } | null)?.noTrade) ?? null,
  };
}

function idxForTime(g: GameRow, epoch: number): number | null {
  const sec = tfSec(baseTfOf(g));
  let lo = 0, hi = g.endIdx, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (g.bars[mid].t <= epoch) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0) return null;
  return epoch < g.bars[ans].t + sec ? ans : null;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export async function deskViewOf(g: GameRow, viewer: Viewer): Promise<DeskView> {
  const intraday = g.mode === "intraday";
  const all = intraday ? await store.deskTradesForDay(g.ticker, g.day) : await store.deskTradesForRange(g.ticker, g.day, g.dayTo ?? g.day);
  // Own mode shows the player's own trades only (the desk's day is /desk-day, with its own privacy rules).
  const rows = g.params.own ? all.filter((r) => r.trader === viewer.name) : all;
  const byTrader = new Map<string, DeskTrader>();
  let outside = 0;
  let letter = 0;
  const dateIdx = new Map<string, number>();
  if (!intraday) g.bars.forEach((b, i) => { if (i <= g.endIdx) dateIdx.set(new Date(b.t * 1000).toISOString().slice(0, 10), i); });
  const dateToIdx = (d: string | null): number | null => {
    if (!d) return null;
    const k = d.slice(0, 10);
    if (dateIdx.has(k)) return dateIdx.get(k)!;
    let best: number | null = null;
    for (const [day, i] of dateIdx) if (day >= k && (best == null || i < best)) best = i;
    return best;
  };
  for (const row of rows) {
    const own = row.trader === viewer.name;
    let t = byTrader.get(row.trader);
    if (!t) {
      if (byTrader.size >= 15) continue;
      const label = own ? "" : LETTERS[letter++ % LETTERS.length];
      t = { key: own ? "me" : viewer.staff ? row.trader : label, name: own || viewer.staff ? row.trader : null, label, own, trades: [] };
      byTrader.set(row.trader, t);
    }
    if (t.trades.length >= 10) continue;
    const side: "long" | "short" = String(row.side ?? "").toLowerCase().startsWith("s") ? "short" : "long";
    const dir = side === "long" ? 1 : -1;
    const fills: DeskFill[] = [];
    if (intraday) {
      for (const e of row.execs) {
        const at = e.at ? Date.parse(e.at) / 1000 : NaN;
        const idx = Number.isFinite(at) ? idxForTime(g, at) : null;
        if (idx == null) { outside++; continue; }
        const opening = e.kind === "entry" || e.kind === "add";
        fills.push({ idx, price: Number(e.price), side: opening ? "in" : "out" });
      }
    } else {
      const ei = dateToIdx(row.date);
      const xi = dateToIdx(row.exit_date);
      if (ei != null && row.entry != null) fills.push({ idx: ei, price: Number(row.entry), side: "in" });
      else outside++;
      if (xi != null && row.exit != null) fills.push({ idx: xi, price: Number(row.exit), side: "out" });
    }
    const entry = Number(row.entry), exit = Number(row.exit);
    const perShare = Number.isFinite(entry) && Number.isFinite(exit) && row.entry != null && row.exit != null ? Math.round((exit - entry) * dir * 10000) / 10000 : null;
    t.trades.push({
      side,
      r: signedR(row),
      perShare,
      net: canSeeTradeMoney({ name: viewer.name, staff: viewer.staff }, row.trader) ? netPnl(row) : null,
      fills,
    });
  }
  const traders = [...byTrader.values()].sort((a, b) => Number(b.own) - Number(a.own));
  const intradayCount = !intraday && rows.length === 0 ? await store.deskIntradayCount(g.ticker, g.day, g.dayTo ?? g.day) : null;
  return { traders, outside, intradayCount };
}

async function revealOf(g: GameRow, viewer: Viewer): Promise<Reveal> {
  const s = simulate(g.bars, cfgOf(g), g.events, g.endIdx);
  const result = (g.result as (SimResult & { equity: number[] }) | null) ?? { ...resultOf(g.bars, cfgOf(g), s, { baseQty: g.params.defaultQty, ...judgeOpts(g.mode, baseTfOf(g)) }), equity: s.equity };
  return {
    ticker: g.ticker,
    longName: g.params.longName ?? (await store.longNameOf(g.ticker)),
    day: g.day,
    dayTo: g.dayTo,
    realTimes: g.bars.slice(0, g.endIdx + 1).map((b) => b.t),
    result,
    desk: await deskViewOf(g, viewer),
    own: g.params.own ? { ...g.params.own, compare: (result as { own?: OwnReveal["compare"] }).own ?? compareOwn(g.params.own, result) } : null,
  };
}

/* ─────────────────────────── Commands ─────────────────────────── */

/** Settle the viewer's unfinished game before a new one starts. */
export async function settleActive(viewer: Viewer): Promise<void> {
  const prevId = await store.activeGameId(viewer.id);
  if (prevId != null) await withLock(prevId, () => settle(viewer, prevId));
}

/** `tf` (intraday only): play the level on another timeframe (1m / 2m / 5m); null = the level's own. */
export async function createGame(
  viewer: Viewer, mode: SimMode, difficulty: Difficulty, rnd: () => number = Math.random, tf: IntradayTf | null = null,
): Promise<Snapshot> {
  await settleActive(viewer);
  const g = await insertNewGame(viewer, mode, difficulty, rnd, tf);
  if (!g) throw notFound("NOT_FOUND");
  return snapshotOf(g, viewer);
}

/** Pick and store a new free game (status 'active', or 'prepared' for the next game of a series); null = no scenario. */
export async function insertNewGame(
  viewer: Viewer, mode: SimMode, difficulty: Difficulty, rnd: () => number, tf: IntradayTf | null,
  series?: { id: number; index: number; size: number; status: "active" | "prepared" },
): Promise<GameRow | null> {
  const picked = await pickScenario(viewer, mode, difficulty, rnd, mode === "intraday" ? tf : null);
  if (!picked) return null;
  const price = picked.bars[picked.startIdx].c;
  const extras = mode === "intraday" ? await newGameExtras(viewer, price, picked.bars, picked.day) : { exec: newGameExec(price, null), oneR: (await store.oneRUsdOf(viewer.name, nyDate())) ?? setting("trainer.oneRUsd") };
  const g = await store.insertGame({
    userId: viewer.id, mode, difficulty, ticker: picked.ticker, day: picked.day, dayTo: picked.dayTo, tf: picked.tf,
    bars: picked.bars, startIdx: picked.startIdx, endIdx: picked.endIdx, cursor: picked.startIdx,
    params: {
      feePerShare: await store.deskFeePerShare(nyDate()),
      riskUnit: picked.riskUnit,
      defaultQty: defaultQty(price),
      maxNotional: maxNotionalOf(mode),
      levels: picked.levels,
      times: fakeTimes(picked.bars, mode),
      ...extras,
      ...(picked.baseTf !== picked.tf ? { baseTf: picked.baseTf } : {}),
      intrabar: true,
      ...(series ? { series: { id: series.id, index: series.index, size: series.size } } : {}),
    },
    status: series?.status ?? "active",
    seriesId: series?.id ?? null,
  });
  return series?.status === "prepared" ? g : remember(g);
}

/** A game left behind: with orders it is played out (flat now, then to the end) and counts; without — abandoned. */
async function settle(viewer: Viewer, id: number): Promise<void> {
  const g = await ownGame(viewer, id);
  if (g.status !== "active") return;
  if (!g.events.some((e) => e.type === "order")) {
    // A series game left untouched counts as skipped in its series; a lone free game is simply abandoned.
    if (g.seriesId != null) { await store.markSkipped(id, g.cursor); g.status = "skipped"; }
    else { await store.markAbandoned(id); g.status = "abandoned"; }
    return;
  }
  await finishNow(g);
}

export async function activeSnapshot(viewer: Viewer): Promise<Snapshot | null> {
  const id = await store.activeGameId(viewer.id);
  if (id == null) return null;
  return snapshotOf(await ownGame(viewer, id), viewer);
}

export async function gameSnapshot(viewer: Viewer, id: number): Promise<Snapshot> {
  return snapshotOf(await ownGame(viewer, id), viewer);
}

export type StepInput = {
  /** sizeMode "risk": qty = 1R / |expected fill − stop| (the stop of this request's bracket, else the current one). */
  order?: { kind: OrderKind; qty?: number; sizeMode?: "risk" | null } | null;
  /** undefined = leave the bracket as is; null values clear it. */
  bracket?: { stop: number | null; target: number | null } | null;
  /** Base bars to show (the maximum with `until`). */
  advance: number;
  /** "event": stop at the next market event (events.ts) or bracket fill within `advance` bars. */
  until?: "event" | null;
};

export type StepOutput = {
  cursor: number; bars: WireBar[]; state: PublicState; done: boolean; reveal: Reveal | null;
  /** The event the jump stopped at (step `until: "event"`), else null. */
  event: MarketEvent | null;
  /** The game's series once the game ended (series games only). */
  series?: SeriesState;
};

/** Series state for a response when the game is a series game and has ended. */
export async function seriesOfEnded(g: GameRow): Promise<{ series?: SeriesState }> {
  if (g.seriesId == null || g.status === "active") return {};
  const s = await seriesStateOf(g.seriesId);
  return s ? { series: s } : {};
}

/** First bracket fill (stop / target) with idx in [from, to], as a «fill» event. */
function fillEvent(g: GameRow, from: number, to: number): MarketEvent | null {
  const f = simulate(g.bars, cfgOf(g), g.events, to).fills.find((x) => x.idx >= from && x.idx <= to && (x.reason === "stop" || x.reason === "target"));
  return f ? { kind: "fill", dir: f.reason === "target" ? "up" : "down", idx: f.idx, level: f.price } : null;
}

/** Where an event jump stops: the first market event or bracket fill in [from, to]. */
export function jumpTarget(g: GameRow, from: number, to: number): MarketEvent | null {
  if (from > to) return null;
  const market = g.mode === "intraday" ? findEvent(g.bars, g.params.levels, tfSec(baseTfOf(g)), from, to, g.endIdx) : null;
  const fill = fillEvent(g, from, market ? market.idx : to);
  return fill ?? market;
}

const MAX_EVENTS = 800;

/** Shares of a risk-sized order (capped by buying power over the current position). */
function riskSized(g: GameRow, input: StepInput, currentStop: number | null, pos: number): number {
  const side: 1 | -1 = input.order?.kind === "sell" ? -1 : 1;
  const stop = input.bracket?.stop ?? currentStop;
  if (stop == null) throw badRequest("VALIDATION", { reason: "stop" });
  const close = g.bars[g.cursor].c;
  const qty = riskQty(oneROf(g), marketPx(close, side, g.params.exec), stop, side);
  if (qty < 1) throw badRequest("VALIDATION", { reason: "stop" });
  const maxQty = Math.floor(g.params.maxNotional / close);
  const room = Math.sign(pos) === side ? maxQty - Math.abs(pos) : maxQty + Math.abs(pos);
  return Math.max(1, Math.min(qty, room));
}

export function step(viewer: Viewer, id: number, input: StepInput): Promise<StepOutput> {
  return withLock(id, async () => {
    const g = await ownGame(viewer, id);
    if (g.status !== "active") throw conflict("CONFLICT", { reason: "finished" });
    const cfg = cfgOf(g);
    const before = simulate(g.bars, cfg, g.events, g.cursor);
    const price = g.bars[g.cursor].c;
    const seq0 = g.events.length ? g.events[g.events.length - 1].seq + 1 : 1;
    const req = (g.events.reduce((m, e) => Math.max(m, e.req ?? 0), 0) || 0) + 1;
    const added: SimEvent[] = [];
    let pos = before.pos;
    if (input.order && !(input.order.kind === "flat" && pos === 0)) {
      const qty = input.order.kind === "flat" ? 0 : input.order.sizeMode === "risk" ? riskSized(g, input, before.stop, pos) : Math.floor(input.order.qty ?? 0);
      if (input.order.kind !== "flat" && qty < 1) throw badRequest("VALIDATION", { reason: "qty" });
      const next = pos + orderDelta(input.order.kind, qty, pos);
      const maxQty = Math.floor(g.params.maxNotional / price);
      if (Math.abs(next) > Math.abs(pos) && Math.abs(next) > maxQty) throw badRequest("VALIDATION", { reason: "buyingPower", maxQty });
      added.push({ seq: seq0, idx: g.cursor, req, type: "order", kind: input.order.kind, qty });
      pos = next;
    }
    if (input.bracket && pos !== 0) {
      const { stop, target } = input.bracket;
      const long = pos > 0;
      if (stop != null && (!(stop > 0) || (long ? stop >= price : stop <= price))) throw badRequest("VALIDATION", { reason: "stop" });
      if (target != null && (!(target > 0) || (long ? target <= price : target >= price))) throw badRequest("VALIDATION", { reason: "target" });
      added.push({ seq: seq0 + added.length, idx: g.cursor, req, type: "bracket", stop, target });
    }
    if (g.events.length + added.length > MAX_EVENTS) throw badRequest("VALIDATION", { reason: "tooMany" });
    g.events.push(...added);
    const from = g.cursor + 1;
    let to = Math.min(g.endIdx, g.cursor + Math.max(0, Math.floor(input.advance)));
    // Own mode: the autoplay stops on the bar where the player really entered — the decision moment.
    const decision = g.params.own?.decisionIdx;
    if (decision != null && g.cursor < decision) to = Math.min(to, decision);
    const event = input.until === "event" ? jumpTarget(g, from, to) : null;
    if (event) to = event.idx;
    g.cursor = to;
    if (g.cursor >= g.endIdx) {
      await finishNow(g);
      return {
        cursor: g.cursor, bars: toWire(g.bars, g.params.times, from, g.cursor), state: publicState(g, simulate(g.bars, cfg, g.events, g.cursor)), done: true,
        reveal: await revealOf(g, viewer), event, ...(await seriesOfEnded(g)),
      };
    }
    await store.saveProgress(g.id, g.cursor, g.events);
    const after = simulate(g.bars, cfg, g.events, g.cursor);
    return { cursor: g.cursor, bars: toWire(g.bars, g.params.times, from, g.cursor), state: publicState(g, after), done: false, reveal: null, event };
  });
}

/** Cancel the last order / bracket change — only while no new bar has been shown since (no peeking). */
export function undo(viewer: Viewer, id: number): Promise<StepOutput> {
  return withLock(id, async () => {
    const g = await ownGame(viewer, id);
    if (g.status !== "active") throw conflict("CONFLICT", { reason: "finished" });
    const req = lastReq(g);
    if (req == null) throw conflict("CONFLICT", { reason: "nothingToUndo" });
    while (g.events.length && g.events[g.events.length - 1].req === req && g.events[g.events.length - 1].idx === g.cursor) g.events.pop();
    await store.saveProgress(g.id, g.cursor, g.events);
    return { cursor: g.cursor, bars: [], state: publicState(g, simulate(g.bars, cfgOf(g), g.events, g.cursor)), done: false, reveal: null, event: null };
  });
}

/** End now: close the position at the current bar and play the rest flat. */
export function finish(viewer: Viewer, id: number): Promise<StepOutput> {
  return withLock(id, async () => {
    const g = await ownGame(viewer, id);
    if (g.status !== "active") throw conflict("CONFLICT", { reason: "finished" });
    const from = g.cursor + 1;
    await finishNow(g);
    return {
      cursor: g.cursor, bars: toWire(g.bars, g.params.times, from, g.cursor), state: publicState(g, simulate(g.bars, cfgOf(g), g.events, g.cursor)), done: true,
      reveal: await revealOf(g, viewer), event: null, ...(await seriesOfEnded(g)),
    };
  });
}

/** Close any position now, play the rest flat, judge and store the result (`extra` is merged into it). */
export async function finishNow(g: GameRow, extra: Record<string, unknown> = {}): Promise<void> {
  const cfg = cfgOf(g);
  const seq = () => (g.events.length ? g.events[g.events.length - 1].seq + 1 : 1);
  const now = simulate(g.bars, cfg, g.events, g.cursor);
  if (g.cursor < g.endIdx && now.pos !== 0) g.events.push({ seq: seq(), idx: g.cursor, type: "order", kind: "flat", qty: 0, auto: true });
  g.cursor = g.endIdx;
  const atEnd = simulate(g.bars, cfg, g.events, g.endIdx);
  if (atEnd.pos !== 0) g.events.push({ seq: seq(), idx: g.endIdx, type: "order", kind: "flat", qty: 0, auto: true });
  const final = simulate(g.bars, cfg, g.events, g.endIdx);
  const base = resultOf(g.bars, cfg, final, { baseQty: g.params.defaultQty, ...judgeOpts(g.mode, baseTfOf(g)) });
  const result = { ...base, equity: downsample(final.equity, 400), ...(g.params.own ? { own: compareOwn(g.params.own, base) } : {}), ...extra };
  await store.saveFinished(g.id, g.cursor, g.events, result);
  g.status = "finished";
  g.result = result;
  g.finishedAt = new Date().toISOString();
}

export function downsample(xs: readonly number[], max: number): number[] {
  if (xs.length <= max) return [...xs];
  const out: number[] = [];
  const step = (xs.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(xs[Math.round(i * step)]);
  return out;
}

/* ─────────────────────────── Progress ─────────────────────────── */

export type MyStats = {
  /** Fair games only (own-mode replays are summed in `own`). */
  totals: { games: number; r: number; wins: number; beatBh: number; net: number };
  best: store.FinishedRow | null;
  streak: { current: number; best: number; days: number };
  byLevel: { mode: SimMode; difficulty: Difficulty; games: number; r: number }[];
  recent: store.FinishedRow[];
  prefs: { leaderboardVisible: boolean };
  /** Own mode: replays played, how many beat the real trade, Σ (sim − real) $. */
  own: { games: number; better: number; diff: number };
};

export function streaks(rows: readonly Pick<store.FinishedRow, "net" | "finishedAt">[], today: string): MyStats["streak"] {
  // rows newest first.
  let current = 0;
  for (const r of rows) { if (r.net > 0) current++; else break; }
  let best = 0, run = 0;
  for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].net > 0) { run++; best = Math.max(best, run); } else run = 0; }
  const days = new Set(rows.map((r) => nyDate(new Date(r.finishedAt))));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return { current, best, days: n };
}

export async function myStats(viewer: Viewer): Promise<MyStats> {
  const all = await store.finishedGames(viewer.id, 500);
  const rows = all.filter((r) => !r.own);
  const ownRows = all.filter((r) => r.own);
  const own = {
    games: ownRows.length,
    better: ownRows.filter((r) => (r.ownDiff ?? 0) > 0).length,
    diff: Math.round(ownRows.reduce((s, r) => s + (r.ownDiff ?? 0), 0) * 100) / 100,
  };
  const totals = rows.reduce(
    (t, r) => ({ games: t.games + 1, r: t.r + r.r, wins: t.wins + (r.net > 0 ? 1 : 0), beatBh: t.beatBh + (r.beatBh ? 1 : 0), net: t.net + r.net }),
    { games: 0, r: 0, wins: 0, beatBh: 0, net: 0 },
  );
  totals.r = Math.round(totals.r * 100) / 100;
  totals.net = Math.round(totals.net * 100) / 100;
  // Best game: the highest R among games where the player actually traded.
  const best = rows.reduce<store.FinishedRow | null>((b, r) => (r.trades > 0 && (!b || r.r > b.r) ? r : b), null);
  const levels = new Map<string, MyStats["byLevel"][number]>();
  for (const r of rows) {
    const k = `${r.mode}:${r.difficulty}`;
    const v = levels.get(k) ?? { mode: r.mode, difficulty: r.difficulty, games: 0, r: 0 };
    v.games++; v.r = Math.round((v.r + r.r) * 100) / 100;
    levels.set(k, v);
  }
  return { totals, best, streak: streaks(rows, nyDate()), byLevel: [...levels.values()], recent: all.slice(0, 20), prefs: await store.getPrefs(viewer.id), own };
}

/** Monday of the New York week containing `day`. */
export function weekStart(day: string): string {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((wd + 6) % 7));
}

export async function leaderboard(viewer: Viewer, week?: string | null) {
  const from = weekStart(week ?? nyDate());
  const to = addDays(from, 7);
  const board = await store.weeklyBoard(from, to, viewer.id);
  return { from, to: addDays(to, -1), ...board };
}

export async function updatePrefs(viewer: Viewer, leaderboardVisible: boolean) {
  await store.setPrefs(viewer.id, leaderboardVisible);
  return { leaderboardVisible };
}
