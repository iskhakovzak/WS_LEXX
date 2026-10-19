/**
 * /trainer — «Тренажёр»: ONE trainer instead of three (the chart-lab training, the simulator, «Мои худшие дни»).
 * Home: four mode cards (components/sim/trainer-home) — «Задача дня», «Найди вход», «Мои дни», «Свободная игра» — and
 * the 30-day line; below, the recent games and the week of the desk. A game (daily / own / free) opens the simulator
 * game screen; «Найди вход» opens a run of 10 drills. Everything is stored on the server (lib/trainer/types).
 * Free play's main entry is «Серия из 10» (components/sim/use-series): the result's big «Следующий (Enter)» deals the
 * next game, skip (N) / «не торгую» (T) go to the game screen, the summary follows the last game; «Задача дня» and
 * «Мои дни» end with «Дальше: серия из 10» (closure).
 *
 * Deep links: `?game=<id>` opens one of the viewer's games (review), `?own=<tradeId>` replays that own trade (the trade
 * sheet's «Переиграть этот день»), `?drill=<setupId|all>` starts a «Найди вход» run. /simulator and the old chart-lab
 * training redirect here.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Dumbbell } from "lucide-react";
import { BentoGrid, EmptyState, Page, PageHeader, usePersistentState } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { trainerI18n } from "@/i18n/ns/trainer";
import { activeGameQuery, isIntradayTf, type Difficulty, type IntradayTf, type SimMode, type Snapshot } from "@/components/sim/api";
import { isSpeed, type Speed } from "@/components/sim/model";
import { useSimGame } from "@/components/sim/use-sim-game";
import { GameScreen, type Ticket } from "@/components/sim/game-screen";
import { RecentGames, WeeklyBoard } from "@/components/sim/start-screen";
import { TrainerCards, TrainerStatsLine, type HomeActions } from "@/components/sim/trainer-home";
import { FindEntryRun } from "@/components/sim/find-entry-run";
import { useSeries } from "@/components/sim/use-series";
import { SeriesProvider, readSeriesChoice, type SeriesCtx } from "@/components/sim/series-context";
import { SeriesSummary } from "@/components/sim/series-summary";
import { gameSeriesOf, inSeries, seriesPos } from "@/components/sim/series-model";
import { trainerHomeQuery } from "@/components/sim/trainer-api";
import { trackAction } from "@/lib/usage";

/** `?drill=` value → a run: a setup id, or null = all setups. Undefined = no run requested. */
function drillParam(search: string): number | null | undefined {
  const v = new URLSearchParams(search).get("drill");
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function setUrlParams(set: Record<string, string | null>) {
  const sp = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(set)) if (v == null) sp.delete(k); else sp.set(k, v);
  const q = sp.toString();
  const next = `${window.location.pathname}${q ? `?${q}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
}

export default function TrainerPage() {
  const { t } = trainerI18n.useT();
  const { user } = useAuth();
  const search = useSearch();
  const guest = user?.role === "guest";

  const [speedRaw, setSpeed] = usePersistentState<number>("sim.speed", 4);
  const speed: Speed = isSpeed(speedRaw) ? speedRaw : 4;
  const [autoStop, setAutoStop] = usePersistentState("sim.autoStop", true);
  const [autoTarget, setAutoTarget] = usePersistentState("sim.autoTarget", false);
  const [riskSize, setRiskSize] = usePersistentState("sim.riskSize", false);
  const [planStop, setPlanStop] = React.useState<number | null>(null);
  const [qty, setQty] = React.useState(100);
  const [run, setRun] = React.useState<{ setupId: number | null; key: number } | null>(null);

  const sim = useSimGame({ qty, autoStop, autoTarget, riskSize, planStop }, speed);
  const { game, start, startOwn, startDaily, startDailyPractice, open, load, starting } = sim;
  const series = useSeries(sim, !guest);
  const gameId = game?.meta.id ?? null;
  const defaultQty = game?.meta.defaultQty ?? null;
  React.useEffect(() => { if (defaultQty != null) setQty(defaultQty); setPlanStop(null); }, [gameId, defaultQty]);

  // Opening a game / a drill run / coming back home: start at the top (#main-content keeps its scroll otherwise).
  const view = gameId != null ? `g${gameId}` : run ? `r${run.key}` : series.summaryOpen ? "summary" : "home";
  React.useEffect(() => { document.getElementById("main-content")?.scrollTo({ top: 0 }); }, [view]);

  const active = useQuery({ ...activeGameQuery(), enabled: !guest });
  const home = useQuery({ ...trainerHomeQuery(), enabled: !guest });

  // Deep links (each handled once).
  const opened = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (guest) return;
    const sp = new URLSearchParams(search);
    const id = Number(sp.get("game"));
    const tradeId = Number(sp.get("own"));
    const drill = drillParam(search);
    if (id > 0 && opened.current !== `g:${id}` && gameId !== id) {
      opened.current = `g:${id}`;
      void open(id);
    } else if (tradeId > 0 && opened.current !== `own:${tradeId}`) {
      opened.current = `own:${tradeId}`;
      trackAction("trainer.start", { mode: "my_days" });
      void startOwn("trade", tradeId);
    } else if (drill !== undefined && opened.current !== `d:${drill}`) {
      opened.current = `d:${drill}`;
      trackAction("trainer.start", { mode: "find_entry" });
      setRun({ setupId: drill, key: Date.now() });
    }
  }, [search, guest, gameId, open, startOwn]);
  // Keep the URL in sync: a finished game stays linkable for its review; the own / drill params are one-shot.
  // A `?game=` written here is ours, not a deep link: marked as handled, so moving on to the next game (series,
  // «again») never reopens the previous one.
  React.useEffect(() => {
    const linked = gameId != null && game?.done ? String(gameId) : null;
    if (linked) opened.current = `g:${linked}`;
    setUrlParams({ own: null, game: linked, ...(run ? {} : { drill: null }) });
  }, [gameId, game?.done, run]);

  const startSeries = series.startSeries;
  const nextInSeries = series.next;
  const seriesAction = series.action;
  const again = React.useCallback(() => {
    if (!game) return;
    // A series game: the next one (instant — prepared by the server), or the summary after the last one.
    if (seriesAction) { void nextInSeries(); return; }
    // «Задача дня» is played once: its result leads on to a series (closure).
    if (game.meta.trainer) { trackAction("trainer.start", { mode: "free" }); void startSeries(readSeriesChoice()); return; }
    const own = game.meta.own;
    if (own) { void startOwn(own.pick === "trade" ? "worst" : own.pick, undefined, isIntradayTf(game.meta.tf) ? game.meta.tf : null); return; }
    void start(game.meta.mode, game.meta.difficulty, isIntradayTf(game.meta.tf) ? game.meta.tf : null);
  }, [game, start, startOwn, seriesAction, nextInSeries, startSeries]);

  const actions: HomeActions = {
    starting,
    active: active.data ?? null,
    onDaily: () => { trackAction("trainer.start", { mode: "daily" }); void startDaily(); },
    onDailyPractice: () => { trackAction("trainer.start", { mode: "daily" }); void startDailyPractice(); },
    onOpenGame: (id) => { if (active.data?.id === id) load(active.data); else void open(id); },
    onResume: () => { if (active.data) load(active.data); },
    onMyDays: (pick) => { trackAction("trainer.start", { mode: "my_days" }); void startOwn(pick, undefined, "1m"); },
    onFindEntry: (setupId) => { trackAction("trainer.start", { mode: "find_entry" }); setRun({ setupId, key: Date.now() }); setUrlParams({ drill: setupId != null ? String(setupId) : "all" }); },
    onFree: (mode: SimMode, level: Difficulty, tf: IntradayTf | null) => { trackAction("trainer.start", { mode: "free" }); void start(mode, level, tf); },
    onSeries: (choice) => { trackAction("trainer.start", { mode: "free" }); void startSeries(choice); },
    series: activeSeries(series.series, active.data ?? null),
  };

  const ctx: SeriesCtx = {
    series: series.series,
    verdictOf: series.verdictOf,
    startSeries: () => { trackAction("trainer.start", { mode: "free" }); void startSeries(readSeriesChoice()); },
    starting,
  };
  const gameSeries = series.current && !series.current.finished ? { index: series.current.index, size: series.current.size } : undefined;

  const ticket: Ticket = { qty, setQty, speed, setSpeed, autoStop, setAutoStop, autoTarget, setAutoTarget, riskSize, setRiskSize, planStop, setPlanStop };

  if (game) {
    return (
      <Page width="full">
        <SeriesProvider value={ctx}>
          <GameScreen game={game} c={{ ...sim, again }} k={ticket} onSkip={series.onSkip} onNoTrade={series.onNoTrade} series={gameSeries} />
        </SeriesProvider>
      </Page>
    );
  }

  if (series.summaryOpen && series.series && !guest) {
    const done = series.series;
    return (
      <Page>
        <SeriesSummary
          series={done} starting={starting}
          onReplay={(id) => { series.closeSummary(); void open(id); }}
          onAgain={() => { trackAction("trainer.start", { mode: "free" }); void startSeries(series.choice ?? readSeriesChoice()); }}
          onHome={series.exit}
        />
      </Page>
    );
  }

  if (run && !guest) {
    return (
      <Page width="full">
        <FindEntryRun key={run.key} setupId={run.setupId} onExit={() => { setRun(null); opened.current = null; setUrlParams({ drill: null }); }} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} icon={Dumbbell} meta={<TrainerStatsLine stats={home.data?.stats} />} />
      {guest ? (
        <EmptyState icon={Dumbbell} title={t("title")} description={t("guest")} />
      ) : (
        <>
          <TrainerCards home={home.data} loading={home.isLoading} error={home.isError ? home.error : null} onRetry={() => void home.refetch()} a={actions} />
          <BentoGrid>
            <RecentGames onOpen={(id) => void open(id)} />
            <WeeklyBoard />
          </BentoGrid>
        </>
      )}
    </Page>
  );
}

/** The home card's «Продолжить серию · 3 / 10»: only when the active game is the current game of an unfinished series. */
function activeSeries(s: ReturnType<typeof useSeries>["series"], active: Snapshot | null): { n: number; size: number } | null {
  if (!s || s.finished || !active || !inSeries(s, active.id, gameSeriesOf(active)?.id)) return null;
  return seriesPos(s);
}
