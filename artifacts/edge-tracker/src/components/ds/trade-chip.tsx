/**
 * A journal chip on a trade — strategy (OPG, MOC …), tag kind (setup / mistake / emotion / other) or horizon — coloured
 * from CSS variables (`--chip-<group>-<key>`, index.css; «Вид» → Чипы can recolour each one or turn a group neutral).
 * Text in the chip colour on a 12 % tint of it: every default and every custom colour is AA on that tint.
 * Unknown keys (a strategy the desk added later) fall back to the neutral muted tone.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { chipToken, type ChipGroup } from "@/lib/appearance/model";

export function chipColorVar(group: ChipGroup, key: string): string {
  return `var(${chipToken(group, key)}, var(--muted-foreground))`;
}

export function TradeChip({
  group,
  value,
  children,
  className,
  title,
}: {
  group: ChipGroup;
  /** The key that picks the colour (strategy code, tag kind, horizon). */
  value: string;
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const c = chipColorVar(group, value);
  return (
    <span
      title={title}
      data-chip={group}
      style={{ color: `hsl(${c})`, backgroundColor: `hsl(${c} / 0.12)` }}
      className={cn("inline-flex min-h-5.5 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium leading-none tabular-nums [&_svg]:size-3 [&_svg]:shrink-0", className)}
    >
      {children ?? value}
    </span>
  );
}
