/**
 * The game: chart (left, takes the space) + one side column (HUD while playing, the verdict after). Focus mode —
 * nothing else on the page competes with the chart (UX §4a.2). Keys (DAS-like, can be switched off) work page-wide
 * except while typing in a field (use-game-keys). After the reveal the details (trades, mistakes, the desk) open under
 * the chart. Own mode («Мои дни») swaps the «hidden» badge for «your trade · ticker · date», adds the decision tile on
 * top of the HUD and the real-entry marker on the chart, and shows the then-vs-now verdict (own-result.tsx). «Задача
 * дня» shows its badge and, after the finish, the reveal with the desk ranking (daily-reveal.tsx).
 *
 * «Как торговый экран» (Тренажёр 2): a timeframe switcher over the chart (keys 1–4; base bars aggregated on the client,
 * the last candle forming bar by bar — tf-model.ts), a daily mini panel (Д) and a brief card at the start (gap, PDH /
 * PDL / PMH / PML, ATR — GET /sim/games/:id/context), the view «Дневка» (the long daily chart: 250 days, previous close,
 * 52-week high / low, the gap), «Контекст дня» on top of the side column (gap, catalyst masked until the reveal, cap,
 * float, premarket volume — every trainer day gapped ≥ 7 % with a catalyst), size in bases ½ · 1 · 2 · 3 (Shift+1..4), a TradingView-like
 * position box (use-game-overlay; lines draggable by mouse and finger, Shift / Alt+click or the long-press menu to
 * place them), auto stop + target on entry (use-entry-bracket), playback 1× / 5× / 30× with → = to the close of the
 * current candle, Shift+→ = jump to the next event, and an automatic pause when a stop / target fills. Series games
 * (FLOW supplies the handlers) show «3 / 10», «Пропустить (N)» and, while flat with no trade yet, «Не торгую (T)».
 * Mobile: a shorter chart with the main buttons right under it (everything playable by touch, mobile-bar.tsx).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, EyeOff, Flag, Keyboard, LogOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pill, usePersistentState } from "@/components/ds";
import { fmtDate, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";
import { simOwnI18n } from "@/i18n/ns/simOwn";
import { trainerI18n } from "@/i18n/ns/trainer";
import { gameContextQuery, type SimEvent } from "./api";
import { BASE_MULTS, PACES, baseQty, fromWire } from "./model";
import type { ChartToggles } from "./sim-chart";
import { BracketBox, FillsLog, KeysHint, OrderPad, PlayBar, PositionCard } from "./hud";
import { LevelPill, ResultDetails, ResultSummary } from "./result";
import { OwnRealTrade, OwnResultSummary } from "./own-result";
import { DailyReveal } from "./daily-reveal";
import { useFinePointer } from "./use-fine-pointer";
import { usePlayback } from "./use-playback";
import { TF_MINUTES, baseTfOf, displayTfsOf, formingInfo, pickDisplayTf, stepToClose, tfMinutes, todayCandle, type DisplayTf } from "./tf-model";
import { SizeBar } from "./size-bar";
import { ChartStage, type PlaceMenu } from "./chart-stage";
import { ChartToolbar, type ChartView } from "./chart-toolbar";
import { DayContextCard } from "./day-context";
import { MobileBar } from "./mobile-bar";
import { useGameKeys } from "./use-game-keys";
import { useEntryBracket } from "./use-entry-bracket";
import { useGameOverlay } from "./use-game-overlay";
import type { GameControls, Ticket } from "./game-types";
import type { GameView } from "./use-sim-game";

export type { GameControls, Ticket } from "./game-types";

const EVENT_KINDS = ["pdh", "pdl", "pmh", "pml", "hod", "lod", "vwap", "volume"] as const;
/** A mouse click leaves no focus on the button, so Space stays «play» after the finish dialog closes (focus returns). */
const noFocus = (e: React.PointerEvent) => e.preventDefault();

export function GameScreen({
  game, c, k, onSkip, onNoTrade, series,
}: {
  game: GameView;
  c: GameControls;
  k: Ticket;
  /** Series: skip this chart (N). */
  onSkip?: () => void;
  /** Series: «no trade» decision (T), only while flat with no trade yet. */
  onNoTrade?: () => void;
  /** Series position, `index` 0-based (shown «index + 1 / size»). */
  series?: { index: number; size: number };
}) {
  const { t } = simI18n.useT();
  const [toggles, setToggles] = usePersistentState<ChartToggles>("sim.chart", { vwap: true, levels: true, ma: true });
  const [hotkeys, setHotkeys] = usePersistentState("sim.hotkeys", true);
  const fine = useFinePointer();
  const [tfPref, setTfPref] = usePersistentState<string | null>("sim.tf", null);
  const [hiddenDesk, setHiddenDesk] = React.useState<Set<string>>(new Set());
  const [confirmFinish, setConfirmFinish] = React.useState(false);
  const [planTarget, setPlanTarget] = React.useState<number | null>(null);
  const [menu, setMenu] = React.useState<PlaceMenu | null>(null);
  const done = game.done;
  const meta = game.meta;
  const daily = meta.trainer?.mode === "daily";
  const intraday = meta.mode === "intraday";
  const { pos } = game.state;
  const price = game.feed.bars[game.cursor]?.c ?? 0;
  const [view, setView] = React.useState<ChartView>("intraday");
  React.useEffect(() => { setPlanTarget(null); setMenu(null); setView("intraday"); }, [meta.id]);

  // ── Timeframes ──────────────────────────────────────────────────────────
  const tfs = React.useMemo(() => displayTfsOf(meta), [meta]);
  const dispTf = pickDisplayTf(tfs, tfPref, meta);
  const baseMin = tfMinutes(baseTfOf(meta)) ?? 1;
  const dispMin = dispTf ? TF_MINUTES[dispTf] : baseMin;
  const forming = intraday ? formingInfo(game.feed.bars, baseMin, dispMin) : null;
  const setTf = React.useCallback((tf: DisplayTf) => setTfPref(tf), [setTfPref]);

  // ── Daily context, levels, brief ────────────────────────────────────────
  const dc = useDailyContext(game, fine);

  // A planned stop belongs to the next entry: it becomes the position's stop and is cleared.
  const { planStop, setPlanStop } = k;
  React.useEffect(() => { if (pos !== 0 && planStop != null) setPlanStop(null); }, [pos, planStop, setPlanStop]);

  // One «auto stop + target» switch drives both ticket flags.
  const auto = k.autoStop;
  const { autoTarget, setAutoTarget, setAutoStop } = k;
  React.useEffect(() => { if (autoTarget !== auto) setAutoTarget(auto); }, [auto, autoTarget, setAutoTarget]);
  const setAuto = React.useCallback((v: boolean) => { setAutoStop(v); setAutoTarget(v); }, [setAutoStop, setAutoTarget]);

  // ── Playback, automatic bracket, overlay ────────────────────────────────
  const pb = usePlayback({ next: (n) => c.next(n), active: !done, external: { playing: c.playing, setPlaying: c.setPlaying } });
  const { setPlaying: setPb } = pb;
  const { setPlaying: setCtl } = c;
  const pauseAll = React.useCallback(() => { setPb(false); setCtl(false); }, [setPb, setCtl]);
  const eb = useEntryBracket({ game, c, levels: dc.levels, auto, riskSize: k.riskSize, planStop, planTarget, setPlanTarget, pauseAll });
  const ov = useGameOverlay({ game, c, k, planTarget, setPlanTarget, hiddenDesk });

  // ── Actions shared by keys and buttons ──────────────────────────────────
  const canNoTrade = !done && pos === 0 && game.state.trades.length === 0 && game.state.fills.length === 0;
  const step = () => c.next(stepToClose(forming));
  const jump = c.nextEvent ? () => { eb.setNotice(null); c.nextEvent?.(); } : null;
  const setBase = (i: number) => { const m = BASE_MULTS[i]; if (m != null && !k.riskSize) k.setQty(baseQty(meta.defaultQty, m)); };
  const clearPlan = () => {
    if (planStop == null && planTarget == null) return false;
    setPlanStop(null); setPlanTarget(null);
    return true;
  };
  useGameKeys({
    c, k, game, enabled: hotkeys, blocked: confirmFinish, brief: dc.brief, closeBrief: dc.closeBrief, menuOpen: !!menu, closeMenu: () => setMenu(null),
    tfs, setTf, togglePlay: pb.toggle, faster: pb.faster, slower: pb.slower, pauseAll, step, jump, setBase, clearPlan, onSkip, onNoTrade, canNoTrade,
  });

  const total = meta.endIdx - meta.startIdx;
  const played = game.cursor - meta.startIdx;
  const slip = meta.slippage;
  const feeText = meta.own ? simOwnI18n.t("hudFee", { value: fmtUsd(meta.feePerShare, { decimals: 4 }) }) : t("hud.fee", { value: fmtUsd(meta.feePerShare, { decimals: 4 }) });
  const ser = series ?? (meta.series ? { index: meta.series.index, size: meta.series.size } : null);
  const event = game.event ?? null;
  const oneR = meta.oneR ?? null;

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <div className="flex flex-wrap items-center gap-2">
        {ser && <Pill tone="accent" title={t("flow.seriesLabel", { index: ser.index + 1, size: ser.size })}><span data-testid="sim-series">{t("flow.series", { index: ser.index + 1, size: ser.size })}</span></Pill>}
        {meta.own ? (
          <Pill tone="accent"><RotateCcw aria-hidden="true" />{simOwnI18n.t("banner.pill", { ticker: meta.own.ticker, date: fmtDate(meta.own.date, "medium") })}</Pill>
        ) : (
          <>
            {daily ? <Pill tone="accent"><CalendarCheck aria-hidden="true" />{trainerI18n.t("daily.pill")}</Pill> : <LevelPill mode={meta.mode} difficulty={meta.difficulty} />}
            {!done && <Pill tone="neutral"><EyeOff aria-hidden="true" />{t("hiddenBadge")}</Pill>}
          </>
        )}
        <div className="flex min-w-[8rem] flex-1 items-center gap-2" aria-hidden="true">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--glass-bg)]">
            <div className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur-1)] motion-reduce:transition-none" style={{ width: `${total > 0 ? (played / total) * 100 : 0}%` }} />
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{t("hud.bar", { played, total })}</span>
        </div>
        {!done && (
          <>
            <Button onPointerDown={noFocus} variant="outline" size="sm" onClick={() => setConfirmFinish(true)}><Flag aria-hidden="true" /> {t("hud.finish")}</Button>
            <Button onPointerDown={noFocus} variant="ghost" size="sm" onClick={c.leave} title={t("hud.exitHint")}><LogOut aria-hidden="true" /> {t("hud.exit")}</Button>
          </>
        )}
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-2">
          <ChartToolbar
            tfs={tfs} tf={dispTf} setTf={setTf} fine={fine} intraday={intraday}
            canDaily={intraday && dc.dailyBars.length > 0} showDaily={dc.showDaily} toggleDaily={dc.toggleDaily} view={view} setView={setView}
            forming={done ? null : forming} toggles={toggles} setToggles={setToggles}
            onNoTrade={onNoTrade && canNoTrade ? onNoTrade : null} onSkip={onSkip && !done ? onSkip : null}
          />
          <ChartStage
            game={game} overlay={ov.overlay} toggles={toggles} levels={dc.levels} baseMin={baseMin} dispMin={dispMin}
            onDragLine={ov.onDragLine} dragLabel={ov.dragLabel} onPlace={ov.place} menu={menu} setMenu={setMenu}
            daily={dc.dailyBars} today={dc.today} showDaily={dc.showDaily}
            chip={eb.notice ?? (event ? eventLabel(event, t) : null)} chipWarn={!!eb.notice}
            brief={dc.brief && dc.ctx ? dc.ctx.levels : null} onCloseBrief={dc.closeBrief}
            view={view} dailyLevels={dc.ctx ? { pdc: dc.levels.pdc ?? dc.ctx.levels.pdc, hi52: dc.ctx.levels.hi52, lo52: dc.ctx.levels.lo52 } : undefined}
            gapPct={dc.ctx?.day?.gapPct ?? dc.ctx?.levels.gapPct ?? null} day={dc.ctx?.day ?? null}
          />
          {!done && (
            <MobileBar
              pos={pos} c={c} playing={pb.playing} onToggle={pb.toggle} onStep={step} onEvent={jump}
              pace={pb.pace} onPace={() => pb.setPace(PACES[(PACES.indexOf(pb.pace) + 1) % PACES.length])}
              size={<SizeBar compact base={meta.defaultQty} qty={k.qty} setQty={k.setQty} price={price} risk={k.riskSize && oneR != null && pos === 0 ? { oneR, shares: ov.planQty } : null} />}
            />
          )}
        </div>
        <aside className="glass-panel flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl p-[var(--panel-p)] lg:h-[calc(100dvh-13rem)] lg:min-h-[480px]">
          {done ? (
            <>
              {game.reveal?.own
                ? <OwnResultSummary game={game} onAgain={c.again} onStart={c.leave} starting={c.starting} />
                : <ResultSummary game={game} onAgain={c.again} onStart={c.leave} starting={c.starting} noAgain={daily} />}
              {dc.ctx?.day && <DayContextCard day={dc.ctx.day} revealed />}
            </>
          ) : (
            <>
              {dc.ctx?.day && <DayContextCard day={dc.ctx.day} revealed={false} compact />}
              {meta.own && <OwnMoment cursor={game.cursor} decisionIdx={meta.own.decisionIdx} />}
              <PositionCard game={game} />
              <OrderPad
                game={game} qty={k.qty} setQty={k.setQty} onOrder={c.order} onUndo={c.undo} onBreakEven={c.breakEven} disabled={false}
                riskSize={k.riskSize} setRiskSize={k.setRiskSize} planStop={planStop} fine={fine}
              />
              <BracketBox
                game={game} auto={auto} setAuto={setAuto} onBracket={c.setBracket} disabled={false}
                planStop={planStop} setPlanStop={setPlanStop} planTarget={planTarget} setPlanTarget={setPlanTarget} fine={fine} autoNote={eb.autoNote}
              />
              <FillsLog game={game} />
              <div className="mt-auto flex flex-col gap-3">
                <div className="hidden lg:block">
                  <PlayBar game={game} playing={pb.playing} onToggle={pb.toggle} pace={pb.pace} setPace={pb.setPace} onStep={step} onEvent={jump} disabled={false} />
                </div>
                <p className="text-2xs text-muted-foreground">
                  {feeText}
                  {slip ? ` · ${t("hud.slippage", { slip: fmtUsd(slip.perShare, { decimals: slip.perShare < 0.01 ? 4 : 2 }), spread: fmtUsd(slip.spread, { decimals: slip.spread < 0.01 ? 4 : 2 }) })}` : ""}
                </p>
                {fine && (
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5"><Keyboard className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{t("hud.hotkeys")}</span>
                      <Switch checked={hotkeys} onCheckedChange={setHotkeys} aria-label={t("hud.hotkeys")} />
                    </label>
                    {hotkeys && <KeysHint tfCount={tfs.length} canEvent={!!jump} flow={{ skip: !!onSkip, noTrade: !!onNoTrade }} />}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {done && daily && <DailyReveal game={game} />}
      {done && game.reveal?.own && <OwnRealTrade own={game.reveal.own} />}
      {done && <ResultDetails game={game} hiddenDesk={hiddenDesk} toggleDesk={(key) => setHiddenDesk((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })} />}

      {/* Mounted only while asked: closing unmounts it at once, so the modal lock on <body> (pointer-events) and the
          overlay never wait for an exit animation that may not run (hidden tab, busy main thread) — MAKSIM-03. */}
      {confirmFinish && (
        <AlertDialog open onOpenChange={setConfirmFinish}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("hud.finishTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("hud.finishText")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{simI18n.t("start.resume")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmFinish(false); c.finish(); }}>{t("hud.finish")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

/**
 * Daily context of an intraday game: the daily bars and levels (GET /sim/games/:id/context; null for old games /
 * servers — the screen then shows no panel and no brief), today's candle from the bars seen, the snapshot's levels
 * filled in from the context, the mini panel switch (remembered; on by default with a mouse) and the brief card shown
 * once per game at its very start.
 */
function useDailyContext(game: GameView, fine: boolean) {
  const meta = game.meta;
  const intraday = meta.mode === "intraday";
  const ctxQ = useQuery({ ...gameContextQuery(meta.id, !!game.reveal), enabled: intraday });
  const ctx = ctxQ.data ?? null;
  const dailyBars = React.useMemo(() => (ctx?.daily ?? []).map(fromWire), [ctx]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the feed is mutable; the cursor marks a new bar
  const today = React.useMemo(() => (intraday ? todayCandle(game.feed.bars) : null), [game.feed, game.cursor, intraday]);
  const [dailyOn, setDailyOn] = usePersistentState<boolean | null>("sim.dailyPanel", null);
  const showDaily = (dailyOn ?? fine) && intraday && dailyBars.length > 0;
  const levels = React.useMemo(() => {
    const a = meta.levels, b = ctx?.levels;
    if (!b) return a;
    return { pdh: a.pdh ?? b.pdh, pdl: a.pdl ?? b.pdl, pdc: a.pdc ?? b.pdc, pmh: a.pmh ?? b.pmh, pml: a.pml ?? b.pml };
  }, [meta.levels, ctx]);

  const [brief, setBrief] = React.useState(false);
  const briefed = React.useRef<number | null>(null);
  const hasBrief = !!ctx && (ctx.daily.length > 0 || ctx.levels.gapPct != null || ctx.levels.pdh != null);
  const fresh = game.cursor <= meta.startIdx;
  React.useEffect(() => { setBrief(false); }, [meta.id]);
  React.useEffect(() => {
    if (briefed.current === meta.id || !intraday || game.done || !hasBrief) return;
    briefed.current = meta.id;
    if (fresh) setBrief(true);
  }, [meta.id, intraday, game.done, hasBrief, fresh]);
  const closeBrief = React.useCallback(() => setBrief(false), []);
  return { ctx, dailyBars, today, levels, showDaily, toggleDaily: () => setDailyOn(!showDaily), brief, closeBrief };
}

type T = ReturnType<typeof simI18n.useT>["t"];

/** Chip text of the event a jump stopped at («PDH break», «Stop filled» …). */
function eventLabel(e: SimEvent, t: T): string {
  if (e.kind === "fill") return t(e.dir === "up" ? "play.pausedTarget" : "play.pausedStop");
  const k = (EVENT_KINDS as readonly string[]).includes(e.kind) ? (e.kind as (typeof EVENT_KINDS)[number]) : null;
  return k ? t(`event.kind.${k}`) : t("event.generic");
}

/** Own mode: where the player is relative to their real entry (lead-in → the decision → the rest of the day). */
function OwnMoment({ cursor, decisionIdx }: { cursor: number; decisionIdx: number }) {
  const { t } = simOwnI18n.useT();
  const phase = cursor < decisionIdx ? "lead" : cursor === decisionIdx ? "decision" : "after";
  return (
    <div
      role="status"
      className={cn("tile rounded-xl p-3 text-sm", phase === "decision" ? "font-medium ring-2 ring-primary" : "text-muted-foreground")}
    >
      {t(`banner.${phase}`)}
    </div>
  );
}
