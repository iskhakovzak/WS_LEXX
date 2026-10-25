/**
 * «Тренажёр 2» game context: GET /api/sim/games/:id/context → the daily chart before the game day, the key levels and
 * «Контекст дня» (owner 2026-10-19: «видно дневку»; 2026-10-25: «дейли должен быть длинный показан, и капитализация
 * компании», a catalyst for every day). Same no-leak rule as the game: before the reveal the daily bars carry fake
 * dates (business days ending 2001-01-09 — the intraday fake play day is 2001-01-10), real dates only once the game is
 * over; bars stop the trading day BEFORE the game day (today's candle is built on the client from the bars seen).
 *
 *   daily     up to CONTEXT_DAYS (250) daily bars: the local daily cache + archive first; when they hold fewer than
 *             MIN_DAILY (120), the provider's daily range (store.loadDailySeries, memoised 12 h) fills in;
 *   levels    PDH / PDL / PDC / PMH / PML, the gap (premarket price vs PDC before the reveal, the open after), ATR 14,
 *             the 52-week high / low of the bars before the day;
 *   day       catalysts (catalyst.ts views: masked before the reveal), market cap (≈ shares × PDC, else the latest
 *             cap, «now»), float, premarket volume (from the bars the player already sees).
 * Swing games are daily already: empty context. Drills build the same `day` block (dayContextOf).
 */
import { addDays } from "../tradingDate";
import { setting } from "../settings/registry";
import { RTH_OPEN, atr, etOf, type Levels, type WireBar } from "./scenario";
import * as store from "./store";
import type { GameRow } from "./store";
import { ownGame, type Viewer } from "./service";
import { capView, catalystView, round2, type CapView, type Catalyst, type CatalystView } from "./catalyst";
import { catalystsOf, fundamentalsOf, type Fundamentals } from "./catalystStore";

export type ContextLevels = Levels & { gapPct: number | null; atr14: number | null; hi52: number | null; lo52: number | null };

/** «Контекст дня». */
export type DayContext = {
  /** Gap % vs the previous close: the premarket price before the reveal (`gapAt` pre), the open after (open). */
  gapPct: number | null;
  gapAt: "pre" | "open";
  /** The desk's threshold every trainer day passed (trainer.minGapPct). */
  minGapPct: number;
  catalysts: CatalystView[];
  cap: CapView | null;
  /** Shares in the float, 2 significant digits (the latest known — float is not kept by date). */
  floatShares: number | null;
  /** Premarket volume of the play day (shares). */
  pmVolume: number | null;
};

export type GameContext = { daily: WireBar[]; levels: ContextLevels; day: DayContext | null };

export const CONTEXT_DAYS = 250;
export const MIN_DAILY = 120;
const YEAR_BARS = 252;
const FAKE_PREV_DAY = Date.UTC(2001, 0, 9) / 1000; // Tuesday before the fake play day (2001-01-10)

/** Fake UTC-midnight dates for `n` daily bars: consecutive business days ending 2001-01-09, oldest first. */
export function fakeDailyTimes(n: number): number[] {
  const out: number[] = [];
  let t = FAKE_PREV_DAY;
  while (out.length < n) {
    const wd = new Date(t * 1000).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(t);
    t -= 86400;
  }
  return out.reverse();
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Daily bars → wire bars with fake (or, revealed, real) dates. */
export function dailyWire(bars: readonly store.DatedBar[], real: boolean): WireBar[] {
  const fake = fakeDailyTimes(bars.length);
  return bars.map((b, i) => [real ? Date.parse(`${b.date}T00:00:00Z`) / 1000 : fake[i], b.o, b.h, b.l, b.c, b.v]);
}

/** 52-week high / low of the last year of bars (null without bars). */
export function yearRange(bars: readonly store.DatedBar[]): { hi52: number | null; lo52: number | null } {
  const y = bars.slice(-YEAR_BARS);
  if (!y.length) return { hi52: null, lo52: null };
  let hi = -Infinity, lo = Infinity;
  for (const b of y) { if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l; }
  return { hi52: r4(hi), lo52: r4(lo) };
}

/** Raw inputs of «Контекст дня» (server only: real headlines). */
export type DayInfo = { ticker: string; catalysts: Catalyst[]; fundamentals: Fundamentals };

/** Pure: «Контекст дня» for the client. */
export function dayContextOf(info: DayInfo, o: { revealed: boolean; gapPct: number | null; gapAt: "pre" | "open"; prevClose: number | null; pmVolume: number | null }): DayContext {
  const f = info.fundamentals;
  return {
    gapPct: o.gapPct,
    gapAt: o.gapAt,
    minGapPct: setting("trainer.minGapPct"),
    catalysts: info.catalysts.map((c) => catalystView(c, o.revealed, info.ticker, f.names)),
    cap: capView({ shares: f.shares, price: o.prevClose, capNow: f.capNow }, o.revealed),
    floatShares: f.floatShares != null ? round2(f.floatShares) : null,
    pmVolume: o.pmVolume,
  };
}

/** Premarket volume of the play day among bars [0 … startIdx] (what the player sees at the start). */
export function premarketVolume(bars: readonly { t: number; v: number }[], day: string, upto: number): number | null {
  let v = 0, n = 0;
  for (let i = 0; i <= upto && i < bars.length; i++) {
    const e = etOf(bars[i].t);
    if (e.date === day && e.min < RTH_OPEN) { v += bars[i].v || 0; n++; }
  }
  // Archived premarket bars without volume (some feeds) say nothing: «—», not «0».
  return n && v > 0 ? Math.round(v) : null;
}

/** Pure: the context of a game from its daily bars (oldest first, all before the game day) and the day info. */
export function contextOf(g: Pick<GameRow, "mode" | "status" | "bars" | "startIdx" | "params"> & { day?: string }, daily: readonly store.DatedBar[], info?: DayInfo | null): GameContext {
  const lv = g.params.levels;
  const empty: ContextLevels = { pdh: null, pdl: null, pdc: null, pmh: null, pml: null, gapPct: null, atr14: null, hi52: null, lo52: null };
  if (g.mode !== "intraday") return { daily: [], levels: empty, day: null };
  const bars = daily.slice(-CONTEXT_DAYS);
  const real = g.status === "finished";
  const prev = bars[bars.length - 1];
  const pdc = lv.pdc ?? prev?.c ?? null;
  const px = g.bars[g.startIdx]?.c;
  const a = atr(bars.map((b) => ({ t: 0, ...b })), 14);
  const gapPre = pdc && pdc > 0 && px != null ? r2(((px - pdc) / pdc) * 100) : null;
  // After the reveal: the gap at the open (the first regular-session bar of the play day).
  const openBar = real && g.day ? g.bars.find((b, i) => i > g.startIdx && etOf(b.t).date === g.day && etOf(b.t).min >= RTH_OPEN) : undefined;
  const gapOpen = openBar && pdc && pdc > 0 ? r2(((openBar.o - pdc) / pdc) * 100) : null;
  return {
    daily: dailyWire(bars, real),
    levels: {
      pdh: lv.pdh ?? prev?.h ?? null, pdl: lv.pdl ?? prev?.l ?? null, pdc, pmh: lv.pmh, pml: lv.pml,
      gapPct: gapPre,
      atr14: a == null ? null : r4(a),
      ...yearRange(daily),
    },
    day: info
      ? dayContextOf(info, {
        revealed: real, gapPct: gapOpen ?? gapPre, gapAt: gapOpen != null ? "open" : "pre", prevClose: pdc,
        pmVolume: g.day ? premarketVolume(g.bars, g.day, g.startIdx) : null,
      })
      : null,
  };
}

/** Long daily history before `day`: local first, the provider's daily range when the local cache is short. */
export async function longDailyBefore(ticker: string, day: string): Promise<store.DatedBar[]> {
  const local = await store.loadDailyBefore(ticker, day, YEAR_BARS + 10);
  if (local.length >= MIN_DAILY) return local;
  const { bars, dates } = await store.loadDailySeries(ticker, addDays(day, -1));
  if (!bars.length) return local;
  const byDate = new Map<string, store.DatedBar>();
  bars.forEach((b, i) => { if (dates[i] < day) byDate.set(dates[i], { date: dates[i], o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); });
  for (const b of local) byDate.set(b.date, b);
  return [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : 1)).slice(-(YEAR_BARS + 10));
}

export async function dayInfoOf(ticker: string, day: string): Promise<DayInfo> {
  const [catalysts, fundamentals] = await Promise.all([catalystsOf(ticker, day), fundamentalsOf(ticker)]);
  return { ticker, catalysts, fundamentals };
}

export async function gameContext(viewer: Viewer, id: number): Promise<GameContext> {
  const g = await ownGame(viewer, id);
  if (g.mode !== "intraday") return contextOf(g, []);
  const [daily, info] = await Promise.all([longDailyBefore(g.ticker, g.day), dayInfoOf(g.ticker, g.day)]);
  return contextOf(g, daily, info);
}
