/**
 * «Серия из 10» controller on top of the game controller (use-sim-game): start a series, go to the next game (the
 * server has it prepared, so it is instant), skip a game (N — out of every stat; after a trade the server finishes it
 * instead, so a loss cannot be hidden), decide «не торгую» (T — a scored decision with a verdict), and the summary
 * after the last game. The series survives a reload (GET /sim/series/active, the game's `series` tag, storage).
 *
 * Fallbacks while the server has no series routes: a local series (10 ordinary games in a row, results read from the
 * finished games); skip / «не торгую» then stay hidden. A single free game also gets skip (→ a new game at the same
 * level) and «не торгую».
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { usePersistentState } from "@/components/ds";
import { simI18n } from "@/i18n/ns/simulator";
import { trainerI18n } from "@/i18n/ns/trainer";
import { isIntradayTf, simApi } from "./api";
import { routeMissing, seriesApi, type NoTradeVerdict, type SeriesState } from "./series-api";
import {
  advanceLocal, gameSeriesOf, gameVerdictOf, inSeries, isLocalSeries, localSeries, nextAction, recordResult, resultOfGame, type SeriesChoice,
} from "./series-model";
import { markGameRequested } from "./sim-chart";
import type { useSimGame } from "./use-sim-game";

type Sim = ReturnType<typeof useSimGame>;
type Stored = { series: SeriesState; choice: SeriesChoice } | null;

const DEFAULT_CHOICE: SeriesChoice = { mode: "intraday", difficulty: "easy", tf: "5m" };
const choiceFrom = (s: SeriesState, fallback: SeriesChoice | undefined): SeriesChoice =>
  s.mode && s.difficulty ? { mode: s.mode, difficulty: s.difficulty, tf: s.mode === "swing" ? null : s.tf ?? null } : fallback ?? DEFAULT_CHOICE;
const statusOf = (err: unknown) => (err as { status?: number } | null)?.status;

/** `enabled`: members only (a guest never asks the server for a series). */
export function useSeries(sim: Sim, enabled = true) {
  const { t } = trainerI18n.useT();
  const [stored, setStored] = usePersistentState<Stored>("trainer.series", null);
  const series = stored?.series ?? null;
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [verdicts, setVerdicts] = React.useState<Record<number, NoTradeVerdict>>({});
  // Server support, learned on the first call (unknown = assume yes).
  const [skipOk, setSkipOk] = React.useState(true);
  const [noTradeOk, setNoTradeOk] = React.useState(true);
  const storedRef = React.useRef(stored);
  storedRef.current = stored;

  const setSeries = React.useCallback((s: SeriesState | null, choice?: SeriesChoice) => {
    const cur = storedRef.current;
    const next: Stored = s ? { series: s, choice: choice ?? choiceFrom(s, cur?.choice) } : null;
    storedRef.current = next;
    setStored(next);
  }, [setStored]);

  /** Server answer → state, keeping the current game id when the server does not send one. */
  const merge = React.useCallback((s: SeriesState | null, gameId?: number | null) => {
    if (!s) return;
    const cur = storedRef.current?.series;
    const keep = cur && cur.id === s.id ? cur.gameId : null;
    setSeries({ ...s, gameId: gameId !== undefined ? gameId : s.gameId ?? keep ?? null });
  }, [setSeries]);

  const fail = React.useCallback((err: unknown) => {
    toast({ title: statusOf(err) === 404 ? simI18n.t("start.noScenarios") : humanizeApiError(err, simI18n.t("errors.load")), variant: "destructive" });
  }, []);

  const openSummary = React.useCallback(() => { sim.leave(); setSummaryOpen(true); }, [sim]);

  const startSeries = React.useCallback(async (choice: SeriesChoice) => {
    sim.setStarting(true);
    markGameRequested();
    setSummaryOpen(false);
    try {
      try {
        const r = await seriesApi.create({ ...choice, size: 10 });
        sim.load(r.game);
        setSeries(r.series ? { ...r.series, gameId: r.series.gameId ?? r.game.id } : localSeries(r.game.id), choice);
      } catch (err) {
        if (!routeMissing(err)) throw err;
        // No series routes on this server yet: 10 ordinary games in a row.
        const g = await simApi.create(choice.mode, choice.difficulty, choice.tf);
        sim.load(g);
        setSeries(localSeries(g.id), choice);
      }
      sim.invalidate();
    } catch (err) {
      fail(err);
    } finally {
      sim.setStarting(false);
    }
  }, [sim, setSeries, fail]);

  // A series game finished: record it (local) or refresh the server's results (progress dots on the result screen).
  const g = sim.game;
  const gameId = g?.meta.id ?? null;
  const tag = g ? gameSeriesOf(g.meta) : null;
  const doneId = g?.done ? gameId : null;
  React.useEffect(() => {
    const st = storedRef.current;
    const cur = sim.game;
    if (doneId == null || !st || !cur || !inSeries(st.series, doneId, gameSeriesOf(cur.meta)?.id)) return;
    if (isLocalSeries(st.series)) {
      setSeries(recordResult(st.series, resultOfGame(doneId, cur.state.trades.length, cur.reveal?.result.r ?? 0)));
      return;
    }
    if (st.series.results.some((x) => x.gameId === doneId)) return;
    let alive = true;
    seriesApi.get(st.series.id).then((s) => { if (alive) merge(s); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per finished game
  }, [doneId]);

  // A game tagged with a series we do not hold (reload, opened from the recent games): load that series.
  const tagId = tag?.id ?? null;
  React.useEffect(() => {
    if (tagId == null || storedRef.current?.series.id === tagId) return;
    let alive = true;
    seriesApi.get(tagId).then((s) => { if (alive && s) merge(s, s.finished ? null : s.gameId ?? gameId); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per tagged game
  }, [tagId]);

  // On mount: the server's active series wins over storage (finished elsewhere / gone → forget the stored one).
  React.useEffect(() => {
    if (!enabled) return;
    const st = storedRef.current;
    seriesApi.active().then((s) => {
      if (s && !s.finished) merge(s);
      else if (st && !isLocalSeries(st.series) && !st.series.finished) setSeries(null);
    }).catch((err) => {
      if (!routeMissing(err) || !st || isLocalSeries(st.series) || st.series.finished) return;
      seriesApi.get(st.series.id).then((s) => merge(s)).catch((e) => { if (statusOf(e) === 404) setSeries(null); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount (and sign-in) only
  }, [enabled]);

  /** The next game of the series; after the last one — the summary. */
  const next = React.useCallback(async () => {
    const st = storedRef.current;
    if (!st) return;
    const s = st.series;
    if (s.finished) { openSummary(); return; }
    sim.setStarting(true);
    markGameRequested();
    try {
      if (isLocalSeries(s)) {
        if (s.index + 1 >= s.size) { setSeries(advanceLocal(s, null)); openSummary(); return; }
        const ng = await simApi.create(st.choice.mode, st.choice.difficulty, st.choice.tf);
        setSeries(advanceLocal(s, ng.id));
        sim.load(ng);
        return;
      }
      const r = await seriesApi.next(s.id);
      if (r.game) {
        merge(r.series ?? { ...s, index: s.index + 1 }, r.game.id);
        sim.load(r.game);
      } else {
        merge({ ...(r.series ?? s), finished: true }, null);
        openSummary();
      }
      sim.invalidate();
    } catch (err) {
      fail(err);
    } finally {
      sim.setStarting(false);
    }
  }, [sim, setSeries, merge, fail, openSummary]);

  /** N: skip this game and go straight to the next one (after a trade the server finishes it → its result). */
  const skip = React.useCallback(async () => {
    const cur = sim.game;
    if (!cur || cur.done) return;
    await sim.halt();
    const st = storedRef.current;
    const ofSeries = !!st && !isLocalSeries(st.series) && inSeries(st.series, cur.meta.id, gameSeriesOf(cur.meta)?.id);
    try {
      const r = await seriesApi.skip(cur.meta.id);
      if (r.series) merge(r.series);
      sim.invalidate();
      if (r.outcome === "finished") {
        if (r.snapshot) sim.load(r.snapshot); else await sim.open(cur.meta.id);
      } else if (ofSeries) {
        await next();
      } else {
        await sim.start(cur.meta.mode, cur.meta.difficulty, isIntradayTf(cur.meta.tf) ? cur.meta.tf : null);
      }
    } catch (err) {
      if (routeMissing(err)) { setSkipOk(false); toast({ title: t("series.skipUnavailable") }); }
      else toast({ title: humanizeApiError(err, simI18n.t("errors.load")), variant: "destructive" });
    }
  }, [sim, merge, next, t]);

  /** T: «не торгую» — the game ends with the reveal and a verdict (was there a clean setup?). */
  const noTrade = React.useCallback(async () => {
    const cur = sim.game;
    if (!cur || cur.done || cur.state.pos !== 0 || cur.state.trades.length > 0) return;
    await sim.halt();
    try {
      const r = await seriesApi.noTrade(cur.meta.id);
      const verdict = r.verdict;
      if (verdict) setVerdicts((v) => ({ ...v, [cur.meta.id]: verdict }));
      if (r.series) merge(r.series);
      if (r.snapshot) sim.load(r.snapshot); else await sim.open(cur.meta.id);
      sim.invalidate();
    } catch (err) {
      if (routeMissing(err)) { setNoTradeOk(false); toast({ title: t("series.noTradeUnavailable") }); }
      else toast({ title: humanizeApiError(err, simI18n.t("errors.load")), variant: "destructive" });
    }
  }, [sim, merge, t]);

  const verdictOf = React.useCallback(
    (id: number) => verdicts[id] ?? (g && g.meta.id === id ? gameVerdictOf(g.meta) : null),
    [verdicts, g],
  );

  const current = inSeries(series, gameId, tag?.id) ? series : null;
  const free = !!g && !g.meta.own && !g.meta.trainer;
  const serverOk = !current || !isLocalSeries(current);
  return {
    series, choice: stored?.choice ?? null, current, summaryOpen, verdictOf,
    startSeries, next, openSummary, action: nextAction(series, gameId, tag?.id),
    onSkip: free && skipOk && serverOk ? skip : undefined,
    onNoTrade: free && noTradeOk && serverOk ? noTrade : undefined,
    closeSummary: () => setSummaryOpen(false),
    exit: () => { setSummaryOpen(false); setSeries(null); },
  };
}
