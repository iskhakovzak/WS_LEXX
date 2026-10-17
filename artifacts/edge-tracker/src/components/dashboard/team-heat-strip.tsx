import { Link } from "wouter";
import { ChevronRight, Users } from "lucide-react";
import { EmptyState, Panel, Pill, StatusDot, limitTone, limitToneToTone, toneOf, toneText, type Tone } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { KPI_FORMULAS } from "@/lib/trade-math";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtR, plural } from "./fmt";
import type { RiskDesk, RiskDeskRow } from "./use-dashboard";

const STATUS_TONE: Record<RiskDeskRow["status"], Tone> = { breach: "down", warn: "warn", ok: "up", no_limits: "neutral" };
const STATUS_LABEL: Record<RiskDeskRow["status"], string> = { breach: "лимит", warn: "близко", ok: "в лимите", no_limits: "нет лимита" };
const RANK: Record<RiskDeskRow["status"], number> = { breach: 0, warn: 1, ok: 2, no_limits: 3 };

const COLS = "grid grid-cols-[minmax(0,1fr)_84px_84px_108px] items-center gap-x-3";

function money(v: number | null, r: number, trades: number) {
  return v != null ? fmtMoney(v) : trades > 0 && r !== 0 ? fmtR(r) : "—";
}

function TraderRow({ r }: { r: RiskDeskRow }) {
  const pnl = r.today.pnlNet;
  const loss = Math.max(0, -(pnl ?? 0));
  const limit = r.limits?.dailyLossLimit ?? null;
  const lt = r.halted ? "breach" : limitTone(loss, limit, 0.6);
  const pct = limit != null && limit > 0 ? Math.round((loss / limit) * 100) : null;
  return (
    <li>
      <Link
        href={links.risk(r.trader)}
        className={cn(COLS, "rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        aria-label={`${r.trader}: сегодня ${money(pnl, r.today.r, r.today.trades)}, статус ${r.halted ? "стоп" : STATUS_LABEL[r.status]}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{r.trader}</span>
          <span className="block truncate text-2xs text-muted-foreground tabular-nums">
            {r.today.trades} {plural(r.today.trades, ["сделка", "сделки", "сделок"])}
            {r.today.carriedTonight > 0 ? ` · ${r.today.carriedTonight} на ночь` : ""}
          </span>
        </span>
        <span className={cn("text-right text-sm font-medium tabular-nums", toneText(toneOf(pnl ?? r.today.r)))} title={KPI_FORMULAS.netPnl}>
          {money(pnl, r.today.r, r.today.trades)}
        </span>
        <span className={cn("text-right text-sm tabular-nums", toneText(toneOf(r.week.pnlNet ?? r.week.r)))}>{money(r.week.pnlNet, r.week.r, r.week.trades)}</span>
        <span className="flex justify-end">
          <StatusDot tone={r.halted ? "down" : pct != null ? limitToneToTone(lt) : STATUS_TONE[r.status]} className="text-muted-foreground">
            {r.halted ? "стоп" : pct != null ? `${pct}% лимита` : STATUS_LABEL[r.status]}
          </StatusDot>
        </span>
      </Link>
    </li>
  );
}

/** Staff only: one row per trader — today, week, daily-limit use (GET /api/risk/desk). Hidden on 404. */
export function DeskTodayPanel({ data, isLoading, fill }: { data: RiskDesk | null | undefined; isLoading: boolean; fill?: boolean }) {
  if (isLoading && data === undefined) {
    return (
      <Panel title="Деск сегодня" icon={Users} fill={fill}>
        <div className="flex flex-col gap-2" role="status" aria-label="Загрузка">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </Panel>
    );
  }
  if (!data) return null;
  const s = data.summary;
  const rows = data.traders.filter((r) => !r.banned).sort((a, b) => (a.halted === b.halted ? RANK[a.status] - RANK[b.status] : a.halted ? -1 : 1) || a.trader.localeCompare(b.trader, "ru"));

  return (
    <Panel
      title="Деск сегодня"
      icon={Users}
      fill={fill}
      description={`${s.traders} ${plural(s.traders, ["трейдер", "трейдера", "трейдеров"])} · ${s.tradesToday} ${plural(s.tradesToday, ["сделка", "сделки", "сделок"])} сегодня`}
      actions={
        s.halted + s.breach > 0 ? (
          <Pill tone="down" dot>
            {s.halted + s.breach} стоп
          </Pill>
        ) : s.warn > 0 ? (
          <Pill tone="warn" dot>
            {s.warn} близко к лимиту
          </Pill>
        ) : undefined
      }
      bodyClassName="px-2 sm:px-3"
      footer={
        <>
          <span className="tabular-nums">
            {s.pnlNetToday != null ? `Деск сегодня ${fmtMoney(s.pnlNetToday)} нетто` : "Сегодня сделок нет"}
            {s.carriedTonight ? ` · ${s.carriedTonight} на ночь` : ""}
          </span>
          <Link href={links.risk()} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
            Риск-деск
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact icon={Users} title="Трейдеров нет" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn(COLS, "px-2 pb-1 text-2xs text-muted-foreground")} aria-hidden="true">
            <span>Трейдер</span>
            <span className="text-right">Сегодня</span>
            <span className="text-right">Неделя</span>
            <span className="text-right">Лимит дня</span>
          </div>
          <ul className="flex max-h-[340px] flex-col overflow-y-auto" aria-label="Трейдеры деска">
            {rows.map((r) => (
              <TraderRow key={r.trader} r={r} />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
