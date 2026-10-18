/**
 * The game: chart (left, takes the space) + one side column (HUD while playing, the verdict after). Focus mode —
 * nothing else on the page competes with the chart (UX §4a.2). Keys (DAS-like, can be switched off) work page-wide
 * except while typing in a field. After the reveal the details (trades, mistakes, the desk) open under the chart.
 * Own mode («Мои дни») swaps the «hidden» badge for «your trade · ticker · date», adds the decision tile on top of
 * the HUD and the real-entry marker on the chart, and shows the then-vs-now verdict (own-result.tsx). «Задача дня»
 * shows its badge and, after the finish, the reveal with the desk ranking (daily-reveal.tsx).
 * Mobile: a shorter chart with the main buttons right under it (everything playable by touch).
 */
import * as React from "react";
import { CalendarCheck, EyeOff, Flag, Keyboard, LogOut, Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FilterChip, Pill, usePersistentState } from "@/components/ds";
import { fmtCount, fmtDate, fmtPrice, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";
import { simOwnI18n } from "@/i18n/ns/simOwn";
import { trainerI18n } from "@/i18n/ns/trainer";
import { keyAction, nextSpeed, type Speed } from "./model";
import { SimChart, type ChartToggles } from "./sim-chart";
import { EMPTY_OVERLAY, type DragLine, type OverlayData, type OverlayDeskFill } from "./sim-overlay";
import { BracketBox, FillsLog, KeysHint, OrderPad, PlayBar, PositionCard } from "./hud";
import { LevelPill, ResultDetails, ResultSummary } from "./result";
import { OwnRealTrade, OwnResultSummary } from "./own-result";
import { DailyReveal } from "./daily-reveal";
import { useFinePointer } from "./use-fine-pointer";
import type { GameView, TicketKind } from "./use-sim-game";

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};

/** Keep mouse clicks from leaving focus on a button (Space would then also «click» it). */
const noFocus = (e: React.PointerEvent) => e.preventDefault();

export type GameControls = {
  playing: boolean;
  setPlaying: (v: boolean) => void;
  busy: boolean;
  starting: boolean;
  next: (n?: number) => void;
  order: (k: TicketKind) => void;
  breakEven: () => void;
  setBracket: (stop: number | null, target: number | null) => void;
  undo: () => void;
  finish: () => void;
  again: () => void;
  leave: () => void;
};

/** Ticket settings owned by the page (they feed the order requests). */
export type Ticket = {
  qty: number; setQty: (q: number) => void;
  speed: Speed; setSpeed: (s: Speed) => void;
  autoStop: boolean; setAutoStop: (v: boolean) => void;
  autoTarget: boolean; setAutoTarget: (v: boolean) => void;
  riskSize: boolean; setRiskSize: (v: boolean) => void;
  planStop: number | null; setPlanStop: (v: number | null) => void;
};

export function GameScreen({ game, c, k }: { game: GameView; c: GameControls; k: Ticket }) {
  const { t } = simI18n.useT();
  const [toggles, setToggles] = usePersistentState<ChartToggles>("sim.chart", { vwap: true, levels: true, ma: true });
  const [hotkeys, setHotkeys] = usePersistentState("sim.hotkeys", true);
  const fine = useFinePointer();
  const [hiddenDesk, setHiddenDesk] = React.useState<Set<string>>(new Set());
  const [confirmFinish, setConfirmFinish] = React.useState(false);
  const done = game.done;
  const daily = game.meta.trainer?.mode === "daily";
  const { pos } = game.state;

  // A planned stop belongs to the next entry: it becomes the position's stop and is cleared.
  const { planStop, setPlanStop } = k;
  React.useEffect(() => { if (pos !== 0 && planStop != null) setPlanStop(null); }, [pos, planStop, setPlanStop]);

  // ── Keyboard (DAS-like) ─────────────────────────────────────────────────
  const live = React.useRef({ c, k, done, confirmFinish, hotkeys, game });
  live.current = { c, k, done, confirmFinish, hotkeys, game };
  const lastNext = React.useRef(0);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = live.current;
      if (!st.hotkeys || isTyping(e.target) || st.confirmFinish) return;
      if (document.querySelector("[role='dialog'][data-state='open']")) return;
      const a = keyAction(e);
      if (!a) return;
      const { c: ctl, done: isDone } = st;
      if (isDone) {
        if (a === "again" && !e.repeat) { e.preventDefault(); ctl.again(); }
        return;
      }
      e.preventDefault();
      if (e.repeat && a !== "next" && a !== "faster" && a !== "slower") return;
      switch (a) {
        case "next": {
          // Held key: auto-repeat fires ~30/s; keep it to ≤ 20 bars/s.
          const now = performance.now();
          if (e.repeat && now - lastNext.current < 50) return;
          lastNext.current = now;
          ctl.next(1);
          break;
        }
        case "buy": case "sell": case "flat": case "half": ctl.order(a); break;
        case "breakeven": ctl.breakEven(); break;
        case "cancel": {
          // Esc = cancel the working orders: the planned stop, else the stop / target; autoplay pauses.
          ctl.setPlaying(false);
          const s = st.game.state;
          if (st.k.planStop != null) st.k.setPlanStop(null);
          else if (s.pos !== 0 && (s.stop != null || s.target != null)) ctl.setBracket(null, null);
          break;
        }
        case "auto": ctl.setPlaying(!ctl.playing); break;
        case "faster": st.k.setSpeed(nextSpeed(st.k.speed, 1)); break;
        case "slower": st.k.setSpeed(nextSpeed(st.k.speed, -1)); break;
        case "undo": ctl.undo(); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Overlay for the chart ───────────────────────────────────────────────
  const overlay: OverlayData = React.useMemo(() => {
    const s = game.state;
    const open = s.trades.find((x) => x.closeIdx == null) ?? null;
    const sideWord = s.pos > 0 ? t("chart.long") : t("chart.short");
    const desk: OverlayDeskFill[] = [];
    const spans: OverlayData["spans"][number][] = [];
    if (game.reveal) {
      for (const d of game.reveal.desk.traders) {
        if (hiddenDesk.has(d.key)) continue;
        for (const tr of d.trades) for (const f of tr.fills) desk.push({ ...f, long: tr.side === "long", own: d.own, tag: d.own ? "" : d.label });
      }
      const marked = new Set<number>();
      for (const m of game.reveal.result.mistakes) {
        if (m.trade == null || marked.has(m.trade)) continue;
        const tr = s.trades.find((x) => x.n === m.trade);
        if (!tr) continue;
        marked.add(m.trade);
        spans.push({ from: tr.openIdx, to: tr.closeIdx ?? game.cursor, text: `${t("chart.mistake", { n: tr.n })} · ${t(`result.mistakeShort.${m.kind}`)}` });
      }
    }
    const own = game.meta.own;
    const marker = own && game.cursor >= own.decisionIdx ? { idx: own.decisionIdx, text: simOwnI18n.t("chartEntry") } : null;
    const plan = !game.done && s.pos === 0 && planStop != null ? { price: planStop, text: t("chart.plan", { price: fmtPrice(planStop) }) } : null;
    if (!s.fills.length && !desk.length && s.pos === 0 && !spans.length) return { ...EMPTY_OVERLAY, cursor: game.cursor, marker, plan };
    return {
      marker, plan,
      fills: s.fills, pos: s.pos, avg: s.avg, stop: s.stop, target: s.target, openIdx: open?.openIdx ?? null, cursor: game.cursor, spans, desk,
      text: {
        position: s.pos !== 0 && s.avg != null ? t("chart.you", { side: sideWord, qty: fmtCount(Math.abs(s.pos)), price: fmtPrice(s.avg) }) : null,
        stop: s.stop != null ? t("chart.stop", { price: fmtPrice(s.stop) }) : null,
        target: s.target != null ? t("chart.target", { price: fmtPrice(s.target) }) : null,
      },
    };
  }, [game.state, game.cursor, game.reveal, game.meta.own, game.done, hiddenDesk, planStop, t]);

  // Dragging a line on the chart = moving that order.
  const onDragLine = React.useCallback((kind: DragLine, price: number) => {
    const s = live.current.game.state;
    if (kind === "plan") live.current.k.setPlanStop(price);
    else if (kind === "stop") live.current.c.setBracket(price, s.target);
    else live.current.c.setBracket(s.stop, price);
  }, []);
  const dragLabel = React.useCallback((kind: DragLine, price: number) => t(kind === "target" ? "chart.target" : kind === "plan" ? "chart.plan" : "chart.stop", { price: fmtPrice(price) }), [t]);

  const total = game.meta.endIdx - game.meta.startIdx;
  const played = game.cursor - game.meta.startIdx;
  const intraday = game.meta.mode === "intraday";
  const slip = game.meta.slippage;
  const feeText = game.meta.own ? simOwnI18n.t("hudFee", { value: fmtUsd(game.meta.feePerShare, { decimals: 4 }) }) : t("hud.fee", { value: fmtUsd(game.meta.feePerShare, { decimals: 4 }) });

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <div className="flex flex-wrap items-center gap-2">
        {game.meta.own ? (
          <Pill tone="accent"><RotateCcw aria-hidden="true" />{simOwnI18n.t("banner.pill", { ticker: game.meta.own.ticker, date: fmtDate(game.meta.own.date, "medium") })}</Pill>
        ) : (
          <>
            {daily ? <Pill tone="accent"><CalendarCheck aria-hidden="true" />{trainerI18n.t("daily.pill")}</Pill> : <LevelPill mode={game.meta.mode} difficulty={game.meta.difficulty} />}
            {!done && <Pill tone="neutral"><EyeOff aria-hidden="true" />{t("hiddenBadge")}</Pill>}
          </>
        )}
        <div className="flex min-w-[10rem] flex-1 items-center gap-2" aria-hidden="true">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--glass-bg)]">
            <div className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur-1)] motion-reduce:transition-none" style={{ width: `${total > 0 ? (played / total) * 100 : 0}%` }} />
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{t("hud.bar", { played, total })}</span>
        </div>
        <div className="flex items-center gap-1">
          <FilterChip size="sm" active={toggles.levels} onClick={() => setToggles({ ...toggles, levels: !toggles.levels })}>{t("chart.levels")}</FilterChip>
          {intraday
            ? <FilterChip size="sm" active={toggles.vwap} onClick={() => setToggles({ ...toggles, vwap: !toggles.vwap })}>{t("chart.vwap")}</FilterChip>
            : <FilterChip size="sm" active={toggles.ma} onClick={() => setToggles({ ...toggles, ma: !toggles.ma })}>{t("chart.ma")}</FilterChip>}
        </div>
        {!done && (
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmFinish(true)}><Flag aria-hidden="true" /> {t("hud.finish")}</Button>
            <Button variant="ghost" size="sm" onClick={c.leave} title={t("hud.exitHint")}><LogOut aria-hidden="true" /> {t("hud.exit")}</Button>
          </>
        )}
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="glass-panel relative h-[52dvh] min-h-[300px] overflow-hidden rounded-2xl p-1.5 sm:p-2 lg:h-[calc(100dvh-13rem)] lg:min-h-[480px]">
            <SimChart
              feed={game.feed} mode={game.meta.mode} startIdx={game.meta.startIdx} levels={game.meta.levels} overlay={overlay} toggles={toggles}
              className="min-h-[280px]" onDragLine={done ? undefined : onDragLine} dragLabel={dragLabel}
            />
          </div>
          {!done && <MobileBar game={game} c={c} />}
        </div>
        <aside className="glass-panel flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl p-[var(--panel-p)] lg:h-[calc(100dvh-13rem)] lg:min-h-[480px]">
          {done ? (
            game.reveal?.own
              ? <OwnResultSummary game={game} onAgain={c.again} onStart={c.leave} starting={c.starting} />
              : <ResultSummary game={game} onAgain={c.again} onStart={c.leave} starting={c.starting} noAgain={daily} />
          ) : (
            <>
              {game.meta.own && <OwnMoment cursor={game.cursor} decisionIdx={game.meta.own.decisionIdx} />}
              <PositionCard game={game} />
              <OrderPad
                game={game} qty={k.qty} setQty={k.setQty} onOrder={c.order} onUndo={c.undo} onBreakEven={c.breakEven} disabled={false}
                riskSize={k.riskSize} setRiskSize={k.setRiskSize} planStop={planStop}
              />
              <BracketBox
                game={game} autoStop={k.autoStop} setAutoStop={k.setAutoStop} autoTarget={k.autoTarget} setAutoTarget={k.setAutoTarget}
                onBracket={c.setBracket} disabled={false} planStop={planStop} setPlanStop={setPlanStop}
              />
              <FillsLog game={game} />
              <div className="mt-auto flex flex-col gap-3">
                <div className="hidden lg:block">
                  <PlayBar game={game} playing={c.playing} setPlaying={c.setPlaying} speed={k.speed} setSpeed={k.setSpeed} onNext={() => c.next(1)} disabled={false} />
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
                    {hotkeys && <KeysHint />}
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

      <AlertDialog open={confirmFinish} onOpenChange={setConfirmFinish}>
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
    </div>
  );
}

/** Phones / tablets: the moves within thumb reach right under the chart (the full HUD follows below). */
function MobileBar({ game, c }: { game: GameView; c: GameControls }) {
  const { t } = simI18n.useT();
  const pos = game.state.pos;
  return (
    <div className="grid grid-cols-[1fr_1fr_2.75rem_1fr_2.75rem] gap-1.5 text-sm lg:hidden" role="toolbar" aria-label={t("hud.keys.title")}>
      <Button onPointerDown={noFocus} className="min-h-12 bg-up px-1 text-white hover:brightness-110" onClick={() => c.order("buy")}>{t("hud.buy")}</Button>
      <Button onPointerDown={noFocus} className="min-h-12 bg-down px-1 text-white hover:brightness-110" onClick={() => c.order("sell")}>{t("hud.sell")}</Button>
      <Button onPointerDown={noFocus} variant="secondary" className="min-h-12 px-0" disabled={pos === 0} onClick={() => c.order("half")} aria-label={t("hud.halfOut")} title={t("hud.halfOut")}>½</Button>
      <Button onPointerDown={noFocus} variant="secondary" className="min-h-12 px-1" disabled={pos === 0} onClick={() => c.order("flat")}>{t("hud.close")}</Button>
      <div className="grid grid-rows-2 gap-1">
        <Button onPointerDown={noFocus} size="sm" className="h-auto min-h-0 px-0" onClick={() => c.next(1)} aria-label={t("hud.next")}><StepForward aria-hidden="true" /></Button>
        <Button onPointerDown={noFocus} size="sm" variant={c.playing ? "default" : "outline"} className="h-auto min-h-0 px-0" onClick={() => c.setPlaying(!c.playing)} aria-pressed={c.playing} aria-label={c.playing ? t("hud.pause") : t("hud.auto")}>
          {c.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
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
