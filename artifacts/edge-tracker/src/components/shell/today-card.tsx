/**
 * Sidebar footer «Сегодня»: the trader's own day from the risk desk — net P&L, trades, what is left to the daily stop
 * (a meter) — linking to /risk. On a weekend / market holiday it reads neutrally (today-card-model.ts). Rail: a ring
 * (share of the stop used) with the day's sign in the centre; the numbers live in the tooltip.
 */
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LiveBadge } from "@/components/shared/live-badge";
import { shellI18n } from "@/i18n/ns/shell";
import { useMarketDay } from "./market-clock";
import { todayCardModel, type TodayTone } from "./today-card-model";
import type { RiskToday } from "./use-shell-badges";

const BAR: Record<TodayTone, string> = { down: "bg-down", warn: "bg-warn", ok: "bg-primary" };
const RING: Record<TodayTone, string> = { down: "stroke-down", warn: "stroke-warn", ok: "stroke-primary" };
const LINE: Record<TodayTone, string> = { down: "text-down", warn: "text-warn", ok: "text-muted-foreground" };

export function TodayCard({ risk, rail }: { risk: RiskToday; rail: boolean }) {
  const { t } = shellI18n.useT();
  const day = useMarketDay();
  const m = todayCardModel(risk, day);
  const pnlCls = m.pnlSign > 0 ? "text-up" : m.pnlSign < 0 ? "text-down" : "text-foreground";
  const lineCls = m.limitAlarm ? LINE[m.tone] : "text-muted-foreground";

  if (rail) {
    const r = 15;
    const c = 2 * Math.PI * r;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/risk" className="relative mx-auto grid h-9 w-9 place-items-center rounded-full outline-none transition-[background-color] duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring">
            <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90" aria-hidden="true">
              <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-muted-foreground/25" />
              {m.usedPct != null && m.usedPct > 0 && (
                <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(m.usedPct / 100) * c} ${c}`} className={RING[m.tone]} />
              )}
            </svg>
            <span aria-hidden="true" className={cn("absolute h-2 w-2 rounded-full", m.pnlSign > 0 ? "bg-up" : m.pnlSign < 0 ? "bg-down" : "bg-muted-foreground/50")} />
            <span className="sr-only">{[t("today.title"), m.pnl ?? m.tradesLine, m.limitLine].filter(Boolean).join(". ")}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          <div className="font-medium">{t("today.title")}{m.pnl && <span className={cn("ml-2 tabular-nums", pnlCls)}>{m.pnl}</span>}</div>
          <div className="text-muted-foreground">{m.tradesLine}{m.limitLine && <> · {m.limitLine}</>}</div>
          <LiveBadge live={risk.live} className="mt-0.5" />
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href="/risk"
      title={t("today.open")}
      className="block rounded-xl px-2.5 py-1.5 outline-none transition-[background-color] duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-foreground">{t("today.title")}</span>
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{m.tradesLine}</span>
        {m.pnl && <span className={cn("text-xs font-semibold tabular-nums", pnlCls)}>{m.pnl}</span>}
      </span>
      {m.usedPct != null && (
        <span
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(m.usedPct)}
          aria-label={m.usedAria ?? undefined}
          className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--glass-border)]"
        >
          <span className={cn("block h-full origin-left rounded-full transition-transform duration-[var(--dur-3)] ease-smooth", BAR[m.tone])} style={{ transform: `scaleX(${m.usedPct / 100})` }} />
        </span>
      )}
      {m.limitLine && <span className={cn("mt-1 line-clamp-2 block text-2xs leading-snug", lineCls)} title={m.limitLine}>{m.limitLine}</span>}
      <LiveBadge live={risk.live} className="mt-0.5 flex max-w-full" />
    </Link>
  );
}
