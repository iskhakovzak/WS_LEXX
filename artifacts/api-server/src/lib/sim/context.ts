/**
 * «Тренажёр 2» game context: GET /api/sim/games/:id/context → the daily chart before the game day and the key levels
 * (owner 2026-10-19: «видно дневку»). Same no-leak rule as the game: before the reveal the daily bars carry fake dates
 * (business days ending 2001-01-09 — the intraday fake play day is 2001-01-10), real dates only once the game is
 * over; bars stop the trading day BEFORE the game day (today's candle is built on the client from the bars seen).
 * Swing games are daily already: empty context.
 */
import { atr, type Levels, type WireBar } from "./scenario";
import * as store from "./store";
import type { GameRow } from "./store";
import { ownGame, type Viewer } from "./service";

export type ContextLevels = Levels & { gapPct: number | null; atr14: number | null };
export type GameContext = { daily: WireBar[]; levels: ContextLevels };

export const CONTEXT_DAYS = 60;
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

/** Pure: the context of a game from its daily bars (oldest first, all before the game day). */
export function contextOf(g: Pick<GameRow, "mode" | "status" | "bars" | "startIdx" | "params">, daily: readonly store.DatedBar[]): GameContext {
  const lv = g.params.levels;
  const empty: ContextLevels = { pdh: null, pdl: null, pdc: null, pmh: null, pml: null, gapPct: null, atr14: null };
  if (g.mode !== "intraday") return { daily: [], levels: empty };
  const bars = daily.slice(-CONTEXT_DAYS);
  const real = g.status === "finished";
  const fake = fakeDailyTimes(bars.length);
  const wire: WireBar[] = bars.map((b, i) => [real ? Date.parse(`${b.date}T00:00:00Z`) / 1000 : fake[i], b.o, b.h, b.l, b.c, b.v]);
  const prev = bars[bars.length - 1];
  const pdc = lv.pdc ?? prev?.c ?? null;
  const px = g.bars[g.startIdx]?.c;
  const a = atr(bars.map((b) => ({ t: 0, ...b })), 14);
  return {
    daily: wire,
    levels: {
      pdh: lv.pdh ?? prev?.h ?? null, pdl: lv.pdl ?? prev?.l ?? null, pdc, pmh: lv.pmh, pml: lv.pml,
      gapPct: pdc && pdc > 0 && px != null ? r2(((px - pdc) / pdc) * 100) : null,
      atr14: a == null ? null : r4(a),
    },
  };
}

export async function gameContext(viewer: Viewer, id: number): Promise<GameContext> {
  const g = await ownGame(viewer, id);
  if (g.mode !== "intraday") return contextOf(g, []);
  return contextOf(g, await store.loadDailyBefore(g.ticker, g.day, CONTEXT_DAYS));
}
