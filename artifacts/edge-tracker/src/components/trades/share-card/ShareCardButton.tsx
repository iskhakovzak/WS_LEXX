/**
 * «Картинка» buttons: in the trade sheet (outline button with a label) and in a trades-list row (icon, shown on hover /
 * focus / the active row like «В плейбук»). Rendered only for the viewer's own closed trades while the desk switch
 * shareCards.enabled is on (model.ts canShareTrade). The dialog chunk loads on the first click.
 */
import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { ImageDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { shareCardI18n } from "@/i18n/ns/shareCard";
import { cn } from "@/lib/utils";
import { canShareTrade } from "./model";

const LazyShareCardDialog = React.lazy(() => import("./ShareCardDialog"));

function useCanShare(trade: Trade): boolean {
  const { user, permissions } = useAuth();
  const me = user && user.role !== "guest" ? user.traderName : null;
  return canShareTrade(trade, me, permissions);
}

function Dialog({ trade, open, onOpenChange }: { trade: Trade; open: boolean; onOpenChange: (v: boolean) => void }) {
  if (!open) return null;
  return (
    <React.Suspense fallback={null}>
      <LazyShareCardDialog trade={trade} open={open} onOpenChange={onOpenChange} />
    </React.Suspense>
  );
}

/** Trade sheet: «Картинка» next to «Изменить» / «В плейбук». */
export function ShareCardButton({ trade, className }: { trade: Trade; className?: string }) {
  const { t } = shareCardI18n.useT();
  const [open, setOpen] = React.useState(false);
  if (!useCanShare(trade)) return null;
  return (
    <>
      <Button variant="outline" size="sm" className={cn("gap-1.5", className)} title={t("buttonTitle")} onClick={() => setOpen(true)}>
        <ImageDown className="h-3.5 w-3.5" aria-hidden="true" /> {t("button")}
      </Button>
      <Dialog trade={trade} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Trades list row: an icon button; the click never opens the trade sheet underneath. */
export function ShareCardRowButton({ trade, active, onFocusRow }: { trade: Trade; active: boolean; onFocusRow?: (id: number) => void }) {
  const { t } = shareCardI18n.useT();
  const [open, setOpen] = React.useState(false);
  if (!useCanShare(trade)) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t("rowAria", { ticker: trade.ticker })}
        title={t("buttonTitle")}
        onClick={(e) => { e.stopPropagation(); onFocusRow?.(trade.id); setOpen(true); }}
        className={cn(
          "hidden h-8 w-8 place-items-center rounded-full text-muted-foreground transition-opacity hover:bg-[var(--glass-hover-bg)] hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid md:opacity-0 md:group-hover:opacity-100",
          active && "md:opacity-100",
        )}
      >
        <ImageDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {/* Portalled: the row ignores clicks that do not land inside its own DOM (review-list ReviewTradeRow). */}
      <Dialog trade={trade} open={open} onOpenChange={setOpen} />
    </>
  );
}
