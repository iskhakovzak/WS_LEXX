/**
 * «Вид» — the user's view of the themes table, saved in his profile (PUT /api/themes/view, optimistic): which columns
 * are visible (the last one stays) and the shared themes he hid (restore here; hide from a theme's sheet).
 */
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { themesI18n } from "@/i18n/ns/themes";
import { useSaveView } from "./api";
import { METRICS, setHidden, toggleColumn, visibleColumns, type ThemeOut, type ThemesView } from "./model";

export function ViewPopover({ view, themes }: { view: ThemesView; themes: readonly ThemeOut[] }) {
  const { t } = themesI18n.useT();
  const save = useSaveView();
  const visible = visibleColumns(view);
  const hidden = themes.filter((th) => view.hidden.includes(th.id));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8">
          <SlidersHorizontal aria-hidden="true" /> {t("view.open")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">{t("view.columns")}</legend>
          {METRICS.map((c) => {
            const on = visible.includes(c);
            const last = on && visible.length === 1;
            return (
              <label key={c} className="flex items-center gap-2 text-sm" title={last ? t("view.lastColumn") : t(`hints.${c}`)}>
                <Checkbox checked={on} disabled={last} onCheckedChange={() => save.mutate(toggleColumn(view, c))} />
                {t(`cols.${c}`)}
              </label>
            );
          })}
        </fieldset>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">{t("view.hiddenTitle")}</p>
          {hidden.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("view.hiddenNone")}</p>
          ) : (
            <ul className="flex max-h-48 flex-col overflow-y-auto">
              {hidden.map((th) => (
                <li key={th.id} className="flex items-center justify-between gap-2 py-0.5 text-sm">
                  <span className="truncate">{th.name}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => save.mutate(setHidden(view, th.id, false))}>
                    {t("view.restore")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-2xs text-muted-foreground">{t("view.hint")}</p>
      </PopoverContent>
    </Popover>
  );
}
