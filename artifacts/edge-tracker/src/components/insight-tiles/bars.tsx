/**
 * Diverging bars of a tile (trade number in the day, days of the week): the zero rule sits where the largest gain and
 * the largest loss meet; bars grow from it in the money colours, the marked ones (best / worst) solid, the rest soft.
 * Each bar is a button (drill) with a tooltip; an empty bucket is a stub, not clickable. Labels sit under the bars.
 */
import type * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTone } from "./kit";

export type TileBar = {
  key: string;
  label: string;
  value: number;
  empty?: boolean;
  mark?: boolean;
  aria: string;
  tip: React.ReactNode;
  onClick?: () => void;
};

export function TileBars({ items, height = 88 }: { items: TileBar[]; height?: number }) {
  const tone = useTone();
  const maxPos = Math.max(0, ...items.map((i) => i.value));
  const maxNeg = Math.max(0, ...items.map((i) => -i.value));
  const span = maxPos + maxNeg || 1;
  const zero = maxPos / span;
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => {
        const h = (Math.abs(it.value) / span) * 100;
        const up = it.value >= 0;
        return (
          <Tooltip key={it.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={it.empty || !it.onClick}
                onClick={it.onClick}
                aria-label={it.aria}
                className="group flex min-h-6 w-full min-w-0 flex-col items-stretch gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              >
                <span className="relative block w-full rounded-lg transition-colors group-enabled:group-hover:bg-[var(--glass-hover-bg)]" style={{ height }} aria-hidden="true">
                  <span className="absolute inset-x-0 h-px bg-foreground/20" style={{ top: `${zero * 100}%` }} />
                  {!it.empty && h > 0 && (
                    <span
                      className="ins-bar"
                      data-tone={tone(it.value) ?? "be"}
                      data-mark={it.mark ? "true" : "false"}
                      style={up ? { bottom: `${(1 - zero) * 100}%`, height: `max(${h}%, 3px)` } : { top: `${zero * 100}%`, height: `max(${h}%, 3px)` }}
                    />
                  )}
                </span>
                <span className={cn("truncate text-center text-2xs tabular-nums", it.mark ? "font-semibold text-foreground" : "text-muted-foreground")} aria-hidden="true">
                  {it.label}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="tabular-nums">{it.tip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
