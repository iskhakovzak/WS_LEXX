/**
 * Shared pieces of the compact insight cards: the card chrome (ds Panel), «мало данных», diverging mini bars, the
 * money tone of a value (the «Вид» colours + break-even range) and the drill into «Разрезы».
 *
 * Drill: a card on the dashboard opens /stats (the period page with the «Разрезы» panel) with the slice checked; a
 * card on /stats opens the trade list of the same period / trader with the slice. The slice is written into the
 * viewer's saved «Разрезы» view (the same view every period page and /trades read), so it is never a hidden filter:
 * the target page shows it as chips and «Сбросить» clears it. Other columns and «Исключить IMX» stay as they were.
 */
import * as React from "react";
import { useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, SearchX } from "lucide-react";
import { Panel } from "@/components/ds";
import { useBeRange } from "@/components/ds/money";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFacetView } from "@/components/shared/trade-facets/api";
import { classifyPnl, type PnlClass } from "@/lib/appearance/be-range";
import type { FacetDim } from "@/lib/trade-facets";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { insightCardsI18n } from "@/i18n/ns/insightCards";
import { onlyFacet } from "./model";

/** Where the cards live and where they drill. */
export type InsightScope = {
  /** «stats»: dashboard → /stats with the slice; «trades»: /stats → the trade list of the period with the slice. */
  target: "stats" | "trades";
  from: string | null;
  to: string | null;
  /** One person (staff on a trader / their own book); null = the viewer's own book (server-scoped). */
  trader: string | null;
  /** /stats preset that matches the dashboard window (target «stats»). */
  statsPeriod?: string;
  /** Subtitle «Сделки: name» when the book is not the viewer's own. */
  ownerName?: string | null;
};

export function sliceHref(scope: InsightScope): string {
  if (scope.target === "stats") {
    const p = new URLSearchParams();
    if (scope.statsPeriod) p.set("period", scope.statsPeriod);
    if (scope.trader) p.set("trader", scope.trader);
    const q = p.toString();
    return q ? `/stats?${q}` : "/stats";
  }
  return links.trades({ from: scope.from ?? undefined, to: scope.to ?? undefined, trader: scope.trader ?? undefined });
}

/** The trade list of the scope, with extra /trades params (outcome, sort, view). */
export function tradesHref(scope: InsightScope, extra: Record<string, string> = {}): string {
  const base = links.trades({ from: scope.from ?? undefined, to: scope.to ?? undefined, trader: scope.trader ?? undefined });
  const [path, query = ""] = base.split("?");
  const p = new URLSearchParams(query);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

/** Check only `keys` of `dim` in «Разрезы», then open the slice page. */
export function useDrill(scope: InsightScope) {
  const fv = useFacetView();
  const [, navigate] = useLocation();
  const { update, ready } = fv;
  return React.useCallback(
    (dim: FacetDim, keys: readonly string[]) => {
      // Before the saved view has loaded, writing would replace it with an empty one: open the page unfiltered.
      if (ready) update((v) => onlyFacet(v, dim, keys));
      navigate(sliceHref(scope));
    },
    [ready, update, navigate, scope],
  );
}

const TONE_BG: Record<PnlClass, string> = {
  win: "bg-up",
  loss: "bg-down",
  be: "bg-be",
  flat: "bg-foreground/25",
  none: "bg-foreground/15",
};
const TONE_TEXT: Record<PnlClass, string> = {
  win: "text-up",
  loss: "text-down",
  be: "text-be",
  flat: "text-foreground",
  none: "text-muted-foreground",
};

/** Money colour classes of a dollar value under the current break-even range. */
export function useMoneyTone() {
  const range = useBeRange();
  return React.useMemo(
    () => ({
      range,
      bg: (v: number | null | undefined) => TONE_BG[classifyPnl(v, range)],
      text: (v: number | null | undefined) => TONE_TEXT[classifyPnl(v, range)],
    }),
    [range],
  );
}

/** The card: ds Panel, equal height in its row, an optional footer link. */
export function InsightCard({
  icon,
  title,
  subtitle,
  footer,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel fill icon={icon} title={title} description={subtitle} footer={footer} className={className}>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
    </Panel>
  );
}

/** Footer action of a card: a full-width quiet button «Открыть в разрезах ›». */
export function FooterLink({ label, onClick, href }: { label: string; onClick?: () => void; href?: string }) {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      onClick={() => (onClick ? onClick() : href ? navigate(href) : undefined)}
      className="-mx-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

export function CardSkeleton({ icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <InsightCard icon={icon} title={title}>
      <div className="flex flex-col gap-2" role="status" aria-label={commonI18n.t("states.loading")}>
        <Skeleton className="h-5 w-3/4 rounded-md" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </InsightCard>
  );
}

/** «Мало данных» with the sample size, instead of a verdict that a handful of trades cannot carry. */
export function LowData({ have, need }: { have: number; need: number }) {
  const { t } = insightCardsI18n.useT();
  return (
    <div className="tile flex flex-1 items-center gap-3 px-3 py-3">
      <SearchX className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{t("lowData")}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{t("lowDataHint", { have, need })}</p>
      </div>
    </div>
  );
}

/** One-line verdict: the card's single clear sentence. */
export function Verdict({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm font-medium leading-snug text-foreground", className)}>{children}</p>;
}

export type MiniBar = {
  key: string;
  label: string;
  value: number;
  /** No trades in this bucket (drawn as a stub, not clickable). */
  empty?: boolean;
  /** Accessible name of the bar button (value, sample, action). */
  aria: string;
  tip: React.ReactNode;
  mark?: boolean;
  onClick?: () => void;
};

/**
 * Diverging mini bars: the zero rule sits where the largest gain and the largest loss meet, bars grow from it in the
 * money colours. Each bar is a button with a tooltip; marked bars (best / worst) are solid, the rest softer.
 */
export function MiniBars({ items, height = 64 }: { items: MiniBar[]; height?: number }) {
  const tone = useMoneyTone();
  const maxPos = Math.max(0, ...items.map((i) => i.value));
  const maxNeg = Math.max(0, ...items.map((i) => -i.value));
  const span = maxPos + maxNeg || 1;
  const zero = maxPos / span; // share of the height above the zero rule
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => {
        const h = (Math.abs(it.value) / span) * 100;
        const up = it.value >= 0;
        const bar = (
          <button
            type="button"
            disabled={it.empty || !it.onClick}
            onClick={it.onClick}
            aria-label={it.aria}
            className="group flex w-full min-w-0 flex-col items-stretch gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          >
            <span className="relative block w-full rounded-md transition-colors group-enabled:group-hover:bg-[var(--glass-hover-bg)]" style={{ height }} aria-hidden="true">
              <span className="absolute inset-x-0 h-px bg-foreground/25" style={{ top: `${zero * 100}%` }} />
              {!it.empty && h > 0 && (
                <span
                  className={cn("absolute inset-x-[18%] rounded-[3px]", tone.bg(it.value), it.mark ? "opacity-100" : "opacity-55")}
                  style={up ? { bottom: `${(1 - zero) * 100}%`, height: `max(${h}%, 2px)` } : { top: `${zero * 100}%`, height: `max(${h}%, 2px)` }}
                />
              )}
            </span>
            <span className={cn("truncate text-center text-2xs tabular-nums", it.mark ? "font-semibold text-foreground" : "text-muted-foreground")} aria-hidden="true">
              {it.label}
            </span>
          </button>
        );
        return (
          <Tooltip key={it.key}>
            <TooltipTrigger asChild>{bar}</TooltipTrigger>
            <TooltipContent side="top">{it.tip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Compact hold «45с», «5м», «1ч 20м» in the UI language. */
export function fmtHoldShort(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const t = insightCardsI18n.t;
  if (s < 60) return t("hold.s", { s });
  if (s < 3600) {
    const m = Math.floor(s / 60), r = s % 60;
    return m < 10 && r ? t("hold.ms", { m, s: r }) : t("hold.m", { m });
  }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return m ? t("hold.hm", { h, m }) : t("hold.h", { h });
}
