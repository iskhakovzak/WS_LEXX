/**
 * In-game side panel. Top to bottom in the order of a decision: where am I (position, open P&L in $ and R) → act
 * (Buy / Sell / Close, ½ / break-even in a position, size in bases ½ · 1 · 2 · 3 or «размер по риску») → protect
 * (one auto stop + target switch; stop / target, or a planned stop / target while flat — all draggable on the chart's
 * position box) → the trade log with the applied slippage → go on (play / pause, bar, event jump, 1× / 5× / 30×) →
 * keys (DAS-like; the legend only on keyboard devices). Few controls up front (UX §4a.6).
 */
import * as React from "react";
import { Equal, FastForward, Pause, Play, Scissors, ShieldCheck, SkipForward, StepForward, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Kbd, Segmented, toneOf, toneText } from "@/components/ds";
import { fmtCount, fmtPrice, fmtR, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simOwnI18n } from "@/i18n/ns/simOwn";
import { simI18n } from "@/i18n/ns/simulator";
import type { PublicState } from "./api";
import { PACES, fillLabels, maxQtyFor, parsePrice, riskQty, roundPrice, type Pace } from "./model";
import { SizeBar } from "./size-bar";
import type { GameView, TicketKind } from "./use-sim-game";

/** Keep mouse clicks from leaving focus on a button (Space would then also «click» it). */
const noFocus = (e: React.PointerEvent) => e.preventDefault();

export function openR(s: PublicState): number | null {
  const open = s.trades.find((t) => t.closeIdx == null);
  return open ? open.r : null;
}

export function PositionCard({ game }: { game: GameView }) {
  const { t } = simI18n.useT();
  const s = game.state;
  const r = openR(s);
  const price = game.feed.bars[game.cursor]?.c ?? null;
  return (
    <div className="tile rounded-xl p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className={cn("text-base font-semibold", s.pos > 0 ? "text-up" : s.pos < 0 ? "text-down" : "text-foreground")}>
          {s.pos === 0 ? t("hud.flat") : t(s.pos > 0 ? "hud.long" : "hud.short", { qty: fmtCount(Math.abs(s.pos)) })}
        </p>
        {s.pos !== 0 && s.avg != null && <p className="text-xs tabular-nums text-muted-foreground">{t("hud.at", { price: fmtPrice(s.avg) })}</p>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs text-muted-foreground">{t("hud.openPnl")}</p>
          <p className={cn("text-2xl font-semibold tabular-nums leading-tight", toneText(toneOf(s.unrealized)))}>{fmtUsd(s.unrealized, { signed: true })}</p>
        </div>
        <p className={cn("pb-0.5 text-lg font-semibold tabular-nums", toneText(toneOf(r)))}>{r != null ? fmtR(r) : ""}</p>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-[var(--glass-border)] pt-2 text-xs">
        <div className="min-w-0"><dt className="text-2xs text-muted-foreground">{t("hud.realized")}</dt><dd className={cn("tabular-nums", toneText(toneOf(s.realized)))}>{fmtUsd(s.realized, { signed: true })}</dd></div>
        <div className="min-w-0"><dt className="text-2xs text-muted-foreground">{t("hud.fees")}</dt><dd className="tabular-nums">{fmtUsd(-s.fees)}</dd></div>
        <div className="min-w-0"><dt className="text-2xs text-muted-foreground">{t("hud.net")}</dt><dd className={cn("font-semibold tabular-nums", toneText(toneOf(s.net)))}>{fmtUsd(s.net, { signed: true })}</dd></div>
      </dl>
      {price != null && <span className="sr-only">{fmtPrice(price)}</span>}
    </div>
  );
}

export function OrderPad({
  game, qty, setQty, onOrder, onUndo, onBreakEven, disabled, riskSize, setRiskSize, planStop, fine = false,
}: {
  game: GameView;
  qty: number;
  setQty: (q: number) => void;
  onOrder: (k: TicketKind) => void;
  onUndo: () => void;
  onBreakEven: () => void;
  disabled: boolean;
  riskSize: boolean;
  setRiskSize: (v: boolean) => void;
  planStop: number | null;
  /** Keyboard device: key hints in tooltips. */
  fine?: boolean;
}) {
  const { t } = simI18n.useT();
  const base = game.meta.defaultQty;
  const price = game.feed.bars[game.cursor]?.c ?? 0;
  const pos = game.state.pos;
  const oneR = game.meta.oneR ?? null;
  const byRisk = riskSize && oneR != null && pos === 0;
  const stopForPreview = planStop ?? roundPrice(price - game.meta.riskUnit);
  const riskShares = byRisk && oneR != null ? riskQty(oneR, price, stopForPreview, maxQtyFor(game.meta.maxNotional, price)) : null;
  const keyHint = "text-2xs font-normal opacity-80 [@media(pointer:coarse)]:hidden";
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <Button onPointerDown={noFocus} disabled={disabled} onClick={() => onOrder("buy")} className="min-h-12 flex-col gap-0 border-up/40 bg-up text-white hover:brightness-110" aria-keyshortcuts="B" title={t("hud.keyTitle", { action: t("hud.buy"), key: "B" })}>
          <span>{t("hud.buy")}</span><span className={keyHint}>B</span>
        </Button>
        <Button onPointerDown={noFocus} disabled={disabled} onClick={() => onOrder("sell")} className="min-h-12 flex-col gap-0 border-down/40 bg-down text-white hover:brightness-110" aria-keyshortcuts="S" title={t("hud.keyTitle", { action: t("hud.sell"), key: "S" })}>
          <span>{t("hud.sell")}</span><span className={keyHint}>S</span>
        </Button>
        <Button onPointerDown={noFocus} variant="secondary" disabled={disabled || pos === 0} onClick={() => onOrder("flat")} className="min-h-12 flex-col gap-0" aria-keyshortcuts="F" title={t("hud.keyTitle", { action: t("hud.close"), key: "F" })}>
          <span>{t("hud.close")}</span><span className={cn(keyHint, "text-muted-foreground")}>F</span>
        </Button>
      </div>
      {pos !== 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Button onPointerDown={noFocus} variant="outline" size="sm" className="min-h-9" disabled={disabled} onClick={() => onOrder("half")} aria-keyshortcuts="H" title={t("hud.keyTitle", { action: t("hud.halfOut"), key: "H" })}>
            <Scissors aria-hidden="true" /> {t("hud.halfOut")}
          </Button>
          <Button onPointerDown={noFocus} variant="outline" size="sm" className="min-h-9" disabled={disabled} onClick={onBreakEven} aria-keyshortcuts="E" title={t("hud.keyTitle", { action: t("hud.breakEven"), key: "E" })}>
            <Equal aria-hidden="true" /> {t("hud.breakEven")}
          </Button>
        </div>
      )}
      <SizeBar base={base} qty={qty} setQty={setQty} price={price} risk={byRisk && oneR != null ? { oneR, shares: riskShares } : null} keys={fine} />
      {oneR != null && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="sim-risksize" className="text-xs" title={t("hud.riskSizeHint", { value: fmtUsd(oneR, { decimals: 0 }) })}>{t("hud.riskSize")}</label>
          <Switch id="sim-risksize" checked={riskSize} onCheckedChange={setRiskSize} />
        </div>
      )}
      {game.state.canUndo && (
        <Button onPointerDown={noFocus} variant="ghost" size="sm" onClick={onUndo} className="self-start" aria-keyshortcuts="Z">
          <Undo2 aria-hidden="true" /> {t("hud.undo")} <Kbd className="[@media(pointer:coarse)]:hidden">Z</Kbd>
        </Button>
      )}
    </div>
  );
}

export function BracketBox({
  game, auto, setAuto, onBracket, disabled, planStop, setPlanStop, planTarget, setPlanTarget, fine = false, autoNote,
}: {
  game: GameView;
  /** Automatic stop + target on entry (one switch, remembered). */
  auto: boolean;
  setAuto: (v: boolean) => void;
  onBracket: (stop: number | null, target: number | null) => void;
  disabled: boolean;
  planStop: number | null;
  setPlanStop: (v: number | null) => void;
  planTarget: number | null;
  setPlanTarget: (v: number | null) => void;
  fine?: boolean;
  /** «Stop beyond PDL» after an automatic level stop. */
  autoNote?: string | null;
}) {
  const { t } = simI18n.useT();
  const s = game.state;
  const [stop, setStop] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [plan, setPlan] = React.useState("");
  const [planT, setPlanT] = React.useState("");
  React.useEffect(() => { setStop(s.stop != null ? String(s.stop) : ""); setTarget(s.target != null ? String(s.target) : ""); }, [s.stop, s.target, s.pos]);
  React.useEffect(() => { setPlan(planStop != null ? String(planStop) : ""); }, [planStop]);
  React.useEffect(() => { setPlanT(planTarget != null ? String(planTarget) : ""); }, [planTarget]);
  const price = game.feed.bars[game.cursor]?.c ?? 0;
  const ru = game.meta.riskUnit;
  const dir = Math.sign(s.pos);
  const apply = () => onBracket(parsePrice(stop), parsePrice(target));
  const field = (id: string, label: string, value: string, set: (v: string) => void, quick: { text: string; price: number; pick?: () => void }[], onCommit: () => void, commitOnBlur = false) => (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-12 shrink-0 text-xs text-muted-foreground">{label}</label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onCommit(); }} onBlur={commitOnBlur ? onCommit : undefined} className="h-8 min-w-0 flex-1 text-right tabular-nums" />
      {quick.map((q) => (
        <Button key={q.text} type="button" variant="outline" size="sm" className="w-12 shrink-0 px-0" onClick={() => { set(String(q.price)); q.pick?.(); }}>{q.text}</Button>
      ))}
    </div>
  );
  // A plan's target side follows its stop (below the price = a long plan), else up.
  const planDir = planStop != null ? (planStop < price ? 1 : -1) : 1;
  const planDist = planStop != null ? Math.abs(price - planStop) : ru;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="sim-autobracket" className="flex items-center gap-2 text-xs" title={t("box.autoBracketHint")}><ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{t("box.autoBracket")}</label>
        <Switch id="sim-autobracket" checked={auto} onCheckedChange={setAuto} />
      </div>
      {s.pos === 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-[var(--glass-border)] pt-2">
          {field("sim-plan", t("hud.planStop"), plan, setPlan, [
            { text: "↓1R", price: roundPrice(price - ru), pick: () => setPlanStop(roundPrice(price - ru)) },
            { text: "↑1R", price: roundPrice(price + ru), pick: () => setPlanStop(roundPrice(price + ru)) },
          ], () => setPlanStop(parsePrice(plan)), true)}
          {field("sim-plan-target", t("box.planTarget"), planT, setPlanT, [
            { text: "2R", price: roundPrice(price + planDir * 2 * planDist), pick: () => setPlanTarget(roundPrice(price + planDir * 2 * planDist)) },
          ], () => setPlanTarget(parsePrice(planT)), true)}
          <p className="text-2xs text-muted-foreground">{planStop != null ? t("hud.planHint") : t("hud.planEmpty")}</p>
          {(planStop != null || planTarget != null) && <Button size="sm" variant="ghost" className="self-start" onClick={() => { setPlanStop(null); setPlanTarget(null); }}>{t("box.planClear")}</Button>}
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-2">
          {field("sim-stop", t("hud.stop"), stop, setStop, [{ text: "1R", price: roundPrice(price - dir * ru) }], apply)}
          {field("sim-target", t("hud.target"), target, setTarget, [{ text: "2R", price: roundPrice(price + dir * 2 * ru) }], apply)}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={disabled} onClick={apply}>{t("hud.apply")}</Button>
            {(s.stop != null || s.target != null) && (
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onBracket(null, null)} title={t("hud.keyTitle", { action: t("hud.clearBracket"), key: "Esc" })}>{t("hud.clearBracket")}</Button>
            )}
          </div>
          {autoNote && <p className="text-2xs text-muted-foreground" data-testid="sim-auto-note">{autoNote}</p>}
        </div>
      )}
      <p className="text-2xs text-muted-foreground">{fine ? t("box.placeHint") : t("box.placeHintTouch")}</p>
      <p className="text-2xs text-muted-foreground">{game.meta.own && game.meta.own.riskSource !== "atr" ? simOwnI18n.t("hudRiskUnit", { value: fmtUsd(ru, { decimals: ru < 1 ? 4 : 2 }) }) : t("hud.riskUnit", { value: fmtUsd(ru, { decimals: ru < 1 ? 4 : 2 }) })}</p>
    </div>
  );
}

/** The trade log: the latest fills with price and the slippage / spread the server applied (newest first). */
export function FillsLog({ game, limit = 6 }: { game: GameView; limit?: number }) {
  const { t } = simI18n.useT();
  const fills = game.state.fills;
  if (!fills.length) return null;
  const labels = fillLabels(fills);
  const rows = fills.map((f, i) => ({ ...f, label: labels[i] })).slice(-limit).reverse();
  const anySlip = fills.some((f) => f.slip != null);
  const slipTotal = fills.reduce((sum, f) => sum + Math.abs(f.qty) * (f.slip ?? 0), 0);
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-baseline justify-between gap-2 text-2xs text-muted-foreground">
        <span className="font-medium">{t("hud.log.title")}</span>
        {anySlip && <span className="tabular-nums" title={t("hud.log.slipHint")}>{t("hud.log.slipTotal", { value: fmtUsd(-slipTotal) })}</span>}
      </p>
      <ul className="flex flex-col gap-0.5 text-2xs tabular-nums">
        {rows.map((f, i) => (
          <li key={`${f.idx}-${i}`} className="flex items-center gap-2">
            <span className={cn("w-12 shrink-0 font-semibold", f.qty > 0 ? "text-up" : "text-down")}>{t(`hud.log.reason.${f.label}`)}</span>
            <span className="min-w-0 flex-1 truncate">{t("hud.log.fill", { qty: fmtCount(Math.abs(f.qty)), price: fmtPrice(f.price) })}</span>
            {f.slip != null && <span className="shrink-0 text-muted-foreground" title={t("hud.log.slipHint")}>{t("hud.log.slip", { value: fmtUsd(f.slip, { decimals: Math.abs(f.slip) < 0.01 ? 4 : 2 }) })}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlayBar({
  game, playing, onToggle, pace, setPace, onStep, onEvent, disabled,
}: {
  game: GameView;
  playing: boolean;
  onToggle: () => void;
  pace: Pace;
  setPace: (p: Pace) => void;
  onStep: () => void;
  /** Jump to the next event; absent = not available (button hidden). */
  onEvent?: (() => void) | null;
  disabled: boolean;
}) {
  const { t } = simI18n.useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button onPointerDown={noFocus} size="lg" variant={playing ? "default" : "secondary"} className="min-h-11 flex-1" disabled={disabled} onClick={onToggle} aria-pressed={playing} aria-keyshortcuts="Space" data-testid="sim-play">
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {playing ? t("play.pause") : t("play.play")} <Kbd className="[@media(pointer:coarse)]:hidden">{"␣"}</Kbd>
        </Button>
        <Button onPointerDown={noFocus} size="lg" variant="outline" className="min-h-11 px-3" disabled={disabled} onClick={onStep} aria-keyshortcuts="ArrowRight" title={t("play.stepHint", { key: "→" })} aria-label={t("play.step")} data-testid="sim-step">
          <StepForward aria-hidden="true" />
        </Button>
        {onEvent && (
          <Button onPointerDown={noFocus} size="lg" variant="outline" className="min-h-11 px-3" disabled={disabled} onClick={onEvent} aria-keyshortcuts="Shift+ArrowRight" title={t("play.eventHint", { key: "Shift+→" })} aria-label={t("play.event")} data-testid="sim-event">
            <SkipForward aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <FastForward className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Segmented
          size="sm" ariaLabel={t("play.speed")} value={String(pace)}
          onChange={(v) => setPace(Number(v) as Pace)}
          options={PACES.map((p) => ({ value: String(p), label: `${p}×`, title: t("play.speedHint", { count: p }) }))}
        />
      </div>
      <span className="sr-only" aria-live="polite">{t("hud.bar", { played: game.cursor - game.meta.startIdx, total: game.meta.endIdx - game.meta.startIdx })}</span>
    </div>
  );
}

export function KeysHint({ tfCount, canEvent, flow }: { tfCount: number; canEvent: boolean; flow: { skip: boolean; noTrade: boolean } }) {
  const { t } = simI18n.useT();
  const item = (k: React.ReactNode, text: string) => <span className="inline-flex items-center gap-1 whitespace-nowrap">{k}{text}</span>;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground" aria-label={t("hud.keys.title")}>
      {item(<Kbd>B</Kbd>, t("hud.keys.buy"))}
      {item(<Kbd>S</Kbd>, t("hud.keys.sell"))}
      {item(<Kbd>F</Kbd>, t("hud.keys.flat"))}
      {item(<Kbd>H</Kbd>, t("hud.keys.half"))}
      {item(<Kbd>E</Kbd>, t("hud.keys.breakEven"))}
      {item(<Kbd>Esc</Kbd>, t("hud.keys.cancel"))}
      {item(<Kbd>Z</Kbd>, t("hud.keys.undo"))}
      {item(<Kbd>{"␣"}</Kbd>, t("hud.keys.play"))}
      {item(<Kbd>{"→"}</Kbd>, t("hud.keys.step"))}
      {canEvent && item(<Kbd keys={["⇧", "→"]} />, t("hud.keys.event"))}
      {item(<Kbd keys={["+", "−"]} />, t("hud.keys.speed"))}
      {tfCount > 1 && item(<Kbd>{`1–${Math.min(4, tfCount)}`}</Kbd>, t("hud.keys.tf"))}
      {item(<Kbd keys={["⇧", "1–4"]} />, t("hud.keys.size"))}
      {flow.skip && item(<Kbd>N</Kbd>, t("hud.keys.skip"))}
      {flow.noTrade && item(<Kbd>T</Kbd>, t("hud.keys.noTrade"))}
      {item(<Kbd keys={["⇧ / Alt", "click"]} />, t("hud.keys.place"))}
    </p>
  );
}
