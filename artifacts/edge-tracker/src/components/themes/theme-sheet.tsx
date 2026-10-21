/**
 * One theme in a side sheet (bottom sheet on phones): its values, actions, then a sortable mini heat-table of its
 * tickers (price + the visible columns; phones: the active column and «За день») — a ticker opens its menu («В
 * вотчлист», «В план дня», «Скопировать») — the Finviz context chips from tablet width up, and the unquoted tickers.
 *   any theme      «Скопировать тикеры», «Новая доска из темы»
 *   shared theme   «На доску» (pin / unpin on the user's themes boards), «Скрыть у меня» (on «Общие темы»)
 *   own theme      «Изменить», «Удалить» (archive)
 */
import { useMemo, useState, type CSSProperties } from "react";
import { ClipboardCopy, EyeOff, LayoutGrid, Pencil, Pin, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TickerContext } from "@/components/shared/finviz/ticker-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { HeatCell, SortHeader, valueTracks } from "./heat";
import { TickerMenu, useTickerActions } from "./ticker-actions";
import { columnMax, nextSort, phoneColumns, sortMembers, themeTickerList, type BoardMeta, type BoardTheme, type ThemeMetric, type ThemeSort } from "./model";

const GRID = "grid grid-cols-[3.5rem_minmax(0,1fr)_var(--pvt)] items-center gap-x-1.5 sm:grid-cols-[3.75rem_minmax(0,1fr)_var(--vt)]";

function Members({ theme, columns, initialSort }: { theme: BoardTheme; columns: readonly ThemeMetric[]; initialSort: ThemeSort }) {
  const { t } = themesI18n.useT();
  const [picked, setPicked] = useState<ThemeSort | null>(null);
  const sort = picked && columns.includes(picked.col) ? picked : initialSort;
  const rows = useMemo(() => sortMembers(theme.members, sort), [theme.members, sort]);
  const phone = phoneColumns(sort.col, columns);
  const narrow = (c: ThemeMetric, show: string) => !phone.includes(c) && `hidden ${show}`;
  const vars = { "--vt": valueTracks(columns, [], "4.75rem"), "--pvt": valueTracks(phone, [], "4.5rem") } as CSSProperties;
  return (
    <div className="flex min-h-0 flex-col gap-2" style={vars}>
      <div className={cn(GRID, "border-b border-[var(--glass-border)] pb-1 text-2xs text-muted-foreground")}>
        <span>{t("cols.ticker")}</span>
        <span className="text-right">{t("cols.price")}</span>
        {columns.map((c) => (
          <SortHeader key={c} col={c} sort={sort} onSort={(col) => setPicked(nextSort(sort, col))} className={cn(narrow(c, "sm:inline-flex"), "w-full")} />
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border/40">
        {rows.map((m) => (
          <li key={m.ticker} className="flex flex-col gap-1 py-0.5">
            <TickerMenu ticker={m.ticker} source={theme.name}>
              <button type="button" className={cn(GRID, "h-7 w-full rounded-md text-left hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
                <span className="text-xs font-semibold">{m.ticker}</span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">{fmtPrice(m.price)}</span>
                {columns.map((c) => <HeatCell key={c} value={m[c]} max={columnMax(theme.members, c)} className={cn(narrow(c, "sm:block"))} />)}
              </button>
            </TickerMenu>
            <TickerContext ticker={m.ticker} max={3} className="hidden sm:flex" />
          </li>
        ))}
      </ul>
      {theme.missing.length > 0 && <p className="text-xs text-muted-foreground">{t("missing", { list: theme.missing.join(", ") })}</p>}
    </div>
  );
}

export type ThemeSheetActions = {
  onHide?: (theme: BoardTheme) => void;
  onEdit: (theme: BoardTheme) => void;
  onRemove: (theme: BoardTheme) => void;
  onNewBoard: (theme: BoardTheme) => void;
  onPin: (board: BoardMeta, themeId: number, pinned: boolean) => void;
};

function Actions({ theme, boards, canEdit, a }: { theme: BoardTheme; boards: readonly BoardMeta[]; canEdit: boolean; a: ThemeSheetActions }) {
  const { t } = themesI18n.useT();
  const [confirm, setConfirm] = useState(false);
  const acts = useTickerActions(theme.name);
  const tickers = themeTickerList(theme);
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button type="button" variant="outline" size="sm" disabled={!tickers.length} onClick={() => void acts.copy(tickers)}>
        <ClipboardCopy aria-hidden="true" /> {t("actions.copyAll")}
      </Button>
      {canEdit && (
        <Button type="button" variant="ghost" size="sm" disabled={!tickers.length} onClick={() => a.onNewBoard(theme)}>
          <LayoutGrid aria-hidden="true" /> {t("actions.newBoard")}
        </Button>
      )}
      {canEdit && !theme.mine && boards.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm"><Pin aria-hidden="true" /> {t("actions.pin")}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {boards.map((b) => {
              const on = b.pinned.includes(theme.id);
              return <DropdownMenuCheckboxItem key={b.id} checked={on} onCheckedChange={() => a.onPin(b, theme.id, !on)}>{b.name}</DropdownMenuCheckboxItem>;
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canEdit && !theme.mine && a.onHide && (
        <Button type="button" variant="ghost" size="sm" onClick={() => a.onHide!(theme)}><EyeOff aria-hidden="true" /> {t("sheet.hide")}</Button>
      )}
      {canEdit && theme.mine && (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => a.onEdit(theme)}><Pencil aria-hidden="true" /> {t("sheet.edit")}</Button>
          <Button type="button" variant={confirm ? "destructive" : "ghost"} size="sm" onClick={() => (confirm ? a.onRemove(theme) : setConfirm(true))}>
            <Trash2 aria-hidden="true" /> {confirm ? t("sheet.removeConfirm") : t("sheet.remove")}
          </Button>
        </>
      )}
    </div>
  );
}

export function ThemeSheet({
  theme, columns, sort, canEdit, themesBoards, actions, onOpenChange,
}: {
  theme: BoardTheme | null;
  columns: readonly ThemeMetric[];
  sort: ThemeSort;
  /** A member (not a guest): may hide / pin / edit. */
  canEdit: boolean;
  /** The user's themes boards (pin targets). */
  themesBoards: readonly BoardMeta[];
  actions: ThemeSheetActions;
  onOpenChange: (open: boolean) => void;
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
            <Actions key={theme.key} theme={theme} boards={themesBoards} canEdit={canEdit} a={actions} />
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
