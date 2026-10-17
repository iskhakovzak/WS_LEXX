import * as React from "react";
import { Link } from "wouter";
import { Moon, Briefcase, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { EmptyState, Pill, Segmented, TableScroll, useTableSort } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RiskLimits, RiskPosition } from "./use-risk";
import { HORIZON_LABEL, HORIZON_TONE, SortableTableHead, fmtUsd, useStoredState } from "./primitives";

/** Planned vs stop-implied risk disagree by >25%: show both so the curator sees which one counts. */
function mismatchText(p: RiskPosition): string | null {
  if (!p.riskMismatch || p.plannedRiskUsd == null || p.stopRiskUsd == null) return null;
  return `план ${fmtUsd(p.plannedRiskUsd)} ≠ по стопу ${fmtUsd(p.stopRiskUsd)}`;
}

export type HorizonFilter = "all" | "carried" | "intraday" | "overnight" | "swing";
const FILTERS: readonly HorizonFilter[] = ["all", "carried", "intraday", "overnight", "swing"];

const HORIZON_ORDER: Record<string, number> = { intraday: 0, overnight: 1, swing: 2 };
const POSITION_ACCESSORS = {
  ticker: (p: RiskPosition) => p.ticker,
  trader: (p: RiskPosition) => p.trader,
  horizon: (p: RiskPosition) => HORIZON_ORDER[p.horizon] ?? 9,
  side: (p: RiskPosition) => p.side,
  qty: (p: RiskPosition) => p.qty,
  days: (p: RiskPosition) => p.daysHeld,
  risk: (p: RiskPosition) => p.riskUsd,
  exposure: (p: RiskPosition) => p.exposureUsd,
};
type SortKey = keyof typeof POSITION_ACCESSORS;

function matches(p: RiskPosition, f: HorizonFilter) {
  if (f === "all") return true;
  if (f === "carried") return p.carried;
  return p.horizon === f;
}

/** Over-limit flags for a single position. */
function flags(p: RiskPosition, limits: RiskLimits | null | undefined): string[] {
  if (!limits) return [];
  const out: string[] = [];
  if (limits.maxRiskPerTrade != null && (p.riskUsd ?? 0) > limits.maxRiskPerTrade) out.push("риск > лимита на сделку");
  if (limits.maxPositionUsd != null && (p.exposureUsd ?? 0) > limits.maxPositionUsd) out.push("размер > лимита позиции");
  if (!limits.allowOvernight && p.carried && p.horizon !== "swing") out.push("овернайт запрещён");
  if (!limits.allowSwing && p.horizon === "swing") out.push("свинг запрещён");
  if (p.riskSource === "stop" && p.stopRiskUsd === 0) out.push("стоп уже пробит");
  return out;
}

export function PositionsTable({
  positions,
  showTrader = false,
  limitsByTrader,
  onTraderClick,
  storageKey,
  defaultFilter = "all",
  compact = false,
}: {
  positions: RiskPosition[];
  showTrader?: boolean;
  limitsByTrader?: Map<string, RiskLimits | null>;
  onTraderClick?: (trader: string) => void;
  storageKey: string;
  defaultFilter?: HorizonFilter;
  compact?: boolean;
}) {
  const [filter, setFilter] = useStoredState<HorizonFilter>(storageKey, defaultFilter, FILTERS);

  const counts = React.useMemo(() => {
    const c: Record<HorizonFilter, number> = { all: 0, carried: 0, intraday: 0, overnight: 0, swing: 0 };
    for (const p of positions) for (const f of FILTERS) if (matches(p, f)) c[f]++;
    return c;
  }, [positions]);

  const filtered = React.useMemo(() => positions.filter((p) => matches(p, filter)), [positions, filter]);
  const { rows, thProps } = useTableSort(filtered, POSITION_ACCESSORS, "risk");

  const totalRisk = rows.reduce((s, p) => s + (p.riskUsd ?? 0), 0);
  const totalExp = rows.reduce((s, p) => s + (p.exposureUsd ?? 0), 0);

  const sortHead = (k: SortKey, children: React.ReactNode, align?: "right") => (
    <SortableTableHead {...thProps(k)} align={align}>{children}</SortableTableHead>
  );

  const traderCell = (name: string) =>
    onTraderClick ? (
      <button type="button" onClick={() => onTraderClick(name)} className="rounded-full font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {name}
      </button>
    ) : (
      <span className="font-medium">{name}</span>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          ariaLabel="Фильтр по горизонту"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Все", count: counts.all },
            { value: "carried", label: "Перенос", count: counts.carried },
            { value: "intraday", label: "Интрадей", count: counts.intraday },
            { value: "overnight", label: "Овернайт", count: counts.overnight },
            { value: "swing", label: "Свинг", count: counts.swing },
          ]}
        />
        {rows.length > 0 && (
          <div className="flex gap-3 text-xs text-muted-foreground tabular-nums">
            <span>Риск <span className="font-medium text-foreground">{fmtUsd(totalRisk, { compact: true })}</span></span>
            <span>Экспозиция <span className="font-medium text-foreground">{fmtUsd(totalExp, { compact: true })}</span></span>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={filter === "carried" || filter === "overnight" ? Moon : Briefcase}
          title={positions.length === 0 ? "Открытых позиций нет" : "Нет позиций с этим горизонтом"}
          description={
            positions.length === 0
              ? "Сделки со статусом «open» появятся здесь с риском, экспозицией и сроком удержания."
              : "Смените фильтр, чтобы увидеть остальные позиции."
          }
          className={compact ? "py-8" : undefined}
        />
      ) : (
        <>
          {/* mobile cards */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {rows.map((p) => {
              const f = flags(p, limitsByTrader?.get(p.trader));
              return (
                <li key={p.id} className="rounded-xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--field-border)]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link href={links.trade(p.id)} className="font-semibold hover:text-primary">{p.ticker}</Link>
                      <Pill tone={HORIZON_TONE[p.horizon]}>{HORIZON_LABEL[p.horizon]}</Pill>
                      {p.noStatus && <Pill tone="warn">без статуса</Pill>}
                      {f.length > 0 && <AlertTriangle className="h-4 w-4 text-down" aria-label={f.join(", ")} />}
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">{p.daysHeld} дн.</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums">
                    <div><div className="text-muted-foreground">Риск</div><div className="font-medium">{fmtUsd(p.riskUsd)}</div></div>
                    <div><div className="text-muted-foreground">Экспозиция</div><div className="font-medium">{fmtUsd(p.exposureUsd, { compact: true })}</div></div>
                    <div><div className="text-muted-foreground">{showTrader ? "Трейдер" : "Сторона"}</div><div className="truncate font-medium">{showTrader ? traderCell(p.trader) : (p.side ?? "—")}</div></div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* desktop table */}
          <TableScroll className="hidden sm:block">
            <Table>
              <TableHeader className="sticky top-0">
                <TableRow>
                  {sortHead("ticker", "Тикер")}
                  {showTrader && sortHead("trader", "Трейдер")}
                  {sortHead("horizon", "Горизонт")}
                  {sortHead("side", "Сторона")}
                  {sortHead("qty", "Кол-во", "right")}
                  <TableHead className="text-right">Вход / стоп</TableHead>
                  {sortHead("days", "В позиции", "right")}
                  {sortHead("risk", "$ риска", "right")}
                  {sortHead("exposure", "Экспозиция", "right")}
                  <TableHead className="w-10"><span className="sr-only">Действия</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const f = flags(p, limitsByTrader?.get(p.trader));
                  return (
                    <TableRow key={p.id} className={cn(f.length > 0 && "bg-down/5")}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Link href={links.trade(p.id)} className="font-semibold hover:text-primary">{p.ticker}</Link>
                          {p.noStatus && (
                            <span title="У сделки нет статуса — считаем открытой" className="inline-flex"><Pill tone="warn">без статуса</Pill></span>
                          )}
                          {f.length > 0 && (
                            <span title={f.join(", ")} className="inline-flex">
                              <AlertTriangle className="h-3.5 w-3.5 text-down" aria-label={f.join(", ")} />
                            </span>
                          )}
                        </div>
                        {p.setup && <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={p.setup}>{p.setup}</div>}
                      </TableCell>
                      {showTrader && <TableCell>{traderCell(p.trader)}</TableCell>}
                      <TableCell>
                        <Pill tone={HORIZON_TONE[p.horizon]}>{HORIZON_LABEL[p.horizon]}</Pill>
                        {p.horizon === "intraday" && p.daysHeld > 0 && <Pill tone="warn" className="ml-1">не закрыта</Pill>}
                      </TableCell>
                      <TableCell className="text-sm">{p.side ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.qty ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {p.entry ?? "—"} <span className="text-muted-foreground">/ {p.stop ?? "—"}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.daysHeld === 0 ? <span className="text-muted-foreground">сегодня</span> : `${p.daysHeld} дн.`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={cn("font-medium", p.riskMismatch && "text-warn")}>{fmtUsd(p.riskUsd)}</span>
                        {p.riskMismatch ? (
                          <div className="text-2xs text-warn" title="Плановый риск и риск по стопу расходятся больше чем на 25% — берём по стопу">{mismatchText(p)}</div>
                        ) : (
                          <>
                            {p.riskSource === "stop" && <div className="text-2xs text-muted-foreground">по стопу</div>}
                            {p.riskUsd == null && <div className="text-2xs text-muted-foreground">нет стопа/кол-ва</div>}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(p.exposureUsd, { compact: true })}</TableCell>
                      <TableCell>
                        <Link
                          href={links.journalDay(p.date, p.trader)}
                          aria-label={`Журнал ${p.trader} за ${p.date}`}
                          title={`Журнал за ${p.date}`}
                          className="inline-flex rounded-full p-1 text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
        </>
      )}
    </div>
  );
}
