/**
 * «Задача дня» service: the pick of a NY challenge date (job trainer.daily-pick at trainer.dailyPickTime, 08:30 NY by
 * default, or lazily on the first read), the viewer's state (DailyChallengeState) and starting / resuming the game.
 *
 *   ranked window      Волна 1, item 1.8 — «Задача дня» is an evening task: the challenge of trading day D is ranked
 *                      from D's market close (16:00 NY, 13:00 on an early close) until the pick time of the next trading day (08:30 NY by
 *                      default, trainer.dailyPickTime), so the window runs over the weekend / a holiday. During the
 *                      session nothing ranked is open (traders trade), the closed challenge can be practised.
 *   current challenge  today from the close on a trading day; before it (and on weekends / holidays) the previous
 *                      trading day's challenge — open until the next trading day's pick time, closed after it.
 *   open               new games only inside the ranked window; a game started inside it can be finished later (its
 *                      reveal waits until it is finished).
 *   reveal / ranking   after the viewer finished, or for everyone once the window closed (not while mid-game).
 *   eligibility        a ticker-day with any desk fill at 15:50–16:00 NY is never picked (lib/trainer/eligibility);
 *                      existing picks stay as they are.
 *   game               an ordinary sim game (mode 'intraday', 1-minute bars, trainer.dailyPlayMinutes from the open)
 *                      marked by params.daily; one per user and date — an abandoned one is re-activated, never
 *                      replaced (its bars were seen). Played through POST /api/sim/games/:id/step like any game.
 */
import { conflict, notFound } from "../http";
import { logger } from "../logger";
import { addDays, nyDate, nyMinutes } from "../tradingDate";
import { isMarketClosed, sessionFor } from "../marketDays";
import { setting } from "../settings/registry";
import { pickMinutes } from "./schedule";
import { deskAliases } from "../deskAliases";
import { namesVisible } from "../access/names";
import { buildIntraday, defaultQty, fakeTimes, maxNotionalOf, type BuiltScenario, type IntradaySpec } from "../sim/scenario";
import * as simStore from "../sim/store";
import { gameSnapshot, newGameExtras, remember, settleActive, snapshotOf, type Snapshot, type Viewer } from "../sim/service";
import { forgetAllTrainerHomes, forgetTrainerHome } from "./cache";
import { buildRanking, dailyStreak, pickOrder, type PickRules } from "./dailyPick";
import * as ds from "./dailyStore";
import { withoutBlockedDays } from "./eligibility";
import { blockedTickerDays } from "./eligibilityStore";
import type { DailyChallengeState } from "./types";

/** The regular close; an early-close day (13:00) opens its challenge at its own close (lib/marketDays sessionFor). */
export const CLOSE_MIN = 16 * 60;
const closeMinOf = async (date: string): Promise<number> => (await sessionFor(date)).closeMin;

async function prevTradingDay(date: string): Promise<string> {
  let d = addDays(date, -1);
  for (let i = 0; i < 10 && (await isMarketClosed(d)); i++) d = addDays(d, -1);
  return d;
}

async function nextTradingDay(date: string): Promise<string> {
  let d = addDays(date, 1);
  for (let i = 0; i < 10 && (await isMarketClosed(d)); i++) d = addDays(d, 1);
  return d;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** The challenge of the last trading day whose close has passed: today after its close (16:00 NY, 13:00 on an early close), else the previous trading day. */
export async function currentChallengeDate(now = new Date()): Promise<string> {
  const today = nyDate(now);
  if (!(await isMarketClosed(today)) && nyMinutes(now) >= (await closeMinOf(today))) return today;
  return prevTradingDay(today);
}

export type ChallengeWindow = NonNullable<DailyChallengeState["window"]>;

/** The ranked window of the challenge `date` (NY dates + times): D's close (16:00, 13:00 early) → next trading day at the pick time. */
export async function challengeWindow(date: string, now = new Date()): Promise<ChallengeWindow> {
  const until = await nextTradingDay(date);
  const pick = pickMinutes();
  const close = await closeMinOf(date);
  const today = nyDate(now), min = nyMinutes(now);
  const started = today > date || (today === date && min >= close);
  const ended = today > until || (today === until && min >= pick);
  return { from: { date, time: hhmm(close) }, until: { date: until, time: hhmm(pick) }, open: started && !ended };
}

/** New games may start: `now` is inside the challenge's ranked window. */
export async function isOpen(date: string, now = new Date()): Promise<boolean> {
  return (await challengeWindow(date, now)).open;
}

const rules = (): PickRules => ({
  minPrice: setting("trainer.dailyMinPriceUsd"),
  minVolume: setting("trainer.dailyMinVolume"),
  minRangePct: setting("trainer.dailyMinRangePct"),
  maxRangePct: setting("trainer.dailyMaxRangePct"),
});

const spec = (): IntradaySpec => ({ mode: "intraday", tf: "1m", playMinutes: setting("trainer.dailyPlayMinutes"), filter: () => true, rank: () => 0 });

type BuiltDay = { built: BuiltScenario; dayBars: simStore.ArchivedBars["bars"] };

/** The challenge's game series (1-minute, previous session + premarket + trainer.dailyPlayMinutes of the session). */
export async function buildDay(ticker: string, day: string): Promise<BuiltDay | null> {
  const data = await simStore.loadDayBars(ticker, day);
  if (!data || data.tf !== "1m") return null;
  const prev = await simStore.loadPrevDay(ticker, day, 60);
  const built = buildIntraday({ day, dayBars: data.bars, prevBars: prev?.bars ?? [], prevLevels: prev?.levels ?? null, spec: spec() });
  if (!built) return null;
  if (built.levels.pdc == null && data.prevClose != null) built.levels.pdc = data.prevClose;
  return { built, dayBars: data.bars };
}

const picks = new Map<string, ds.ChallengeRow>();
const inflight = new Map<string, Promise<ds.ChallengeRow | null>>();

/** For tests. */
export function _resetDailyMemo(): void { picks.clear(); inflight.clear(); }

async function pickNow(date: string): Promise<ds.ChallengeRow | null> {
  const existing = await ds.challengeOf(date);
  if (existing) return existing;
  const noRepeat = setting("trainer.dailyNoRepeatDays");
  const recent = await ds.recentChallenges(date, 400);
  const used = new Set(recent.filter((r) => r.date >= addDays(date, -noRepeat)).map((r) => `${r.ticker}:${r.barsDay}`));
  const recentTickers = new Set(recent.slice(0, 5).map((r) => r.ticker));
  // Trainer eligibility: no ticker-day the desk traded in the closing auction (15:50–16:00 NY) — lib/trainer/eligibility.
  const [cands, blocked] = await Promise.all([ds.dailyCandidates(date), blockedTickerDays()]);
  const order = pickOrder(date, withoutBlockedDays(cands, (c) => c, blocked), rules(), used, recentTickers);
  for (const c of order.slice(0, 8)) {
    if (!(await buildDay(c.ticker, c.day))) continue;
    const row = await ds.savePick({
      date, ticker: c.ticker, barsDay: c.day, tf: "1m", deskTraders: c.deskTraders,
      features: { rangePct: c.rangePct, gapPct: c.gapPct, volume: c.volume, open: c.open },
    });
    forgetAllTrainerHomes();
    return row;
  }
  logger.warn({ date, candidates: order.length }, "trainer: no daily challenge could be picked");
  return null;
}

/** The pick of `date` (idempotent: an existing pick is returned; concurrent callers share one run). */
export async function ensurePick(date: string): Promise<ds.ChallengeRow | null> {
  const hit = picks.get(date);
  if (hit) return hit;
  let run = inflight.get(date);
  if (!run) {
    run = pickNow(date).finally(() => inflight.delete(date));
    inflight.set(date, run);
  }
  const row = await run;
  if (row) {
    if (picks.size > 50) picks.clear();
    picks.set(date, row);
  }
  return row;
}

/** Job trainer.daily-pick: today's pick on a trading day (a re-run picks nothing new). */
export async function runDailyPick(now = new Date()): Promise<{ date: string; ticker: string | null; skipped?: string }> {
  const today = nyDate(now);
  if (!setting("trainer.dailyEnabled")) return { date: today, ticker: null, skipped: "disabled" };
  if (await isMarketClosed(today)) return { date: today, ticker: null, skipped: "closed" };
  const row = await ensurePick(today);
  return { date: today, ticker: row?.ticker ?? null };
}

export async function dailyState(viewer: Viewer, now = new Date()): Promise<DailyChallengeState> {
  const date = await currentChallengeDate(now);
  const pick = setting("trainer.dailyEnabled") ? await ensurePick(date) : await ds.challengeOf(date);
  const [mine, dates, played] = await Promise.all([ds.myDailyGame(viewer.id, date), ds.challengeDates(date), ds.playedDates(viewer.id)]);
  const finished = mine?.status === "finished";
  const activeGameId = mine?.status === "active" ? mine.id : null;
  const win = await challengeWindow(date, now);
  const show = pick != null && (finished || (!win.open && activeGameId == null));
  const base: DailyChallengeState = {
    date, revealed: null, played: finished, activeGameId, gameId: mine?.id ?? null, my: null, ranking: [], streak: dailyStreak(dates, played, date),
    window: win,
  };
  if (!show || !pick) return base;
  const [rows, participants, excluded] = await Promise.all([
    ds.dailyGames(date), ds.dailyParticipants(date),
    pick.deskTraders > 0 ? ds.tradersOfTickerDay(pick.ticker, pick.barsDay) : Promise.resolve(new Set<string>()),
  ]);
  const mode = (await namesVisible(viewer)) ? "names" : "aliases";
  const { ranking, my } = buildRanking(rows, viewer.id, mode, deskAliases(participants, date), setting("trainer.dailyRankingTop"), excluded);
  return { ...base, revealed: { ticker: pick.ticker, barsDate: pick.barsDay }, my, ranking };
}

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

/** POST /api/trainer/daily/start: the viewer's game of the current challenge (created, resumed or the finished one). */
export async function startDaily(viewer: Viewer, now = new Date()): Promise<Snapshot> {
  if (!setting("trainer.dailyEnabled")) throw notFound("NOT_FOUND", { reason: "dailyDisabled" });
  const date = await currentChallengeDate(now);
  const pick = await ensurePick(date);
  if (!pick) throw notFound("NOT_FOUND", { reason: "noChallenge" });
  const mine = await ds.myDailyGame(viewer.id, date);
  forgetTrainerHome(viewer.id);
  if (mine?.status === "finished" || mine?.status === "active") return gameSnapshot(viewer, mine.id);
  if (!(await isOpen(date, now))) throw conflict("CONFLICT", { reason: "dailyClosed" });
  await settleActive(viewer);
  if (mine) {
    await simStore.reactivate(mine.id);
    return gameSnapshot(viewer, mine.id);
  }
  const day = await buildDay(pick.ticker, pick.barsDay);
  if (!day) throw notFound("NOT_FOUND", { reason: "noBars" });
  const { built, dayBars } = day;
  const price = built.bars[built.startIdx].c;
  const extras = await newGameExtras(viewer, price, dayBars, pick.barsDay);
  try {
    const g = await simStore.insertGame({
      userId: viewer.id, mode: "intraday", difficulty: "medium", ticker: pick.ticker, day: pick.barsDay, dayTo: null, tf: "1m",
      bars: built.bars, startIdx: built.startIdx, endIdx: built.endIdx, cursor: built.startIdx,
      params: {
        feePerShare: await simStore.deskFeePerShare(nyDate(now)),
        riskUnit: built.riskUnit,
        defaultQty: defaultQty(price),
        maxNotional: maxNotionalOf("intraday"),
        levels: built.levels,
        times: fakeTimes(built.bars, "intraday"),
        daily: { date },
        ...extras,
      },
    });
    return snapshotOf(remember(g), viewer);
  } catch (err) {
    // A double click / a second tab: the other request created it — hand back that game.
    if (!isUniqueViolation(err)) throw err;
    const again = await ds.myDailyGame(viewer.id, date);
    if (!again) throw err;
    return gameSnapshot(viewer, again.id);
  }
}

/**
 * POST /api/trainer/daily/practice — once the challenge's ranked window closed (the next session's morning) and the viewer did not
 * play it: the same ticker-day as an ordinary, unranked game (no `params.daily`, so it is in no ranking, streak or
 * quest of the challenge). UMID-07: «Задача дня» on a weekend used to be a dead end. Resumes an active game first.
 */
export async function startDailyPractice(viewer: Viewer, now = new Date()): Promise<Snapshot> {
  if (!setting("trainer.dailyEnabled")) throw notFound("NOT_FOUND", { reason: "dailyDisabled" });
  const date = await currentChallengeDate(now);
  if (await isOpen(date, now)) throw conflict("CONFLICT", { reason: "dailyOpen" });
  const pick = await ensurePick(date);
  if (!pick) throw notFound("NOT_FOUND", { reason: "noChallenge" });
  const mine = await ds.myDailyGame(viewer.id, date);
  if (mine?.status === "active") return gameSnapshot(viewer, mine.id);
  const day = await buildDay(pick.ticker, pick.barsDay);
  if (!day) throw notFound("NOT_FOUND", { reason: "noBars" });
  await settleActive(viewer);
  forgetTrainerHome(viewer.id);
  const { built, dayBars } = day;
  const price = built.bars[built.startIdx].c;
  const extras = await newGameExtras(viewer, price, dayBars, pick.barsDay);
  const g = await simStore.insertGame({
    userId: viewer.id, mode: "intraday", difficulty: "medium", ticker: pick.ticker, day: pick.barsDay, dayTo: null, tf: "1m",
    bars: built.bars, startIdx: built.startIdx, endIdx: built.endIdx, cursor: built.startIdx,
    params: {
      feePerShare: await simStore.deskFeePerShare(nyDate(now)),
      riskUnit: built.riskUnit,
      defaultQty: defaultQty(price),
      maxNotional: maxNotionalOf("intraday"),
      levels: built.levels,
      times: fakeTimes(built.bars, "intraday"),
      practice: { date },
      ...extras,
    },
  });
  return snapshotOf(remember(g), viewer);
}
