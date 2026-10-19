/**
 * «Тренажёр 2» series (owner 2026-10-19: «скипать на следующее и после сразу к следующему»): `size` free games of one
 * mode / level / timeframe played back to back. SQL: seriesStore.ts; games are ordinary sim games (service.ts).
 *
 *   POST /api/sim/series            start: settles the active game, abandons an unfinished series, deals game 0 and
 *                                   prepares game 1 in the background
 *   POST /api/sim/series/:id/next   settles the current game (orders → played out and counted; none → skipped),
 *                                   deals the prepared next game (instant) and prepares the one after; null = done
 *   GET  /api/sim/series/:id        state;  GET /api/sim/series/active  the unfinished series or null
 *
 * One active game per user stays true: a prepared game has status 'prepared' (invisible, not 'active') until «next».
 */
import { conflict, notFound } from "../http";
import { logger } from "../logger";
import type { Difficulty, IntradayTf, SimMode } from "./scenario";
import * as store from "./store";
import * as ss from "./seriesStore";
import { finishNow, insertNewGame, ownGame, remember, settleActive, snapshotOf, withLock, type Snapshot, type Viewer } from "./service";

export const SERIES_DEFAULT_SIZE = 10;
export const SERIES_MAX_SIZE = 50;

/** Background preparations in flight: `${seriesId}:${index}` → the promise (awaited by «next» when it is early). */
const preparing = new Map<string, Promise<void>>();
const seriesLocks = new Map<number, Promise<unknown>>();

function withSeriesLock<T>(id: number, fn: () => Promise<T>): Promise<T> {
  const prev = seriesLocks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  seriesLocks.set(id, tail);
  void tail.then(() => { if (seriesLocks.get(id) === tail) seriesLocks.delete(id); });
  return run;
}

/** For tests: wait for background preparations; forget them. */
export async function _settlePreparations(): Promise<void> { await Promise.all([...preparing.values()]); }
export function _resetSeries(): void { preparing.clear(); seriesLocks.clear(); }

async function ownSeries(viewer: Viewer, id: number): Promise<ss.SeriesRow> {
  const s = await ss.loadSeries(id);
  if (!s || s.userId !== viewer.id) throw notFound("NOT_FOUND");
  return s;
}

/** Build the game at `index` as 'prepared' in the background (no-op past the end or when one is being built). */
function prepare(viewer: Viewer, s: ss.SeriesRow, index: number, rnd: () => number): void {
  if (index >= s.size) return;
  const key = `${s.id}:${index}`;
  if (preparing.has(key)) return;
  const p = (async () => {
    if ((await ss.preparedGameId(s.id, index)) != null) return;
    await insertNewGame(viewer, s.mode, s.difficulty, rnd, s.tf, { id: s.id, index, size: s.size, status: "prepared" });
  })()
    .catch((err) => { logger.warn({ err, series: s.id, index }, "sim series: prepare failed"); })
    .finally(() => { preparing.delete(key); });
  preparing.set(key, p);
}

async function state(id: number): Promise<ss.SeriesState> {
  const st = await ss.seriesStateOf(id);
  if (!st) throw notFound("NOT_FOUND");
  return st;
}

export async function startSeries(
  viewer: Viewer, mode: SimMode, difficulty: Difficulty, tf: IntradayTf | null, size = SERIES_DEFAULT_SIZE, rnd: () => number = Math.random,
): Promise<{ series: ss.SeriesState; game: Snapshot }> {
  const n = Math.max(1, Math.min(SERIES_MAX_SIZE, Math.floor(size)));
  const prevId = await ss.activeSeriesId(viewer.id);
  if (prevId != null) await withSeriesLock(prevId, () => closeSeries(prevId, "abandoned"));
  await settleActive(viewer);
  const s = await ss.insertSeries({ userId: viewer.id, mode, difficulty, tf: mode === "intraday" ? tf : null, size: n });
  const g = await insertNewGame(viewer, mode, difficulty, rnd, s.tf, { id: s.id, index: 0, size: n, status: "active" });
  if (!g) {
    await ss.closeSeries(s.id, "abandoned");
    throw notFound("NOT_FOUND");
  }
  prepare(viewer, s, 1, rnd);
  return { series: await state(s.id), game: await snapshotOf(g, viewer) };
}

async function closeSeries(id: number, status: "finished" | "abandoned"): Promise<void> {
  await ss.closeSeries(id, status);
  await Promise.all([...preparing.entries()].filter(([k]) => k.startsWith(`${id}:`)).map(([, p]) => p));
  await store.dropPrepared(id);
}

/** End the current series game if it is still being played: with orders → played out (counted), else skipped. */
async function settleCurrent(viewer: Viewer, gameId: number): Promise<void> {
  await withLock(gameId, async () => {
    const g = await ownGame(viewer, gameId).catch(() => null);
    if (!g || g.status !== "active") return;
    if (g.events.some((e) => e.type === "order")) await finishNow(g);
    else { await store.markSkipped(g.id, g.cursor); g.status = "skipped"; }
  });
}

export function nextGame(viewer: Viewer, id: number, rnd: () => number = Math.random): Promise<{ series: ss.SeriesState; game: Snapshot | null }> {
  return withSeriesLock(id, async () => {
    const s = await ownSeries(viewer, id);
    if (s.status === "abandoned") throw conflict("CONFLICT", { reason: "abandoned" });
    if (s.status === "finished") return { series: await state(id), game: null };
    const cur = (await ss.seriesStateOf(id))?.currentGameId ?? null;
    if (cur != null) await settleCurrent(viewer, cur);
    const index = s.idx + 1;
    if (index >= s.size) {
      await closeSeries(id, "finished");
      return { series: await state(id), game: null };
    }
    await preparing.get(`${id}:${index}`);
    await settleActive(viewer); // the player may have started a lone game meanwhile
    let g = null;
    const pid = await ss.preparedGameId(id, index);
    if (pid != null && (await store.activatePrepared(pid))) {
      g = await store.loadGame(pid);
    }
    if (!g) g = await insertNewGame(viewer, s.mode, s.difficulty, rnd, s.tf, { id, index, size: s.size, status: "active" });
    if (!g) throw notFound("NOT_FOUND");
    g.status = "active";
    remember(g);
    await ss.setSeriesIdx(id, index);
    prepare(viewer, { ...s, idx: index }, index + 1, rnd);
    return { series: await state(id), game: await snapshotOf(g, viewer) };
  });
}

export async function getSeries(viewer: Viewer, id: number): Promise<{ series: ss.SeriesState }> {
  await ownSeries(viewer, id);
  return { series: await state(id) };
}

export async function activeSeries(viewer: Viewer): Promise<{ series: ss.SeriesState | null }> {
  const id = await ss.activeSeriesId(viewer.id);
  return { series: id == null ? null : await ss.seriesStateOf(id) };
}
