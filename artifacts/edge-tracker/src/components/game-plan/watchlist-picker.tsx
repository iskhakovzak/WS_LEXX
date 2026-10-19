import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Eye, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { TickerSuggestion } from "./plan-editor-parts";
import { gpI18n } from "@/i18n/ns/gamePlan";
import { commonI18n } from "@/i18n/ns/common";

/* ── Watchlist picker ───────────────────────────────────────────────────────── */
type WatchItem = {
  id: number;
  ticker: string;
  catalyst: string | null;
  targetPrice: string | null;
  stopPrice: string | null;
  status: string;
  notes: string | null;
  inPlay?: boolean | null;
};

function fromWatch(w: WatchItem): TickerSuggestion {
  const tp = w.targetPrice ? Number(w.targetPrice) : NaN;
  const sp = w.stopPrice ? Number(w.stopPrice) : NaN;
  return {
    ticker: w.ticker.toUpperCase(),
    catalyst: w.catalyst ?? "",
    support: Number.isFinite(sp) ? String(sp) : "",
    resistance: Number.isFinite(tp) ? String(tp) : "",
    bias: Number.isFinite(tp) && Number.isFinite(sp) ? (tp > sp ? "bull" : "bear") : "neutral",
    plan: (w.notes ?? "").slice(0, 3000),
  };
}

export function WatchlistPicker({ taken, onPick }: { taken: string[]; onPick: (list: TickerSuggestion[]) => void }) {
  const { t: tr } = gpI18n.useT();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["game-plan", "watchlist-picker"],
    queryFn: ({ signal }) => http.get<WatchItem[]>("/api/watchlist", { signal }),
    enabled: open,
    staleTime: STALE.short,
  });
  const { hot, watching } = useMemo(() => {
    const rows = Array.isArray(q.data) ? q.data : [];
    const isHot = (w: WatchItem) => w.inPlay === true && w.status === "watching";
    return { hot: rows.filter(isHot), watching: rows.filter((w) => w.status === "watching" && !isHot(w)) };
  }, [q.data]);
  const freshHot = hot.filter((w) => !taken.includes(w.ticker.toUpperCase()));

  const item = (w: WatchItem) => {
    const added = taken.includes(w.ticker.toUpperCase());
    return (
      <CommandItem
        key={w.id}
        value={`${w.ticker} ${w.catalyst ?? ""} ${w.id}`}
        disabled={added}
        onSelect={() => {
          onPick([fromWatch(w)]);
          setOpen(false);
        }}
        className="flex items-start gap-2"
      >
        <span className="w-14 shrink-0 font-semibold">{w.ticker}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{w.catalyst ?? "—"}</span>
        {added && <Check className="h-4 w-4 shrink-0 text-primary" aria-label={tr("editor.inPlan")} />}
      </CommandItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Eye aria-hidden="true" />
          {tr("editor.fromWatchlist")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder={tr("editor.tickerSearch")} />
          <CommandList>
            {q.isLoading ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {commonI18n.t("states.loading")}
              </div>
            ) : q.isError ? (
              <div className="p-3 text-sm text-muted-foreground">{tr("editor.watchlistUnavailable")}</div>
            ) : (
              <>
                <CommandEmpty>{tr("editor.noTickers")}</CommandEmpty>
                {hot.length > 0 && (
                  <CommandGroup heading={tr("editor.hotOnWatchlist")}>
                    {freshHot.length > 1 && (
                      <CommandItem
                        value="__all_in_play__"
                        onSelect={() => {
                          onPick(freshHot.map(fromWatch));
                          setOpen(false);
                        }}
                        className="font-medium text-primary"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        {tr("editor.addAll", { count: freshHot.length })}
                      </CommandItem>
                    )}
                    {hot.map(item)}
                  </CommandGroup>
                )}
                {watching.length > 0 && <CommandGroup heading={tr("editor.watchlist")}>{watching.map(item)}</CommandGroup>}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
