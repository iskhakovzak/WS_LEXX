/**
 * Members of one theme in a side sheet (bottom sheet on phones): the theme's four values, then a sortable mini
 * heat-table of its tickers (price + the 4 columns; phones: the active column and «За день»), the Finviz context chips
 * from tablet width up, and the tickers that had no quote.
 */
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TickerContext } from "@/components/shared/finviz/ticker-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { HeatCell, SortHeader } from "./heat";
import { METRICS, columnMax, hasValues, nextSort, phoneColumns, sortMembers, type ThemeMetric, type ThemeOut, type ThemeSort } from "./model";

const GRID = "grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-1.5 sm:grid-cols-[3.75rem_minmax(0,1fr)_repeat(4,4.75rem)]";

function Members({ theme, initialSort }: { theme: ThemeOut; initialSort: ThemeSort }) {
  const { t } = themesI18n.useT();
  const [picked, setPicked] = useState<ThemeSort | null>(null);
  const sort = picked ?? initialSort;
  const rows = useMemo(() => sortMembers(theme.members, sort), [theme.members, sort]);
  const phone = phoneColumns(sort.col);
  const hide = (c: ThemeMetric) => !phone.includes(c) && "hidden sm:block";
  const max = (c: ThemeMetric) => columnMax(theme.members, c);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className={cn(GRID, "border-b border-[var(--glass-border)] pb-1 text-2xs text-muted-foreground")}>
        <span>{t("cols.ticker")}</span>
        <span className="text-right">{t("cols.price")}</span>
        {METRICS.map((c) => (
          <SortHeader key={c} col={c} sort={sort} available={hasValues([theme], c)} onSort={(col) => setPicked(nextSort(sort, col))} className={cn(!phone.includes(c) && "hidden sm:inline-flex", "w-full")} />
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border/40">
        {rows.map((m) => (
          <li key={m.ticker} className="flex flex-col gap-1 py-1">
            <div className={GRID}>
              <span className="text-xs font-semibold">{m.ticker}</span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">{fmtPrice(m.price)}</span>
              {METRICS.map((c) => <HeatCell key={c} value={m[c]} max={max(c)} className={cn(hide(c))} />)}
            </div>
            <TickerContext ticker={m.ticker} max={3} className="hidden sm:flex" />
          </li>
        ))}
      </ul>
      {theme.missing.length > 0 && <p className="text-xs text-muted-foreground">{t("missing", { list: theme.missing.join(", ") })}</p>}
    </div>
  );
}

export function ThemeSheet({
  theme, sort, onOpenChange,
}: { theme: ThemeOut | null; sort: ThemeSort; onOpenChange: (open: boolean) => void }) {
  const { t } = themesI18n.useT();
  const mobile = useIsMobile();
  return (
    <Sheet open={!!theme} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-3 overflow-y-auto p-4 sm:p-5", mobile ? "max-h-[88dvh] rounded-t-2xl" : "w-full sm:max-w-2xl")}
      >
        {theme && (
          <>
            <SheetHeader>
              <SheetTitle>{theme.name}</SheetTitle>
              <SheetDescription>{t("sheetDesc")}</SheetDescription>
            </SheetHeader>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {METRICS.map((c) => (
                <div key={c} className="tile flex flex-col gap-1 p-2" title={t(`hints.${c}`)}>
                  <dt className="text-2xs text-muted-foreground">{t(`cols.${c}`)}</dt>
                  <dd><HeatCell value={theme[c]} max={Math.max(Math.abs(theme[c] ?? 0), 1)} className="text-sm" /></dd>
                </div>
              ))}
            </dl>
            <Members key={theme.id} theme={theme} initialSort={sort} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
