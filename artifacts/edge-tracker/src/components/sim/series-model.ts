/**
 * «Серия из 10» — pure client logic (no React): the last free-play choice (prefill), the progress strip, what the big
 * result button does next, the summary picks (best / worst decision) and the local fallback series used while the
 * server has no series routes (results are then read from the finished games themselves).
 */
import { INTRADAY_TFS, isIntradayTf, type Difficulty, type IntradayTf, type SimMode } from "./api";
import { normalizeVerdict, totalsOf, type NoTradeVerdict, type SeriesResult, type SeriesState } from "./series-api";

export const SERIES_SIZE = 10;

const LEVELS: readonly Difficulty[] = ["easy", "medium", "hard"];
/** Free-play bar sizes: the intraday ones plus daily bars (= the swing game). */
export type FreeTf = IntradayTf | "1d";
export const FREE_TFS: readonly FreeTf[] = [...INTRADAY_TFS, "1d"];
export const isFreeTf = (v: unknown): v is FreeTf => isIntradayTf(v) || v === "1d";
export const isLevel = (v: unknown): v is Difficulty => LEVELS.includes(v as Difficulty);

export type SeriesChoice = { mode: SimMode; difficulty: Difficulty; tf: IntradayTf | null };

/** Remembered level / bar size (whatever is in storage) → a valid choice; defaults easy · 5m. */
export function choiceOf(level: unknown, tf: unknown): SeriesChoice {
  const difficulty = isLevel(level) ? level : "easy";
  const t: FreeTf = isFreeTf(tf) ? tf : "5m";
  return t === "1d" ? { mode: "swing", difficulty, tf: null } : { mode: "intraday", difficulty, tf: t };
}

/* ─────────────────────────── Local fallback series ─────────────────────────── */

/** Local series ids are negative: they never reach the server. */
export const isLocalSeries = (s: SeriesState | null | undefined): boolean => !!s && s.id < 0;

export function localSeries(gameId: number, size = SERIES_SIZE): SeriesState {
  return { id: -Date.now(), size, index: 0, finished: false, results: [], totals: totalsOf([]), gameId };
}

/** A finished game → its series result (local fallback): any trade = traded with the game's R, none = no trade (unscored). */
export function resultOfGame(gameId: number, trades: number, r: number): SeriesResult {
  return trades > 0 ? { gameId, outcome: "traded", r: Math.round(r * 100) / 100, correct: null } : { gameId, outcome: "no_trade", r: null, correct: null };
}

/** Record one result (once per game). */
export function recordResult(s: SeriesState, res: SeriesResult): SeriesState {
  if (s.results.some((x) => x.gameId === res.gameId)) return s;
  const results = [...s.results, res];
  return { ...s, results, totals: totalsOf(results) };
}

/** Move to the next game (or finish when this was the last one). */
export function advanceLocal(s: SeriesState, nextGameId: number | null): SeriesState {
  if (nextGameId == null || s.index + 1 >= s.size) return { ...s, finished: true, gameId: null };
  return { ...s, index: s.index + 1, gameId: nextGameId };
}

/* ─────────────────────────── Progress and the next step ─────────────────────────── */

/* ─────────────────────────── Snapshot fields (contract §1) ─────────────────────────── */

export type GameSeriesRef = { id: number; index: number; size: number };

/** `snapshot.series` — the series a game belongs to (null / absent = none). */
export function gameSeriesOf(meta: unknown): GameSeriesRef | null {
  const v = (meta as { series?: unknown } | null)?.series as Partial<GameSeriesRef> | null | undefined;
  return v && typeof v.id === "number" ? { id: v.id, index: typeof v.index === "number" ? v.index : 0, size: typeof v.size === "number" ? v.size : SERIES_SIZE } : null;
}

/** `snapshot.noTrade` — the verdict of a game decided with «не торгую» (survives a reload). */
export function gameVerdictOf(meta: unknown): NoTradeVerdict | null {
  return normalizeVerdict((meta as { noTrade?: unknown } | null)?.noTrade);
}

/** Is this game part of the series (the current one, an already played one, or tagged with the series id)? */
export function inSeries(s: SeriesState | null | undefined, gameId: number | null | undefined, gameSeriesId?: number | null): boolean {
  if (!s || gameId == null) return false;
  return s.gameId === gameId || s.results.some((x) => x.gameId === gameId) || (gameSeriesId != null && gameSeriesId === s.id);
}

export type DotKind = "win" | "loss" | "even" | "good" | "miss" | "pass" | "skip" | "current" | "todo";

/** One dot per game: played ones by outcome, the current one, the rest to play. */
export function progressDots(s: SeriesState): DotKind[] {
  const out: DotKind[] = [];
  for (let i = 0; i < s.size; i += 1) {
    const r = s.results[i];
    if (r) {
      if (r.outcome === "skipped") out.push("skip");
      else if (r.outcome === "no_trade") out.push(r.correct == null ? "pass" : r.correct ? "good" : "miss");
      else out.push(r.r == null || Math.abs(r.r) < 0.05 ? "even" : r.r > 0 ? "win" : "loss");
    } else out.push(!s.finished && i === s.index ? "current" : "todo");
  }
  return out;
}

/** «3 / 10»: the position of the game (1-based, clamped) — a played game by its place in the results, else the current. */
export function seriesPos(s: SeriesState, gameId?: number | null): { n: number; size: number } {
  const at = gameId != null ? s.results.findIndex((x) => x.gameId === gameId) : -1;
  return { n: Math.min(s.size, Math.max(1, at >= 0 ? at + 1 : s.index + 1)), size: s.size };
}

/**
 * What the big result button does for a finished game: «next» game of the series, the «summary» after the last
 * one (or when reviewing a game of a finished series), null = not a series game (the usual «again»).
 */
export function nextAction(s: SeriesState | null | undefined, gameId: number | null | undefined, gameSeriesId?: number | null): "next" | "summary" | null {
  if (!s || !inSeries(s, gameId, gameSeriesId)) return null;
  return s.finished || s.index + 1 >= s.size || s.results.length >= s.size ? "summary" : "next";
}

/* ─────────────────────────── Summary ─────────────────────────── */

export type Pick = { result: SeriesResult; n: number };

/**
 * Best and worst decision of the series. Best: the biggest winning trade, else a correct «no trade», else the least
 * bad trade. Worst: the biggest losing trade, else a missed move (wrong «no trade»). Skips never count.
 */
export function summaryPicks(results: readonly SeriesResult[]): { best: Pick | null; worst: Pick | null } {
  const rows = results.map((result, i) => ({ result, n: i + 1 }));
  const traded = rows.filter((x) => x.result.outcome === "traded" && x.result.r != null);
  const byR = [...traded].sort((a, b) => (b.result.r ?? 0) - (a.result.r ?? 0));
  const goodPass = rows.find((x) => x.result.outcome === "no_trade" && x.result.correct === true) ?? null;
  const missed = rows.find((x) => x.result.outcome === "no_trade" && x.result.correct === false) ?? null;
  const top = byR[0] ?? null;
  const bottom = byR[byR.length - 1] ?? null;
  const best = top && (top.result.r ?? 0) > 0 ? top : goodPass ?? top;
  let worst = bottom && (bottom.result.r ?? 0) < 0 ? bottom : missed;
  if (worst && best && worst.result.gameId === best.result.gameId) worst = null;
  return { best, worst };
}

/** Share of scored decisions that were right: winning trades + correct «no trade» out of traded + scored no-trades. */
export function goodShare(results: readonly SeriesResult[]): number | null {
  let good = 0;
  let all = 0;
  for (const r of results) {
    if (r.outcome === "traded" && r.r != null) { all += 1; if (r.r > 0) good += 1; }
    else if (r.outcome === "no_trade" && r.correct != null) { all += 1; if (r.correct) good += 1; }
  }
  return all ? good / all : null;
}
