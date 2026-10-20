/**
 * «Вид» — the columns of the active board (the last visible one stays) and, on «Общие темы», the shared themes the user
 * hid (restore here; hide from a theme's card). Saved in the profile at once: the shared view in users.settings, a
 * personal board's columns on the board.
 */
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { themesI18n } from "@/i18n/ns/themes";
import { toggleIn, type BoardColumn } from "./model";

export function ViewPopover<C extends BoardColumn>({
  all, visible, onColumns, hidden, onRestore,
}: {
  all: readonly C[];
  visible: readonly C[];
  onColumns: (next: C[]) => void;
  /** «Общие темы» only: the hidden shared themes. */
  hidden?: readonly { id: number; name: string }[];
  onRestore?: (id: number) => void;
}) {
  const { t } = themesI18n.useT();
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
          {all.map((c) => {
            const k: BoardColumn = c;
            const on = visible.includes(c);
            const last = on && visible.length === 1;
            return (
              <label key={c} className="flex items-center gap-2 text-sm" title={last ? t("view.lastColumn") : t(`hints.${k}`)}>
                <Checkbox checked={on} disabled={last} onCheckedChange={() => onColumns(toggleIn(visible, all, c))} />
                {t(`cols.${k}`)}
              </label>
            );
          })}
        </fieldset>
        {hidden && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t("view.hiddenTitle")}</p>
            {hidden.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("view.hiddenNone")}</p>
            ) : (
              <ul className="flex max-h-48 flex-col overflow-y-auto">
                {hidden.map((th) => (
                  <li key={th.id} className="flex items-center justify-between gap-2 py-0.5 text-sm">
                    <span className="truncate">{th.name}</span>
                    <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onRestore?.(th.id)}>
                      {t("view.restore")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="text-2xs text-muted-foreground">{t("view.hint")}</p>
      </PopoverContent>
    </Popover>
  );
}
