/**
 * «Найди вход» service: GET /api/trainer/drill/next?setupId= and POST /api/trainer/drill/:id/answer.
 *
 * No leak before the answer: a served drill carries bars with fake times (real NY wall clock on a fake date), the
 * window and the setup — never the ticker, the date, the source trade or the reference entry. The answer adds them.
 * Picking: drills of the viewer's own trades are never served; unanswered drills first (when every drill was answered,
 * the one answered longest ago comes back for practice); the setup is drawn with weight 110 − the viewer's average
 * first-answer score on it (unseen setups count as 50) — weak setups come up more often.
 * Day rule (owner 2026-10-25, lib/sim/catalyst.ts): only drills on days that opened ≥ trainer.minGapPct from the
 * previous close with a catalyst; with none left the run says so (404 noDrills) — the rule is never relaxed. A drill
 * carries «Контекст дня» (gap, catalyst masked until the answer, cap, float, premarket volume) and the long daily chart
 * before the day (fake dates); the answer adds the full catalyst text.
 */
import { badRequest, notFound } from "../http";
import { logger } from "../logger";
import { setting } from "../settings/registry";
import type { SimBar } from "../sim/engine";
import * as simStore from "../sim/store";
import type { Viewer } from "../sim/service";
import { forgetTrainerHome } from "./cache";
import { buildDrill, scoreAnswer, splitSetupName, verdictOf, type BuiltDrill } from "./drills";
import * as store from "./drillStore";
import type { FindEntryAnswer, FindEntryDrill, TrainerDayContext } from "./types";
import { isGapDay } from "../sim/catalyst";
import { archivedGaps, catalystKeys, dayKey } from "../sim/catalystStore";
import { dailyWire, dayContextOf, dayInfoOf, longDailyBefore, premarketVolume, yearRange } from "../sim/context";

const ENSURE_EVERY_MS = 10 * 60_000;
let ensuredAt = 0;
let ensuring: Promise<void> | null = null;

/** Creates missing drills at most every 10 minutes (and from the daily job); never fails a request. Only the very first
 *  run of a process is awaited by a request (there may be no drills yet); later refreshes run in the background. */
export async function ensureDrillsThrottled(force = false): Promise<void> {
  if (!force && Date.now() - ensuredAt < ENSURE_EVERY_MS) return;
  if (!ensuring) {
    ensuring = store
      .ensureDrills(setting("trainer.drillMinExamples"), setting("trainer.drillMaxPerSetup"))
      .then(() => { ensuredAt = Date.now(); })
      .catch((err) => { logger.warn({ err }, "trainer: drill build failed"); })
      .finally(() => { ensuring = null; });
  }
  await ensuring;
}

const built = new Map<string, (BuiltDrill & { prevClose: number | null }) | null>();

/** For tests. */
export function _resetDrillMemo(): void { built.clear(); ensuredAt = 0; }

async function buildOf(d: store.DrillRow): Promise<(BuiltDrill & { prevClose: number | null }) | null> {
  const windowBars = setting("trainer.drillWindowBars");
  const key = `${d.id}|${windowBars}`;
  if (built.has(key)) return built.get(key) ?? null;
  const data = await simStore.loadDayBars(d.ticker, d.day);
  const raw = data && data.tf === "1m" ? buildDrill({ drillId: d.id, day: d.day, dayBars: data.bars, entryAt: d.entryAt, entryPrice: d.entryPrice, windowBars }) : null;
  const b = raw ? { ...raw, prevClose: data?.prevClose ?? null } : null;
  if (built.size > 300) built.delete(built.keys().next().value as string);
  built.set(key, b);
  return b;
}

const wire = (bars: readonly SimBar[], times: readonly number[]) => bars.map((b, i) => ({ t: times[i], o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

/** Drills whose day passes the day rule (gap ≥ trainer.minGapPct up or down + a catalyst). */
export async function eligibleDrills<T extends { ticker: string; day: string }>(drills: readonly T[]): Promise<{ list: T[]; gaps: Map<string, number | null> }> {
  const minGap = setting("trainer.minGapPct");
  const gaps = await archivedGaps(drills);
  const gapped = drills.filter((d) => isGapDay(gaps.get(dayKey(d)), minGap));
  const cats = await catalystKeys(gapped);
  return { list: gapped.filter((d) => cats.has(dayKey(d))), gaps };
}

/** «Контекст дня» of a drill: masked before the answer, full after. */
async function drillContext(d: store.DrillRow, b: BuiltDrill & { prevClose: number | null }, gapPct: number | null, revealed: boolean): Promise<TrainerDayContext> {
  const info = await dayInfoOf(d.ticker, d.day);
  return dayContextOf(info, { revealed, gapPct, gapAt: "open", prevClose: b.prevClose, pmVolume: premarketVolume(b.bars, d.day, b.bars.length - 1) });
}

async function drillView(d: store.DrillRow, b: BuiltDrill & { prevClose: number | null }, gapPct: number | null): Promise<FindEntryDrill> {
  const { code, name } = splitSetupName(d.setupName);
  const [daily, day] = await Promise.all([longDailyBefore(d.ticker, d.day), drillContext(d, b, gapPct, false)]);
  const range = yearRange(daily);
  return {
    id: d.id, setupId: d.setupId, setupCode: code, setupName: name, side: d.side, tf: "1m", bars: wire(b.bars, b.times), window: b.window,
    context: {
      day,
      daily: dailyWire(daily.slice(-250), false).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })),
      levels: { pdc: b.prevClose ?? daily[daily.length - 1]?.c ?? null, hi52: range.hi52, lo52: range.lo52 },
    },
  };
}

/** Order of drills to try: setup by weakness weight, then unanswered (random) / answered longest ago. */
export function drillOrder(drills: readonly store.ServableDrill[], avg: ReadonlyMap<number, number>, rnd: () => number = Math.random): store.ServableDrill[] {
  const fresh = drills.filter((d) => !d.answered);
  if (!fresh.length) return [...drills].sort((a, b) => (a.lastAnsweredAt ?? 0) - (b.lastAnsweredAt ?? 0));
  const bySetup = new Map<number, store.ServableDrill[]>();
  for (const d of fresh) bySetup.set(d.setupId, [...(bySetup.get(d.setupId) ?? []), d]);
  const setups = [...bySetup.keys()].map((id) => ({ id, k: Math.pow(Math.max(rnd(), 1e-12), 1 / Math.max(1, 110 - (avg.get(id) ?? 50))) }));
  setups.sort((a, b) => b.k - a.k);
  const out: store.ServableDrill[] = [];
  for (const s of setups) {
    const list = [...(bySetup.get(s.id) ?? [])];
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    out.push(...list);
  }
  return out;
}

export async function nextDrill(viewer: Viewer, setupId: number | null, rnd: () => number = Math.random): Promise<FindEntryDrill> {
  if (ensuredAt === 0) await ensureDrillsThrottled();
  else void ensureDrillsThrottled();
  const [all, avg] = await Promise.all([store.servableDrills(viewer.id, viewer.name, setupId), store.avgScoreBySetup(viewer.id)]);
  const { list: drills, gaps } = await eligibleDrills(all);
  for (const d of drillOrder(drills, avg, rnd).slice(0, 8)) {
    const b = await buildOf(d);
    if (b) return drillView(d, b, gaps.get(dayKey(d)) ?? null);
    await store.disableDrill(d.id);
  }
  throw notFound("NOT_FOUND", { reason: "noDrills" });
}

export async function answerDrill(viewer: Viewer, id: number, yours: { barIndex: number; price: number }): Promise<FindEntryAnswer> {
  const d = await store.drillById(id);
  if (!d || d.trader === viewer.name) throw notFound("NOT_FOUND");
  const b = await buildOf(d);
  if (!b) throw notFound("NOT_FOUND", { reason: "noBars" });
  if (yours.barIndex < 0 || yours.barIndex >= b.bars.length) throw badRequest("VALIDATION", { reason: "barIndex" });
  const tol = { bars: setting("trainer.drillBarTolerance"), atr: setting("trainer.drillAtrTolerance") };
  const pass = setting("trainer.drillPassScore");
  const score = scoreAnswer(b.ideal, yours, b.atr, tol);
  const passed = score >= pass;
  const first = await store.insertAttempt({ drillId: d.id, userId: viewer.id, trader: viewer.name, setupId: d.setupId, barIndex: yours.barIndex, price: yours.price, score, passed });
  forgetTrainerHome(viewer.id);
  const barsOff = Math.abs(yours.barIndex - b.ideal.barIndex);
  const atrOff = Math.round((Math.abs(yours.price - b.ideal.price) / b.atr) * 10) / 10;
  const { code, name } = splitSetupName(d.setupName);
  return {
    score,
    ideal: b.ideal,
    yours,
    explanation: {
      key: `trainer.findEntry.verdict.${verdictOf(b.ideal, yours, b.atr, score, pass)}`,
      params: { bars: barsOff, atr: atrOff, score, setup: code ? `${code} ${name}` : name },
    },
    revealed: { ticker: d.ticker, date: d.day, source: d.source },
    context: { day: await drillContext(d, b, (await archivedGaps([d])).get(dayKey(d)) ?? null, true) },
    barsAfter: wire(b.after, b.afterTimes),
    masteryDelta: first && passed ? 1 : 0,
  };
}
