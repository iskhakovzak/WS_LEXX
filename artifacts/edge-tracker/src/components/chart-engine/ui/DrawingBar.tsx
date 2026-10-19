/**
 * Floating bar for the selected drawing (bottom-left of the chart): colour role (accent · up · down · warn) and delete.
 * Works with a mouse and on a phone, where there is no Delete key. Also shows the hint while a drawing is being placed.
 */
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DrawingRole } from "../types";
import { DRAWING_ROLES } from "../lib/drawings";
import { chartI18n } from "@/i18n/ns/chart";

const SWATCH: Record<DrawingRole, string> = {
  accent: "bg-primary",
  up: "bg-up",
  down: "bg-down",
  warn: "bg-[hsl(var(--chart-3))]",
};

export function DrawingBar({ hint, selectedRole, onRole, onDelete, local }: {
  /** Placing a drawing: «Первая точка…» / «Вторая точка…». */
  hint: string | null;
  /** Role of the selected drawing (null = nothing selected). */
  selectedRole: DrawingRole | null;
  onRole: (r: DrawingRole) => void;
  onDelete: () => void;
  /** Drawings are kept in this browser only (the server has no drawings yet / signed out). */
  local: boolean;
}) {
  const { t } = chartI18n.useT();
  if (!hint && selectedRole == null) return null;
  return (
    <div className="absolute bottom-8 left-2 z-raised flex max-w-[calc(100%-5rem)] items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-[var(--glass-shadow-sm)]">
      {hint ? <span>{hint}</span> : (
        <>
          <span className="flex items-center gap-1" role="group" aria-label={t("drawing.color")}>
            {DRAWING_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={selectedRole === r}
                aria-label={t(`drawing.role.${r}`)}
                title={t(`drawing.role.${r}`)}
                onClick={() => onRole(r)}
                className={cn("h-5 w-5 rounded-full ring-offset-2 ring-offset-background transition-shadow", SWATCH[r], selectedRole === r && "ring-2 ring-foreground/70")}
              />
            ))}
          </span>
          <button type="button" onClick={onDelete} className="inline-flex h-7 items-center gap-1 rounded-full px-2 hover:bg-[var(--glass-hover-bg)] hover:text-foreground" title={t("engine.deleteDrawing")}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("drawing.delete")}
          </button>
          {local && <span className="hidden sm:inline" title={t("drawing.localTitle")}>{t("drawing.local")}</span>}
        </>
      )}
    </div>
  );
}
