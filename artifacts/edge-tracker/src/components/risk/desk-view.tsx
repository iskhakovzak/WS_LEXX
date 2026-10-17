import * as React from "react";
import { Briefcase, Moon, Search, ShieldAlert, Users, Wallet, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, Panel, Segmented, StatCard, StatGrid, StatGridSkeleton, TableSkeleton, toneOf } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { HttpError, useRiskDesk, useRiskPositions } from "./use-risk";
import { LevelBadge, fmtSignedUsd, fmtUsd, useStoredState } from "./primitives";
import { exposureByTrader } from "./risk-math";
import { DeskTable, toTableRows, type DeskTableRow } from "./desk-table";
import { PositionsTable } from "./positions-table";
import { TraderSheet } from "./trader-sheet";

type StatusFilter = "all" | "attention" | "no_limits";
const STATUS_FILTERS: readonly StatusFilter[] = ["all", "attention", "no_limits"];

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** Who needs action right now: stopped / near a limit, with the exact reason. Renders nothing when the desk is clean. */
function ActionStrip({ rows, onOpen }: { rows: DeskTableRow[]; onOpen: (t: string) => void }) {
  const hot = rows.filter((r) => r.level === "stop" || r.level === "near").sort((a, b) => b.score - a.score);
  if (!hot.length) return null;
  const stopped = hot.some((r) => r.level === "stop");
  return (
    <section
      role="alert"
      aria-label="Требует действия"
      className={cn("glass-panel flex flex-col gap-2 rounded-2xl p-[var(--panel-p)] ring-1 ring-inset", stopped ? "ring-down/50" : "ring-warn/40")}
    >
      <h2 className="text-sm font-semibold">Требует действия · {hot.length}</h2>
      <ul className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
        {hot.map((t) => {
          const r = t.row;
          const reason = r.halted || r.stop.state === "warn" ? r.stop.message : r.alerts.map((a) => `${a.label}${a.pct != null ? ` ${Math.round(a.pct)}%` : ""}${a.detail ? ` (${a.detail})` : ""}`).join(" · ");
          return (
            <li key={r.trader}>
              <button
                type="button"
                onClick={() => onOpen(r.trader)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  t.level === "stop" ? "bg-down/10 hover:bg-down/15" : "bg-warn/10 hover:bg-warn/15",
                )}
              >
                <LevelBadge level={t.level} className="w-24" />
                <span className="font-semibold">{r.trader}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums" title={reason}>{reason}</span>
                <span className="shrink-0 text-xs text-primary">карточка →</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DeskView({ onUpdatedAt, focusTrader, focusTab = "overview", onShowOvernight }: {
  onUpdatedAt?: (ts: number) => void;
  focusTrader?: string | null;
  /** ?tab=limits opens the deep-linked trader straight on the limits editor. */
  focusTab?: "overview" | "limits";
  onShowOvernight?: () => void;
}) {
  const desk = useRiskDesk();
  const pos = useRiskPositions(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const focusedOnce = React.useRef<string | null>(null);
  const [sheetTab, setSheetTab] = React.useState<"overview" | "limits">("overview");
  const [query, setQuery] = React.useState("");
  const [showIdle, setShowIdle] = React.useState(false);
  const [statusFilter, setStatusFilter] = useStoredState<StatusFilter>("risk.desk.status", "all", STATUS_FILTERS);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (desk.dataUpdatedAt) onUpdatedAt?.(desk.dataUpdatedAt);
  }, [desk.dataUpdatedAt, onUpdatedAt]);

  // "/" focuses trader search
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = React.useMemo(() => desk.data?.traders ?? [], [desk.data]);
  const s = desk.data?.summary;
  const positions = React.useMemo(() => pos.data?.positions ?? [], [pos.data]);
  const exposure = React.useMemo(() => exposureByTrader(positions), [positions]);
  const tableRows = React.useMemo(() => toTableRows(rows, exposure), [rows, exposure]);

  // /risk?trader=X opens that trader's card once the desk has loaded.
  React.useEffect(() => {
    if (!focusTrader || focusedOnce.current === focusTrader) return;
    if (!rows.some((r) => r.trader === focusTrader)) return;
    focusedOnce.current = focusTrader;
    setSheetTab(focusTab);
    setSelected(focusTrader);
  }, [focusTrader, focusTab, rows]);

  const open = (trader: string, tab: "overview" | "limits" = "overview") => {
    setSheetTab(tab);
    setSelected(trader);
  };

  const attention = (t: DeskTableRow) => t.level === "stop" || t.level === "near";
  const noLimitRows = tableRows.filter((t) => t.level === "none");
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return tableRows.filter((t) => {
      if (q && !t.row.trader.toLowerCase().includes(q)) return false;
      if (statusFilter === "attention") return attention(t);
      if (statusFilter === "no_limits") return t.level === "none";
      return true;
    });
  }, [tableRows, query, statusFilter]);
  // No limits + no trades today + no open book: nothing to watch — fold into one footer line (unless asked for).
  const isIdle = (t: DeskTableRow) => t.level === "none" && t.row.today.trades === 0 && !(t.exposure?.count) && t.row.today.carriedTonight === 0;
  const foldIdle = statusFilter === "all" && !query.trim() && !showIdle;
  const idleRows = statusFilter === "all" && !query.trim() ? filtered.filter(isIdle) : [];
  const shown = foldIdle ? filtered.filter((t) => !isIdle(t)) : filtered;
  const selectedRow = rows.find((r) => r.trader === selected) ?? null;
  const limitsByTrader = React.useMemo(() => new Map(rows.map((r) => [r.trader, r.limits])), [rows]);

  if (desk.isError) {
    const notReady = desk.error instanceof HttpError && desk.error.status === 404;
    return notReady ? (
      <Panel>
        <EmptyState icon={ShieldAlert} title="Риск-деск ещё не подключён на сервере" description="API /api/risk/desk появится после пересборки сервера." />
      </Panel>
    ) : (
      <ErrorState title="Не удалось загрузить риск-деск" error={desk.error} onRetry={() => desk.refetch()} />
    );
  }

  // Desk-level aggregates from the open book (long / short / gross).
  let longUsd = 0, shortUsd = 0;
  for (const e of exposure.values()) { longUsd += e.longUsd; shortUsd += e.shortUsd; }
  const stops = tableRows.filter((t) => t.level === "stop");
  const nears = tableRows.filter((t) => t.level === "near");
  const tradedToday = rows.filter((r) => r.today.trades > 0).length;
  // Nothing happened today: fold the four zero KPIs into one status line (no empty "—/0/$0" cards).
  const quiet = !!s && !s.tradesToday && !s.openPositions && !s.carriedTonight && !stops.length && !nears.length && !s.pnlNetToday;

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      {desk.isLoading || !s ? (
        <StatGridSkeleton count={4} />
      ) : quiet ? (
        <p role="status" className="glass-panel flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-[var(--panel-p)] py-3 text-sm text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-2 font-medium text-foreground"><Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Сегодня ({desk.data!.date.slice(8, 10)}.{desk.data!.date.slice(5, 7)}) деск не торговал</span>
          <span>открытых позиций и овернайта нет</span>
          <span>все в пределах лимитов</span>
        </p>
      ) : (
        <StatGrid cols={4}>
          <StatCard
            label="P&L деска сегодня, нетто"
            icon={Wallet}
            value={s.pnlNetToday != null ? fmtSignedUsd(s.pnlNetToday) : "—"}
            tone={toneOf(s.pnlNetToday)}
            hint={s.tradesToday ? `${s.tradesToday} ${plural(s.tradesToday, "сделка", "сделки", "сделок")} · торговали ${tradedToday} из ${s.traders}` : `сегодня (${desk.data!.date.slice(8, 10)}.${desk.data!.date.slice(5, 7)}) сделок нет`}
          />
          <StatCard
            label="Стоп / у лимита"
            icon={ShieldAlert}
            value={<span><span className={stops.length ? "text-down" : ""}>{stops.length}</span><span className="text-muted-foreground"> / </span><span className={nears.length ? "text-warn" : ""}>{nears.length}</span></span>}
            hint={stops.length || nears.length ? [...stops, ...nears].map((t) => t.row.trader).join(", ") : "все в пределах лимитов"}
            onClick={stops.length || nears.length ? () => setStatusFilter("attention") : undefined}
          />
          <StatCard
            label="Экспозиция деска (gross)"
            icon={Briefcase}
            value={fmtUsd(longUsd + shortUsd, { compact: true })}
            hint={s.openPositions ? `лонг ${fmtUsd(longUsd, { compact: true })} · шорт ${fmtUsd(shortUsd, { compact: true })} · ${s.openPositions} поз.` : "открытых позиций нет"}
          />
          <StatCard
            label="Через закрытие"
            icon={Moon}
            value={fmtUsd(s.overnightExposureUsd, { compact: true })}
            hint={s.carriedTonight ? `${s.carriedTonight} поз. · риск по стопам ${fmtUsd(s.openRiskUsd, { compact: true })}` : "овернайт-книга пуста"}
            onClick={onShowOvernight}
          />
        </StatGrid>
      )}

      {!desk.isLoading && <ActionStrip rows={tableRows} onOpen={(t) => open(t)} />}

      <Panel
        title="Трейдеры по риску"
        icon={Users}
        description="Сверху — кто ближе всего к стопу. Полоски: использование дневного, недельного лимита и просадки; справа — сколько осталось."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); (e.target as HTMLInputElement).blur(); } }}
                placeholder="Трейдер…"
                aria-label="Поиск трейдера"
                className="h-9 w-40 pl-9 pr-8"
              />
              <Kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>
            </div>
            <Segmented
              ariaLabel="Фильтр по статусу"
              size="sm"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "Все", count: tableRows.length },
                { value: "attention", label: "Внимание", count: tableRows.filter(attention).length },
                { value: "no_limits", label: "Без лимитов", count: noLimitRows.length },
              ]}
            />
          </div>
        }
        footer={
          noLimitRows.length > 0 && !desk.isLoading ? (
            <>
              <span className="min-w-0 flex-1 tabular-nums">
                <span className="font-medium text-foreground">{noLimitRows.length} из {tableRows.length} без лимитов</span> — стоп для них не считается
                {foldIdle && idleRows.length > 0 ? `; ${idleRows.length} без сделок и позиций сегодня свёрнуты` : ""}: {noLimitRows.slice(0, 6).map((t) => t.row.trader).join(", ")}{noLimitRows.length > 6 ? "…" : ""}
              </span>
              {idleRows.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowIdle((v) => !v)} aria-expanded={showIdle}>
                  {showIdle ? "Свернуть" : `Показать ${idleRows.length}`}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => open(noLimitRows[0].row.trader, "limits")}>Задать лимиты</Button>
            </>
          ) : undefined
        }
      >
        {desk.isLoading ? (
          <TableSkeleton rows={3} cols={8} />
        ) : shown.length === 0 && idleRows.length > 0 ? (
          <EmptyState
            compact
            icon={Users}
            title="Сегодня следить не за кем"
            description="У трейдеров с лимитами нет записей, остальные без сделок и позиций. Разверните список в подвале панели."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title={rows.length === 0 ? "На деске пока нет трейдеров" : "Никого не найдено"}
            description={rows.length === 0 ? "Трейдеры появятся, когда у них будут сделки или лимиты." : "Измените поиск или фильтр."}
          />
        ) : (
          <DeskTable rows={shown} onOpen={(t) => open(t, rows.find((r) => r.trader === t)?.status === "no_limits" ? "limits" : "overview")} />
        )}
      </Panel>

      {positions.length > 0 && (
        <Panel title="Открытая книга деска" icon={Activity} description="Все открытые позиции: горизонт, срок, $ под риском и экспозиция">
          <PositionsTable
            positions={positions}
            showTrader
            limitsByTrader={limitsByTrader}
            onTraderClick={(t) => open(t)}
            storageKey="risk.desk.horizon"
            defaultFilter="all"
          />
        </Panel>
      )}

      <TraderSheet
        row={selectedRow}
        positions={positions}
        open={!!selectedRow}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
        initialTab={sheetTab}
      />
    </div>
  );
}
