/**
 * Earnings from Finviz: the «отчёт сегодня» badge next to a ticker (plan tickers, screener rows, trade sheet) and the
 * «Отчёты» block of /events (today / tomorrow / this week). All badges of a day share one cached range request.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, PlugZap } from "lucide-react";
import { EmptyState, ErrorState, Panel, Pill, Segmented, usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCompact, fmtDeskDate } from "@/lib/format";
import { nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import { finvizI18n } from "@/i18n/ns/finviz";
import { earningsRangeQuery, useFinvizStatus } from "./api";
import {
  earningsFlag, earningsList, nextWeekday, normTicker, periodRange, sessionDay, type EarningsFlag, type EarningsPeriod, type EarningsRow,
} from "./model";

/** «Finviz не подключён» — one quiet line where a Finviz block would be. */
export function FinvizOff({ className }: { className?: string }) {
  const { t } = finvizI18n.useT();
  return <EmptyState compact icon={PlugZap} title={t("off.title")} description={t("off.hint")} className={className} />;
}

/** Re-renders once a minute (the NY day and «before the open» follow the clock). */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** The earnings flag of `ticker` around NY trading day `day` (default: the current session). */
export function useEarningsFlag(ticker: string, day?: string | null): { flag: EarningsFlag | null; day: string } {
  const now = useMinuteClock();
  const d = day ?? sessionDay(now);
  const { state } = useFinvizStatus();
  const sym = normTicker(ticker);
  const q = useQuery({ ...earningsRangeQuery(d, nextWeekday(d)), enabled: state === "on" && !!sym });
  return { flag: sym ? earningsFlag(sym, q.data, d) : null, day: d };
}

/**
 * «Отчёт сегодня» next to a ticker. `day` = the NY trading day the ticker belongs to (a trade's day); without it the
 * current session. `short` = compact text for dense rows (the full text stays in the tooltip).
 */
export function EarningsBadge({ ticker, day, short, className }: { ticker: string; day?: string | null; short?: boolean; className?: string }) {
  const { flag, day: d } = useEarningsFlag(ticker, day);
  if (!flag) return null;
  return <EarningsFlagPill flag={flag} onToday={d === nyDate()} short={short} className={className} />;
}

/** The pill itself, for rows that already know their flag (screener rows carry their own earnings date). */
export function EarningsFlagPill({ flag, onToday = true, short, className }: { flag: EarningsFlag; onToday?: boolean; short?: boolean; className?: string }) {
  const { t } = finvizI18n.useT();
  const full = onToday ? t(`earnings.badge.${flag}`) : t(`earnings.badgeOn.${flag}`);
  return (
    <Pill tone="warn" title={full} className={className}>
      <CalendarClock aria-hidden="true" />
      {short ? t(`earnings.badgeShort.${flag}`) : full}
      {short && <span className="sr-only">{full}</span>}
    </Pill>
  );
}

const SHOW = 8;
const PERIODS: EarningsPeriod[] = ["today", "tomorrow", "week"];

function EarningsRowItem({ r, mine, showDate, onOpen }: { r: EarningsRow; mine: boolean; showDate: boolean; onOpen?: (ticker: string) => void }) {
  const { t } = finvizI18n.useT();
  const timing = r.timing ? t(`earnings.timing.${r.timing}`) : t("earnings.timing.none");
  const body = (
    <>
      <span className="w-14 shrink-0 text-sm font-semibold">{r.ticker}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={r.company ?? undefined}>{r.company ?? ""}</span>
      {mine && <Pill tone="accent">{t("earnings.block.mine")}</Pill>}
      {showDate && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDeskDate(r.date, "dayMonth")}</span>}
      <Pill tone={r.timing === "bmo" ? "warn" : r.timing === "amc" ? "purple" : "neutral"} title={timing}>{r.timing ? r.timing.toUpperCase() : "—"}</Pill>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{r.marketCap != null ? `$${fmtCompact(r.marketCap)}` : "—"}</span>
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(r.ticker)}
          title={t("earnings.block.openTitle", { ticker: r.ticker })}
          className={cn("flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mine && "bg-primary/5")}
        >
          {body}
        </button>
      ) : (
        <div className={cn("flex min-w-0 items-center gap-2 px-2 py-1.5", mine && "bg-primary/5")}>{body}</div>
      )}
    </li>
  );
}

/**
 * /events «Отчёты»: today / tomorrow / this week from the Finviz calendar — the trader's own tickers first, then by
 * market cap. A row opens the page's earnings history sheet (`onOpenTicker`).
 */
export function EarningsBlock({ mine = [], onOpenTicker, className }: { mine?: readonly string[]; onOpenTicker?: (ticker: string) => void; className?: string }) {
  const { t } = finvizI18n.useT();
  const now = useMinuteClock();
  const today = nyDate(now);
  const { state } = useFinvizStatus();
  const [stored, setPeriod] = usePersistentState<EarningsPeriod>("finviz.earnings.period", "today");
  const period: EarningsPeriod = PERIODS.includes(stored) ? stored : "today";
  const [all, setAll] = useState(false);
  // One request covers every tab: this week plus the next session (Friday's «tomorrow» is Monday).
  const week = periodRange("week", today);
  const tomorrow = periodRange("tomorrow", today);
  const to = tomorrow.to > week.to ? tomorrow.to : week.to;
  const q = useQuery({ ...earningsRangeQuery(week.from, to), enabled: state === "on" });
  const mineSet = new Set(mine.map((x) => x.toUpperCase()));
  const rows = q.data ? earningsList(q.data, periodRange(period, today), mineSet) : [];
  const shown = all ? rows : rows.slice(0, SHOW);

  let body: ReactNode;
  if (state === "off") body = <FinvizOff />;
  else if (state === "loading" || q.isLoading) body = <div className="flex flex-col gap-2" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>;
  else if (q.isError) body = <ErrorState error={q.error} onRetry={() => q.refetch()} title={t("earnings.block.loadFailed")} compact inset />;
  else if (rows.length === 0) body = <p className="py-3 text-sm text-muted-foreground">{t("earnings.block.empty")}</p>;
  else {
    body = (
      <>
        <ul className="flex flex-col gap-0.5">
          {shown.map((r) => (
            <EarningsRowItem key={`${r.ticker}-${r.date}`} r={r} mine={mineSet.has(r.ticker.toUpperCase())} showDate={period === "week"} onOpen={onOpenTicker} />
          ))}
        </ul>
        {rows.length > SHOW && (
          <Button type="button" variant="ghost" size="sm" className="mt-1 self-start" onClick={() => setAll((v) => !v)}>
            {all ? t("earnings.block.less") : t("earnings.block.more", { n: rows.length - SHOW })}
          </Button>
        )}
      </>
    );
  }
  return (
    <Panel
      title={t("earnings.block.title")}
      description={state === "on" ? t("earnings.block.desc") : undefined}
      icon={CalendarClock}
      className={className}
      actions={
        state === "on" ? (
          <Segmented<EarningsPeriod>
            ariaLabel={t("earnings.block.tabsAria")}
            size="sm"
            value={period}
            onChange={(p) => { setPeriod(p); setAll(false); }}
            options={PERIODS.map((p) => ({ value: p, label: t(`earnings.block.tabs.${p}`) }))}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col">{body}</div>
    </Panel>
  );
}
