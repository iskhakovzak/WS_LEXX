/**
 * «Отчёт по овернайт-книге» — what the desk carries through the close (key time 15:45 ET):
 * positions by trader marked to live quotes, catalysts inside the holding window, gap scenarios
 * (−1/−2/−3 ATR, custom %) against daily limits, and concentration (ticker / sector / side / shared names).
 */
import * as React from "react";
import { Link } from "wouter";
import { AlertTriangle, Briefcase, CalendarClock, Download, Layers, Moon, Printer, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { nyDate, addDays } from "@/lib/trading-date";
import { EmptyState, Panel, Pill, Segmented, StatCard, StatGrid, TableScroll, toneOf } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Catalyst, EarningsHit, OfferingHit, OvernightBook, OvernightTrader, RiskPosition } from "./use-risk";
import { HttpError, useEarningsMap, useOfferingsMap, useOvernightBook, useQuotes } from "./use-risk";
import { HORIZON_LABEL, HORIZON_TONE, LimitBar, StopPill, fmtPct, fmtSignedUsd, fmtUsd, usageText, useStoredState } from "./primitives";
import {
  DEFAULT_SHOCKS, concentration, customPctShock, markPosition, runShock, toCsv,
  type BookPosition, type Marked, type ShockMode, type ShockResult, type TraderRoom,
} from "./risk-math";

type Mode = "book" | "all";
const MODES: readonly Mode[] = ["book", "all"];
const SHOCK_MODES: readonly ShockMode[] = ["market", "adverse"];

type CatalystChip = { kind: "earnings" | "offering" | "catalyst"; label: string; date: string; urgent: boolean; title: string };

function catalystsFor(ticker: string, today: string, book: OvernightBook | undefined, earnings: Record<string, EarningsHit> | undefined, offerings: Record<string, OfferingHit> | undefined): CatalystChip[] {
  const out: CatalystChip[] = [];
  const t = ticker.toUpperCase();
  const soon = addDays(today, 3);
  const dd = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  const e = earnings?.[t];
  if (e) out.push({ kind: "earnings", label: `Отчёт ${dd(e.date)} ${e.callType}`, date: e.date, urgent: e.date <= soon, title: `Earnings ${e.date} ${e.callType}${e.company ? ` — ${e.company}` : ""}` });
  const o = offerings?.[t];
  if (o) out.push({ kind: "offering", label: `${o.type} ${dd(o.date)}`, date: o.date, urgent: true, title: `Размещение: ${o.type}${o.dealSizeM != null ? ` $${o.dealSizeM}M` : ""}${o.dilutionPct != null ? `, размытие ${o.dilutionPct}%` : ""} (${o.status})` });
  for (const c of (book?.catalysts?.[t] ?? []) as Catalyst[]) {
    out.push({ kind: "catalyst", label: `${c.type} ${dd(c.date)}`, date: c.date, urgent: c.date <= soon || c.impact === "high", title: `${c.type} ${c.date}${c.description ? ` — ${c.description}` : ""} (${c.impact})` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function CatalystPills({ items }: { items: CatalystChip[] }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((c, i) => (
        <span key={i} title={c.title} className="inline-flex">
          <Pill tone={c.urgent ? "down" : c.kind === "earnings" ? "warn" : "neutral"}>{c.label}</Pill>
        </span>
      ))}
    </div>
  );
}

function downloadCsv(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #risk-overnight-print, #risk-overnight-print * { visibility: visible !important; }
  #risk-overnight-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
  #risk-overnight-print .no-print { display: none !important; }
  #risk-overnight-print .glass-panel { background: transparent !important; box-shadow: none !important; border: 1px solid hsl(var(--border)); break-inside: avoid; }
  #risk-overnight-print table { font-size: 11px; }
}`;

type Row = { p: RiskPosition; m: Marked; cats: CatalystChip[]; pctOfMax: number | null };

export function OvernightView({ trader, isCurator, onUpdatedAt }: { trader: string | null; isCurator: boolean; onUpdatedAt?: (ts: number) => void }) {
  const scope = isCurator ? null : trader;
  const [mode, setMode] = useStoredState<Mode>("risk.overnight.mode", "book", MODES);
  const [shockMode, setShockMode] = useStoredState<ShockMode>("risk.overnight.shockMode", "market", SHOCK_MODES);
  const [customPct, setCustomPct] = React.useState<string>(() => {
    try { return localStorage.getItem("risk.overnight.customPct") ?? "-5"; } catch { return "-5"; }
  });
  const book = useOvernightBook(scope, mode === "all");
  const data = book.data;
  const tickers = React.useMemo(() => (data?.positions ?? []).map((p) => p.ticker), [data]);
  const quotes = useQuotes(tickers);
  const earnings = useEarningsMap(tickers.length > 0);
  const offerings = useOfferingsMap(tickers.length > 0);
  const today = data?.date ?? nyDate();

  React.useEffect(() => {
    if (book.dataUpdatedAt) onUpdatedAt?.(book.dataUpdatedAt);
  }, [book.dataUpdatedAt, onUpdatedAt]);

  React.useEffect(() => {
    try { localStorage.setItem("risk.overnight.customPct", customPct); } catch { /* ignore */ }
  }, [customPct]);

  const q = quotes.data ?? {};
  const traderBy = React.useMemo(() => new Map((data?.traders ?? []).map((t) => [t.trader, t])), [data]);

  const rows: Row[] = React.useMemo(
    () =>
      (data?.positions ?? []).map((p) => {
        const m = markPosition(p, q[p.ticker.toUpperCase()]);
        const L = traderBy.get(p.trader)?.limits;
        return { p, m, cats: catalystsFor(p.ticker, today, data, earnings.data, offerings.data), pctOfMax: L?.maxOvernightExposure != null && m.marketValueUsd != null ? (L.maxOvernightExposure > 0 ? (m.marketValueUsd / L.maxOvernightExposure) * 100 : 100) : null };
      }),
    [data, q, traderBy, today, earnings.data, offerings.data],
  );
  const byTrader = React.useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) (m.get(r.p.trader) ?? m.set(r.p.trader, []).get(r.p.trader)!).push(r);
    for (const arr of m.values()) arr.sort((a, b) => (b.m.marketValueUsd ?? 0) - (a.m.marketValueUsd ?? 0));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const totals = React.useMemo(() => {
    const mv = rows.reduce((s, r) => s + (r.m.marketValueUsd ?? 0), 0);
    const unreal = rows.filter((r) => r.m.unrealizedUsd != null);
    return {
      mv,
      unrealized: unreal.length ? unreal.reduce((s, r) => s + (r.m.unrealizedUsd ?? 0), 0) : null,
      quoted: rows.filter((r) => r.m.last != null).length,
      riskToStop: rows.reduce((s, r) => s + (r.m.riskToStopUsd ?? 0), 0),
      catalysts: rows.filter((r) => r.cats.some((c) => c.urgent)).length,
    };
  }, [rows]);

  const bookPositions: BookPosition[] = React.useMemo(() => rows.map((r) => r.p), [rows]);
  const rooms: TraderRoom[] = React.useMemo(
    () => (data?.traders ?? []).map((t) => ({ trader: t.trader, limits: t.limits, dailyRemainingUsd: t.dailyRemainingUsd })),
    [data],
  );
  const custom = Number(customPct.replace(",", "."));
  const shocks = React.useMemo(() => [...DEFAULT_SHOCKS, ...(Number.isFinite(custom) && custom !== 0 ? [customPctShock(custom)] : [])], [custom]);
  const results: ShockResult[] = React.useMemo(() => shocks.map((s) => runShock(bookPositions, q, rooms, s, shockMode)), [shocks, bookPositions, q, rooms, shockMode]);
  const conc = React.useMemo(() => concentration(bookPositions, q), [bookPositions, q]);

  const exportCsv = () => {
    const head = ["Дата", "Трейдер", "Тикер", "Сторона", "Горизонт", "Дней в позиции", "Кол-во", "Средняя цена", "Последняя цена", "Нереализ. P&L $", "Нереализ. %", "Стоп", "Риск до стопа $", "Рыночная стоимость $", "% от макс. овернайт", "ATR", "Источник ATR", "Сектор", "Катализаторы", "Источник сделки", "ID сделки"];
    const body = rows.map(({ p, m, cats, pctOfMax }) => [
      today, p.trader, p.ticker, p.side ?? "", HORIZON_LABEL[p.horizon], p.daysHeld, p.qty, p.entry, m.last, m.unrealizedUsd, m.unrealizedPct, p.stop, m.riskToStopUsd, m.marketValueUsd,
      pctOfMax == null ? "" : Math.round(pctOfMax), m.atr, m.atrSource ?? "", p.sector ?? "", cats.map((c) => c.label).join(", "), p.source, p.id,
    ]);
    const scen: (string | number | null | undefined)[][] = [[], ["Гэп-сценарии", shockMode === "market" ? "рынок вниз" : "против каждой позиции"], ["Трейдер", ...results.map((r) => `${r.shock.label} P&L $`), ...results.map((r) => `${r.shock.label} остаток дня $`)]];
    const traders = [...new Set(rows.map((r) => r.p.trader))].sort();
    for (const t of traders) {
      const cells = results.map((r) => r.traders.find((x) => x.trader === t)?.pnlUsd ?? "");
      const rem = results.map((r) => r.traders.find((x) => x.trader === t)?.remainingAfterUsd ?? "");
      scen.push([t, ...cells, ...rem]);
    }
    scen.push(["Деск", ...results.map((r) => r.desk.pnlUsd), ...results.map(() => "")]);
    downloadCsv(`overnight-book-${today}.csv`, toCsv([head, ...body, ...scen]));
  };

  if (book.isError) {
    const notReady = book.error instanceof HttpError && book.error.status === 404;
    return (
      <Panel>
        <EmptyState icon={Moon} title={notReady ? "Овернайт-книга ещё не подключена на сервере" : "Не удалось загрузить овернайт-книгу"} description={notReady ? "API /api/risk/overnight появится после пересборки сервера." : (book.error as Error).message} />
      </Panel>
    );
  }

  const keyPill = data
    ? data.afterKey
      ? <Pill tone="accent" dot>срез 15:45 ET прошёл — в книге все открытые</Pill>
      : data.minutesToKey != null
        ? <Pill tone={data.minutesToKey <= 30 ? "warn" : "neutral"} dot>до среза 15:45 ET: {data.minutesToKey >= 60 ? `${Math.floor(data.minutesToKey / 60)} ч ${data.minutesToKey % 60} мин` : `${data.minutesToKey} мин`}</Pill>
        : <Pill tone="neutral">срез 15:45 ET</Pill>
    : null;

  const empty = !book.isLoading && !!data && rows.length === 0;

  return (
    <div id="risk-overnight-print" className="flex flex-col gap-[var(--grid-gap)]">
      <style>{PRINT_CSS}</style>

      {/* Print-only header */}
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">Отчёт по овернайт-книге — {today}</h1>
        <p className="text-sm text-muted-foreground">
          {isCurator ? "Весь деск" : trader} · сформирован {new Date().toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })} · котировки {quotes.dataUpdatedAt ? new Date(quotes.dataUpdatedAt).toLocaleTimeString("ru-RU", { timeStyle: "short" }) : "—"}
        </p>
      </div>

      {!empty && <StatGrid>
        {book.isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)
        ) : (
          <>
            <StatCard label="Овернайт-экспозиция" icon={Moon} value={fmtUsd(totals.mv, { compact: true })} hint={`${rows.length} поз. · ${byTrader.length} трейд. · по рынку${totals.quoted < rows.length ? ` (${rows.length - totals.quoted} без котировки)` : ""}`} />
            <StatCard label="Нереализованный P&L" value={totals.unrealized != null ? fmtSignedUsd(totals.unrealized) : "—"} tone={toneOf(totals.unrealized)} hint={totals.unrealized == null ? "нет котировок" : "по последней цене"} />
            <StatCard label="Риск до стопов" icon={Briefcase} value={fmtUsd(totals.riskToStop, { compact: true })} hint="если все стопы сработают на открытии" tone={totals.riskToStop > 0 ? "down" : "neutral"} />
            <StatCard label="С катализатором" icon={CalendarClock} value={totals.catalysts} tone={totals.catalysts ? "warn" : "neutral"} hint="отчёт / размещение в ближайшие 3 дня" />
          </>
        )}
      </StatGrid>}

      <Panel
        title="Книга через закрытие"
        icon={Moon}
        description={mode === "all" ? "Предпросмотр: все открытые позиции, как будто срез 15:45 ET уже прошёл" : "Позиции, которые уйдут через закрытие: перенос, овернайт, свинг — с гэп-риском"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {keyPill}
            <Segmented
              ariaLabel="Состав книги"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "book", label: "Книга" },
                { value: "all", label: "Все открытые" },
              ]}
              className="no-print"
            />
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length} className="no-print">
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!rows.length} className="no-print">
              <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />Печать
            </Button>
          </div>
        }
      >
        {book.isLoading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={Moon}
            title={mode === "all" ? "Открытых позиций нет" : "Через закрытие ничего не переносится"}
            description={mode === "all" ? "Гэп-сценарии и концентрация появятся, когда будут открытые позиции." : data?.afterKey ? "Все позиции закрыты до среза 15:45 ET." : "До 15:45 ET здесь только перенос, овернайт и свинг."}
            action={mode === "book" && !data?.afterKey ? <Button size="sm" variant="outline" onClick={() => setMode("all")}>Показать все открытые</Button> : undefined}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {byTrader.map(([name, list]) => {
              const t = traderBy.get(name);
              return <TraderBlock key={name} name={name} t={t} rows={list} showTrader={isCurator} />;
            })}
          </div>
        )}
      </Panel>

      {!empty && <div className="grid grid-cols-1 gap-[var(--grid-gap)] xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Гэп-сценарии"
          icon={Sparkles}
          description="Шок книги на открытии: P&L по трейдерам и деску против остатка дневного лимита"
          actions={
            <div className="flex flex-wrap items-center gap-2 no-print">
              <Segmented
                ariaLabel="Направление шока"
                size="sm"
                value={shockMode}
                onChange={setShockMode}
                options={[
                  { value: "market", label: "Рынок вниз" },
                  { value: "adverse", label: "Против каждой" },
                ]}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                свой %
                <Input
                  inputMode="decimal"
                  value={customPct}
                  onChange={(e) => setCustomPct(e.target.value)}
                  aria-label="Свой гэп, % (отрицательный — вниз)"
                  className="h-8 w-20 text-right"
                />
              </label>
            </div>
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Сценарии появятся, когда в книге будут позиции.</p>
          ) : (
            <ScenarioTable results={results} rooms={rooms} shockMode={shockMode} />
          )}
        </Panel>

        <Panel className="xl:col-span-2" title="Концентрация" icon={Layers} description="Экспозиция по тикерам, секторам и сторонам; общие имена у нескольких трейдеров">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет позиций в книге.</p>
          ) : (
            <ConcentrationPanel c={conc} />
          )}
        </Panel>
      </div>}
    </div>
  );
}

function TraderBlock({ name, t, rows, showTrader }: { name: string; t: OvernightTrader | undefined; rows: Row[]; showTrader: boolean }) {
  const mv = rows.reduce((s, r) => s + (r.m.marketValueUsd ?? 0), 0);
  const unreal = rows.filter((r) => r.m.unrealizedUsd != null);
  const unrealSum = unreal.length ? unreal.reduce((s, r) => s + (r.m.unrealizedUsd ?? 0), 0) : null;
  const risk = rows.reduce((s, r) => s + (r.m.riskToStopUsd ?? 0), 0);
  const L = t?.limits;
  const forbidden = L && !L.allowOvernight && rows.some((r) => r.p.horizon !== "swing");
  const forbiddenSwing = L && !L.allowSwing && rows.some((r) => r.p.horizon === "swing");
  return (
    <section aria-label={`Овернайт-книга: ${name}`} className="rounded-xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--field-border)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          {showTrader ? <Link href={links.risk(name)} className="font-semibold hover:text-primary">{name}</Link> : <span className="font-semibold">{name}</span>}
          {t && <StopPill state={t.stop.state} />}
          {forbidden && <Pill tone="down" dot>овернайт запрещён</Pill>}
          {forbiddenSwing && <Pill tone="down" dot>свинг запрещён</Pill>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>экспозиция <span className="font-medium text-foreground">{fmtUsd(mv, { compact: true })}</span></span>
          <span>нереализ. <span className={cn("font-medium", unrealSum == null ? "" : unrealSum > 0 ? "text-up" : unrealSum < 0 ? "text-down" : "text-foreground")}>{unrealSum != null ? fmtSignedUsd(unrealSum) : "—"}</span></span>
          <span>риск до стопов <span className="font-medium text-foreground">{fmtUsd(risk, { compact: true })}</span></span>
          {t && (
            <span className="inline-flex items-center gap-1">
              сегодня <span className={cn("font-medium", toneOf(t.todayPnlNet) === "up" ? "text-up" : toneOf(t.todayPnlNet) === "down" ? "text-down" : "text-foreground")}>{t.todayPnlNet != null ? fmtSignedUsd(t.todayPnlNet) : "—"}</span>
            </span>
          )}
        </div>
        <div className="ml-auto w-full sm:w-64">
          <LimitBar size="sm" label="Макс. овернайт" used={mv} limit={L?.maxOvernightExposure} hint={t?.dailyRemainingUsd != null ? `остаток дня ${fmtUsd(t.dailyRemainingUsd)}` : undefined} />
        </div>
      </div>

      <TableScroll className="mt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Тикер</TableHead>
              <TableHead>Сторона</TableHead>
              <TableHead className="text-right">Кол-во</TableHead>
              <TableHead className="text-right">Средняя</TableHead>
              <TableHead className="text-right">Последняя</TableHead>
              <TableHead className="text-right">Нереализ.</TableHead>
              <TableHead className="text-right">До стопа</TableHead>
              <TableHead className="text-right">% овернайт</TableHead>
              <TableHead>Катализаторы</TableHead>
              <TableHead>Сектор</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ p, m, cats, pctOfMax }) => (
              <TableRow key={p.id} className={cn(cats.some((c) => c.urgent) && "bg-warn/5")}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Link href={links.trade(p.id)} className="font-semibold hover:text-primary">{p.ticker}</Link>
                    <Pill tone={HORIZON_TONE[p.horizon]}>{HORIZON_LABEL[p.horizon]}</Pill>
                    {p.noStatus && <Pill tone="warn">без статуса</Pill>}
                  </div>
                  <div className="text-2xs text-muted-foreground">{p.daysHeld === 0 ? "открыта сегодня" : `${p.daysHeld} дн. в позиции`}{p.setup ? ` · ${p.setup}` : ""}</div>
                </TableCell>
                <TableCell className="text-sm">{p.side ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{p.qty ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{p.entry ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.last != null ? m.last : <span className="text-muted-foreground">—</span>}
                  {m.unrealizedPct != null && <div className={cn("text-2xs", m.unrealizedPct > 0 ? "text-up" : m.unrealizedPct < 0 ? "text-down" : "text-muted-foreground")}>{m.unrealizedPct > 0 ? "+" : ""}{m.unrealizedPct}%</div>}
                </TableCell>
                <TableCell className={cn("text-right font-medium tabular-nums", m.unrealizedUsd == null ? "text-muted-foreground" : m.unrealizedUsd > 0 ? "text-up" : m.unrealizedUsd < 0 ? "text-down" : "")}>
                  {m.unrealizedUsd != null ? fmtSignedUsd(m.unrealizedUsd) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.riskToStopUsd != null ? fmtUsd(m.riskToStopUsd) : <span className="text-muted-foreground">нет стопа</span>}
                  {p.stop != null && <div className="text-2xs text-muted-foreground">стоп {p.stop}{m.riskToStopUsd === 0 ? " · пробит" : ""}</div>}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", usageText(pctOfMax))}>{pctOfMax != null ? fmtPct(pctOfMax) : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><CatalystPills items={cats} /></TableCell>
                <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">{p.sector ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
    </section>
  );
}

function ScenarioTable({ results, rooms, shockMode }: { results: ShockResult[]; rooms: TraderRoom[]; shockMode: ShockMode }) {
  const traders = React.useMemo(() => [...new Set(results.flatMap((r) => r.traders.map((t) => t.trader)))].sort(), [results]);
  const roomBy = new Map(rooms.map((r) => [r.trader, r]));
  const breachers = new Map<string, string[]>();
  for (const r of results) for (const t of r.desk.breaches) breachers.set(t, [...(breachers.get(t) ?? []), r.shock.label]);
  return (
    <div className="flex flex-col gap-3">
      {breachers.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-down/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-down" aria-hidden="true" />
          <span className="font-medium">Пробьют дневной стоп:</span>
          {[...breachers.entries()].map(([t, labels]) => (
            <Pill key={t} tone="down">{t} · {labels[0]}{labels.length > 1 ? ` и ещё ${labels.length - 1}` : ""}</Pill>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Ни один сценарий не пробивает дневной стоп{rooms.every((r) => r.dailyRemainingUsd == null) ? " (лимиты не заданы — сравнивать не с чем)" : ""}.</p>
      )}
      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Трейдер</TableHead>
              <TableHead className="text-right">Остаток дня</TableHead>
              {results.map((r) => <TableHead key={r.shock.key} className="text-right">{r.shock.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {traders.map((t) => {
              const room = roomBy.get(t);
              return (
                <TableRow key={t}>
                  <TableCell className="font-medium">{t}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{room?.dailyRemainingUsd != null ? fmtUsd(room.dailyRemainingUsd) : "—"}</TableCell>
                  {results.map((r) => {
                    const x = r.traders.find((y) => y.trader === t);
                    if (!x) return <TableCell key={r.shock.key} className="text-right">—</TableCell>;
                    return (
                      <TableCell key={r.shock.key} className={cn("text-right tabular-nums", x.breach && "bg-down/10")}>
                        <div className={cn("font-medium", x.pnlUsd > 0 ? "text-up" : x.pnlUsd < 0 ? "text-down" : "")}>{fmtSignedUsd(x.pnlUsd)}</div>
                        {x.remainingAfterUsd != null && (
                          <div className={cn("text-2xs", x.breach ? "font-semibold text-down" : "text-muted-foreground")}>
                            {x.breach ? `стоп −${fmtUsd(-x.remainingAfterUsd)}` : `ост. ${fmtUsd(x.remainingAfterUsd)}`}
                          </div>
                        )}
                        {x.worst[0]?.pnlUsd != null && x.worst[0].pnlUsd < 0 && <div className="text-2xs text-muted-foreground">{x.worst[0].ticker} {fmtSignedUsd(x.worst[0].pnlUsd, true)}</div>}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            <TableRow className="font-semibold">
              <TableCell>Деск</TableCell>
              <TableCell />
              {results.map((r) => (
                <TableCell key={r.shock.key} className={cn("text-right tabular-nums", r.desk.pnlUsd > 0 ? "text-up" : r.desk.pnlUsd < 0 ? "text-down" : "")}>
                  {fmtSignedUsd(r.desk.pnlUsd)}
                  {r.desk.breaches.length > 0 && <div className="text-2xs font-normal text-down">{r.desk.breaches.length} наруш.</div>}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </TableScroll>
      <p className="text-2xs text-muted-foreground">
        ATR из котировки (14 дн.), иначе из кэша тикера, иначе 3% от цены. {shockMode === "market" ? "«Рынок вниз»: все тикеры гэпают вниз — шорты зарабатывают." : "«Против каждой»: каждая позиция идёт против себя — худший случай для книги."} Остаток дня = дневной лимит − сегодняшний убыток.
      </p>
    </div>
  );
}

function Bars({ items, max }: { items: { key: string; value: number; pct: number; sub?: React.ReactNode; tone?: "up" | "down" | "accent" | "neutral" }[]; max: number }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((it) => (
        <li key={it.key} className="text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">{it.key}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{fmtUsd(it.value, { compact: true })} · {Math.round(it.pct)}%</span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg)] ring-1 ring-inset ring-[var(--field-border)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${max > 0 ? Math.max(2, (it.value / max) * 100) : 0}%`,
                background: it.tone === "down" ? "hsl(var(--down))" : it.tone === "up" ? "hsl(var(--up))" : it.tone === "accent" ? "hsl(var(--primary))" : "hsl(var(--chart-1))",
              }}
            />
          </div>
          {it.sub && <div className="mt-0.5 text-2xs text-muted-foreground">{it.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

function ConcentrationPanel({ c }: { c: ReturnType<typeof concentration> }) {
  const topTickers = c.byTicker.slice(0, 6);
  const topSectors = c.bySector.slice(0, 6);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="micro-label">Лонг / шорт</span>
          <span className="tabular-nums text-muted-foreground">нетто {fmtSignedUsd(c.netUsd, true)}</span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)] ring-1 ring-inset ring-[var(--field-border)]" role="img" aria-label={`Лонг ${Math.round(c.bySide.longPct)}%, шорт ${Math.round(100 - c.bySide.longPct)}%`}>
          <div className="h-full bg-up" style={{ width: `${c.bySide.longPct}%` }} />
          <div className="h-full bg-down" style={{ width: `${100 - c.bySide.longPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-2xs tabular-nums text-muted-foreground">
          <span>лонг {fmtUsd(c.longUsd, { compact: true })} ({Math.round(c.bySide.longPct)}%)</span>
          <span>шорт {fmtUsd(c.shortUsd, { compact: true })}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="micro-label mb-1.5">По тикерам{c.topTickerPct >= 40 && <Pill tone="warn" className="ml-2">топ {Math.round(c.topTickerPct)}%</Pill>}</div>
          <Bars max={topTickers[0]?.grossUsd ?? 0} items={topTickers.map((b) => ({ key: b.key, value: b.grossUsd, pct: b.pctOfGross, tone: b.traders.length > 1 ? "accent" : "neutral", sub: b.traders.length > 1 ? `${b.traders.length} трейдера: ${b.traders.join(", ")}` : undefined }))} />
        </div>
        <div>
          <div className="micro-label mb-1.5">По секторам</div>
          <Bars max={topSectors[0]?.grossUsd ?? 0} items={topSectors.map((b) => ({ key: b.key, value: b.grossUsd, pct: b.pctOfGross, tone: b.key === "Без сектора" ? "neutral" : "accent", sub: `${b.count} поз. · лонг ${fmtUsd(b.longUsd, { compact: true })} / шорт ${fmtUsd(b.shortUsd, { compact: true })}` }))} />
        </div>
      </div>

      <div>
        <div className="micro-label mb-1.5 flex items-center gap-1"><Users className="h-3 w-3" aria-hidden="true" />Один тикер у нескольких трейдеров</div>
        {c.sharedTickers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Пересечений нет.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {c.sharedTickers.map((s) => (
              <li key={s.ticker}>
                <Pill tone={s.sameSide ? "warn" : "neutral"}>{s.ticker} · {s.traders.join(", ")} · {s.sameSide ? `все ${s.sides[0] === "long" ? "лонг" : "шорт"}` : "разные стороны"} · {fmtUsd(s.grossUsd, { compact: true })}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="micro-label mb-1.5">Коррелированные лонги (один сектор)</div>
        {c.correlatedLongs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Нет сектора с двумя и более лонгами.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {c.correlatedLongs.map((g) => (
              <li key={g.sector} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-warn/10 px-2 py-1.5">
                <span className="font-medium">{g.sector}</span>
                <span className="tabular-nums text-muted-foreground">{fmtUsd(g.longUsd, { compact: true })} · {Math.round(g.pctOfGross)}% книги</span>
                <span className="text-muted-foreground">{g.tickers.join(", ")} · {g.traders.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
