/**
 * Row actions for lists and tables (design audit: 16 identical «+ В план / В плейбук» buttons per screen were noise).
 *
 *   ticker · numbers …                         [ + В план ] [ … ]
 *                                               ^ shown on row hover / keyboard focus (always on touch screens)
 *
 * `children` is the one primary action of the row; `more` are the secondary ones, folded into a «…» menu. The wrapper
 * (`.row-actions`, index.css) stays invisible until the row (`tr`, `li` or `[data-row]`) is hovered or anything in it
 * has focus, so the keyboard path is unchanged and the menu stays visible while it is open. A row that needs doing
 * (a status, «в плане ✓») keeps that state outside this wrapper so it is always seen.
 */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { commonI18n } from "@/i18n/ns/common";
import { cn } from "@/lib/utils";

export type RowAction = {
  label: React.ReactNode;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
};

export function RowActions({
  children,
  more,
  menuLabel,
  className,
}: {
  /** The row's primary action (a small Button). */
  children?: React.ReactNode;
  /** Secondary actions, in a «…» menu. */
  more?: ReadonlyArray<RowAction | false | null | undefined>;
  /** Accessible name of the «…» button, e.g. «Ещё действия: NVDA» (default «Ещё действия»). */
  menuLabel?: string;
  className?: string;
}) {
  const items = (more ?? []).filter((a): a is RowAction => !!a);
  const label = menuLabel ?? commonI18n.t("ds.rowMore");
  return (
    <div className={cn("row-actions flex shrink-0 items-center justify-end gap-1", className)}>
      {children}
      {items.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {items.map((a, i) => {
              const Icon = a.icon;
              return (
                <DropdownMenuItem key={i} disabled={a.disabled} onSelect={a.onSelect}>
                  {Icon && <Icon aria-hidden="true" />}
                  {a.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
