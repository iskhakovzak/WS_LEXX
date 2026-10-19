/**
 * Phones / tablets: the moves within thumb reach right under the chart — Buy / Sell / ½ / Close, step and play; a
 * second row with the size in bases, the event jump and the speed (tap cycles 1× → 5× → 30×). Every hotkey action has
 * a tap target here or in the HUD below.
 */
import type * as React from "react";
import { FastForward, Pause, Play, SkipForward, StepForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { simI18n } from "@/i18n/ns/simulator";
import type { GameControls } from "./game-types";

const noFocus = (e: React.PointerEvent) => e.preventDefault();

export function MobileBar({
  pos, c, playing, onToggle, onStep, onEvent, pace, onPace, size,
}: {
  pos: number; c: GameControls; playing: boolean; onToggle: () => void; onStep: () => void; onEvent: (() => void) | null;
  pace: number; onPace: () => void; size: React.ReactNode;
}) {
  const { t } = simI18n.useT();
  return (
    <div className="flex flex-col gap-1.5 lg:hidden">
      <div className="grid grid-cols-[1fr_1fr_2.75rem_1fr_2.75rem] gap-1.5 text-sm" role="toolbar" aria-label={t("hud.keys.title")}>
        <Button onPointerDown={noFocus} className="min-h-12 bg-up px-1 text-white hover:brightness-110" onClick={() => c.order("buy")}>{t("hud.buy")}</Button>
        <Button onPointerDown={noFocus} className="min-h-12 bg-down px-1 text-white hover:brightness-110" onClick={() => c.order("sell")}>{t("hud.sell")}</Button>
        <Button onPointerDown={noFocus} variant="secondary" className="min-h-12 px-0" disabled={pos === 0} onClick={() => c.order("half")} aria-label={t("hud.halfOut")} title={t("hud.halfOut")}>½</Button>
        <Button onPointerDown={noFocus} variant="secondary" className="min-h-12 px-1" disabled={pos === 0} onClick={() => c.order("flat")}>{t("hud.close")}</Button>
        <div className="grid grid-rows-2 gap-1">
          <Button onPointerDown={noFocus} size="sm" className="h-auto min-h-0 px-0" onClick={onStep} aria-label={t("play.step")}><StepForward aria-hidden="true" /></Button>
          <Button onPointerDown={noFocus} size="sm" variant={playing ? "default" : "outline"} className="h-auto min-h-0 px-0" onClick={onToggle} aria-pressed={playing} aria-label={playing ? t("play.pause") : t("play.play")}>
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">{size}</div>
        {onEvent && (
          <Button onPointerDown={noFocus} size="sm" variant="outline" className="h-9 shrink-0 px-2" onClick={onEvent} aria-label={t("play.event")} title={t("play.event")}><SkipForward aria-hidden="true" /></Button>
        )}
        <Button onPointerDown={noFocus} size="sm" variant="outline" className="h-9 shrink-0 gap-1 px-2 tabular-nums" onClick={onPace} aria-label={t("play.speed")} title={t("play.speedHint", { count: pace })}>
          <FastForward aria-hidden="true" />{`${pace}×`}
        </Button>
      </div>
    </div>
  );
}
