/**
 * What a trader does with a ticker or a theme from /themes, reusing the desk's own flows:
 *   «В вотчлист»          POST /api/watchlist (a ticker already there is fine)
 *   «В план дня»          the personal day plan (shared finviz addToPlan: today until the close, then the next session)
 *   «Скопировать тикеры»  the clipboard
 * `TickerMenu` wraps a row (tickers boards, theme members) in a dropdown: click / tap / Enter opens it.
 */
import type { ReactElement } from "react";
import { ClipboardCopy, ClipboardList, Eye } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { themesI18n } from "@/i18n/ns/themes";
import { useAddToPlan } from "@/components/shared/finviz/api";
import { useAddToWatchlist } from "./api";
import { planDay } from "./model";

export function useTickerActions(source: string) {
  const watch = useAddToWatchlist();
  const plan = useAddToPlan(planDay());
  const t = themesI18n.t;
  return {
    toWatchlist: (ticker: string) =>
      watch.mutate(ticker, {
        onSuccess: (kind) => toast({ title: kind === "exists" ? t("actions.watchExists", { ticker }) : t("actions.watchAdded", { ticker }) }),
      }),
    toPlan: (ticker: string) =>
      plan.mutate({ ticker, catalyst: t("actions.planCatalyst", { source }) }, {
        onSuccess: (kind) => toast({ title: kind === "full" ? t("actions.planFull") : kind === "exists" ? t("actions.planExists", { ticker }) : t("actions.planAdded", { ticker }) }),
        onError: (e) => toast({ title: t("actions.planFailed", { ticker }), description: humanizeApiError(e), variant: "destructive" }),
      }),
    copy: async (tickers: readonly string[]) => {
      try {
        await navigator.clipboard.writeText(tickers.join(", "));
        toast({ title: t("actions.copied", { n: tickers.length }) });
      } catch {
        toast({ title: t("actions.copyFailed"), variant: "destructive" });
      }
    },
  };
}

/** A row that opens the ticker's actions. `children` must be ONE focusable element (the row button). */
export function TickerMenu({ ticker, source, children }: { ticker: string; source: string; children: ReactElement }) {
  const { t } = themesI18n.useT();
  const a = useTickerActions(source);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{ticker}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => a.toWatchlist(ticker)}><Eye className="mr-2 h-4 w-4" aria-hidden="true" />{t("actions.watch")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => a.toPlan(ticker)}><ClipboardList className="mr-2 h-4 w-4" aria-hidden="true" />{t("actions.plan")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void a.copy([ticker])}><ClipboardCopy className="mr-2 h-4 w-4" aria-hidden="true" />{t("actions.copyOne")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
