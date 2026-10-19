/**
 * «Серия из 10» + skip / no-trade API (server: api-server routes/sim.ts, lib/sim/{series,noTrade}.ts; shapes in the
 * trainer2 CONTRACT). Every answer goes through a normalizer, so a missing / older field never breaks the flow:
 *   POST /api/sim/series { mode, difficulty, tf, size }  → { series, game }
 *   POST /api/sim/series/:id/next                        → { series, game | null }   (null = the series is over)
 *   GET  /api/sim/series/:id                             → { series }
 *   GET  /api/sim/series/active                          → { series | null }          (resume after a reload)
 *   POST /api/sim/games/:id/skip                         → { outcome: "skipped" | "finished", snapshot, series? }
 *   POST /api/sim/games/:id/no-trade                     → { verdict, snapshot, series? }
 * A route the server does not have yet answers 404 / 405 — `routeMissing` tells the caller to fall back.
 */
import { http } from "@/lib/api/http";
import type { Difficulty, IntradayTf, SimMode, Snapshot } from "./api";

export type SeriesOutcome = "traded" | "no_trade" | "skipped";
export type SeriesResult = { gameId: number; outcome: SeriesOutcome; r: number | null; correct: boolean | null };
export type SeriesTotals = { traded: number; noTrade: number; skipped: number; netR: number; correctNoTrade: number };
export type SeriesState = {
  id: number; size: number; index: number; finished: boolean; results: SeriesResult[]; totals: SeriesTotals;
  /** The game being played now (server `currentGameId`; else the client remembers it from create / next). */
  gameId?: number | null;
  /** The series' level / bar size (server; null tf = daily bars). */
  mode?: SimMode; difficulty?: Difficulty; tf?: IntradayTf | null;
};

export type NoTradeReason = "noTrade.correct" | "noTrade.missedLong" | "noTrade.missedShort";
export type MissedMove = { side: "long" | "short"; entry: number; extreme: number; r: number };
export type NoTradeVerdict = { correct: boolean; bestR: number; reasonKey: NoTradeReason; missed?: MissedMove | null };

export type SeriesParams = { mode: SimMode; difficulty: Difficulty; tf: IntradayTf | null; size?: number };

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const OUTCOMES: readonly SeriesOutcome[] = ["traded", "no_trade", "skipped"];
const REASONS: readonly NoTradeReason[] = ["noTrade.correct", "noTrade.missedLong", "noTrade.missedShort"];

/** Totals from the results (used when the server sends none, and by the local fallback series). */
export function totalsOf(results: readonly SeriesResult[]): SeriesTotals {
  const t: SeriesTotals = { traded: 0, noTrade: 0, skipped: 0, netR: 0, correctNoTrade: 0 };
  for (const r of results) {
    if (r.outcome === "traded") t.traded += 1;
    else if (r.outcome === "no_trade") { t.noTrade += 1; if (r.correct) t.correctNoTrade += 1; }
    else t.skipped += 1;
    if (r.outcome !== "skipped" && r.r != null) t.netR += r.r;
  }
  t.netR = Math.round(t.netR * 100) / 100;
  return t;
}

/** Server JSON → SeriesState (tolerant: unknown outcomes are dropped, totals recomputed when absent). Null = not a series. */
export function normalizeSeries(raw: unknown): SeriesState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const id = num(s.id, NaN);
  if (!Number.isFinite(id)) return null;
  const results: SeriesResult[] = Array.isArray(s.results)
    ? s.results.flatMap((x): SeriesResult[] => {
      const o = x as Record<string, unknown> | null;
      if (!o || !OUTCOMES.includes(o.outcome as SeriesOutcome)) return [];
      return [{ gameId: num(o.gameId), outcome: o.outcome as SeriesOutcome, r: numOrNull(o.r), correct: typeof o.correct === "boolean" ? o.correct : null }];
    })
    : [];
  const size = Math.max(1, num(s.size, 10));
  const tt = s.totals as Record<string, unknown> | undefined;
  const totals = tt && typeof tt === "object"
    ? { traded: num(tt.traded), noTrade: num(tt.noTrade), skipped: num(tt.skipped), netR: num(tt.netR), correctNoTrade: num(tt.correctNoTrade) }
    : totalsOf(results);
  const gameId = numOrNull(s.currentGameId ?? s.gameId);
  const out: SeriesState = { id, size, index: Math.max(0, Math.min(size - 1, num(s.index))), finished: s.finished === true, results, totals, gameId };
  if (s.mode === "intraday" || s.mode === "swing") out.mode = s.mode;
  if (s.difficulty === "easy" || s.difficulty === "medium" || s.difficulty === "hard") out.difficulty = s.difficulty;
  if (s.tf === "1m" || s.tf === "2m" || s.tf === "5m") out.tf = s.tf;
  else if (s.tf === "1d" || out.mode === "swing") out.tf = null;
  return out;
}

export function normalizeVerdict(raw: unknown): NoTradeVerdict | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.correct !== "boolean") return null;
  const m = v.missed as Record<string, unknown> | null | undefined;
  const missed: MissedMove | null = m && typeof m === "object" && (m.side === "long" || m.side === "short")
    ? { side: m.side, entry: num(m.entry), extreme: num(m.extreme), r: num(m.r, num(v.bestR)) }
    : null;
  const fallback: NoTradeReason = v.correct ? "noTrade.correct" : missed?.side === "short" ? "noTrade.missedShort" : "noTrade.missedLong";
  const reasonKey = REASONS.includes(v.reasonKey as NoTradeReason) ? (v.reasonKey as NoTradeReason) : fallback;
  return { correct: v.correct, bestR: num(v.bestR), reasonKey, missed };
}

/** The route is not on this server (yet): the caller falls back instead of showing an error. */
export function routeMissing(err: unknown): boolean {
  const e = err as { status?: number; code?: string | null } | null;
  return e?.status === 404 || e?.status === 405 || e?.status === 501;
}

const isSnapshot = (v: unknown): v is Snapshot => !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "number" && Array.isArray((v as { bars?: unknown }).bars);

export const seriesApi = {
  create: async (p: SeriesParams): Promise<{ series: SeriesState | null; game: Snapshot }> => {
    const body = { mode: p.mode, difficulty: p.difficulty, size: p.size ?? 10, ...(p.mode === "intraday" && p.tf ? { tf: p.tf } : {}) };
    const r = await http.post<{ series?: unknown; game?: unknown }>("/api/sim/series", body);
    if (!isSnapshot(r?.game)) throw Object.assign(new Error("series: no game"), { status: 404 });
    return { series: normalizeSeries(r.series), game: r.game };
  },
  next: async (id: number): Promise<{ series: SeriesState | null; game: Snapshot | null }> => {
    const r = await http.post<{ series?: unknown; game?: unknown }>(`/api/sim/series/${id}/next`, {});
    return { series: normalizeSeries(r?.series), game: isSnapshot(r?.game) ? r.game : null };
  },
  get: async (id: number): Promise<SeriesState | null> => normalizeSeries((await http.get<{ series?: unknown }>(`/api/sim/series/${id}`))?.series),
  active: async (): Promise<SeriesState | null> => normalizeSeries((await http.get<{ series?: unknown }>("/api/sim/series/active"))?.series),
  /** «finished»: the player had already traded — the game is finished and counted (skipping cannot hide a loss). */
  skip: async (gameId: number): Promise<{ outcome: "skipped" | "finished"; snapshot: Snapshot | null; series: SeriesState | null }> => {
    const r = await http.post<{ outcome?: unknown; snapshot?: unknown; series?: unknown } | null>(`/api/sim/games/${gameId}/skip`, {});
    return { outcome: r?.outcome === "finished" ? "finished" : "skipped", snapshot: isSnapshot(r?.snapshot) ? r.snapshot : null, series: normalizeSeries(r?.series) };
  },
  noTrade: async (gameId: number): Promise<{ verdict: NoTradeVerdict | null; snapshot: Snapshot | null; series: SeriesState | null }> => {
    const r = await http.post<{ verdict?: unknown; snapshot?: unknown; series?: unknown }>(`/api/sim/games/${gameId}/no-trade`, {});
    return { verdict: normalizeVerdict(r?.verdict), snapshot: isSnapshot(r?.snapshot) ? r.snapshot : null, series: normalizeSeries(r?.series) };
  },
};
