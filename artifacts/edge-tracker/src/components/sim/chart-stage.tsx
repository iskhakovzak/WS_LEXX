/**
 * The game chart with what floats over it: the daily mini panel (top left), the status chip (event a jump stopped at /
 * «paused: stop filled»), the «stop here / target here» menu (long-press / right-click) and the brief card at the
 * start. `isolate` keeps the overlays' stacking inside the panel.
 */
import type * as React from "react";
import { Target, X } from "lucide-react";
import type { Candle } from "@/components/chart-engine";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ds";
import { fmtPrice } from "@/lib/format";
import { simI18n } from "@/i18n/ns/simulator";
import type { GameContext, Levels } from "./api";
import { SimChart, type ChartToggles } from "./sim-chart";
import type { DragLine, OverlayData } from "./sim-overlay";
import { DailyMini } from "./daily-panel";
import { BriefCard } from "./brief-card";
import type { GameView } from "./use-sim-game";

export type PlaceMenu = { price: number; x: number; y: number };

export function ChartStage({
  game, overlay, toggles, levels, baseMin, dispMin, onDragLine, dragLabel, onPlace, menu, setMenu,
  daily, today, showDaily, chip, chipWarn, brief, onCloseBrief,
}: {
  game: GameView;
  overlay: OverlayData;
  toggles: ChartToggles;
  levels: Levels;
  baseMin: number;
  dispMin: number;
  onDragLine: (kind: DragLine, price: number) => void;
  dragLabel: (kind: DragLine, price: number) => string;
  onPlace: (kind: "stop" | "target", price: number) => void;
  menu: PlaceMenu | null;
  setMenu: (m: PlaceMenu | null) => void;
  daily: readonly Candle[];
  today: Candle | null;
  showDaily: boolean;
  chip: string | null;
  chipWarn: boolean;
  /** The context levels while the brief card is shown, else null. */
  brief: GameContext["levels"] | null;
  onCloseBrief: () => void;
}) {
  const { t } = simI18n.useT();
  const done = game.done;
  const choose = (kind: "stop" | "target", price: number) => { setMenu(null); onPlace(kind, price); };
  return (
    <div className="glass-panel relative isolate h-[52dvh] min-h-[300px] overflow-hidden rounded-2xl p-1.5 sm:p-2 lg:h-[calc(100dvh-15rem)] lg:min-h-[480px]">
      <SimChart
        feed={game.feed} mode={game.meta.mode} startIdx={game.meta.startIdx} levels={levels} overlay={overlay} toggles={toggles}
        className="min-h-[280px]" onDragLine={done ? undefined : onDragLine} dragLabel={dragLabel}
        baseMin={baseMin} dispMin={dispMin}
        onPlace={done ? undefined : onPlace} onMenu={done ? undefined : (price, x, y) => setMenu({ price, x, y })}
      />
      {showDaily && (
        <div className="pointer-events-none absolute left-2 top-2 z-sticky w-40 rounded-lg border border-[var(--glass-border)] bg-background/80 p-1.5 backdrop-blur-sm sm:w-48" data-testid="sim-daily">
          <p className="flex items-baseline justify-between px-0.5 text-2xs text-muted-foreground"><span className="font-medium">{t("daily.title")}</span>{today && <span>{t("daily.today")}</span>}</p>
          <div className="h-16 sm:h-20"><DailyMini daily={daily} today={today} levels={levels} label={t("tf.dailyHint")} /></div>
        </div>
      )}
      {chip && !done && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-sticky -translate-x-1/2" role="status" aria-live="polite">
          <Pill tone={chipWarn ? "warn" : "accent"} className="shadow-sm"><span data-testid="sim-event-chip">{chip}</span></Pill>
        </div>
      )}
      {menu && <PlaceMenuView menu={menu} onClose={() => setMenu(null)} onChoose={choose} />}
      {brief && <BriefCard levels={brief} daily={daily} today={today} onClose={onCloseBrief} />}
    </div>
  );
}

function PlaceMenuView({ menu, onClose, onChoose }: { menu: PlaceMenu; onClose: () => void; onChoose: (kind: "stop" | "target", price: number) => void }) {
  const { t } = simI18n.useT();
  const title = t("box.menuTitle", { price: fmtPrice(menu.price) });
  const style: React.CSSProperties = { left: `clamp(84px, ${menu.x}px, calc(100% - 84px))`, top: Math.max(4, menu.y - 8), transform: "translate(-50%, -100%)" };
  return (
    <>
      <div className="absolute inset-0 z-sticky" onPointerDown={onClose} aria-hidden="true" />
      <div role="menu" aria-label={title} data-testid="sim-place-menu" className="glass-panel absolute z-popover flex min-w-[10rem] flex-col gap-1 rounded-xl p-1.5 shadow-lg" style={style}>
        <div className="flex items-center justify-between gap-2 px-1.5 text-2xs text-muted-foreground">
          <span className="tabular-nums">{title}</span>
          <button type="button" className="rounded p-0.5 hover:bg-[var(--glass-bg)]" aria-label={t("box.menuClose")} onClick={onClose}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </div>
        <Button role="menuitem" size="sm" variant="outline" className="justify-start border-down/40 text-down" onClick={() => onChoose("stop", menu.price)}>{t("box.menuStop")}</Button>
        <Button role="menuitem" size="sm" variant="outline" className="justify-start border-up/40 text-up" onClick={() => onChoose("target", menu.price)}><Target aria-hidden="true" />{t("box.menuTarget")}</Button>
      </div>
    </>
  );
}
