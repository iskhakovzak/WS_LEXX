import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ChevronDown, ExternalLink, ListOrdered, ShieldAlert } from "lucide-react";
import { EmptyState, FilterChip, Panel, Pill, TableScroll, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  HORIZON_LABEL, feesOf, fmtDayShort, fmtMoney, fmtPct, fmtR, grossPnl, netPnl, plural, signedR, splitTags, tradeOutcome,
  tradeRiskPct, type Trade,
} from "./utils";

// Kept for existing importers; the single definition lives in utils.
export { plural } from "./utils";

export type RuleViolation = {
  id: number;
  trader: string | null;
  ruleId: number | null;
  tradeId: number | null;
  severity: string | null;
  message: string | null;
  ruleName: string | null;
  ticker: string | null;
  tradeDate: string | null;
};

const PREVIEW = 15;

const SESSION_LABEL: Record<string, string> = {
  premarket: "Премаркет",
  regular: "Основная сессия",
  afterhours: "Афтермаркет",
  postmarket: "Афтермаркет",
};

const OUTCOME_BAR: Record<ReturnType<typeof tradeOutcome>, string> = {
  win: "bg-up",
  loss: "bg-down",
  be: "bg-muted-foreground/60",
  open: "bg-primary",
};

const OUTCOME_LABEL: Record<ReturnType<typeof tradeOutcome>, string> = {
  win: "Профит",
  loss: "Убыток",
  be: "В ноль",
  open: "Открыта",
};

export function DayTrades({
  trades,
  carried = [],
  opened = [],
  day,
  isLoading,
  violations,
  showTrader,
  emptyAction,
}: {
  /** Trades whose result is realised on this day (closed on it, or still open and entered on it). */
  trades: Trade[];
  /** Overnight/swing positions opened earlier and still held on this day. */
  carried?: Trade[];
  /** Entered on this day but closed on a later one — shown so the entry day is not «empty». */
  opened?: Trade[];
  day: string;
  isLoading: boolean;
  violations: RuleViolation[];
  showTrader: boolean;
  emptyAction?: ReactNode;
}) {
  const [ticker, setTicker] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const ordered = useMemo(
    () => [...trades].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id)),
    [trades],
  );

  const tickers = useMemo(() => {
    const m = new Map<string, TickerAgg>();
    const add = (cur: number | null, v: number | null) => (v == null ? cur : (cur ?? 0) + v);
    for (const t of ordered) {
      const g = m.get(t.ticker) ?? { count: 0, r: null, qty: null, gross: null, fees: null, net: null };
      g.count++;
      g.r = add(g.r, signedR(t));
      g.qty = add(g.qty, typeof t.qty === "number" ? t.qty : null);
      g.gross = add(g.gross, grossPnl(t));
      g.fees = add(g.fees, grossPnl(t) != null ? feesOf(t) : null);
      g.net = add(g.net, netPnl(t));
      m.set(t.ticker, g);
    }
    return Array.from(m.entries());
  }, [ordered]);

  const activeTicker = ticker && tickers.some(([k]) => k === ticker) ? ticker : null;
  const filtered = activeTicker ? ordered.filter((t) => t.ticker === activeTicker) : ordered;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll || filtered.length <= PREVIEW + 3 ? filtered : filtered.slice(0, PREVIEW);

  const violationsByTrade = useMemo(() => {
    const m = new Map<number, RuleViolation[]>();
    for (const v of violations) {
      if (v.tradeId == null) continue;
      const arr = m.get(v.tradeId) ?? [];
      arr.push(v);
      m.set(v.tradeId, arr);
    }
    return m;
  }, [violations]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOpen = visible.length > 0 && visible.every((t) => open.has(t.id));

  return (
    <Panel
      title="Сделки дня"
      icon={ListOrdered}
      description={trades.length > 0 ? `${trades.length} ${plural(trades.length, "сделка", "сделки", "сделок")}` : undefined}
      actions={
        visible.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(allOpen ? new Set() : new Set(visible.map((t) => t.id)))}
          >
            {allOpen ? "Свернуть все" : "Развернуть все"}
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : trades.length === 0 && carried.length === 0 && opened.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="В этот день сделок нет"
          description="Используйте день для плана и подготовки, либо перейдите к последнему торговому дню."
          action={emptyAction}
          className="py-8"
        />
      ) : (
        <div className="space-y-3">
          {trades.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {opened.length > 0 ? "Результатов в этот день нет — позиции открыты и закрываются позже." : "Новых сделок в этот день нет — только перенесённые позиции."}
            </p>
          )}
          {tickers.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр по тикеру">
              <FilterChip active={!activeTicker} onClick={() => setTicker(null)} count={ordered.length}>
                Все
              </FilterChip>
              {tickers.map(([k, g]) => (
                <FilterChip key={k} active={activeTicker === k} onClick={() => setTicker(activeTicker === k ? null : k)}>
                  <span className="font-semibold">{k}</span>
                  <span className={cn("tabular-nums", toneText(toneOf(g.net ?? g.r)))}>{g.net != null ? fmtMoney(g.net) : g.r != null ? fmtR(g.r, 1) : g.count}</span>
                </FilterChip>
              ))}
            </div>
          )}

          <ol className="relative space-y-2">
            {visible.map((t) => (
              <TradeItem
                key={t.id}
                trade={t}
                index={ordered.indexOf(t) + 1}
                isOpen={open.has(t.id)}
                onToggle={() => toggle(t.id)}
                violations={violationsByTrade.get(t.id) ?? []}
                showTrader={showTrader}
              />
            ))}
          </ol>

          {filtered.length > visible.length && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
              Показать все {filtered.length}
            </Button>
          )}

          {tickers.length > 0 && <TickerTable rows={tickers} />}

          {opened.length > 0 && (
            <div className="space-y-2 border-t border-[var(--glass-border)] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="micro-label">Открыты в этот день</span>
                <span className="text-2xs text-muted-foreground">результат учитывается в день закрытия</span>
              </div>
              <ol className="space-y-2">
                {opened.map((t) => (
                  <TradeItem
                    key={t.id}
                    trade={t}
                    index={0}
                    openedHere={t.exitDate ?? null}
                    isOpen={open.has(t.id)}
                    onToggle={() => toggle(t.id)}
                    violations={violationsByTrade.get(t.id) ?? []}
                    showTrader={showTrader}
                  />
                ))}
              </ol>
            </div>
          )}

          {carried.length > 0 && (
            <div className="space-y-2 border-t border-[var(--glass-border)] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="micro-label">Перенесённые позиции</span>
                <span className="text-2xs text-muted-foreground">открыты раньше, удерживаются в этот день</span>
              </div>
              <ol className="space-y-2">
                {carried.map((t) => (
                  <TradeItem
                    key={t.id}
                    trade={t}
                    index={0}
                    carriedFrom={t.date}
                    closesToday={t.exitDate === day}
                    isOpen={open.has(t.id)}
                    onToggle={() => toggle(t.id)}
                    violations={violationsByTrade.get(t.id) ?? []}
                    showTrader={showTrader}
                  />
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function TradeItem({
  trade: t,
  index,
  carriedFrom,
  closesToday,
  openedHere,
  isOpen,
  onToggle,
  violations,
  showTrader,
}: {
  trade: Trade;
  index: number;
  carriedFrom?: string;
  closesToday?: boolean;
  /** Entered on the shown day; closes on this later date (null = still open). */
  openedHere?: string | null;
  isOpen: boolean;
  onToggle: () => void;
  violations: RuleViolation[];
  showTrader: boolean;
}) {
  const reduce = useReducedMotion();
  const r = signedR(t);
  const net = netPnl(t);
  const gross = grossPnl(t);
  const fees = gross != null ? feesOf(t) : null;
  const outcome = tradeOutcome(t);
  const riskPct = tradeRiskPct(t);
  const tags = splitTags(t.tags);
  const isShort = (t.side ?? "").toLowerCase() === "short";
  const hasText = !!(t.notes || t.whatWorked || t.whatFailed || t.conclusion);
  const detailsId = `journal-trade-${t.id}`;

  return (
    <li className="relative overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", OUTCOME_BAR[outcome])} aria-hidden="true" />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={detailsId}
        className="flex w-full items-center gap-3 py-2.5 pl-4 pr-3 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="w-5 shrink-0 text-center text-2xs tabular-nums text-muted-foreground">{index > 0 ? index : "↪"}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{t.ticker}</span>
            {t.side && <Pill>{isShort ? "↘ Short" : "↗ Long"}</Pill>}
            {t.setup && <span className="truncate text-xs text-muted-foreground">{t.setup}</span>}
            {t.horizon && t.horizon !== "intraday" && <Pill tone="purple">{HORIZON_LABEL[t.horizon] ?? t.horizon}</Pill>}
            {carriedFrom && <Pill>с {fmtDayShort(carriedFrom)}</Pill>}
            {closesToday && <Pill tone="accent">закрыта в этот день</Pill>}
            {openedHere !== undefined && (
              <Pill tone="purple">{openedHere ? `открыта, закрыта ${fmtDayShort(openedHere)}` : "открыта, ещё держится"}</Pill>
            )}
            {violations.length > 0 && (
              <Pill tone="warn"><ShieldAlert className="h-3 w-3" aria-hidden="true" />{violations.length}</Pill>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted-foreground tabular-nums">
            {showTrader && t.trader && <span className="text-foreground/80">{t.trader}</span>}
            {t.session && <span>{SESSION_LABEL[t.session] ?? t.session}</span>}
            <span>
              {t.entry ?? "—"} → {t.exit ?? "…"}
            </span>
            {t.stop != null && <span>стоп {t.stop}</span>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          {net != null ? (
            <span className={cn("text-sm font-semibold tabular-nums", toneText(toneOf(net)))}>{fmtMoney(net)}</span>
          ) : (
            <span className={cn("text-sm font-semibold tabular-nums", toneText(toneOf(r)))}>{r != null ? fmtR(r) : OUTCOME_LABEL[outcome]}</span>
          )}
          {net != null && r != null && (
            <span className={cn("text-xs tabular-nums", toneText(toneOf(r)))}>{fmtR(r)}</span>
          )}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-2)] motion-reduce:transition-none", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={detailsId}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-[var(--glass-border)] py-3 pl-4 pr-3 sm:pl-12">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <Fact label="Вход" value={t.entry} />
                <Fact label="Выход" value={t.exit} />
                <Fact label="Стоп" value={t.stop} />
                <Fact label="Риск на акцию" value={riskPct != null ? fmtPct(riskPct) : null} />
                <Fact label="Удержание" value={t.holdTime} />
                <Fact label="Проскальзывание" value={t.slippage != null ? `${t.slippage}¢` : null} />
                <Fact label="RVOL" value={t.relativeVolume != null ? `${t.relativeVolume}×` : null} />
                <Fact label="Результат" value={OUTCOME_LABEL[outcome]} />
                <Fact label="Кол-во" value={t.qty != null ? t.qty.toLocaleString("en-US") : null} />
                <Fact label="P&L брутто" value={gross != null ? fmtMoney(gross) : null} />
                <Fact label="Комиссии" value={fees != null ? fmtMoney(-fees) : null} />
                <Fact label="P&L нетто" value={net != null ? fmtMoney(net) : null} />
                <Fact label="Риск, $" value={t.riskUsd != null ? fmtMoney(t.riskUsd, false) : null} />
                <Fact label="Горизонт" value={t.horizon ? HORIZON_LABEL[t.horizon] ?? t.horizon : null} />
                <Fact label="Дата выхода" value={t.exitDate ? fmtDayShort(t.exitDate) : null} />
              </dl>

              {hasText && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {t.notes && <TextBlock label="Заметки" text={t.notes} className="sm:col-span-2" />}
                  {t.whatWorked && <TextBlock label="Что сработало" text={t.whatWorked} tone="up" />}
                  {t.whatFailed && <TextBlock label="Что не сработало" text={t.whatFailed} tone="down" />}
                  {t.conclusion && <TextBlock label="Вывод" text={t.conclusion} className="sm:col-span-2" />}
                </div>
              )}

              {violations.length > 0 && (
                <ul className="space-y-1">
                  {violations.map((v) => (
                    <li key={v.id} className="flex items-start gap-2 text-xs">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
                      <span>
                        <span className="font-medium">{v.ruleName ?? "Правило"}</span>
                        {v.message && <span className="text-muted-foreground"> — {v.message}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((tg) => (
                  <Pill key={tg}>{tg}</Pill>
                ))}
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {t.screenshotUrl && /^https?:\/\//i.test(t.screenshotUrl) && (
                    <Button asChild variant="ghost" size="sm">
                      <a href={t.screenshotUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink aria-hidden="true" />График
                      </a>
                    </Button>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/trades?highlight=${t.id}`}>
                      <ArrowUpRight aria-hidden="true" />Открыть сделку
                    </Link>
                  </Button>
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

type TickerAgg = { count: number; r: number | null; qty: number | null; gross: number | null; fees: number | null; net: number | null };

/** Per-ticker summary — only real, computed columns. */
function TickerTable({ rows }: { rows: Array<[string, TickerAgg]> }) {
  const sum = (k: keyof TickerAgg) =>
    rows.reduce<number | null>((acc, [, g]) => (g[k] == null ? acc : (acc ?? 0) + (g[k] as number)), null);
  const total: TickerAgg = { count: sum("count") ?? 0, r: sum("r"), qty: sum("qty"), gross: sum("gross"), fees: sum("fees"), net: sum("net") };
  const money = (v: number | null) => (v == null ? "—" : fmtMoney(v));
  const showQty = total.qty != null;
  const showMoney = total.gross != null || total.fees != null;
  const showR = total.r != null;
  // Without size/money data the table would only repeat the ticker chips — skip it.
  if (!showQty && !showMoney) return null;
  const cells = (g: TickerAgg) => [
    <td key="n" className="px-2 py-1.5 text-right">{g.count}</td>,
    showQty && <td key="q" className="px-2 py-1.5 text-right">{g.qty != null ? g.qty.toLocaleString("en-US") : "—"}</td>,
    showMoney && <td key="g" className={cn("px-2 py-1.5 text-right", toneText(toneOf(g.gross)))}>{money(g.gross)}</td>,
    showMoney && <td key="f" className="px-2 py-1.5 text-right text-muted-foreground">{g.fees != null ? fmtMoney(-g.fees) : "—"}</td>,
    showMoney && <td key="t" className={cn("px-2 py-1.5 text-right font-medium", toneText(toneOf(g.net)))}>{money(g.net)}</td>,
    showR && <td key="r" className={cn("px-2 py-1.5 text-right font-medium", toneText(toneOf(g.r)))}>{fmtR(g.r)}</td>,
  ];
  return (
    <TableScroll>
      <table className={cn("w-full text-xs tabular-nums", showMoney && "min-w-[480px]")}>
        <caption className="sr-only">Итоги по тикерам</caption>
        <thead>
          <tr className="border-b border-[var(--glass-border)] text-muted-foreground">
            <th scope="col" className="px-2 py-1.5 text-left font-medium">Тикер</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">Сделки</th>
            {showQty && <th scope="col" className="px-2 py-1.5 text-right font-medium">Кол-во</th>}
            {showMoney && <th scope="col" className="px-2 py-1.5 text-right font-medium">Брутто</th>}
            {showMoney && <th scope="col" className="px-2 py-1.5 text-right font-medium">Комиссии</th>}
            {showMoney && <th scope="col" className="px-2 py-1.5 text-right font-medium">Нетто</th>}
            {showR && <th scope="col" className="px-2 py-1.5 text-right font-medium">R</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, g]) => (
            <tr key={k} className="border-b border-[var(--glass-border)]">
              <th scope="row" className="px-2 py-1.5 text-left font-semibold">{k}</th>
              {cells(g)}
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="px-2 py-1.5 text-left">Итого</th>
              {cells(total)}
            </tr>
          </tfoot>
        )}
      </table>
    </TableScroll>
  );
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums">{value == null || value === "" ? "—" : value}</dd>
    </div>
  );
}

function TextBlock({ label, text, tone, className }: { label: string; text: string; tone?: "up" | "down"; className?: string }) {
  return (
    <div className={cn("rounded-xl bg-[var(--glass-bg)] p-3", className)}>
      <div className={cn("micro-label mb-1", tone === "up" && "text-up", tone === "down" && "text-down")}>{label}</div>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">{text}</p>
    </div>
  );
}
