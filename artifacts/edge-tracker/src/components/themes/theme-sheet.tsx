/**
 * One theme in a side sheet (bottom sheet on phones): its values in the user's visible columns, then a sortable mini
 * heat-table of its tickers (price + those columns; phones: the active column and «За день»), the Finviz context chips
 * from tablet width up, and the tickers that had no quote. Actions: a shared theme can be hidden for this user; the
 * user's own theme can be edited or deleted (archived).
 */
import { useMemo, useState, type CSSProperties } from "react";
import { EyeOff, Pencil, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { TickerContext } from "@/components/shared/finviz/ticker-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { HeatCell, SortHeader } from "./heat";
import { columnMax, hasValues, nextSort, phoneColumns, sortMembers, type BoardTheme, type ThemeMetric, type ThemeSort } from "./model";

const GRID = "grid grid-cols-[3.5rem_minmax(0,1fr)_repeat(var(--np),4.5rem)] items-center gap-x-1.5 sm:grid-cols-[3.75rem_minmax(0,1fr)_repeat(var(--n),4.75rem)]";

function Members({ theme, columns, initialSort }: { theme: BoardTheme; columns: readonly ThemeMetric[]; initialSort: ThemeSort }) {
  const { t } = themesI18n.useT();
  const [picked, setPicked] = useState<ThemeSort | null>(null);
  const sort = picked && columns.includes(picked.col) ? picked : initialSort;
  const rows = useMemo(() => sortMembers(theme.members, sort), [theme.members, sort]);
  const phone = phoneColumns(sort.col, columns);
  const narrow = (c: ThemeMetric, show: string) => !phone.includes(c) && `hidden ${show}`;
  const vars = { "--n": columns.length, "--np": phone.length } as CSSProperties;
  return (
    <div className="flex min-h-0 flex-col gap-2" style={vars}>
      <div className={cn(GRID, "border-b border-[var(--glass-border)] pb-1 text-2xs text-muted-foreground")}>
        <span>{t("cols.ticker")}</span>
        <span className="text-right">{t("cols.price")}</span>
        {columns.map((c) => (
          <SortHeader key={c} col={c} sort={sort} available={hasValues([theme], c)} onSort={(col) => setPicked(nextSort(sort, col))} className={cn(narrow(c, "sm:inline-flex"), "w-full")} />
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border/40">
        {rows.map((m) => (
          <li key={m.ticker} className="flex flex-col gap-1 py-1">
            <div className={GRID}>
              <span className="text-xs font-semibold">{m.ticker}</span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">{fmtPrice(m.price)}</span>
              {columns.map((c) => <HeatCell key={c} value={m[c]} max={columnMax(theme.members, c)} className={cn(narrow(c, "sm:block"))} />)}
            </div>
            <TickerContext ticker={m.ticker} max={3} className="hidden sm:flex" />
          </li>
        ))}
      </ul>
      {theme.missing.length > 0 && <p className="text-xs text-muted-foreground">{t("missing", { list: theme.missing.join(", ") })}</p>}
    </div>
  );
}

/** Hide (shared theme) or edit / delete (own theme); delete asks once more in place. */
function Actions({ theme, onHide, onEdit, onRemove }: { theme: BoardTheme; onHide: () => void; onEdit: () => void; onRemove: () => void }) {
  const { t } = themesI18n.useT();
  const [confirm, setConfirm] = useState(false);
  if (!theme.mine) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onHide}>
        <EyeOff aria-hidden="true" /> {t("sheet.hide")}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onEdit}>
        <Pencil aria-hidden="true" /> {t("sheet.edit")}
      </Button>
      <Button type="button" variant={confirm ? "destructive" : "ghost"} size="sm" onClick={() => (confirm ? onRemove() : setConfirm(true))}>
        <Trash2 aria-hidden="true" /> {confirm ? t("sheet.removeConfirm") : t("sheet.remove")}
      </Button>
    </div>
  );
}

export function ThemeSheet({
  theme, columns, sort, canEdit, onOpenChange, onHide, onEdit, onRemove,
}: {
  theme: BoardTheme | null;
  columns: readonly ThemeMetric[];
  sort: ThemeSort;
  /** A member (not a guest): may hide / edit. */
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onHide: (theme: BoardTheme) => void;
  onEdit: (theme: BoardTheme) => void;
  onRemove: (theme: BoardTheme) => void;
}) {
  const { t } = themesI18n.useT();
  const mobile = useIsMobile();
  const mine = theme?.mine ?? null;
  return (
    <Sheet open={!!theme} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-3 overflow-y-auto p-4 sm:p-5", mobile ? "max-h-[88dvh] rounded-t-2xl" : "w-full sm:max-w-2xl")}
      >
        {theme && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {theme.name}
                {mine && <span className="rounded bg-primary/12 px-1.5 text-xs font-normal text-accent-soft">{t("mine")}</span>}
              </SheetTitle>
              <SheetDescription>{t("sheetDesc")}</SheetDescription>
            </SheetHeader>
            {canEdit && <Actions key={theme.key} theme={theme} onHide={() => onHide(theme)} onEdit={() => onEdit(theme)} onRemove={() => onRemove(theme)} />}
            {mine?.screener && (
              <p className="break-words text-xs text-muted-foreground">
                {t("sheet.screener", { filters: mine.screener.filters.join(", ") })}
                {mine.needsFinviz ? ` · ${t("sheet.needsFinviz")}` : !mine.tickers.length ? ` · ${t("sheet.resolving")}` : ""}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {columns.map((c) => (
                <div key={c} className="tile flex flex-col gap-1 p-2" title={t(`hints.${c}`)}>
                  <dt className="text-2xs text-muted-foreground">{t(`cols.${c}`)}</dt>
                  <dd><HeatCell value={theme[c]} max={Math.max(Math.abs(theme[c] ?? 0), 1)} className="text-sm" /></dd>
                </div>
              ))}
            </dl>
            <Members key={theme.key} theme={theme} columns={columns} initialSort={sort} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
