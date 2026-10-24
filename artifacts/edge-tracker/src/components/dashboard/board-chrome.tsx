/**
 * The edit mode's controls: the bar on top of the dashboard («Добавить», «Сбросить», «Готово»), the «Настроить» button
 * that opens it, and each tile's chrome — the grab handle (top centre), «×» (top left), the size switch S / M / L / XL
 * and «2 ряда» (top right) — floating on the tile's edge so the tile itself stays readable. Touch targets grow on
 * coarse pointers (dashboard.css).
 */
import { forwardRef, type PointerEvent as ReactPointerEvent } from "react";
import { Check, GripHorizontal, LayoutGrid, MoveHorizontal, Plus, RotateCcw, Rows2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import { canBeTall, TILE_SPECS, type LayoutItem, type TileSize } from "./layout-model";

/** Size letters are the same in every language (S / M / L / XL), the full names are translated. */
const SIZE_LETTER: Record<TileSize, string> = { s: "S", m: "M", l: "L", xl: "XL" };

export const CustomizeButton = forwardRef<HTMLButtonElement, { onClick: () => void }>(function CustomizeButton({ onClick }, ref) {
  const { t } = dashboardI18n.useT();
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
      aria-label={t("customize.button")}
      title={t("customize.button")}
    >
      <SlidersHorizontal aria-hidden="true" />
      <span className="hidden sm:inline">{t("customize.short")}</span>
    </Button>
  );
});

export const EditBar = forwardRef<HTMLButtonElement, { onAdd: () => void; onReset: () => void; onDone: () => void }>(
  function EditBar({ onAdd, onReset, onDone }, addRef) {
    const { t } = dashboardI18n.useT();
    return (
      <div className="dash-editbar glass-panel" role="toolbar" aria-label={t("customize.title")} data-board-keep>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="dash-editbar-icon" aria-hidden="true"><LayoutGrid className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{t("customize.title")}</p>
            <p className="dash-hint-pointer truncate text-xs text-muted-foreground">{t("customize.hint")}</p>
            <p className="dash-hint-touch truncate text-xs text-muted-foreground">{t("customize.hintTouch")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button ref={addRef} variant="outline" size="sm" onClick={onAdd} className="h-9 gap-1.5">
            <Plus aria-hidden="true" />
            <span>{t("customize.add")}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} className="h-9 gap-1.5" title={t("customize.reset")}>
            <RotateCcw aria-hidden="true" />
            <span className="hidden sm:inline">{t("customize.reset")}</span>
            <span className="sr-only sm:hidden">{t("customize.reset")}</span>
          </Button>
          <Button size="sm" onClick={onDone} className="h-9 gap-1.5">
            <Check aria-hidden="true" />
            <span>{t("customize.done")}</span>
          </Button>
        </div>
      </div>
    );
  },
);

export function TileChrome({
  item,
  label,
  grown,
  shortened,
  onHandleDown,
  onResize,
  onRemove,
}: {
  item: LayoutItem;
  label: string;
  grown: boolean;
  shortened: boolean;
  onHandleDown: (e: ReactPointerEvent) => void;
  onResize: (size: TileSize, rows: 1 | 2) => void;
  onRemove: () => void;
}) {
  const { t } = dashboardI18n.useT();
  const sizes = TILE_SPECS[item.id].sizes;
  const rows = item.rows ?? 1;
  const tallOk = canBeTall(item.id, item.size);
  return (
    <>
      <button
        type="button"
        className="dash-handle"
        aria-label={t("customize.drag", { label })}
        title={t("customize.drag", { label })}
        tabIndex={-1}
        onPointerDown={(e) => { e.stopPropagation(); onHandleDown(e); }}
      >
        <GripHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" data-tile-control className="dash-remove" aria-label={t("customize.remove", { label })} title={t("customize.remove", { label })} onClick={onRemove}>
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {(sizes.length > 1 || tallOk) && (
        <div className="dash-sizes" role="group" aria-label={t("customize.size", { label })} data-tile-control>
          {sizes.length > 1 && sizes.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={item.size === s}
              title={t(`customize.sizeNames.${s}`)}
              aria-label={t(`customize.sizeNames.${s}`)}
              onClick={() => onResize(s, canBeTall(item.id, s) ? rows : 1)}
            >
              {SIZE_LETTER[s]}
            </button>
          ))}
          {tallOk && (
            <button
              type="button"
              aria-pressed={rows === 2}
              title={t("customize.rows")}
              aria-label={t("customize.rowsAria", { label })}
              onClick={() => onResize(item.size, rows === 2 ? 1 : 2)}
              className="dash-rows"
            >
              <Rows2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {(grown || shortened) && (
        <span className="dash-badge" title={grown ? t("customize.grownHint") : t("customize.shortenedHint")}>
          <MoveHorizontal className="h-3 w-3" aria-hidden="true" />
          {grown ? t("customize.grown") : t("customize.shortened")}
        </span>
      )}
    </>
  );
}
